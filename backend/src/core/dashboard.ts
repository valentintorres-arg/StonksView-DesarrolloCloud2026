// Métricas del dashboard consolidado (tarea 3.3, issue #28).
//
// Junta las tenencias actuales del portfolio, el último precio cacheado de
// cada activo (price_cache, que llena la tarea 4.4) y el motor de métricas
// determinístico. El backend calcula; el frontend solo muestra.
//
// Precios: de cada (símbolo, clase de activo) se usa el más reciente entre
// las fuentes, y solo si está en la moneda base del portfolio. Un precio en
// otra moneda no se convierte (no hay tipo de cambio todavía): ese lote queda
// como "sin precio", igual que si no hubiera precio.

import { z } from "zod";
import { computePortfolioMetrics, type HoldingLot, type PortfolioMetrics } from "./metrics";
import type { PortfolioStore, StoreResult } from "./portfolios";
import { internalError, invalidRequest, mapRpcError, type Outcome } from "./rpc";

export interface PriceRow {
  symbol: string;
  asset_class: string;
  source: string;
  price: string;
  currency: string;
  fetched_at: string;
}

export interface PriceStore {
  // Precios cacheados de esos activos (todas las fuentes y monedas).
  pricesFor(symbols: string[]): Promise<StoreResult<PriceRow[]>>;
}

export interface PriceUsed {
  symbol: string;
  assetClass: string;
  price: string;
  source: string;
  fetchedAt: string;
}

export interface DashboardResult {
  portfolio: { id: string; name: string; baseCurrency: string };
  metrics: PortfolioMetrics;
  prices: PriceUsed[];
  // Fecha del precio más viejo usado: hasta cuándo es válido el cálculo.
  pricesAsOf: string | null;
}

const querySchema = z.object({
  portfolioId: z.uuid({ message: "portfolioId debe ser un UUID" }),
  concentrationThreshold: z.coerce
    .number({ message: "concentrationThreshold debe ser un número" })
    .gt(0)
    .max(100)
    .optional(),
});

const MESSAGES = { notFound: "El portfolio no existe", internal: "No se pudieron calcular las métricas" };

export async function getDashboard(
  input: { portfolioId: unknown; concentrationThreshold?: unknown },
  store: PortfolioStore,
  prices: PriceStore,
  onError: (error: unknown) => void,
): Promise<Outcome<DashboardResult>> {
  const parsed = querySchema.safeParse(input);
  if (!parsed.success) return invalidRequest("El pedido de métricas no es válido", parsed.error);
  const { portfolioId, concentrationThreshold } = parsed.data;

  try {
    const portfolio = await store.getPortfolio(portfolioId);
    if (portfolio.error) return mapRpcError(portfolio.error, MESSAGES, onError);
    if (!portfolio.data) return { status: 404, body: { error: "not_found", message: MESSAGES.notFound } };
    const currency = portfolio.data.base_currency;

    const holdings = await store.listHoldings(portfolioId, false);
    if (holdings.error) return mapRpcError(holdings.error, MESSAGES, onError);

    const symbols = [...new Set(holdings.data.map((h) => h.symbol))];
    const cached = symbols.length ? await prices.pricesFor(symbols) : { data: [], error: null };
    if (cached.error) return mapRpcError(cached.error, MESSAGES, onError);

    const latest = latestPrices(cached.data, currency);

    const lots: HoldingLot[] = holdings.data.map((h) => ({
      id: h.id,
      symbol: h.symbol,
      assetClass: h.asset_class,
      quantity: h.quantity,
      costBasis: h.cost_basis,
      fee: h.fee,
      sourceName: h.source_name,
      sourceType: h.source_type,
    }));
    const metrics = computePortfolioMetrics(
      lots,
      (symbol, assetClass) => latest.get(priceKey(symbol, assetClass))?.price,
      concentrationThreshold ? { concentrationThresholdPercent: concentrationThreshold } : {},
    );

    // Solo los precios que efectivamente valuaron alguna tenencia.
    const used = [...latest.values()]
      .filter((p) => lots.some((lot) => priceKey(lot.symbol, lot.assetClass) === priceKey(p.symbol, p.asset_class)))
      .sort((a, b) => a.symbol.localeCompare(b.symbol) || a.asset_class.localeCompare(b.asset_class));

    return {
      status: 200,
      body: {
        portfolio: { id: portfolio.data.id, name: portfolio.data.name, baseCurrency: currency },
        metrics,
        prices: used.map((p) => ({
          symbol: p.symbol,
          assetClass: p.asset_class,
          price: p.price,
          source: p.source,
          fetchedAt: p.fetched_at,
        })),
        pricesAsOf: used.reduce<string | null>(
          (oldest, p) => (oldest === null || Date.parse(p.fetched_at) < Date.parse(oldest) ? p.fetched_at : oldest),
          null,
        ),
      },
    };
  } catch (error) {
    onError(error);
    return internalError(MESSAGES.internal);
  }
}

function priceKey(symbol: string, assetClass: string): string {
  return `${assetClass}:${symbol.toUpperCase()}`;
}

// El precio más reciente de cada activo entre las fuentes, en la moneda base.
function latestPrices(rows: PriceRow[], currency: string): Map<string, PriceRow> {
  const latest = new Map<string, PriceRow>();
  for (const row of rows) {
    if (row.currency.toUpperCase() !== currency.toUpperCase()) continue;
    const key = priceKey(row.symbol, row.asset_class);
    const current = latest.get(key);
    if (!current || Date.parse(row.fetched_at) > Date.parse(current.fetched_at)) latest.set(key, row);
  }
  return latest;
}
