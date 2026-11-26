"use client";

// Edición de un lote (P5 en modo edición). La API solo deja cambiar costo,
// comisión, fechas, ratio y notas: el símbolo, la cantidad y la sede se
// muestran fijos, porque cambiarlos rompería el historial de transferencias y
// ventas (RN-09).

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ErrorBox, Status } from "@/components/feedback";
import { Field } from "@/components/form-field";
import { PortfolioGate } from "@/components/portfolio-gate";
import { api, ApiError, type Holding, type Portfolio } from "@/lib/api";
import { assetClassLabel, quantity, sourceTypeLabel } from "@/lib/format";
import {
  editValuesFrom,
  todayIso,
  validateHoldingEdit,
  type HoldingEditErrors,
  type HoldingEditValues,
} from "@/lib/holding-form";
import { errorMessage, useLoad } from "@/lib/use-load";

export function EditHoldingScreen() {
  const id = useSearchParams().get("id");
  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-8">
      <Link href="/tenencias/" className="text-sm text-neutral-500 hover:underline">
        ← Volver a tenencias
      </Link>
      <h1 className="mt-3 text-2xl font-bold">Editar tenencia</h1>
      {id ? (
        <PortfolioGate>{(portfolio) => <LoadHolding key={portfolio.id} portfolio={portfolio} id={id} />}</PortfolioGate>
      ) : (
        <p className="mt-6 text-sm text-neutral-500">Falta indicar qué tenencia editar.</p>
      )}
    </div>
  );
}

function LoadHolding({ portfolio, id }: { portfolio: Portfolio; id: string }) {
  // No hay GET de un solo lote: se busca en el listado del portfolio.
  const [holdings, , reload] = useLoad(() => api.listHoldings(portfolio.id), [portfolio.id]);

  if (holdings.state === "loading") return <Status>Cargando tenencia…</Status>;
  if (holdings.state === "error") return <ErrorBox message={holdings.message} onRetry={reload} />;

  const holding = holdings.data.find((h) => h.id === id);
  if (!holding) {
    return (
      <p className="mt-6 text-sm text-neutral-500">
        No encontramos esa tenencia en este portfolio. Puede que se haya borrado o vendido entera.
      </p>
    );
  }
  return <EditForm holding={holding} currency={portfolio.baseCurrency} />;
}

function EditForm({ holding, currency }: { holding: Holding; currency: string }) {
  const router = useRouter();
  const [values, setValues] = useState<HoldingEditValues>(() => editValuesFrom(holding));
  const [errors, setErrors] = useState<HoldingEditErrors>({});
  const [serverError, setServerError] = useState<{ message: string; issues: string[] } | null>(null);
  const [pending, setPending] = useState(false);

  const set = (field: keyof HoldingEditValues) => (value: string) => {
    setValues((v) => ({ ...v, [field]: value }));
    if (errors[field]) setErrors((e) => ({ ...e, [field]: undefined }));
  };
  const backToList = () => router.push(`/tenencias/?lote=${encodeURIComponent(holding.id)}`);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = validateHoldingEdit(values, holding);
    if (!result.ok) {
      setErrors(result.errors);
      requestAnimationFrame(() => document.querySelector<HTMLElement>('form [aria-invalid="true"]')?.focus());
      return;
    }
    // Sin cambios no hay nada que mandar (la API rechaza un PATCH vacío).
    if (Object.keys(result.patch).length === 0) return backToList();

    setErrors({});
    setServerError(null);
    setPending(true);
    try {
      await api.updateHolding(holding.id, result.patch);
      backToList();
    } catch (e) {
      setServerError({ message: errorMessage(e), issues: e instanceof ApiError ? e.issues : [] });
      setPending(false);
    }
  }

  return (
    <>
      <dl className="mt-6 grid grid-cols-3 gap-4 rounded-lg border border-neutral-200 p-4 text-sm dark:border-neutral-800">
        <div>
          <dt className="text-xs text-neutral-500">Activo</dt>
          <dd className="font-semibold">
            {holding.symbol} <span className="font-normal text-neutral-500">{assetClassLabel(holding.assetClass)}</span>
          </dd>
        </div>
        <div>
          <dt className="text-xs text-neutral-500">Cantidad</dt>
          <dd className="tabular-nums">{quantity(holding.quantity)}</dd>
        </div>
        <div>
          <dt className="text-xs text-neutral-500">Sede</dt>
          <dd>
            {holding.sourceName} <span className="text-neutral-500">{sourceTypeLabel(holding.sourceType)}</span>
          </dd>
        </div>
      </dl>
      <p className="mt-2 text-xs text-neutral-500">
        El activo, la cantidad y la sede no se editan: para cambiarlos, registrá una venta o una transferencia.
      </p>

      <form onSubmit={submit} noValidate className="mt-6 space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id="costBasis"
            label={`Costo por unidad (${currency})`}
            optional
            error={errors.costBasis}
            hint="El precio que pagaste por cada unidad, no el total."
          >
            {(props) => (
              <input {...props} value={values.costBasis} onChange={(e) => set("costBasis")(e.target.value)} inputMode="decimal" autoComplete="off" />
            )}
          </Field>
          <Field id="acquiredAt" label="Fecha de adquisición" optional error={errors.acquiredAt}>
            {(props) => (
              <input {...props} type="date" max={todayIso()} value={values.acquiredAt} onChange={(e) => set("acquiredAt")(e.target.value)} />
            )}
          </Field>
          <Field id="fee" label={`Comisión (${currency})`} optional error={errors.fee}>
            {(props) => <input {...props} value={values.fee} onChange={(e) => set("fee")(e.target.value)} inputMode="decimal" autoComplete="off" />}
          </Field>
          <Field id="lockupExpiry" label="Fin de lockup" optional>
            {(props) => <input {...props} type="date" value={values.lockupExpiry} onChange={(e) => set("lockupExpiry")(e.target.value)} />}
          </Field>
          {holding.assetClass === "cedear" && (
            <Field id="ratio" label="Ratio" error={errors.ratio} hint="Cuántos CEDEAR equivalen a 1 acción.">
              {(props) => <input {...props} value={values.ratio} onChange={(e) => set("ratio")(e.target.value)} inputMode="decimal" autoComplete="off" />}
            </Field>
          )}
          <div className="sm:col-span-2">
            <Field id="notes" label="Notas" optional>
              {(props) => <textarea {...props} rows={2} value={values.notes} onChange={(e) => set("notes")(e.target.value)} />}
            </Field>
          </div>
        </div>

        {serverError && (
          <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
            <p>{serverError.message}</p>
            {serverError.issues.length > 0 && (
              <ul className="mt-1 list-disc pl-5">
                {serverError.issues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? "Guardando…" : "Guardar cambios"}
          </button>
          <Link href="/tenencias/" className="text-sm text-neutral-500 hover:underline">
            Cancelar
          </Link>
        </div>
      </form>
    </>
  );
}
