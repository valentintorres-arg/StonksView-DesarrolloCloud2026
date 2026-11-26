// Proveedores de precios para core/prices (tarea 4.4, RN-19): CoinGecko para
// cripto y Yahoo Finance para acciones, ETF y CEDEAR. Las dos son APIs
// públicas sin clave. Cada pedido tiene un timeout corto: el refresco corre
// dentro del GET de métricas y no puede demorar el dashboard.
//
// Los precios llegan como number de JSON; se guardan con String(), que es
// exacto respecto de lo que mandó la API (la precisión ya la fijó el
// proveedor). Postgres y core/decimal aceptan la notación exponencial.

import type { Asset, PriceProvider, PriceQuote } from "../core/prices";

export const PRICE_TIMEOUT_MS = 2500;

type Fetch = typeof fetch;

const COINGECKO_URL = "https://api.coingecko.com/api/v3/simple/price";
const YAHOO_URL = "https://query1.finance.yahoo.com/v8/finance/chart/";

// CoinGecko resuelve por símbolo; si varios tokens comparten el símbolo, usa
// el de mayor capitalización. Un pedido para todos los símbolos.
export function coinGeckoProvider(fetchImpl: Fetch = fetch): PriceProvider {
  return {
    source: "coingecko",
    supports: (assetClass) => assetClass === "crypto",
    async fetch(assets) {
      const url = new URL(COINGECKO_URL);
      url.searchParams.set("symbols", assets.map((a) => a.symbol.toLowerCase()).join(","));
      url.searchParams.set("vs_currencies", "usd");
      url.searchParams.set("include_24hr_change", "true");
      url.searchParams.set("precision", "full");

      const response = await fetchImpl(url, { signal: AbortSignal.timeout(PRICE_TIMEOUT_MS) });
      if (!response.ok) throw new Error(`CoinGecko respondió ${response.status}`);
      const body = (await response.json()) as Record<string, { usd?: unknown; usd_24h_change?: unknown }>;

      const quotes: PriceQuote[] = [];
      for (const asset of assets) {
        const entry = body[asset.symbol.toLowerCase()];
        const price = finitePositive(entry?.usd);
        if (price === null) continue;
        quotes.push({
          symbol: asset.symbol,
          assetClass: asset.assetClass,
          price: String(price),
          currency: "USD",
          changePercent24h: finiteOrNull(entry?.usd_24h_change),
        });
      }
      return quotes;
    },
  };
}

// Yahoo no tiene un endpoint de cotización múltiple sin autenticación, así
// que se pide /chart por símbolo, en paralelo. Un símbolo que falla (404,
// timeout) se omite sin tirar abajo al resto.
//
// CEDEAR: se cotiza el ticker de BYMA (`AAPL.BA`), en pesos y por certificado,
// que es lo que mide la cantidad del lote. En un portfolio en USD queda "sin
// precio" porque todavía no hay tipo de cambio (ver core/dashboard).
export function yahooProvider(fetchImpl: Fetch = fetch): PriceProvider {
  return {
    source: "yahoo",
    supports: (assetClass) => assetClass === "stock" || assetClass === "etf" || assetClass === "cedear",
    async fetch(assets) {
      const results = await Promise.allSettled(assets.map((asset) => yahooQuote(asset, fetchImpl)));
      const quotes = results.flatMap((r) => (r.status === "fulfilled" && r.value ? [r.value] : []));
      const failed = results.find((r) => r.status === "rejected");
      // Si fallaron todos, que se registre el error; si no, alcanza con lo que vino.
      if (quotes.length === 0 && failed?.status === "rejected") throw failed.reason;
      return quotes;
    },
  };
}

async function yahooQuote(asset: Asset, fetchImpl: Fetch): Promise<PriceQuote | null> {
  const ticker = asset.assetClass === "cedear" ? `${asset.symbol.toUpperCase()}.BA` : asset.symbol.toUpperCase();
  const url = new URL(encodeURIComponent(ticker), YAHOO_URL);
  url.searchParams.set("interval", "1d");
  url.searchParams.set("range", "1d");

  const response = await fetchImpl(url, {
    signal: AbortSignal.timeout(PRICE_TIMEOUT_MS),
    // Sin User-Agent de navegador Yahoo responde 429.
    headers: { "user-agent": "Mozilla/5.0 (compatible; StonksView)" },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Yahoo respondió ${response.status} para ${ticker}`);

  const body = (await response.json()) as {
    chart?: { result?: Array<{ meta?: { regularMarketPrice?: unknown; currency?: unknown; chartPreviousClose?: unknown } }> };
  };
  const meta = body.chart?.result?.[0]?.meta;
  const price = finitePositive(meta?.regularMarketPrice);
  if (!meta || price === null || typeof meta.currency !== "string") return null;

  const previous = finitePositive(meta.chartPreviousClose);
  return {
    symbol: asset.symbol,
    assetClass: asset.assetClass,
    price: String(price),
    currency: meta.currency.toUpperCase(),
    changePercent24h: previous === null ? null : String(((price - previous) / previous) * 100),
  };
}

function finitePositive(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function finiteOrNull(value: unknown): string | null {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : null;
}
