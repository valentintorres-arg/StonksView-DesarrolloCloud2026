// InsightStore sobre Supabase con el cliente del usuario: RLS deja leer e
// insertar solo los insights de sus portfolios (ai_insights es append-only).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { InsightRow, InsightStore } from "../core/insights";

const COLUMNS = "id, portfolio_id, respuesta_texto, estado, created_at";

export function supabaseInsightStore(client: SupabaseClient): InsightStore {
  return {
    async countSince(since) {
      const { count, error, status } = await client
        .from("ai_insights")
        .select("id", { count: "exact", head: true })
        .gte("created_at", since);
      if (error) return { data: null, error: { code: error.code, message: error.message, status } };
      return { data: count ?? 0, error: null };
    },

    async insert(row) {
      const { data, error, status } = await client.from("ai_insights").insert(row).select(COLUMNS).single();
      if (error) return { data: null, error: { code: error.code, message: error.message, status } };
      return { data: data as InsightRow, error: null };
    },

    async latest(portfolioId) {
      const { data, error, status } = await client
        .from("ai_insights")
        .select(COLUMNS)
        .eq("portfolio_id", portfolioId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) return { data: null, error: { code: error.code, message: error.message, status } };
      return { data: (data as InsightRow | null) ?? null, error: null };
    },
  };
}
