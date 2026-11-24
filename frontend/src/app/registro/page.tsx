"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { RequireGuest } from "@/components/auth-guards";
import { AuthForm } from "@/components/auth-form";
import { authErrorMessage } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";

export default function RegistroPage() {
  const router = useRouter();
  const [pendingConfirmation, setPendingConfirmation] = useState<string | null>(null);

  return (
    <RequireGuest>
      <AuthForm
        title="Crear cuenta"
        subtitle="Consolidá tus inversiones de todas las sedes en un solo lugar."
        submitLabel="Crear cuenta"
        pendingLabel="Creando cuenta…"
        passwordAutoComplete="new-password"
        footer={{ text: "¿Ya tenés cuenta?", href: "/login", linkLabel: "Iniciá sesión" }}
        notice={
          pendingConfirmation && (
            <p role="status" className="mt-6 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
              Te mandamos un email a <strong>{pendingConfirmation}</strong>. Confirmá tu cuenta desde ahí y después
              iniciá sesión.
            </p>
          )
        }
        onSubmit={async ({ email, password }) => {
          const { data, error } = await getSupabase().auth.signUp({
            email,
            password,
            // Vuelve a la app después de confirmar el email.
            options: { emailRedirectTo: `${window.location.origin}/login` },
          });
          if (error) return authErrorMessage(error);
          // Con la confirmación de email activada (default de Supabase) no hay
          // sesión hasta que el usuario confirma.
          if (data.session) {
            router.replace("/");
          } else {
            setPendingConfirmation(email);
          }
          return null;
        }}
      />
    </RequireGuest>
  );
}
