// PortfolioStore sobre Supabase con el cliente del usuario: RLS decide qué
// filas ve y puede tocar. Los numeric se piden como texto (`col::text`) para
// que no pasen por un number de JavaScript y pierdan decimales.

import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { PriceRow, PriceStore } from "../core/dashboard";
import type { HoldingRow, PortfolioRow, PortfolioStore, StoreResult } from "../core/portfolios";

const PORTFOLIO_COLUMNS = "id, name, base_currency, created_at";

const HOLDING_COLUMNS =
  "id, portfolio_id, symbol, asset_class, quantity::text, cost_basis::text, fee::text, " +
  "source_type, source_name, acquired_at, lockup_expiry, ratio::text, notes, created_at, updated_at";

type Response<T> = { data: T | null; error: PostgrestError | null; status: number };

function result<T>({ data, error, status }: Response<T>, empty: T): StoreResult<T> {
  if (error) return { data: null, error: { code: error.code, message: error.message, status } };
  return { data: (data ?? empty) as T, error: null };
}

export function supabasePortfolioStore(client: SupabaseClient): PortfolioStore {
  return {
    async listPortfolios() {
      const response = await client
        .from("portfolios")
        .select(PORTFOLIO_COLUMNS)
        .order("created_at", { ascending: true });
      return result<PortfolioRow[]>(response as Response<PortfolioRow[]>, []);
    },

    async getPortfolio(id) {
      const response = await client.from("portfolios").select(PORTFOLIO_COLUMNS).eq("id", id).maybeSingle();
      return result<PortfolioRow | null>(response as Response<PortfolioRow>, null);
    },

    async createPortfolio(input) {
      // user_id lo completa la base con auth.uid() (default de la columna).
      const response = await client.from("portfolios").insert(input).select(PORTFOLIO_COLUMNS).single();
      return result<PortfolioRow>(response as Response<PortfolioRow>, null as never);
    },

    async listHoldings(portfolioId, includeClosed) {
      let query = client.from("holdings").select(HOLDING_COLUMNS).eq("portfolio_id", portfolioId);
      if (!includeClosed) query = query.gt("quantity", 0);
      const response = await query
        .order("symbol", { ascending: true })
        .order("acquired_at", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: true });
      return result<HoldingRow[]>(response as Response<HoldingRow[]>, []);
    },

    async createHolding(input) {
      const response = await client.from("holdings").insert(input).select(HOLDING_COLUMNS).single();
      return result<HoldingRow>(response as Response<HoldingRow>, null as never);
    },

    async updateHolding(id, patch) {
      // Sin fila de vuelta = no existe o RLS no deja verla: 404 arriba.
      const response = await client
        .from("holdings")
        .update(patch)
        .eq("id", id)
        .select(HOLDING_COLUMNS)
        .maybeSingle();
      return result<HoldingRow | null>(response as Response<HoldingRow>, null);
    },

    async deleteHolding(id) {
      const response = await client.from("holdings").delete().eq("id", id).select("id");
      const rows = result<{ id: string }[]>(response as Response<{ id: string }[]>, []);
      return rows.error ? rows : { data: rows.data.length > 0, error: null };
    },
  };
}

// price_cache es de lectura para cualquier usuario logueado (RLS).
export function supabasePriceStore(client: SupabaseClient): PriceStore {
  return {
    async pricesFor(symbols) {
      const response = await client
        .from("price_cache")
        .select("symbol, asset_class, source, price::text, currency, fetched_at")
        .in("symbol", symbols);
      return result<PriceRow[]>(response as Response<PriceRow[]>, []);
    },
  };
}
