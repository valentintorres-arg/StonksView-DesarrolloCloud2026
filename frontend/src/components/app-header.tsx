"use client";

// Barra superior de las pantallas privadas: marca, email y cierre de sesión.

import Link from "next/link";
import { useAuth } from "@/lib/auth";

export function AppHeader() {
  const { auth, signOut } = useAuth();
  const email = auth.status === "signed-in" ? auth.session.user.email : null;

  return (
    <header className="flex items-center justify-between gap-3 border-b border-neutral-200 px-4 py-4 sm:px-6 dark:border-neutral-800">
      <Link href="/" className="font-semibold">
        StonksView
      </Link>
      <div className="flex items-center gap-2 text-sm sm:gap-4">
        <span className="hidden text-neutral-500 sm:inline">{email}</span>
        <button
          type="button"
          onClick={() => void signOut()}
          className="whitespace-nowrap rounded-md border border-neutral-300 px-3 py-1.5 font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
        >
          Cerrar sesión
        </button>
      </div>
    </header>
  );
}
