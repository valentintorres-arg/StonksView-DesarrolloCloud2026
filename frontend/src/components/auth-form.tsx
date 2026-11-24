"use client";

// Formulario de email y contraseña compartido por login y registro (3.1).

import Link from "next/link";
import { useState, type FormEvent, type ReactNode } from "react";
import { z } from "zod";

export const credentialsSchema = z.object({
  email: z.email({ message: "Ingresá un email válido." }),
  password: z.string().min(8, { message: "La contraseña tiene que tener al menos 8 caracteres." }),
});

export type Credentials = z.infer<typeof credentialsSchema>;

interface AuthFormProps {
  title: string;
  subtitle: string;
  submitLabel: string;
  pendingLabel: string;
  passwordAutoComplete: "current-password" | "new-password";
  // Devuelve un mensaje de error para mostrar, o null si salió bien.
  onSubmit: (credentials: Credentials) => Promise<string | null>;
  footer: { text: string; href: string; linkLabel: string };
  notice?: ReactNode;
}

export function AuthForm(props: AuthFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = credentialsSchema.safeParse({ email: email.trim(), password });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Revisá los datos.");
      return;
    }
    setError(null);
    setPending(true);
    try {
      setError(await props.onSubmit(parsed.data));
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <p className="text-sm font-semibold tracking-wide text-emerald-700 dark:text-emerald-400">StonksView</p>
        <h1 className="mt-2 text-2xl font-bold">{props.title}</h1>
        <p className="mt-1 text-sm text-neutral-500">{props.subtitle}</p>

        {props.notice}

        <form onSubmit={handleSubmit} noValidate className="mt-8 space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/20 dark:border-neutral-700"
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-medium">
              Contraseña
            </label>
            <input
              id="password"
              type="password"
              autoComplete={props.passwordAutoComplete}
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/20 dark:border-neutral-700"
            />
          </div>

          {error && (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-md bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? props.pendingLabel : props.submitLabel}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-neutral-500">
          {props.footer.text}{" "}
          <Link href={props.footer.href} className="font-medium text-emerald-700 hover:underline dark:text-emerald-400">
            {props.footer.linkLabel}
          </Link>
        </p>
      </div>
    </main>
  );
}
