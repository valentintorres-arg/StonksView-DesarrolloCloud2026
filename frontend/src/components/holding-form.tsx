"use client";

// Alta manual de una tenencia (tarea 3.2, pantalla P5 de la spec funcional).
// Cada envío crea un lote: una compra concreta en una sede.

import Link from "next/link";
import { useId, useState, type FormEvent } from "react";
import { Field } from "@/components/form-field";
import { PortfolioGate } from "@/components/portfolio-gate";
import { api, ApiError, type Holding, type Portfolio } from "@/lib/api";
import { ASSET_CLASS_OPTIONS, SOURCE_TYPE_OPTIONS, money, quantity, sourceTypeLabel } from "@/lib/format";
import {
  EMPTY_HOLDING_FORM,
  findSource,
  knownSources,
  todayIso,
  validateHoldingForm,
  type HoldingFormErrors,
  type HoldingFormValues,
  type KnownSource,
} from "@/lib/holding-form";
import { errorMessage, useLoad } from "@/lib/use-load";

export function NewHoldingScreen() {
  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-8">
      <Link href="/tenencias/" className="text-sm text-neutral-500 hover:underline">
        ← Volver a tenencias
      </Link>
      <h1 className="mt-3 text-2xl font-bold">Nueva tenencia</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Cargá una compra concreta: qué activo, cuánto, a qué precio y en qué sede está.
      </p>
      <PortfolioGate>{(portfolio) => <PortfolioHoldingForm key={portfolio.id} portfolio={portfolio} />}</PortfolioGate>
    </div>
  );
}

function PortfolioHoldingForm({ portfolio }: { portfolio: Portfolio }) {
  // Las sedes ya usadas, para autocompletar. Si no cargan, el formulario
  // igual funciona: solo se pierde el autocompletado.
  const [holdings, setHoldings] = useLoad(() => api.listHoldings(portfolio.id), [portfolio.id]);
  const sources = holdings.state === "ready" ? knownSources(holdings.data) : [];

  const [values, setValues] = useState<HoldingFormValues>(EMPTY_HOLDING_FORM);
  const [errors, setErrors] = useState<HoldingFormErrors>({});
  const [serverError, setServerError] = useState<{ message: string; issues: string[] } | null>(null);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState<Holding | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);

  const set = (field: keyof HoldingFormValues) => (value: string) => {
    setValues((v) => ({ ...v, [field]: value }));
    if (errors[field]) setErrors((e) => ({ ...e, [field]: undefined }));
  };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = validateHoldingForm(values, sources);
    if (!result.ok) {
      setErrors(result.errors);
      // La comisión está en la sección plegable: se abre para que se vea el error.
      if (result.errors.fee) setMoreOpen(true);
      // Lleva el foco al primer campo con error (en el orden de la pantalla),
      // después de que se pinte.
      requestAnimationFrame(() => document.querySelector<HTMLElement>('form [aria-invalid="true"]')?.focus());
      return;
    }
    setErrors({});
    setServerError(null);
    setPending(true);
    try {
      const created = await api.createHolding(portfolio.id, result.holding);
      setSaved(created);
      if (holdings.state === "ready") setHoldings({ state: "ready", data: [...holdings.data, created] });
    } catch (e) {
      setServerError({ message: errorMessage(e), issues: e instanceof ApiError ? e.issues : [] });
    } finally {
      setPending(false);
    }
  }

  if (saved) {
    return (
      <SavedHolding
        holding={saved}
        currency={portfolio.baseCurrency}
        onAnother={() => {
          // Se conserva la sede: lo común es cargar varias compras del mismo lugar.
          setValues({ ...EMPTY_HOLDING_FORM, sourceName: saved.sourceName, sourceType: saved.sourceType });
          setMoreOpen(false);
          setSaved(null);
        }}
      />
    );
  }

  const existingSource = findSource(sources, values.sourceName);
  const isCedear = values.assetClass === "cedear";

  return (
    <form onSubmit={submit} noValidate className="mt-8 space-y-8">
      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold">Activo</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="symbol" label="Símbolo" error={errors.symbol} hint="Se guarda en mayúsculas.">
            {(props) => (
              <input
                {...props}
                value={values.symbol}
                onChange={(e) => set("symbol")(e.target.value)}
                onBlur={(e) => set("symbol")(e.target.value.replace(/\s/g, "").toUpperCase())}
                placeholder="BTC"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
              />
            )}
          </Field>
          <Field id="assetClass" label="Clase de activo">
            {(props) => (
              <select {...props} value={values.assetClass} onChange={(e) => set("assetClass")(e.target.value)}>
                {ASSET_CLASS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field id="quantity" label="Cantidad" error={errors.quantity} hint="Podés usar coma o punto para los decimales.">
            {(props) => (
              <input
                {...props}
                value={values.quantity}
                onChange={(e) => set("quantity")(e.target.value)}
                inputMode="decimal"
                placeholder="0,5"
                autoComplete="off"
              />
            )}
          </Field>
          <Field
            id="costBasis"
            label={`Costo por unidad (${portfolio.baseCurrency})`}
            optional
            error={errors.costBasis}
            hint="El precio que pagaste por cada unidad, no el total."
          >
            {(props) => (
              <input
                {...props}
                value={values.costBasis}
                onChange={(e) => set("costBasis")(e.target.value)}
                inputMode="decimal"
                placeholder="60000"
                autoComplete="off"
              />
            )}
          </Field>
          <Field id="acquiredAt" label="Fecha de adquisición" optional error={errors.acquiredAt}>
            {(props) => (
              <input
                {...props}
                type="date"
                max={todayIso()}
                value={values.acquiredAt}
                onChange={(e) => set("acquiredAt")(e.target.value)}
              />
            )}
          </Field>
          {isCedear && (
            <Field id="ratio" label="Ratio" error={errors.ratio} hint="Cuántos CEDEAR equivalen a 1 acción.">
              {(props) => (
                <input
                  {...props}
                  value={values.ratio}
                  onChange={(e) => set("ratio")(e.target.value)}
                  inputMode="decimal"
                  placeholder="10"
                  autoComplete="off"
                />
              )}
            </Field>
          )}
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold">Sede</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <SourceNameField
            value={values.sourceName}
            onChange={set("sourceName")}
            sources={sources}
            error={errors.sourceName}
          />
          <Field
            id="sourceType"
            label="Tipo de sede"
            hint={existingSource ? `Es el tipo que ya tiene ${existingSource.name}.` : undefined}
          >
            {(props) => (
              <select
                {...props}
                value={existingSource?.type ?? values.sourceType}
                disabled={Boolean(existingSource)}
                onChange={(e) => set("sourceType")(e.target.value)}
              >
                {SOURCE_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
      </fieldset>

      <details
        open={moreOpen}
        onToggle={(e) => setMoreOpen(e.currentTarget.open)}
        className="rounded-md border border-neutral-200 px-4 py-3 dark:border-neutral-800">
        <summary className="cursor-pointer text-sm font-semibold">
          Más datos <span className="font-normal text-neutral-500">(opcional)</span>
        </summary>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field id="fee" label={`Comisión (${portfolio.baseCurrency})`} optional error={errors.fee}>
            {(props) => (
              <input
                {...props}
                value={values.fee}
                onChange={(e) => set("fee")(e.target.value)}
                inputMode="decimal"
                placeholder="0"
                autoComplete="off"
              />
            )}
          </Field>
          <Field id="lockupExpiry" label="Fin de lockup" optional hint="Hasta cuándo no se puede mover o vender.">
            {(props) => (
              <input {...props} type="date" value={values.lockupExpiry} onChange={(e) => set("lockupExpiry")(e.target.value)} />
            )}
          </Field>
          <div className="sm:col-span-2">
            <Field id="notes" label="Notas" optional>
              {(props) => (
                <textarea {...props} rows={2} value={values.notes} onChange={(e) => set("notes")(e.target.value)} />
              )}
            </Field>
          </div>
        </div>
      </details>

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
          {pending ? "Guardando…" : "Guardar tenencia"}
        </button>
        <Link href="/tenencias/" className="text-sm text-neutral-500 hover:underline">
          Cancelar
        </Link>
      </div>
    </form>
  );
}

// Nombre de la sede con autocompletado de las que ya usó (RN-07).
function SourceNameField({
  value,
  onChange,
  sources,
  error,
}: {
  value: string;
  onChange: (value: string) => void;
  sources: KnownSource[];
  error?: string;
}) {
  const listId = useId();
  return (
    <Field id="sourceName" label="Sede" error={error} hint="Dónde está guardado: exchange, wallet, broker o banco.">
      {(props) => (
        <>
          <input
            {...props}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            list={listId}
            placeholder="Binance"
            autoComplete="off"
          />
          <datalist id={listId}>
            {sources.map((s) => (
              <option key={s.name} value={s.name}>
                {sourceTypeLabel(s.type)}
              </option>
            ))}
          </datalist>
        </>
      )}
    </Field>
  );
}

function SavedHolding({ holding, currency, onAnother }: { holding: Holding; currency: string; onAnother: () => void }) {
  return (
    <div role="status" className="mt-8 rounded-lg border border-emerald-600/40 bg-emerald-50 p-5 dark:bg-emerald-950/30">
      <p className="font-semibold text-emerald-800 dark:text-emerald-300">Tenencia guardada</p>
      <p className="mt-1 text-sm">
        {quantity(holding.quantity)} {holding.symbol} en {holding.sourceName}
        {holding.costBasis !== null && ` a ${money(holding.costBasis, currency)} por unidad`}.
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={onAnother}
          className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800"
        >
          Cargar otra
        </button>
        <Link
          href={`/tenencias/?lote=${encodeURIComponent(holding.id)}`}
          className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
        >
          Ver en tenencias
        </Link>
      </div>
    </div>
  );
}
