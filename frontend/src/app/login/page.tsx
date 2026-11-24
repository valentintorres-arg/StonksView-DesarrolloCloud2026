"use client";

import { useRouter } from "next/navigation";
import { RequireGuest } from "@/components/auth-guards";
import { AuthForm } from "@/components/auth-form";
import { authErrorMessage } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";

export default function LoginPage() {
  const router = useRouter();

  return (
    <RequireGuest>
      <AuthForm
        title="Iniciar sesión"
        subtitle="Entrá para ver tu patrimonio consolidado."
        submitLabel="Ingresar"
        pendingLabel="Ingresando…"
        passwordAutoComplete="current-password"
        footer={{ text: "¿No tenés cuenta?", href: "/registro", linkLabel: "Registrate" }}
        onSubmit={async ({ email, password }) => {
          const { error } = await getSupabase().auth.signInWithPassword({ email, password });
          if (error) return authErrorMessage(error);
          router.replace("/");
          return null;
        }}
      />
    </RequireGuest>
  );
}
