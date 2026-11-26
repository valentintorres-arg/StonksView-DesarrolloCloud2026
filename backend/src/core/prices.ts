// Refresco de precios actuales en price_cache (tarea 4.4, issue #34).
//
// Cada proveedor (CoinGecko, Yahoo) cubre algunas clases de activo. Antes de
// valuar, se buscan los activos sin precio vigente de su proveedor: los que no
// tienen fila, o cuya fila tiene más de PRICE_TTL_MS (RN-20, 5 minutos). Esos
// se piden a la API y se guardan en el cache.
//
// Nada de esto puede romper el dashboard: si un proveedor falla o tarda, se
// sigue con lo que ya había en el cache (aunque sea viejo, y el dashboard
// muestra su fecha). Si falla el guardado, igual se usan los precios recién
// traídos en esta respuesta.
//
// La carga manual queda de respaldo: una fila con otra fuente (por ejemplo
// "manual") sigue valuando los activos que ningún proveedor encuentra
// (forex, other, o un símbolo desconocido).

import type { PriceRow } from "./dashboard";

export const PRICE_TTL_MS = 5 * 60 * 1000;

export interface Asset {
  symbol: string;
  assetClass: string;
}

export interface PriceQuote {
  symbol: string;
  assetClass: string;
  price: string;
  currency: string;
  changePercent24h: string | null;
}

export interface PriceProvider {
  // Valor de price_cache.source para las filas que escribe.
  readonly source: string;
  supports(assetClass: string): boolean;
  // Cotizaciones de los activos que encontró; los que no, se omiten.
  fetch(assets: Asset[]): Promise<PriceQuote[]>;
}

export interface PriceWriter {
  upsert(rows: PriceRow[]): Promise<void>;
}

export interface RefreshDeps {
  providers: PriceProvider[];
  // Sin writer (falta la service_role) se usan los precios sin cachearlos.
  writer: PriceWriter | null;
  now?: () => Date;
  onError: (error: unknown) => void;
}

// Devuelve las filas del cache con las cotizaciones nuevas incorporadas.
export async function refreshStalePrices(
  assets: Asset[],
  cached: PriceRow[],
  { providers, writer, now = () => new Date(), onError }: RefreshDeps,
): Promise<PriceRow[]> {
  const fetchedAt = now();
  const unique = uniqueAssets(assets);

  const batches = providers
    .map((provider) => ({
      provider,
      stale: unique.filter(
        (asset) => provider.supports(asset.assetClass) && !isFresh(cached, asset, provider.source, fetchedAt),
      ),
    }))
    .filter((batch) => batch.stale.length > 0);
  if (batches.length === 0) return cached;

  const results = await Promise.allSettled(batches.map(({ provider, stale }) => provider.fetch(stale)));

  const fresh: PriceRow[] = [];
  results.forEach((outcome, i) => {
    const { provider, stale } = batches[i]!;
    if (outcome.status === "rejected") {
      onError(outcome.reason);
      return;
    }
    // Solo lo que se pidió: un proveedor no puede pisar otros activos.
    const requested = new Set(stale.map(assetKey));
    for (const quote of outcome.value) {
      if (!requested.has(assetKey(quote))) continue;
      fresh.push({
        symbol: quote.symbol,
        asset_class: quote.assetClass,
        source: provider.source,
        price: quote.price,
        currency: quote.currency,
        fetched_at: fetchedAt.toISOString(),
        change_percent_24h: quote.changePercent24h,
      });
    }
  });
  if (fresh.length === 0) return cached;

  if (writer) {
    try {
      await writer.upsert(fresh);
    } catch (error) {
      onError(error);
    }
  }

  const replaced = new Set(fresh.map(rowKey));
  return [...cached.filter((row) => !replaced.has(rowKey(row))), ...fresh];
}

function isFresh(cached: PriceRow[], asset: Asset, source: string, now: Date): boolean {
  const key = assetKey(asset);
  return cached.some(
    (row) =>
      row.source === source &&
      assetKey({ symbol: row.symbol, assetClass: row.asset_class }) === key &&
      now.getTime() - Date.parse(row.fetched_at) < PRICE_TTL_MS,
  );
}

function uniqueAssets(assets: Asset[]): Asset[] {
  const seen = new Map<string, Asset>();
  for (const asset of assets) {
    const key = assetKey(asset);
    if (!seen.has(key)) seen.set(key, asset);
  }
  return [...seen.values()];
}

function assetKey(asset: Asset): string {
  return `${asset.assetClass}:${asset.symbol.toUpperCase()}`;
}

function rowKey(row: PriceRow): string {
  return `${row.source}:${row.asset_class}:${row.symbol.toUpperCase()}`;
}
