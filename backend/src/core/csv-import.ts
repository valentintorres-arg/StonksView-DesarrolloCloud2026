// Importación masiva de tenencias por CSV (tarea 4.7, issue #37).
// Reglas: RN-43 (columnas y validaciones del alta manual), RN-44 (todo o nada
// con errores por número de línea) y RN-07 (normalización de sedes).

import { z } from "zod";
import {
  createHoldingSchema,
  type Holding,
  type HoldingRow,
  type NewHolding,
  type StoreResult,
  toHolding,
} from "./portfolios";
import { internalError, invalidRequest, mapRpcError, type Outcome } from "./rpc";

const MAX_ROWS = 500;
const REQUIRED_HEADERS = ["symbol", "asset_class", "quantity", "source_type", "source_name"] as const;

export interface CsvImportStore {
  listHoldings(portfolioId: string, includeClosed: boolean): Promise<StoreResult<HoldingRow[]>>;
  createHoldings(inputs: NewHolding[]): Promise<StoreResult<HoldingRow[]>>;
}

export interface CsvLineError {
  line: number;
  field?: string;
  message: string;
}

export interface CsvImportResult {
  imported: number;
  holdings: Holding[];
}

const requestSchema = z.object({
  csv: z.string().trim().min(1, { message: "El archivo CSV está vacío" }),
});

const portfolioIdSchema = z.uuid({ message: "portfolioId debe ser un UUID" });

type OnError = (error: unknown) => void;

const MESSAGES = {
  notFound: "El portfolio no existe",
  internal: "No se pudieron importar las tenencias",
};

// Parsea CSV RFC 4180 básico (soporta comillas, comas dentro de comillas y \r\n).
export function parseCsvRows(raw: string): { line: number; cells: string[] }[] {
  const text = raw.replace(/^\uFEFF/, "");
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = firstLine.includes(";") && !firstLine.includes(",") ? ";" : ",";
  const rows: { line: number; cells: string[] }[] = [];
  let cells: string[] = [];
  let current = "";
  let inQuotes = false;
  let line = 1;
  let rowStartLine = 1;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        if (ch === "\n") line++;
        current += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      cells.push(current.trim());
      current = "";
    } else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      cells.push(current.trim());
      if (cells.some((c) => c !== "")) rows.push({ line: rowStartLine, cells });
      cells = [];
      current = "";
      line++;
      rowStartLine = line;
    } else {
      current += ch;
    }
  }

  cells.push(current.trim());
  if (cells.some((c) => c !== "")) rows.push({ line: rowStartLine, cells });
  return rows;
}

function normalizeDecimal(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (value.includes(",") && !value.includes(".")) return value.replace(",", ".");
  if (value.includes(".") && value.includes(",")) return value.replace(/\./g, "").replace(",", ".");
  return value;
}

const optionalCell = (value: string | undefined) => (value && value.length > 0 ? value : undefined);
const sourceKey = (name: string) => name.trim().toLowerCase();

export async function importHoldingsCsv(
  portfolioId: unknown,
  input: unknown,
  store: CsvImportStore,
  onError: OnError,
): Promise<Outcome<CsvImportResult>> {
  const parsedId = portfolioIdSchema.safeParse(portfolioId);
  if (!parsedId.success) return invalidRequest("El portfolio no es válido", parsedId.error);

  const parsedBody = requestSchema.safeParse(input);
  if (!parsedBody.success) return invalidRequest("El pedido no es válido", parsedBody.error);

  const rows = parseCsvRows(parsedBody.data.csv);
  if (rows.length < 2) {
    return {
      status: 400,
      body: {
        error: "invalid_request",
        message: "El CSV debe incluir encabezado y al menos una fila de datos",
        errors: [{ line: 1, message: "No hay filas de tenencias para importar" }],
      } as never,
    };
  }

  const headerRow = rows[0]!;
  const headers = headerRow.cells.map((h) => h.toLowerCase());
  const missing = REQUIRED_HEADERS.filter((req) => !headers.includes(req));
  if (missing.length > 0) {
    return {
      status: 400,
      body: {
        error: "invalid_request",
        message: `Faltan columnas obligatorias: ${missing.join(", ")}`,
        errors: [{ line: headerRow.line, message: `Faltan columnas: ${missing.join(", ")}` }],
      } as never,
    };
  }

  const dataRows = rows.slice(1);
  if (dataRows.length > MAX_ROWS) {
    return {
      status: 400,
      body: {
        error: "invalid_request",
        message: `El CSV supera el máximo de ${MAX_ROWS} filas por importación`,
        errors: [{ line: 1, message: `Máximo permitido: ${MAX_ROWS} filas` }],
      } as never,
    };
  }

  const errors: CsvLineError[] = [];
  const validRows: z.infer<typeof createHoldingSchema>[] = [];

  for (const row of dataRows) {
    const get = (col: string) => {
      const idx = headers.indexOf(col);
      return idx >= 0 ? row.cells[idx] : undefined;
    };

    const candidate = {
      symbol: get("symbol") ?? "",
      assetClass: (get("asset_class") ?? "").toLowerCase(),
      quantity: normalizeDecimal(get("quantity")) ?? "",
      costBasis: normalizeDecimal(optionalCell(get("cost_basis"))),
      fee: normalizeDecimal(optionalCell(get("fee"))),
      sourceType: (get("source_type") ?? "").toLowerCase(),
      sourceName: get("source_name") ?? "",
      acquiredAt: optionalCell(get("acquired_at")),
      lockupExpiry: optionalCell(get("lockup_expiry")),
      ratio: normalizeDecimal(optionalCell(get("ratio"))),
      notes: optionalCell(get("notes")),
    };

    const parsed = createHoldingSchema.safeParse(candidate);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        errors.push({
          line: row.line,
          field: issue.path.join(".") || undefined,
          message: issue.message,
        });
      }
    } else {
      validRows.push(parsed.data);
    }
  }

  if (errors.length > 0) {
    return {
      status: 400,
      body: {
        error: "invalid_request",
        message: `Se encontraron ${errors.length} errores en el CSV. No se importó ninguna tenencia.`,
        errors,
      } as never,
    };
  }

  // RN-07: normaliza sedes contra las existentes del portfolio y dentro del propio CSV.
  let existing: StoreResult<HoldingRow[]>;
  try {
    existing = await store.listHoldings(parsedId.data, true);
  } catch (error) {
    onError(error);
    return internalError(MESSAGES.internal);
  }
  if (existing.error) return mapRpcError(existing.error, MESSAGES, onError);

  const canonicalSources = new Map<string, string>();
  const sortedExisting = [...existing.data].sort(
    (a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
  );
  for (const h of sortedExisting) {
    const key = sourceKey(h.source_name);
    if (!canonicalSources.has(key)) canonicalSources.set(key, h.source_name);
  }

  const toInsert: NewHolding[] = validRows.map((h) => {
    const key = sourceKey(h.sourceName);
    const sourceName = canonicalSources.get(key) ?? h.sourceName;
    if (!canonicalSources.has(key)) canonicalSources.set(key, sourceName);

    return {
      portfolio_id: parsedId.data,
      symbol: h.symbol,
      asset_class: h.assetClass,
      quantity: h.quantity,
      cost_basis: h.costBasis ?? null,
      fee: h.fee ?? null,
      source_type: h.sourceType,
      source_name: sourceName,
      acquired_at: h.acquiredAt ?? null,
      lockup_expiry: h.lockupExpiry ?? null,
      ratio: h.ratio ?? null,
      notes: h.notes ?? null,
    };
  });

  let created: StoreResult<HoldingRow[]>;
  try {
    created = await store.createHoldings(toInsert);
  } catch (error) {
    onError(error);
    return internalError(MESSAGES.internal);
  }

  if (created.error) {
    return mapRpcError(
      created.error,
      { ...MESSAGES, forbiddenAsNotFound: true },
      onError,
    );
  }

  return {
    status: 201,
    body: {
      imported: created.data.length,
      holdings: created.data.map(toHolding),
    },
  };
}