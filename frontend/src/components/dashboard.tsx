"use client";

// Dashboard consolidado (tarea 3.3): patrimonio total y composición por sede y
// por clase de activo, con las métricas que calcula el backend
// (GET /portfolios/{id}/metrics). Acá no se calcula nada: solo se muestra.

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { api, type Dashboard as DashboardData, type Portfolio } from "@/lib/api";
import { assetClassLabel, dateTime, money, percent, signedMoney, sourceTypeLabel } from "@/lib/format";
import { ErrorBox, Status } from "@/components/feedback";
import { errorMessage, useLoad } from "@/lib/use-load";

export function Dashboard() {
  const [portfolios, setPortfolios, reloadPortfolios] = useLoad(api.listPortfolios, []);
  const [chosen, setChosen] = useState<string | null>(null);

  if (portfolios.state === "loading") return <Status>Cargando portfolios…</Status>;
  if (portfolios.state === "error") return <ErrorBox message={portfolios.message} onRetry={reloadPortfolios} />;

  // El elegido, o el primero si todavía no se eligió ninguno.
  const selected = chosen ?? portfolios.data[0]?.id ?? null;
  const setSelected = setChosen;
  if (portfolios.data.length === 0) {
    return (
      <CreatePortfolio
        onCreated={(p) => {
          setPortfolios({ state: "ready", data: [p] });
          setSelected(p.id);
        }}
      />
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-8">
      {portfolios.data.length > 1 && (
        <label className="mb-6 flex items-center gap-3 text-sm">
          <span className="text-neutral-500">Portfolio</span>
          <select
            value={selected ?? ""}
            onChange={(e) => setSelected(e.target.value)}
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
      {selected && <PortfolioMetrics key={selected} portfolioId={selected} />}
    </div>
  );
}

function PortfolioMetrics({ portfolioId }: { portfolioId: string }) {
  const [dashboard, , reload] = useLoad<DashboardData>(() => api.dashboard(portfolioId), [portfolioId]);

  if (dashboard.state === "loading") return <Status>Calculando métricas…</Status>;
  if (dashboard.state === "error") return <ErrorBox message={dashboard.message} onRetry={reload} />;

  const { portfolio, metrics, pricesAsOf } = dashboard.data;
  const currency = portfolio.baseCurrency;
  if (metrics.valuedLots === 0 && metrics.unpricedHoldings.length === 0) return <EmptyPortfolio name={portfolio.name} />;
  const gain = metrics.unrealizedGain;
  const gainSign = Number(gain.value) > 0 ? "▲" : Number(gain.value) < 0 ? "▼" : "";
  const concentrated = [
    ...metrics.concentration.sourcesOverThreshold.map((s) => `la sede ${s.sourceName} (${percent(s.sharePercent)})`),
    ...metrics.concentration.symbolsOverThreshold.map((s) => `${s.symbol} (${percent(s.sharePercent)})`),
  ];

  return (
    <section aria-labelledby="dashboard-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 id="dashboard-title" className="text-2xl font-bold">
          {portfolio.name}
        </h1>
        <p className="text-xs text-neutral-500">
          {pricesAsOf ? `Precios al ${dateTime(pricesAsOf)}` : "Sin precios cargados"} ·{" "}
          <Link href="/tenencias/" className="font-medium text-emerald-700 hover:underline dark:text-emerald-400">
            Ver tenencias
          </Link>
        </p>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <StatTile label="Patrimonio total" value={money(metrics.totalValue, currency)} detail={`${metrics.valuedLots} lotes valuados`} />
        <StatTile
          label="Ganancia no realizada"
          value={`${gainSign} ${signedMoney(gain.value, currency)}`.trim()}
          detail={`${percent(gain.percent, true)} sobre un costo de ${money(gain.costBasis, currency)}`}
        />
      </div>

      {metrics.unpricedHoldings.length > 0 && (
        <Notice icon="ⓘ" title={`${metrics.unpricedHoldings.length} tenencias sin precio`}>
          No entran en el total hasta que haya un precio en {currency}:{" "}
          {[...new Set(metrics.unpricedHoldings.map((h) => h.symbol))].join(", ")}.
        </Notice>
      )}
      {gain.lotsWithoutCostBasis > 0 && (
        <Notice icon="ⓘ" title={`${gain.lotsWithoutCostBasis} lotes sin costo base`}>
          Suman al patrimonio pero no a la ganancia no realizada.
        </Notice>
      )}
      {concentrated.length > 0 && (
        <Notice icon="⚠" title="Concentración de riesgo">
          Más del {metrics.concentration.thresholdPercent} % del patrimonio está en {concentrated.join(" y en ")}.
        </Notice>
      )}

      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        <ShareBars
          title="Por sede"
          rows={metrics.bySource.map((s) => ({
            key: s.sourceName,
            label: s.sourceName,
            hint: sourceTypeLabel(s.sourceType),
            value: s.value,
            share: s.sharePercent,
          }))}
          currency={currency}
        />
        <ShareBars
          title="Por clase de activo"
          rows={metrics.byAssetClass.map((a) => ({
            key: a.assetClass,
            label: assetClassLabel(a.assetClass),
            hint: `${a.lots} ${a.lots === 1 ? "lote" : "lotes"}`,
            value: a.value,
            share: a.sharePercent,
          }))}
          currency={currency}
        />
      </div>
    </section>
  );
}

// Estado vacío (P2 de la spec): todavía no hay ninguna tenencia cargada.
function EmptyPortfolio({ name }: { name: string }) {
  return (
    <section className="mx-auto mt-8 max-w-md text-center">
      <h1 className="text-2xl font-bold">{name}</h1>
      <p className="mt-3 text-sm text-neutral-500">
        Todavía no cargaste tenencias. Sumá lo que tenés en cada exchange, wallet, broker o banco y acá vas a ver tu
        patrimonio consolidado.
      </p>
      <Link
        href="/tenencias/nueva/"
        className="mt-6 inline-block rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800"
      >
        Cargar mi primera tenencia
      </Link>
    </section>
  );
}

function StatTile({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-lg border border-neutral-200 p-5 dark:border-neutral-800">
      <p className="text-sm text-neutral-500">{label}</p>
      <p className="mt-1 text-3xl font-semibold tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-neutral-500">{detail}</p>
    </div>
  );
}

interface ShareRow {
  key: string;
  label: string;
  hint: string;
  value: string;
  share: string | null;
}

// Barras horizontales de una sola serie: el largo es la participación sobre
// el patrimonio. Cada barra lleva su nombre y su valor al lado, así que no
// hace falta leyenda ni colores por categoría.
function ShareBars({ title, rows, currency }: { title: string; rows: ShareRow[]; currency: string }) {
  return (
    <figure>
      <figcaption className="text-sm font-semibold">{title}</figcaption>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-neutral-500">Todavía no hay tenencias valuadas.</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {rows.map((row) => (
            <li key={row.key} title={`${row.label}: ${money(row.value, currency)} (${percent(row.share)})`}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span>
                  {row.label} <span className="text-xs text-neutral-500">{row.hint}</span>
                </span>
                <span className="tabular-nums">
                  {money(row.value, currency)} <span className="text-neutral-500">· {percent(row.share)}</span>
                </span>
              </div>
              <div className="mt-1.5 h-2 rounded-full bg-neutral-100 dark:bg-neutral-800" aria-hidden>
                <div
                  className="h-2 rounded-full bg-emerald-600 dark:bg-emerald-500"
                  style={{ width: `${Math.min(100, Math.max(0, Number(row.share ?? 0)))}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </figure>
  );
}

function Notice({ icon, title, children }: { icon: string; title: string; children: React.ReactNode }) {
  return (
    <div role="note" className="mt-4 flex gap-3 rounded-md border border-neutral-200 px-4 py-3 text-sm dark:border-neutral-800">
      <span aria-hidden className="text-neutral-500">
        {icon}
      </span>
      <p>
        <strong className="font-semibold">{title}.</strong> <span className="text-neutral-500">{children}</span>
      </p>
    </div>
  );
}

function CreatePortfolio({ onCreated }: { onCreated: (p: Portfolio) => void }) {
  const [name, setName] = useState("Principal");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) return setError("Poné un nombre.");
    setPending(true);
    setError(null);
    try {
      onCreated(await api.createPortfolio(name.trim()));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mx-auto mt-16 w-full max-w-sm px-6">
      <h1 className="text-2xl font-bold">Creá tu primer portfolio</h1>
      <p className="mt-1 text-sm text-neutral-500">Agrupa tus tenencias de todas las sedes.</p>
      <form onSubmit={submit} className="mt-6 flex gap-2">
        <label htmlFor="portfolio-name" className="sr-only">
          Nombre del portfolio
        </label>
        <input
          id="portfolio-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="flex-1 rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
        >
          {pending ? "Creando…" : "Crear"}
        </button>
      </form>
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}
