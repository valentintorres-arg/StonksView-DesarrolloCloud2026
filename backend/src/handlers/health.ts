// Adaptador fino: arma la consulta a Supabase y traduce el resultado del
// chequeo a una respuesta HTTP (200 si la base responde, 503 si no).

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { checkHealth, type DatabaseProbe } from "../core/health";
import { json } from "./http";
import { withRequestLog } from "./observability";

// Se crea una vez por contenedor y se reutiliza entre invocaciones.
let client: SupabaseClient | undefined;

function getClient(): SupabaseClient {
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const anonKey = process.env.SUPABASE_ANON_KEY;
    if (!url || !anonKey) {
      throw new Error("Faltan SUPABASE_URL o SUPABASE_ANON_KEY");
    }
    client = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

// Llama a public.health_check() (migración 06healthcheck): obliga a PostgREST
// a ir a Postgres sin leer ninguna tabla. Se corre con la clave anon, que no
// tiene acceso a las tablas; por eso no se consulta price_cache como antes
// (respondía 401 y el chequeo daba siempre 503).
export const supabaseProbe: DatabaseProbe = async (signal) => {
  const { data, error } = await getClient().rpc("health_check").abortSignal(signal);
  if (error) throw error;
  if (data !== true) throw new Error(`health_check devolvió ${JSON.stringify(data)}`);
};

export function createHandler(probe: DatabaseProbe): APIGatewayProxyHandlerV2 {
  return async () => {
    const result = await checkHealth(probe, {
      // El detalle va solo al log: la respuesta es pública.
      onError: (error) => console.error("Health check de la base falló", error),
    });
    return json(result.status === "ok" ? 200 : 503, result, {
      "cache-control": "no-store",
    });
  };
}

export const handler = withRequestLog(createHandler(supabaseProbe));
