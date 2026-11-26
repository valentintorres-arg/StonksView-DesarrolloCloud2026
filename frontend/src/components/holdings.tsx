"use client";

// Tenencias del portfolio (tarea 3.2): la lista de lotes actuales y el alta
// manual. Al guardar, el lote nuevo queda resaltado y se avisa al padre para
// que recalcule las métricas.

import { useState } from "react";
import { ErrorBox } from "@/components/feedback";
import { HoldingForm } from "@/components/holding-form";
import { api, type Holding, type SourceType } from "@/lib/api";
import { assetClassLabel, date, money, quantity, sourceTypeLabel } from "@/lib/format";
import { useLoad } from "@/lib/use-load";

interface Props {
  portfolioId: string;
  currency: string;
  onChanged: () => void;
}

export function Holdings({ portfolioId, currency, onChanged }: Props) {
  const [holdings, setHoldings, reload] = useLoad<Holding[]>(() => api.listHoldings(portfolioId), [portfolioId]);
  const [adding, setAdding] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);

  const list = holdings.state === "ready" ? holdings.data : [];
  const sources = uniqueSources(list);

  return (
    <section aria-labelledby="holdings-title" className="mt-10">
      <div className="flex items-center justify-between gap-3">
        <h2 id="holdings-title" className="text-lg font-semibold">
          Tenencias
        </h2>
        {!adding && (
          <button
            type="button"
            onClick={() => {
              setAdding(true);
              setSavedId(null);
            }}
            className="rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-800"
          >
            Cargar tenencia
          </button>
        )}
      </div>

      {savedId && (
        <p role="status" className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
          Tenencia guardada.
        </p>
      )}

      {adding && (
        <div className="mt-4">
          <HoldingForm
            portfolioId={portfolioId}
            currency={currency}
            sources={sources}
            onCancel={() => setAdding(false)}
            onSaved={(holding) => {
              setAdding(false);
              setSavedId(holding.id);
              setHoldings({ state: "ready", data: [...list, holding] });
              onChanged();
            }}
          />
        </div>
      )}

      {holdings.state === "loading" && <p className="mt-4 text-sm text-neutral-500">Cargando tenencias…</p>}
      {holdings.state === "error" && <ErrorBox message={holdings.message} onRetry={reload} />}
      {holdings.state === "ready" && list.length === 0 && !adding && (
        <p className="mt-4 text-sm text-neutral-500">Todavía no cargaste ninguna tenencia.</p>
      )}
      {list.length > 0 && <HoldingsTable holdings={list} currency={currency} highlightId={savedId} />}
    </section>
  );
}

function HoldingsTable({ holdings, currency, highlightId }: { holdings: Holding[]; currency: string; highlightId: string | null }) {
  const sorted = [...holdings].sort(
    (a, b) => a.symbol.localeCompare(b.symbol) || a.sourceName.localeCompare(b.sourceName) || a.createdAt.localeCompare(b.createdAt),
  );
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-neutral-500">
          <tr className="border-b border-neutral-200 dark:border-neutral-800">
            <th className="py-2 pr-4 font-medium">Activo</th>
            <th className="py-2 pr-4 font-medium">Sede</th>
            <th className="py-2 pr-4 text-right font-medium">Cantidad</th>
            <th className="py-2 pr-4 text-right font-medium">Costo por unidad</th>
            <th className="py-2 font-medium">Adquisición</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((h) => (
            <tr
              key={h.id}
              className={`border-b border-neutral-100 dark:border-neutral-900 ${h.id === highlightId ? "bg-emerald-50 dark:bg-emerald-950/30" : ""}`}
            >
              <td className="py-2 pr-4">
                <span className="font-medium">{h.symbol}</span>{" "}
                <span className="text-xs text-neutral-500">{assetClassLabel(h.assetClass)}</span>
              </td>
              <td className="py-2 pr-4">
                {h.sourceName} <span className="text-xs text-neutral-500">{sourceTypeLabel(h.sourceType)}</span>
              </td>
              <td className="py-2 pr-4 text-right tabular-nums">{quantity(h.quantity)}</td>
              <td className="py-2 pr-4 text-right tabular-nums">{h.costBasis === null ? "—" : money(h.costBasis, currency)}</td>
              <td className="py-2 tabular-nums">{h.acquiredAt ? date(h.acquiredAt) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Sedes del portfolio con el nombre de su primer lote (RN-07).
function uniqueSources(holdings: Holding[]): Array<{ name: string; type: SourceType }> {
  const byKey = new Map<string, { name: string; type: SourceType; createdAt: string }>();
  for (const h of holdings) {
    const key = h.sourceName.trim().toLowerCase();
    const current = byKey.get(key);
    if (!current || h.createdAt < current.createdAt) byKey.set(key, { name: h.sourceName, type: h.sourceType, createdAt: h.createdAt });
  }
  return [...byKey.values()].map(({ name, type }) => ({ name, type })).sort((a, b) => a.name.localeCompare(b.name));
}
