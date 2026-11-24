// Cliente de Supabase por usuario para las Lambdas.
//
// Usa la clave anon más el JWT del usuario que llamó, así PostgREST ejecuta
// todo como ese usuario y las políticas RLS se aplican. Nunca usar acá la
// service_role: saltearía RLS.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { APIGatewayProxyEventV2 } from "aws-lambda";

export function supabaseForUser(accessToken: string): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("Faltan SUPABASE_URL o SUPABASE_ANON_KEY");
  }
  return createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Token del header `Authorization: Bearer <jwt>`, o null si no viene.
// API Gateway HTTP API entrega los headers en minúscula.
export function bearerToken(event: Pick<APIGatewayProxyEventV2, "headers">): string | null {
  const header = event.headers?.authorization ?? event.headers?.Authorization;
  const match = header ? /^Bearer\s+(\S+)$/i.exec(header.trim()) : null;
  return match?.[1] ?? null;
}
