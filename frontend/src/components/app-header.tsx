"use client";

// Barra superior de las pantallas privadas: marca, navegación, alta de
// tenencia (siempre visible, según la spec), email y cierre de sesión.

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useAuth } from "@/lib/auth";

export function AppHeader() {
  const { auth, signOut } = useAuth();
  const email = auth.status === "signed-in" ? auth.session.user.email : null;

  return (
    <header className="flex items-center justify-between gap-3 border-b border-neutral-200 px-4 py-4 sm:px-6 dark:border-neutral-800">
      <nav aria-label="Principal" className="flex items-center gap-4 text-sm">
        <Link href="/" className="text-base font-semibold">
          StonksView
        </Link>
        <NavLink href="/">Dashboard</NavLink>
        <NavLink href="/tenencias/">Tenencias</NavLink>
      </nav>
      <div className="flex items-center gap-2 text-sm sm:gap-4">
        <Link
          href="/tenencias/nueva/"
          aria-label="Nueva tenencia"
          className="whitespace-nowrap rounded-md bg-emerald-700 px-3 py-1.5 font-semibold text-white hover:bg-emerald-800"
        >
          <span className="sm:hidden">+ Tenencia</span>
          <span className="hidden sm:inline">Nueva tenencia</span>
        </Link>
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

// En el celular solo queda la marca; las secciones se alcanzan desde ahí y
// desde los links de cada pantalla.
function NavLink({ href, children }: { href: string; children: ReactNode }) {
  const pathname = usePathname();
  const active = pathname === href || pathname === href.replace(/\/$/, "");
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`hidden sm:inline ${active ? "font-semibold" : "text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"}`}
    >
      {children}
    </Link>
  );
}
