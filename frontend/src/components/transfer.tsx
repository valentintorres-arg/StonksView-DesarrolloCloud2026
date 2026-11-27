"use client";

// Transferencia interna (tarea 3.4, pantalla P6 de la spec): mover unidades de
// un lote a otra sede propia sin que cuente como venta. La operación la hace
// transfer_holding (POST /transfers), que conserva el costo base y la fecha
// de compra. Pasos: lote de origen, cantidad, sede destino y confirmación.

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ErrorBox, Status } from "@/components/feedback";
import { Field } from "@/components/form-field";
import { PortfolioGate } from "@/components/portfolio-gate";
import { api, ApiError, type Holding, type Portfolio, type TransferRequest } from "@/lib/api";
import { assetClassLabel, day, money, quantity, SOURCE_TYPE_OPTIONS, sourceTypeLabel } from "@/lib/format";
import { knownSources, sourceKey, type KnownSource } from "@/lib/holding-form";
import {
  NEW_SOURCE,
  validateTransfer,
  type TransferFormErrors,
  type TransferFormValues,
} from "@/lib/transfer-form";
import { errorMessage, useLoad } from "@/lib/use-load";

export function TransferScreen() {
  const preselected = useSearchParams().get("id");
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
      <Link href="/tenencias/" className="text-sm text-neutral-500 hover:underline">
        ← Volver a tenencias
      </Link>
      <h1 className="mt-3 text-2xl font-bold">Transferir entre sedes</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Mové un activo a otra sede tuya. No cuenta como venta: el costo base y la fecha de compra no cambian.
      </p>
      <PortfolioGate>
        {(portfolio) => <LoadLots key={portfolio.id} portfolio={portfolio} preselected={preselected} />}
      </PortfolioGate>
    </div>
  );
}

function LoadLots({ portfolio, preselected }: { portfolio: Portfolio; preselected: string | null }) {
  const [holdings, , reload] = useLoad(() => api.listHoldings(portfolio.id), [portfolio.id]);
  if (holdings.state === "loading") return <Status>Cargando tenencias…</Status>;
  if (holdings.state === "error") return <ErrorBox message={holdings.message} onRetry={reload} />;
  if (holdings.data.length === 0) {
    return <p className="mt-6 text-sm text-neutral-500">No tenés tenencias para transferir.</p>;
  }
  const initial = holdings.data.some((h) => h.id === preselected) ? preselected! : holdings.data[0]!.id;
  return <TransferForm lots={holdings.data} initialLotId={initial} currency={portfolio.baseCurrency} />;
}

const EMPTY: TransferFormValues = { quantity: "", destination: "", newSourceName: "", newSourceType: "" };

interface Pending {
  request: TransferRequest;
  destinationName: string;
  all: boolean;
}

function TransferForm({ lots, initialLotId, currency }: { lots: Holding[]; initialLotId: string; currency: string }) {
  const router = useRouter();
  const [lotId, setLotId] = useState(initialLotId);
  const [values, setValues] = useState<TransferFormValues>(EMPTY);
  const [errors, setErrors] = useState<TransferFormErrors>({});
  const [confirming, setConfirming] = useState<Pending | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const lot = lots.find((l) => l.id === lotId)!;
  const sources = knownSources(lots);
  const destinations = sources.filter((s) => sourceKey(s.name) !== sourceKey(lot.sourceName));

  const set = (field: keyof TransferFormValues) => (value: string) => {
    setValues((v) => ({ ...v, [field]: value }));
    if (errors[field]) setErrors((e) => ({ ...e, [field]: undefined }));
    setServerError(null);
  };

  function chooseLot(id: string) {
    setLotId(id);
    setValues((v) => ({ ...v, quantity: "" }));
    setErrors({});
    setServerError(null);
  }

  function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = validateTransfer(values, lot, sources);
    if (!result.ok) {
      setErrors(result.errors);
      requestAnimationFrame(() => document.querySelector<HTMLElement>('form [aria-invalid="true"]')?.focus());
      return;
    }
    setErrors({});
    setConfirming(result);
  }

  async function send() {
    if (!confirming) return;
    setSending(true);
    setServerError(null);
    try {
      const result = await api.createTransfer(confirming.request);
      router.push(`/tenencias/?lote=${encodeURIComponent(result.toHoldingId)}&transferencia=1`);
    } catch (error) {
      // Los errores de transfer_holding van junto al campo que corresponde.
      const message = errorMessage(error);
      const status = error instanceof ApiError ? error.status : 0;
      setConfirming(null);
      setSending(false);
      if (status === 422 && /cantidad/i.test(message)) setErrors({ quantity: message });
      else if (status === 422 && /sede/i.test(message)) setErrors({ [values.destination === NEW_SOURCE ? "newSourceName" : "destination"]: message });
      else setServerError(message);
    }
  }

  if (confirming) {
    return (
      <div className="mt-6 rounded-lg border border-neutral-200 p-5 dark:border-neutral-800">
        <h2 className="font-semibold">Confirmá la transferencia</h2>
        <p className="mt-2 text-sm">
          Vas a mover {confirming.all ? "todo el lote: " : ""}
          <strong>
            {quantity(confirming.request.quantity)} {lot.symbol}
          </strong>{" "}
          de <strong>{lot.sourceName}</strong> a <strong>{confirming.destinationName}</strong>. El costo base y la fecha de
          compra no cambian.
        </p>
        <div className="mt-5 flex items-center gap-3">
          <button
            type="button"
            onClick={() => void send()}
            disabled={sending}
            className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {sending ? "Transfiriendo…" : "Confirmar"}
          </button>
          <button type="button" onClick={() => setConfirming(null)} disabled={sending} className="text-sm text-neutral-500 hover:underline">
            Volver
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={review} noValidate className="mt-6 space-y-6">
      <Field id="lot" label="Lote de origen" hint={lotHint(lot, currency)}>
        {(props) => (
          <select {...props} value={lotId} onChange={(e) => chooseLot(e.target.value)}>
            {groupBySymbol(lots).map(([label, group]) => (
              <optgroup key={label} label={label}>
                {group.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.sourceName} · {quantity(l.quantity)}
                    {l.acquiredAt ? ` · ${day(l.acquiredAt)}` : ""}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        )}
      </Field>

      <Field id="quantity" label="Cantidad a mover" error={errors.quantity} hint={`El lote tiene ${quantity(lot.quantity)} ${lot.symbol}.`}>
        {(props) => (
          <div className="flex gap-2">
            <input {...props} value={values.quantity} onChange={(e) => set("quantity")(e.target.value)} inputMode="decimal" autoComplete="off" placeholder="0,5" />
            <button
              type="button"
              onClick={() => set("quantity")(lot.quantity.replace(".", ","))}
              className="mt-1 rounded-md border border-neutral-300 px-3 text-sm font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
            >
              Todo
            </button>
          </div>
        )}
      </Field>

      <DestinationFields values={values} errors={errors} destinations={destinations} set={set} />

      {serverError && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {serverError}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button type="submit" className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800">
          Revisar transferencia
        </button>
        <Link href="/tenencias/" className="text-sm text-neutral-500 hover:underline">
          Cancelar
        </Link>
      </div>
    </form>
  );
}

function DestinationFields({
  values,
  errors,
  destinations,
  set,
}: {
  values: TransferFormValues;
  errors: TransferFormErrors;
  destinations: KnownSource[];
  set: (field: keyof TransferFormValues) => (value: string) => void;
}) {
  return (
    <>
      <Field id="destination" label="Sede destino" error={errors.destination}>
        {(props) => (
          <select {...props} value={values.destination} onChange={(e) => set("destination")(e.target.value)}>
            <option value="">Elegí una sede</option>
            {destinations.map((s) => (
              <option key={s.name} value={sourceKey(s.name)}>
                {s.name} ({sourceTypeLabel(s.type)})
              </option>
            ))}
            <option value={NEW_SOURCE}>Otra sede nueva…</option>
          </select>
        )}
      </Field>
      {values.destination === NEW_SOURCE && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="newSourceName" label="Nombre de la sede nueva" error={errors.newSourceName}>
            {(props) => <input {...props} value={values.newSourceName} onChange={(e) => set("newSourceName")(e.target.value)} placeholder="Ledger" autoComplete="off" />}
          </Field>
          <Field id="newSourceType" label="Tipo de sede" error={errors.newSourceType}>
            {(props) => (
              <select {...props} value={values.newSourceType} onChange={(e) => set("newSourceType")(e.target.value)}>
                <option value="">Elegí el tipo</option>
                {SOURCE_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
      )}
    </>
  );
}

function groupBySymbol(lots: Holding[]): Array<[string, Holding[]]> {
  const groups = new Map<string, Holding[]>();
  for (const lot of [...lots].sort((a, b) => a.symbol.localeCompare(b.symbol) || a.sourceName.localeCompare(b.sourceName))) {
    const label = `${lot.symbol} · ${assetClassLabel(lot.assetClass)}`;
    groups.set(label, [...(groups.get(label) ?? []), lot]);
  }
  return [...groups.entries()];
}

function lotHint(lot: Holding, currency: string): string {
  const cost = lot.costBasis === null ? "sin costo base" : `costo ${money(lot.costBasis, currency)} por unidad`;
  return `${lot.sourceName} (${sourceTypeLabel(lot.sourceType)}), ${cost}.`;
}
