import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Cliente de Supabase para el navegador. Usa la anon key: todo acceso a datos
// queda sujeto a Row-Level Security con el token del usuario logueado.
// Nunca usar acá la service_role key (bypassea RLS y quedaría expuesta en el bundle).
//
// Se crea recién cuando se usa (no al importar): el build estático y el CI
// prerenderizan las páginas sin las variables de entorno, y solo el
// navegador necesita el cliente. La sesión queda en localStorage y se
// renueva sola, así que sobrevive a recargar la página.

let client: SupabaseClient | undefined;

export function getSupabase(): SupabaseClient {
  if (client) return client;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Faltan NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY. " +
        "Copiá frontend/.env.example a frontend/.env.local y completalas.",
    );
  }

  client = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  return client;
}
