// Refresco de precios compartido por las Lambdas que valúan el portfolio
// (métricas e insight). Los proveedores y el cliente con service_role se crean
// una vez por contenedor y se reutilizan entre invocaciones.

import type { PriceRow } from "../core/dashboard";
import { type Asset, type PriceProvider, refreshStalePrices, type PriceWriter } from "../core/prices";
import { supabasePriceWriter } from "./portfolio-store";
import { coinGeckoProvider, yahooProvider } from "./price-providers";
import { supabaseService } from "./supabase";

export interface PriceRefreshDeps {
  priceProviders?: PriceProvider[];
  priceWriter?: PriceWriter | null;
}

export function defaultPriceRefreshDeps(): Required<PriceRefreshDeps> {
  const serviceClient = supabaseService();
  return {
    priceProviders: [coinGeckoProvider(), yahooProvider()],
    priceWriter: serviceClient ? supabasePriceWriter(serviceClient) : null,
  };
}

export function priceRefresher({ priceProviders, priceWriter = null }: PriceRefreshDeps) {
  if (!priceProviders?.length) return undefined;
  return (assets: Asset[], cached: PriceRow[]) =>
    refreshStalePrices(assets, cached, {
      providers: priceProviders,
      writer: priceWriter,
      onError: (error) => console.warn("No se pudieron refrescar precios", error),
    });
}
