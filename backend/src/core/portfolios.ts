// CRUD de portfolios y holdings (tarea 1.7, issue #18).
//
// Validación con zod y traducción a HTTP. El acceso a datos se inyecta como
// un `PortfolioStore`: en producción es Supabase con el JWT del usuario (RLS
// decide qué filas ve y puede tocar); en los tests, un doble en memoria.
//
// Reglas:
// - El símbolo se guarda en mayúsculas, así "btc" y "BTC" son el mismo
//   activo para transfer_holding y sell_holding.
// - Por defecto se listan solo las tenencias actuales (quantity > 0); los
//   lotes agotados por una venta se piden con includeClosed.
// - Un lote no cambia de sede, símbolo ni cantidad por PATCH: para eso están
//   POST /transfers, POST /sales o borrar y volver a cargar.
// - No se puede borrar un lote que aparece en una transferencia (FK): 409.
// - Las sedes se comparan sin mayúsculas ni espacios de los costados (RN-07):
//   si ya hay un lote en " binance", el alta en "Binance" reutiliza el nombre
//   tal como se cargó la primera vez, igual que transfer_holding.

import { z } from "zod";
import { decimalString, internalError, invalidRequest, mapRpcError, type Outcome, type RpcError } from "./rpc";
import { ASSET_CLASSES } from "./sales";
import { SOURCE_TYPES } from "./transfers";

// ---------- Filas tal como las devuelve la base (numeric como texto) ----------

export interface PortfolioRow {
  id: string;
  name: string;
  base_currency: string;
  created_at: string;
}

export interface HoldingRow {
  id: string;
  portfolio_id: string;
  symbol: string;
  asset_class: string;
  quantity: string;
  cost_basis: string | null;
  fee: string | null;
  source_type: string;
  source_name: string;
  acquired_at: string | null;
  lockup_expiry: string | null;
  ratio: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export type NewPortfolio = { name: string; base_currency: string };

export type NewHolding = Omit<HoldingRow, "id" | "created_at" | "updated_at">;

export type HoldingPatch = Partial<
  Pick<HoldingRow, "cost_basis" | "fee" | "acquired_at" | "lockup_expiry" | "ratio" | "notes">
>;

export type StoreResult<T> = { data: T; error: null } | { data: null; error: RpcError };

export interface PortfolioStore {
  listPortfolios(): Promise<StoreResult<PortfolioRow[]>>;
  // null si no existe o no es del usuario (RLS).
  getPortfolio(id: string): Promise<StoreResult<PortfolioRow | null>>;
  createPortfolio(input: NewPortfolio): Promise<StoreResult<PortfolioRow>>;
  listHoldings(portfolioId: string, includeClosed: boolean): Promise<StoreResult<HoldingRow[]>>;
  createHolding(input: NewHolding): Promise<StoreResult<HoldingRow>>;
  // null si no existe o no es del usuario (RLS).
  updateHolding(id: string, patch: HoldingPatch): Promise<StoreResult<HoldingRow | null>>;
  // false si no existe o no es del usuario (RLS).
  deleteHolding(id: string): Promise<StoreResult<boolean>>;
}

// ---------- Forma de la API (camelCase) ----------

export interface Portfolio {
  id: string;
  name: string;
  baseCurrency: string;
  createdAt: string;
}

export interface Holding {
  id: string;
  portfolioId: string;
  symbol: string;
  assetClass: string;
  quantity: string;
  costBasis: string | null;
  fee: string | null;
  sourceType: string;
  sourceName: string;
  acquiredAt: string | null;
  lockupExpiry: string | null;
  ratio: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

const toPortfolio = (row: PortfolioRow): Portfolio => ({
  id: row.id,
  name: row.name,
  baseCurrency: row.base_currency,
  createdAt: row.created_at,
});

const toHolding = (row: HoldingRow): Holding => ({
  id: row.id,
  portfolioId: row.portfolio_id,
  symbol: row.symbol,
  assetClass: row.asset_class,
  quantity: row.quantity,
  costBasis: row.cost_basis,
  fee: row.fee,
  sourceType: row.source_type,
  sourceName: row.source_name,
  acquiredAt: row.acquired_at,
  lockupExpiry: row.lockup_expiry,
  ratio: row.ratio,
  notes: row.notes,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

// ---------- Validación ----------

const id = (label: string) => z.uuid({ message: `${label} debe ser un UUID` });

// Fecha sola (2026-03-15) o fecha y hora ISO 8601 con zona.
const isoDate = z.union([z.iso.date(), z.iso.datetime({ offset: true })], {
  message: "Debe ser una fecha ISO 8601 (AAAA-MM-DD o fecha y hora con zona)",
});

const nullable = <T extends z.ZodType>(schema: T) => schema.nullable().optional();

export const createPortfolioSchema = z.object({
  name: z.string().trim().min(1, { message: "El nombre es obligatorio" }),
  baseCurrency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, { message: "baseCurrency debe ser un código ISO 4217 (ej. USD)" })
    .default("USD"),
});

export const createHoldingSchema = z.object({
  symbol: z.string().trim().min(1, { message: "El símbolo es obligatorio" }).toUpperCase(),
  assetClass: z.enum(ASSET_CLASSES),
  quantity: decimalString({ min: "positive", label: "La cantidad" }),
  costBasis: nullable(decimalString({ min: "non-negative", label: "El costo por unidad" })),
  fee: nullable(decimalString({ min: "non-negative", label: "La comisión" })),
  sourceType: z.enum(SOURCE_TYPES),
  sourceName: z.string().trim().min(1, { message: "La sede es obligatoria" }),
  acquiredAt: nullable(isoDate),
  lockupExpiry: nullable(isoDate),
  ratio: nullable(decimalString({ min: "positive", label: "El ratio" })),
  notes: nullable(z.string().trim()),
});

export const updateHoldingSchema = z
  .object({
    costBasis: nullable(decimalString({ min: "non-negative", label: "El costo por unidad" })),
    fee: nullable(decimalString({ min: "non-negative", label: "La comisión" })),
    acquiredAt: nullable(isoDate),
    lockupExpiry: nullable(isoDate),
    ratio: nullable(decimalString({ min: "positive", label: "El ratio" })),
    notes: nullable(z.string().trim()),
  })
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, { message: "No hay campos para actualizar" });

// ---------- Casos de uso ----------

type OnError = (error: unknown) => void;

const PORTFOLIO_MESSAGES = { notFound: "El portfolio no existe", internal: "No se pudo acceder a los portfolios" };
const HOLDING_MESSAGES = {
  notFound: "El holding no existe",
  internal: "No se pudo acceder a los holdings",
  conflict: "El lote tiene transferencias registradas y no se puede borrar",
};

export async function listPortfolios(store: PortfolioStore, onError: OnError): Promise<Outcome<Portfolio[]>> {
  const result = await safe(() => store.listPortfolios(), onError);
  if (!result) return internalError(PORTFOLIO_MESSAGES.internal);
  if (result.error) return mapRpcError(result.error, PORTFOLIO_MESSAGES, onError);
  return { status: 200, body: result.data.map(toPortfolio) };
}

export async function createPortfolio(
  input: unknown,
  store: PortfolioStore,
  onError: OnError,
): Promise<Outcome<Portfolio>> {
  const parsed = createPortfolioSchema.safeParse(input);
  if (!parsed.success) return invalidRequest("El portfolio no es válido", parsed.error);

  const result = await safe(
    () => store.createPortfolio({ name: parsed.data.name, base_currency: parsed.data.baseCurrency }),
    onError,
  );
  if (!result) return internalError(PORTFOLIO_MESSAGES.internal);
  if (result.error) return mapRpcError(result.error, PORTFOLIO_MESSAGES, onError);
  return { status: 201, body: toPortfolio(result.data) };
}

export async function listHoldings(
  portfolioId: unknown,
  includeClosed: boolean,
  store: PortfolioStore,
  onError: OnError,
): Promise<Outcome<Holding[]>> {
  const parsedId = id("portfolioId").safeParse(portfolioId);
  if (!parsedId.success) return invalidRequest("El portfolio no es válido", parsedId.error);

  // Sin este chequeo, un portfolio ajeno devolvería una lista vacía (RLS)
  // en vez de 404.
  const portfolio = await safe(() => store.getPortfolio(parsedId.data), onError);
  if (!portfolio) return internalError(HOLDING_MESSAGES.internal);
  if (portfolio.error) return mapRpcError(portfolio.error, HOLDING_MESSAGES, onError);
  if (!portfolio.data) return notFound(PORTFOLIO_MESSAGES.notFound);

  const result = await safe(() => store.listHoldings(parsedId.data, includeClosed), onError);
  if (!result) return internalError(HOLDING_MESSAGES.internal);
  if (result.error) return mapRpcError(result.error, HOLDING_MESSAGES, onError);
  return { status: 200, body: result.data.map(toHolding) };
}

export async function createHolding(
  portfolioId: unknown,
  input: unknown,
  store: PortfolioStore,
  onError: OnError,
): Promise<Outcome<Holding>> {
  const parsedId = id("portfolioId").safeParse(portfolioId);
  if (!parsedId.success) return invalidRequest("El portfolio no es válido", parsedId.error);
  const parsed = createHoldingSchema.safeParse(input);
  if (!parsed.success) return invalidRequest("El holding no es válido", parsed.error);

  const h = parsed.data;

  // Un portfolio ajeno devuelve una lista vacía (RLS) y el insert de abajo
  // termina en 404.
  const existing = await safe(() => store.listHoldings(parsedId.data, true), onError);
  if (!existing) return internalError(HOLDING_MESSAGES.internal);
  if (existing.error) return mapRpcError(existing.error, HOLDING_MESSAGES, onError);
  const sourceName = existingSourceName(existing.data, h.sourceName) ?? h.sourceName;

  const result = await safe(
    () =>
      store.createHolding({
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
      }),
    onError,
  );
  if (!result) return internalError(HOLDING_MESSAGES.internal);
  // RLS rechaza el insert en un portfolio ajeno (42501): se responde 404,
  // igual que si no existiera.
  if (result.error) {
    return mapRpcError(
      result.error,
      { ...HOLDING_MESSAGES, notFound: PORTFOLIO_MESSAGES.notFound, forbiddenAsNotFound: true },
      onError,
    );
  }
  return { status: 201, body: toHolding(result.data) };
}

export async function updateHolding(
  holdingId: unknown,
  input: unknown,
  store: PortfolioStore,
  onError: OnError,
): Promise<Outcome<Holding>> {
  const parsedId = id("holdingId").safeParse(holdingId);
  if (!parsedId.success) return invalidRequest("El holding no es válido", parsedId.error);
  const parsed = updateHoldingSchema.safeParse(input);
  if (!parsed.success) return invalidRequest("Los cambios no son válidos", parsed.error);

  const p = parsed.data;
  const patch: HoldingPatch = {};
  if (p.costBasis !== undefined) patch.cost_basis = p.costBasis;
  if (p.fee !== undefined) patch.fee = p.fee;
  if (p.acquiredAt !== undefined) patch.acquired_at = p.acquiredAt;
  if (p.lockupExpiry !== undefined) patch.lockup_expiry = p.lockupExpiry;
  if (p.ratio !== undefined) patch.ratio = p.ratio;
  if (p.notes !== undefined) patch.notes = p.notes;

  const result = await safe(() => store.updateHolding(parsedId.data, patch), onError);
  if (!result) return internalError(HOLDING_MESSAGES.internal);
  if (result.error) return mapRpcError(result.error, HOLDING_MESSAGES, onError);
  if (!result.data) return notFound(HOLDING_MESSAGES.notFound);
  return { status: 200, body: toHolding(result.data) };
}

export async function deleteHolding(
  holdingId: unknown,
  store: PortfolioStore,
  onError: OnError,
): Promise<Outcome<null>> {
  const parsedId = id("holdingId").safeParse(holdingId);
  if (!parsedId.success) return invalidRequest("El holding no es válido", parsedId.error);

  const result = await safe(() => store.deleteHolding(parsedId.data), onError);
  if (!result) return internalError(HOLDING_MESSAGES.internal);
  if (result.error) return mapRpcError(result.error, HOLDING_MESSAGES, onError);
  if (!result.data) return notFound(HOLDING_MESSAGES.notFound);
  return { status: 204, body: null };
}

// Nombre con el que se cargó primero la misma sede, si ya existe.
function existingSourceName(holdings: HoldingRow[], name: string): string | null {
  const key = sourceKey(name);
  const match = [...holdings]
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
    .find((h) => sourceKey(h.source_name) === key);
  return match?.source_name ?? null;
}

const sourceKey = (name: string) => name.trim().toLowerCase();

function notFound(message: string): Outcome<never> {
  return { status: 404, body: { error: "not_found", message } };
}

async function safe<T>(call: () => Promise<T>, onError: OnError): Promise<T | null> {
  try {
    return await call();
  } catch (error) {
    onError(error);
    return null;
  }
}
