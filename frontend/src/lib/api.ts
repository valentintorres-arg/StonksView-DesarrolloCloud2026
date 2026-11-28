// Cliente de la API del backend. Manda el JWT de la sesión de Supabase en
// cada request: la API lo usa para que RLS se aplique como el usuario.
// Los montos llegan como string decimal exacto; se formatean solo al mostrar.

import { getSupabase } from "./supabase";

export interface Portfolio {
  id: string;
  name: string;
  baseCurrency: string;
  createdAt: string;
}

// Un lote: una compra concreta en una sede. `costBasis` es POR UNIDAD.
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

// Lo que se manda al crear un lote (POST /portfolios/{id}/holdings). Los
// números van como string decimal para no perder precisión.
export interface NewHolding {
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
}

export interface Breakdown {
  value: string;
  sharePercent: string | null;
}

export interface SourceBreakdown extends Breakdown {
  sourceName: string;
  sourceType: string;
  lots: number;
}

export interface AssetClassBreakdown extends Breakdown {
  assetClass: string;
  lots: number;
}

export interface SymbolBreakdown extends Breakdown {
  symbol: string;
  assetClass: string;
}

export interface LotValuation {
  id: string;
  sourceName: string;
  quantity: string;
  costBasis: string | null;
  value: string | null;
  unrealizedGain: string | null;
}

// Todos los lotes de un símbolo y clase, valuados por el backend.
export interface Position {
  symbol: string;
  assetClass: string;
  quantity: string;
  price: string | null;
  value: string | null;
  sharePercent: string | null;
  averageCost: string | null;
  unrealizedGain: string | null;
  unrealizedGainPercent: string | null;
  sources: number;
  lots: LotValuation[];
}

// Campos de un lote que se pueden cambiar (PATCH /holdings/{id}).
export type HoldingPatch = Partial<Pick<NewHolding, "costBasis" | "fee" | "acquiredAt" | "lockupExpiry" | "ratio" | "notes">>;

export interface Dashboard {
  portfolio: { id: string; name: string; baseCurrency: string };
  metrics: {
    totalValue: string;
    valuedLots: number;
    unpricedHoldings: Array<{ id: string; symbol: string; assetClass: string }>;
    bySource: SourceBreakdown[];
    byAssetClass: AssetClassBreakdown[];
    bySymbol: SymbolBreakdown[];
    unrealizedGain: {
      value: string;
      costBasis: string;
      marketValue: string;
      percent: string | null;
      lotsWithoutCostBasis: number;
    };
    concentration: {
      thresholdPercent: number;
      largestSource: SourceBreakdown | null;
      largestSymbol: SymbolBreakdown | null;
      sourcesOverThreshold: SourceBreakdown[];
      symbolsOverThreshold: SymbolBreakdown[];
    };
    positions: Position[];
  };
  prices: Array<{ symbol: string; assetClass: string; price: string; source: string; fetchedAt: string }>;
  pricesAsOf: string | null;
}

// Transferencia interna entre sedes propias (POST /transfers, tarea 1.8).
export interface TransferRequest {
  fromHoldingId: string;
  quantity: string;
  toSourceName: string;
  toSourceType?: string;
}

export interface TransferResult {
  transferId: string;
  fromHoldingId: string;
  toHoldingId: string;
  quantity: string;
  // Se sumó a un lote idéntico que ya existía en la sede destino.
  merged: boolean;
  // Se movió el lote entero (mismo id, otra sede).
  relocated: boolean;
}

// Insight con IA (tarea 4.2). `text` es null cuando no está disponible.
export interface Insight {
  id: string | null;
  portfolioId: string;
  state: "ok" | "no_disponible";
  text: string | null;
  createdAt: string;
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

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    // Detalle de validación de la API (400), por campo.
    readonly issues: string[] = [],
    // Detalle por línea para importación CSV (400).
    readonly errors: CsvLineError[] = [],
  ) {
    super(message);
  }
}

function baseUrl(): string {
  const url = process.env.NEXT_PUBLIC_API_URL;
  if (!url) throw new Error("Falta NEXT_PUBLIC_API_URL en frontend/.env.local");
  return url.replace(/\/+$/, "");
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { data } = await getSupabase().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ApiError(401, "La sesión venció. Volvé a iniciar sesión.");

  let response: Response;
  try {
    response = await fetch(`${baseUrl()}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new ApiError(0, "No se pudo conectar con la API.");
  }

  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(
      response.status,
      body?.message ?? "La API respondió con un error.",
      Array.isArray(body?.issues) ? body.issues : [],
      Array.isArray(body?.errors) ? body.errors : [],
    );
  }
  return body as T;
}

export const api = {
  listPortfolios: () => request<Portfolio[]>("/portfolios"),
  createPortfolio: (name: string, baseCurrency = "USD") =>
    request<Portfolio>("/portfolios", { method: "POST", body: JSON.stringify({ name, baseCurrency }) }),
  listHoldings: (portfolioId: string) => request<Holding[]>(`/portfolios/${encodeURIComponent(portfolioId)}/holdings`),
  createHolding: (portfolioId: string, holding: NewHolding) =>
    request<Holding>(`/portfolios/${encodeURIComponent(portfolioId)}/holdings`, {
      method: "POST",
      body: JSON.stringify(holding),
    }),
  updateHolding: (holdingId: string, patch: HoldingPatch) =>
    request<Holding>(`/holdings/${encodeURIComponent(holdingId)}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteHolding: (holdingId: string) =>
    request<void>(`/holdings/${encodeURIComponent(holdingId)}`, { method: "DELETE" }),
  createTransfer: (transfer: TransferRequest) =>
    request<TransferResult>("/transfers", { method: "POST", body: JSON.stringify(transfer) }),
  dashboard: (portfolioId: string) => request<Dashboard>(`/portfolios/${encodeURIComponent(portfolioId)}/metrics`),
  latestInsight: (portfolioId: string) =>
    request<Insight | null>(`/portfolios/${encodeURIComponent(portfolioId)}/insights/latest`),
  generateInsight: (portfolioId: string) =>
    request<Insight>(`/portfolios/${encodeURIComponent(portfolioId)}/insights`, { method: "POST" }),
  importHoldingsCsv: (portfolioId: string, csv: string) =>
    request<CsvImportResult>(`/portfolios/${encodeURIComponent(portfolioId)}/holdings/import`, {
      method: "POST",
      body: JSON.stringify({ csv }),
    }),
};
