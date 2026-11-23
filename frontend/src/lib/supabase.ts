import { createClient } from "@supabase/supabase-js";

// Cliente de Supabase para el navegador. Usa la anon key: todo acceso a datos
// queda sujeto a Row-Level Security con el token del usuario logueado.
// Nunca usar acá la service_role key (bypassea RLS y quedaría expuesta en el bundle).
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Faltan NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY. " +
      "Copiá frontend/.env.example a frontend/.env.local y completalas.",
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
