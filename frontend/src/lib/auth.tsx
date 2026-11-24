"use client";

// Estado de la sesión para toda la app (tarea 1.5). Escucha a Supabase Auth,
// así un login, un logout o la renovación del token se reflejan en todas las
// pantallas sin recargar.

import type { Session } from "@supabase/supabase-js";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { getSupabase } from "./supabase";

export type AuthState =
  | { status: "loading"; session: null }
  | { status: "signed-out"; session: null }
  | { status: "signed-in"; session: Session };

interface AuthContextValue {
  auth: AuthState;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<AuthState>({ status: "loading", session: null });

  useEffect(() => {
    const supabase = getSupabase();
    const apply = (session: Session | null) =>
      setAuth(session ? { status: "signed-in", session } : { status: "signed-out", session: null });

    supabase.auth.getSession().then(({ data }) => apply(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, session) => apply(session));
    return () => data.subscription.unsubscribe();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      auth,
      signOut: async () => {
        await getSupabase().auth.signOut();
      },
    }),
    [auth],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth tiene que usarse dentro de <AuthProvider>");
  return value;
}

// Mensajes de Supabase Auth en castellano. Lo que no se reconoce va genérico
// para no mostrar textos técnicos en inglés.
export function authErrorMessage(error: { message?: string; code?: string } | null): string {
  const text = `${error?.code ?? ""} ${error?.message ?? ""}`.toLowerCase();
  if (text.includes("invalid login credentials") || text.includes("invalid_credentials")) {
    return "Email o contraseña incorrectos.";
  }
  if (text.includes("email not confirmed") || text.includes("email_not_confirmed")) {
    return "Todavía no confirmaste tu email. Revisá tu casilla.";
  }
  if (text.includes("already registered") || text.includes("user_already_exists")) {
    return "Ya existe una cuenta con ese email. Iniciá sesión.";
  }
  if (text.includes("password") && (text.includes("weak") || text.includes("at least"))) {
    return "La contraseña es muy débil. Usá al menos 8 caracteres.";
  }
  if (text.includes("rate limit") || text.includes("over_request_rate_limit")) {
    return "Demasiados intentos. Esperá unos minutos y probá de nuevo.";
  }
  if (text.includes("failed to fetch") || text.includes("network")) {
    return "No se pudo conectar. Revisá tu conexión.";
  }
  return "No se pudo completar la operación. Probá de nuevo.";
}
