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
  };
  prices: Array<{ symbol: string; assetClass: string; price: string; source: string; fetchedAt: string }>;
  pricesAsOf: string | null;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
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
    throw new ApiError(response.status, body?.message ?? "La API respondió con un error.");
  }
  return body as T;
}

export const api = {
  listPortfolios: () => request<Portfolio[]>("/portfolios"),
  createPortfolio: (name: string, baseCurrency = "USD") =>
    request<Portfolio>("/portfolios", { method: "POST", body: JSON.stringify({ name, baseCurrency }) }),
  dashboard: (portfolioId: string) => request<Dashboard>(`/portfolios/${encodeURIComponent(portfolioId)}/metrics`),
};
