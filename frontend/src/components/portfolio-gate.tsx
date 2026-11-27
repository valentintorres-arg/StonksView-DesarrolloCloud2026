"use client";

// Carga los portfolios del usuario y renderiza `children` con el elegido.
// Resuelve los estados de carga, error y "sin portfolio", y muestra el
// selector solo si hay más de uno.

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { ErrorBox, Status } from "@/components/feedback";
import { api, type Portfolio } from "@/lib/api";
import { useLoad } from "@/lib/use-load";

export function PortfolioGate({ children }: { children: (portfolio: Portfolio) => ReactNode }) {
  const [portfolios, , reload] = useLoad(api.listPortfolios, []);
  const [chosen, setChosen] = useState<string | null>(null);

  if (portfolios.state === "loading") return <Status>Cargando portfolios…</Status>;
  if (portfolios.state === "error") return <ErrorBox message={portfolios.message} onRetry={reload} />;

  if (portfolios.data.length === 0) {
    return (
      <div className="mt-16 text-center">
        <p className="text-sm text-neutral-500">Antes de cargar tenencias necesitás un portfolio.</p>
        <Link href="/" className="mt-3 inline-block font-semibold text-emerald-700 hover:underline dark:text-emerald-400">
          Crear mi portfolio
        </Link>
      </div>
    );
  }

  const portfolio = portfolios.data.find((p) => p.id === chosen) ?? portfolios.data[0]!;

  return (
    <>
      {portfolios.data.length > 1 && (
        <label className="mt-6 flex items-center gap-3 text-sm">
          <span className="text-neutral-500">Portfolio</span>
          <select
            value={portfolio.id}
            onChange={(e) => setChosen(e.target.value)}
            className="rounded-md border border-neutral-300 bg-transparent px-3 py-1.5 dark:border-neutral-700"
          >
            {portfolios.data.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {children(portfolio)}
    </>
  );
}
