// Validación del alta de tenencias (P5 de la spec funcional). Es la primera
// barrera, para avisar campo por campo antes de llamar a la API; la API vuelve
// a validar todo con zod y la base con sus CHECK.

import type { Holding, HoldingPatch, NewHolding } from "./api";

export interface HoldingFormValues {
  symbol: string;
  assetClass: string;
  quantity: string;
  costBasis: string;
  sourceName: string;
  sourceType: string;
  acquiredAt: string; // YYYY-MM-DD del <input type="date">, o ""
  fee: string;
  ratio: string;
  lockupExpiry: string;
  notes: string;
}

export type HoldingFormErrors = Partial<Record<keyof HoldingFormValues, string>>;

export const EMPTY_HOLDING_FORM: HoldingFormValues = {
  symbol: "",
  assetClass: "crypto",
  quantity: "",
  costBasis: "",
  sourceName: "",
  sourceType: "exchange",
  acquiredAt: "",
  fee: "",
  ratio: "",
  lockupExpiry: "",
  notes: "",
};

// Acepta "0,5", "0.5", "1.234,56" y "1234.56". Si hay coma, la coma es el
// decimal y los puntos son separadores de miles; si no, el punto es el
// decimal. Devuelve el número como string decimal exacto, o null si no es un
// número no negativo válido.
export function parseDecimal(raw: string): string | null {
  let text = raw.replace(/\s/g, "");
  if (text.includes(",")) text = text.replace(/\./g, "").replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(text) && !/^\.\d+$/.test(text)) return null;
  if (text.startsWith(".")) text = `0${text}`;
  return text;
}

const isZero = (decimal: string) => /^0+(\.0+)?$/.test(decimal);

// RN-06: mayúsculas y sin espacios.
export const normalizeSymbol = (symbol: string) => symbol.replace(/\s/g, "").toUpperCase();

// RN-07: dos sedes son la misma sin distinguir mayúsculas ni espacios.
export const sourceKey = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

export interface KnownSource {
  name: string;
  type: string;
}

// Sedes que ya usó el usuario, con el nombre y el tipo de la primera vez que
// se cargaron (RN-07).
export function knownSources(holdings: Holding[]): KnownSource[] {
  const byKey = new Map<string, KnownSource>();
  const oldestFirst = [...holdings].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const h of oldestFirst) {
    const key = sourceKey(h.sourceName);
    if (!byKey.has(key)) byKey.set(key, { name: h.sourceName.trim(), type: h.sourceType });
  }
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name, "es"));
}

export function findSource(sources: KnownSource[], name: string): KnownSource | undefined {
  const key = sourceKey(name);
  return key ? sources.find((s) => sourceKey(s.name) === key) : undefined;
}

// Fecha local de hoy en YYYY-MM-DD, para comparar con el <input type="date">.
export function todayIso(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export type HoldingFormResult = { ok: true; holding: NewHolding } | { ok: false; errors: HoldingFormErrors };

export function validateHoldingForm(
  values: HoldingFormValues,
  sources: KnownSource[],
  today = todayIso(),
): HoldingFormResult {
  const errors: HoldingFormErrors = {};

  const symbol = normalizeSymbol(values.symbol);
  if (!symbol) errors.symbol = "Ingresá el símbolo (por ejemplo, BTC o AAPL).";

  const quantity = parseDecimal(values.quantity);
  if (!values.quantity.trim()) errors.quantity = "Ingresá la cantidad.";
  else if (quantity === null) errors.quantity = "La cantidad tiene que ser un número.";
  else if (isZero(quantity)) errors.quantity = "La cantidad tiene que ser mayor a 0.";

  const optionalDecimal = (field: "costBasis" | "fee", label: string) => {
    if (!values[field].trim()) return null;
    const parsed = parseDecimal(values[field]);
    if (parsed === null) errors[field] = `${label} tiene que ser un número mayor o igual a 0.`;
    return parsed;
  };
  const costBasis = optionalDecimal("costBasis", "El costo por unidad");
  const fee = optionalDecimal("fee", "La comisión");

  const isCedear = values.assetClass === "cedear";
  let ratio: string | null = null;
  if (isCedear) {
    ratio = parseDecimal(values.ratio);
    if (!values.ratio.trim()) errors.ratio = "Ingresá el ratio del CEDEAR.";
    else if (ratio === null || isZero(ratio)) errors.ratio = "El ratio tiene que ser un número mayor a 0.";
  }

  // Si la sede ya existe se usa su nombre y su tipo originales (RN-07).
  const existing = findSource(sources, values.sourceName);
  const sourceName = existing?.name ?? values.sourceName.trim().replace(/\s+/g, " ");
  if (!sourceName) errors.sourceName = "Ingresá la sede (por ejemplo, Binance o IOL).";

  if (values.acquiredAt && values.acquiredAt > today) {
    errors.acquiredAt = "La fecha de adquisición no puede ser futura.";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    holding: {
      symbol,
      assetClass: values.assetClass,
      quantity: quantity!,
      costBasis,
      fee,
      sourceType: existing?.type ?? values.sourceType,
      sourceName,
      acquiredAt: values.acquiredAt || null,
      lockupExpiry: values.lockupExpiry || null,
      ratio,
      notes: values.notes.trim() || null,
    },
  };
}

// ---------- Edición ----------

// La API deja cambiar solo estos campos de un lote; símbolo, cantidad y sede
// se corrigen con una venta o una transferencia (RN-09).
export interface HoldingEditValues {
  costBasis: string;
  acquiredAt: string;
  fee: string;
  ratio: string;
  lockupExpiry: string;
  notes: string;
}

export type HoldingEditErrors = Partial<Record<keyof HoldingEditValues, string>>;

export function editValuesFrom(holding: Holding): HoldingEditValues {
  const dateOnly = (iso: string | null) => (iso ? iso.slice(0, 10) : "");
  return {
    costBasis: holding.costBasis ?? "",
    acquiredAt: dateOnly(holding.acquiredAt),
    fee: holding.fee ?? "",
    ratio: holding.ratio ?? "",
    lockupExpiry: dateOnly(holding.lockupExpiry),
    notes: holding.notes ?? "",
  };
}

export type HoldingEditResult = { ok: true; patch: HoldingPatch } | { ok: false; errors: HoldingEditErrors };

// Valida y arma el PATCH con los campos que cambiaron. Vaciar un campo
// opcional lo borra (se manda null).
export function validateHoldingEdit(
  values: HoldingEditValues,
  holding: Holding,
  today = todayIso(),
): HoldingEditResult {
  const errors: HoldingEditErrors = {};
  const original = editValuesFrom(holding);

  const decimalField = (field: "costBasis" | "fee" | "ratio", label: string, positive = false) => {
    const raw = values[field].trim();
    if (!raw) return null;
    const parsed = parseDecimal(raw);
    if (parsed === null || (positive && isZero(parsed))) {
      errors[field] = positive ? `${label} tiene que ser un número mayor a 0.` : `${label} tiene que ser un número mayor o igual a 0.`;
    }
    return parsed;
  };
  const costBasis = decimalField("costBasis", "El costo por unidad");
  const fee = decimalField("fee", "La comisión");
  const ratio = decimalField("ratio", "El ratio", true);
  if (holding.assetClass === "cedear" && !values.ratio.trim()) errors.ratio = "Ingresá el ratio del CEDEAR.";

  if (values.acquiredAt && values.acquiredAt > today) {
    errors.acquiredAt = "La fecha de adquisición no puede ser futura.";
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const sameDecimal = (a: string | null, b: string) => (a ?? "") === (b ? parseDecimal(b) ?? b : "");
  const patch: HoldingPatch = {};
  if (!sameDecimal(costBasis, original.costBasis)) patch.costBasis = costBasis;
  if (!sameDecimal(fee, original.fee)) patch.fee = fee;
  if (!sameDecimal(ratio, original.ratio)) patch.ratio = ratio;
  if (values.acquiredAt !== original.acquiredAt) patch.acquiredAt = values.acquiredAt || null;
  if (values.lockupExpiry !== original.lockupExpiry) patch.lockupExpiry = values.lockupExpiry || null;
  if (values.notes.trim() !== original.notes) patch.notes = values.notes.trim() || null;
  return { ok: true, patch };
}
