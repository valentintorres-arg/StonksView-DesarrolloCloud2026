"use client";

// Pantalla de tenencias (P4 de la spec funcional): todas las posiciones del
// portfolio, agrupadas por símbolo y clase, con sus lotes al expandir. Los
// valores, el costo promedio y la ganancia los calcula el backend
// (GET /portfolios/{id}/metrics); acá solo se muestran y se filtran.

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Fragment, useState } from "react";
import { ErrorBox, Status } from "@/components/feedback";
import { PortfolioGate } from "@/components/portfolio-gate";
import { api, type Holding, type LotValuation, type Portfolio, type Position } from "@/lib/api";
import { ASSET_CLASS_OPTIONS, assetClassLabel, day, money, percent, quantity, signedMoney } from "@/lib/format";
import { knownSources, sourceKey } from "@/lib/holding-form";
import { errorMessage, useLoad } from "@/lib/use-load";

export function HoldingsScreen() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Tenencias</h1>
        <Link
          href="/tenencias/importar/"
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
        >
          Importar CSV
        </Link>
      </div>
      <PortfolioGate>{(portfolio) => <PortfolioHoldings key={portfolio.id} portfolio={portfolio} />}</PortfolioGate>
    </div>
  );
}

interface Data {
  positions: Position[];
  // Detalle de cada lote (fecha, tipo de sede, notas) por id.
  holdings: Map<string, Holding>;
  pricesAsOf: string | null;
}

async function loadData(portfolioId: string): Promise<Data> {
  const [dashboard, holdings] = await Promise.all([api.dashboard(portfolioId), api.listHoldings(portfolioId)]);
  return {
    positions: dashboard.metrics.positions,
    holdings: new Map(holdings.map((h) => [h.id, h])),
    pricesAsOf: dashboard.pricesAsOf,
  };
}

function PortfolioHoldings({ portfolio }: { portfolio: Portfolio }) {
  const [data, , reload] = useLoad(() => loadData(portfolio.id), [portfolio.id]);
  // Lote recién cargado o editado, que llega por la URL para resaltarlo.
  const params = useSearchParams();
  const highlighted = params.get("lote");
  // Si se llegó desde una transferencia, el lote resaltado es el de destino.
  const transferred = params.get("transferencia") === "1";
  const [showSaved, setShowSaved] = useState(true);
  const [source, setSource] = useState("");
  const [assetClass, setAssetClass] = useState("");
  // Posiciones expandidas. Vive acá para que sobrevivan a la recarga después
  // de borrar un lote. Arranca abierta la del lote resaltado.
  const [open, setOpen] = useState<Set<string> | null>(null);

  if (data.state === "loading") return <Status>Cargando tenencias…</Status>;
  if (data.state === "error") return <ErrorBox message={data.message} onRetry={reload} />;

  const { positions, holdings } = data.data;
  if (positions.length === 0) {
    return (
      <div className="mt-12 text-center">
        <p className="text-sm text-neutral-500">Todavía no cargaste tenencias.</p>
        <Link
          href="/tenencias/nueva/"
          className="mt-4 inline-block rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800"
        >
          Cargar mi primera tenencia
        </Link>
      </div>
    );
  }

  const expanded =
    open ??
    new Set(positions.filter((p) => p.lots.some((l) => l.id === highlighted)).map(positionKey));
  const toggle = (key: string) => {
    const next = new Set(expanded);
    if (!next.delete(key)) next.add(key);
    setOpen(next);
  };

  const sources = knownSources([...holdings.values()]);
  const matchesSource = (lot: LotValuation) => !source || sourceKey(lot.sourceName) === source;
  const visible = positions.filter(
    (p) => (!assetClass || p.assetClass === assetClass) && p.lots.some(matchesSource),
  );
  const classesInUse = ASSET_CLASS_OPTIONS.filter((o) => positions.some((p) => p.assetClass === o.value));
  const filtered = Boolean(source || assetClass);

  return (
    <>
      {showSaved && highlighted && holdings.has(highlighted) && (
        <p role="status" className="mt-4 rounded-md bg-emerald-50 px-4 py-2 text-sm text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
          {transferred ? "Transferencia registrada." : "Tenencia guardada."}
        </p>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3 text-sm">
        <FilterSelect label="Sede" value={source} onChange={setSource}>
          <option value="">Todas las sedes</option>
          {sources.map((s) => (
            <option key={s.name} value={sourceKey(s.name)}>
              {s.name}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect label="Clase de activo" value={assetClass} onChange={setAssetClass}>
          <option value="">Todas las clases</option>
          {classesInUse.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </FilterSelect>
        {filtered && (
          <button
            type="button"
            onClick={() => {
              setSource("");
              setAssetClass("");
            }}
            className="text-neutral-500 underline"
          >
            Limpiar filtros
          </button>
        )}
      </div>

      {visible.length === 0 ? (
        <p className="mt-8 text-sm text-neutral-500">Ninguna tenencia coincide con los filtros.</p>
      ) : (
        <PositionsTable
          positions={visible}
          holdings={holdings}
          currency={portfolio.baseCurrency}
          matchesSource={matchesSource}
          highlighted={highlighted}
          expanded={expanded}
          onToggle={toggle}
          onChanged={() => {
            setShowSaved(false);
            reload();
          }}
        />
      )}
    </>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="flex items-center gap-2">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-neutral-300 bg-transparent px-3 py-1.5 dark:border-neutral-700"
      >
        {children}
      </select>
    </label>
  );
}

const TH = "px-3 py-2 text-left text-xs font-medium text-neutral-500";
const TH_NUM = `${TH} text-right`;
const TD = "px-3 py-3 align-top";
const TD_NUM = `${TD} text-right tabular-nums`;

function PositionsTable({
  positions,
  holdings,
  currency,
  matchesSource,
  highlighted,
  expanded,
  onToggle,
  onChanged,
}: {
  positions: Position[];
  holdings: Map<string, Holding>;
  currency: string;
  matchesSource: (lot: LotValuation) => boolean;
  highlighted: string | null;
  expanded: Set<string>;
  onToggle: (key: string) => void;
  onChanged: () => void;
}) {

  return (
    // La tabla scrollea dentro de su caja en pantallas angostas; la página no.
    <div className="mt-4 overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
      <table className="w-full min-w-[40rem] text-sm">
        <thead className="border-b border-neutral-200 dark:border-neutral-800">
          <tr>
            <th className={TH}>Activo</th>
            <th className={TH_NUM}>Cantidad</th>
            <th className={TH_NUM}>Valor</th>
            <th className={TH_NUM}>Costo promedio</th>
            <th className={TH_NUM}>Ganancia no realizada</th>
            <th className={TH_NUM}>Sedes</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((position) => {
            const key = positionKey(position);
            const isOpen = expanded.has(key);
            const lots = position.lots.filter(matchesSource);
            const hiddenLots = position.lots.length - lots.length;
            return (
              <Fragment key={key}>
                <tr className="border-b border-neutral-100 last:border-0 dark:border-neutral-900">
                  <td className={TD}>
                    <button
                      type="button"
                      onClick={() => onToggle(key)}
                      aria-expanded={isOpen}
                      aria-controls={`lots-${key}`}
                      className="flex items-start gap-2 text-left"
                    >
                      <span aria-hidden className="mt-0.5 inline-block w-3 text-neutral-500">
                        {isOpen ? "▾" : "▸"}
                      </span>
                      <span>
                        <span className="font-semibold">{position.symbol}</span>
                        <span className="block text-xs text-neutral-500">
                          {assetClassLabel(position.assetClass)} · {position.lots.length}{" "}
                          {position.lots.length === 1 ? "lote" : "lotes"}
                        </span>
                      </span>
                    </button>
                  </td>
                  <td className={TD_NUM}>{quantity(position.quantity)}</td>
                  <td className={TD_NUM}>
                    {position.value === null ? (
                      <span className="text-neutral-500">Sin precio</span>
                    ) : (
                      <>
                        {money(position.value, currency)}
                        <span className="block text-xs text-neutral-500">{percent(position.sharePercent)}</span>
                      </>
                    )}
                  </td>
                  <td className={TD_NUM}>
                    {position.averageCost === null ? (
                      <span className="text-neutral-500">Sin costo base</span>
                    ) : (
                      money(position.averageCost, currency)
                    )}
                  </td>
                  <td className={TD_NUM}>
                    <Gain value={position.unrealizedGain} percentValue={position.unrealizedGainPercent} currency={currency} />
                  </td>
                  <td className={TD_NUM}>{position.sources}</td>
                </tr>
                {isOpen && (
                  <tr id={`lots-${key}`} className="border-b border-neutral-100 bg-neutral-50 last:border-0 dark:border-neutral-900 dark:bg-neutral-900/40">
                    <td colSpan={6} className="px-3 py-3">
                      <LotsTable
                        lots={lots}
                        symbol={position.symbol}
                        holdings={holdings}
                        currency={currency}
                        highlighted={highlighted}
                        onChanged={onChanged}
                      />
                      {hiddenLots > 0 && (
                        <p className="mt-2 text-xs text-neutral-500">
                          {hiddenLots === 1 ? "1 lote más en otra sede" : `${hiddenLots} lotes más en otras sedes`}, fuera
                          del filtro. Los totales de la fila incluyen todas las sedes.
                        </p>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const positionKey = (p: Position) => `${p.assetClass}-${p.symbol}`;

function Gain({ value, percentValue, currency }: { value: string | null; percentValue?: string | null; currency: string }) {
  if (value === null) return <span className="text-neutral-500">—</span>;
  const n = Number(value);
  const tone = n > 0 ? "text-emerald-700 dark:text-emerald-400" : n < 0 ? "text-red-700 dark:text-red-400" : "";
  return (
    <span className={tone}>
      {signedMoney(value, currency)}
      {percentValue !== undefined && <span className="block text-xs">{percent(percentValue, true)}</span>}
    </span>
  );
}

function LotsTable({
  lots,
  symbol,
  holdings,
  currency,
  highlighted,
  onChanged,
}: {
  lots: LotValuation[];
  symbol: string;
  holdings: Map<string, Holding>;
  currency: string;
  highlighted: string | null;
  onChanged: () => void;
}) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr>
          <th className={TH}>Sede</th>
          <th className={TH_NUM}>Cantidad</th>
          <th className={TH_NUM}>Costo por unidad</th>
          <th className={TH}>Fecha</th>
          <th className={TH_NUM}>Valor</th>
          <th className={TH_NUM}>Ganancia</th>
          <th className={TH}>
            <span className="sr-only">Acciones</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {lots.map((lot) => (
          <LotRow
            key={lot.id}
            lot={lot}
            symbol={symbol}
            holding={holdings.get(lot.id)}
            currency={currency}
            highlighted={lot.id === highlighted}
            onChanged={onChanged}
          />
        ))}
      </tbody>
    </table>
  );
}

function LotRow({
  lot,
  symbol,
  holding,
  currency,
  highlighted,
  onChanged,
}: {
  lot: LotValuation;
  symbol: string;
  holding: Holding | undefined;
  currency: string;
  highlighted: boolean;
  onChanged: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setPending(true);
    setError(null);
    try {
      await api.deleteHolding(lot.id);
      onChanged();
    } catch (e) {
      setError(errorMessage(e));
      setPending(false);
      setConfirming(false);
    }
  }

  return (
    <>
      <tr className={highlighted ? "bg-emerald-50 dark:bg-emerald-950/30" : undefined}>
        <td className="px-3 py-2">{lot.sourceName}</td>
        <td className="px-3 py-2 text-right tabular-nums">{quantity(lot.quantity)}</td>
        <td className="px-3 py-2 text-right tabular-nums">
          {lot.costBasis === null ? <span className="text-neutral-500">—</span> : money(lot.costBasis, currency)}
        </td>
        <td className="px-3 py-2">{holding?.acquiredAt ? day(holding.acquiredAt) : <span className="text-neutral-500">—</span>}</td>
        <td className="px-3 py-2 text-right tabular-nums">
          {lot.value === null ? <span className="text-neutral-500">—</span> : money(lot.value, currency)}
        </td>
        <td className="px-3 py-2 text-right tabular-nums">
          <Gain value={lot.unrealizedGain} currency={currency} />
        </td>
        <td className="whitespace-nowrap px-3 py-2 text-right">
          {confirming ? (
            <span className="inline-flex items-center gap-2">
              <span className="text-neutral-500">¿Borrar?</span>
              <button
                type="button"
                onClick={remove}
                disabled={pending}
                className="font-semibold text-red-700 hover:underline disabled:opacity-60 dark:text-red-400"
              >
                {pending ? "Borrando…" : "Sí, borrar"}
              </button>
              <button type="button" onClick={() => setConfirming(false)} disabled={pending} className="text-neutral-500 hover:underline">
                Cancelar
              </button>
            </span>
          ) : (
            <span className="inline-flex items-center gap-3">
              <Link
                href={`/tenencias/transferir/?id=${encodeURIComponent(lot.id)}`}
                className="font-medium text-emerald-700 hover:underline dark:text-emerald-400"
                aria-label={`Transferir el lote de ${symbol} en ${lot.sourceName} a otra sede`}
              >
                Transferir
              </Link>
              <Link
                href={`/tenencias/editar/?id=${encodeURIComponent(lot.id)}`}
                className="font-medium text-emerald-700 hover:underline dark:text-emerald-400"
                aria-label={`Editar el lote de ${symbol} en ${lot.sourceName}`}
              >
                Editar
              </Link>
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="text-neutral-500 hover:text-red-700 hover:underline"
                aria-label={`Borrar el lote de ${symbol} en ${lot.sourceName}`}
              >
                Borrar
              </button>
            </span>
          )}
        </td>
      </tr>
      {error && (
        <tr>
          <td colSpan={7} className="px-3 pb-2">
            <p role="alert" className="text-xs text-red-700 dark:text-red-300">
              {error}
            </p>
          </td>
        </tr>
      )}
    </>
  );
}
