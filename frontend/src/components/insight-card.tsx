"use client";

// Tarjeta del insight con IA (tarea 4.3, pantalla P3.1 de la spec). Muestra el
// último insight del portfolio y permite generar uno nuevo. Nada de lo que
// pase acá rompe el resto del dashboard (RN-34): un error de la API o de la
// IA se muestra dentro de la tarjeta.

import { useState } from "react";
import { api, ApiError, type Insight } from "@/lib/api";
import { dateTime } from "@/lib/format";
import { errorMessage, useLoad } from "@/lib/use-load";

const UNAVAILABLE = "Insight no disponible por ahora.";

export function InsightCard({ portfolioId }: { portfolioId: string }) {
  const [latest, setLatest, reload] = useLoad<Insight | null>(() => api.latestInsight(portfolioId), [portfolioId]);
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function generate() {
    setPending(true);
    setProblem(null);
    try {
      setLatest({ state: "ready", data: await api.generateInsight(portfolioId) });
    } catch (error) {
      setProblem(generateError(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <section aria-labelledby="insight-title" aria-busy={pending} className="mt-6 rounded-lg border border-neutral-200 p-5 dark:border-neutral-800">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="insight-title" className="font-semibold">
          Insight
        </h2>
        <button
          type="button"
          onClick={() => void generate()}
          disabled={pending || latest.state === "loading"}
          className="rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Generando…" : "Generar insight"}
        </button>
      </div>

      <div className="mt-3 text-sm" aria-live="polite">
        {pending ? (
          <p className="text-neutral-500">Generando el insight a partir de tus métricas…</p>
        ) : latest.state === "loading" ? (
          <p className="text-neutral-500">Cargando el último insight…</p>
        ) : latest.state === "error" ? (
          <p className="text-neutral-500">
            No se pudo cargar el último insight.{" "}
            <button type="button" onClick={reload} className="font-semibold underline">
              Reintentar
            </button>
          </p>
        ) : (
          <InsightBody insight={latest.data} />
        )}
        {problem && !pending && (
          <p role="alert" className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            {problem}
          </p>
        )}
      </div>

      <p className="mt-4 text-xs text-neutral-500">Generado por IA a partir de tus datos. No es un consejo de inversión.</p>
    </section>
  );
}

function InsightBody({ insight }: { insight: Insight | null }) {
  if (!insight) return <p className="text-neutral-500">Todavía no generaste ningún insight.</p>;
  const date = <p className="mt-1 text-xs text-neutral-500">{dateTime(insight.createdAt)}</p>;
  if (insight.state !== "ok" || !insight.text) {
    return (
      <div>
        <p className="text-neutral-500">{UNAVAILABLE} El resto del dashboard no se ve afectado; probá de nuevo más tarde.</p>
        {date}
      </div>
    );
  }
  return (
    <div>
      <p className="leading-relaxed">{insight.text}</p>
      {date}
    </div>
  );
}

function generateError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 429) return "Alcanzaste el límite de insights de hoy.";
    // 422: sin tenencias valuadas; el mensaje de la API ya lo explica.
    if (error.status === 422) return error.message;
    if (error.status === 0 || error.status === 401) return errorMessage(error);
  }
  return UNAVAILABLE;
}
