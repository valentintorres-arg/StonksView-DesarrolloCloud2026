"use client";

// Rutas privadas y públicas. El export es estático, así que la protección
// pasa en el navegador: es UX, no seguridad. Lo que protege los datos es RLS
// en la base y el JWT que valida la API.

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { useAuth } from "@/lib/auth";

function Loading() {
  return (
    <div className="flex min-h-screen items-center justify-center text-sm text-neutral-500" role="status">
      Cargando…
    </div>
  );
}

// Solo con sesión; si no hay, manda a /login.
export function RequireAuth({ children }: { children: ReactNode }) {
  const { auth } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (auth.status === "signed-out") router.replace("/login");
  }, [auth.status, router]);

  return auth.status === "signed-in" ? <>{children}</> : <Loading />;
}

// Solo sin sesión (login, registro); si ya hay, manda al inicio.
export function RequireGuest({ children }: { children: ReactNode }) {
  const { auth } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (auth.status === "signed-in") router.replace("/");
  }, [auth.status, router]);

  return auth.status === "signed-out" ? <>{children}</> : <Loading />;
}
