// Clientes de Supabase para las Lambdas.
//
// supabaseForUser usa la clave anon más el JWT del usuario que llamó, así
// PostgREST ejecuta todo como ese usuario y las políticas RLS se aplican.
// Nunca usar la service_role para datos de un usuario: saltearía RLS.

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

// Cliente con la service_role, solo para escribir price_cache: es compartida
// entre usuarios y RLS no deja escribirla a `authenticated` (si pudieran,
// cualquiera podría falsear el precio de todos). Devuelve null si la clave no
// está configurada; los precios se usan igual, sin cachearlos.
export function supabaseService(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
