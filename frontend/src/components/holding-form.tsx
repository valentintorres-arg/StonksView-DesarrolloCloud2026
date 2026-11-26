"use client";

// Alta manual de un lote (tarea 3.2, pantalla P5 de la spec). Valida lo mismo
// que la API para avisar antes de mandar; la API vuelve a validar igual.

import { useId, useState, type FormEvent, type ReactNode } from "react";
import { z } from "zod";
import { api, type Holding, type NewHolding, type SourceType } from "@/lib/api";
import { ASSET_CLASS_OPTIONS, SOURCE_TYPE_OPTIONS } from "@/lib/format";
import { errorMessage } from "@/lib/use-load";

// Acepta coma decimal ("0,5") además de punto; sin separador de miles.
export function normalizeDecimal(text: string): string {
  return text.trim().replace(/\s+/g, "").replace(",", ".");
}

const DECIMAL = /^\d+(\.\d+)?$/;

const decimal = (label: string, min: "positive" | "non-negative") =>
  z
    .string()
    .transform(normalizeDecimal)
    .refine((v) => DECIMAL.test(v), { message: `${label}: ingresá un número (ej. 0,5).` })
    .refine((v) => (min === "positive" ? Number(v) > 0 : Number(v) >= 0), {
      message: min === "positive" ? `${label} tiene que ser mayor a 0.` : `${label} no puede ser negativo.`,
    });

const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), schema.optional());

function today(): string {
  // AAAA-MM-DD en la zona del navegador, para comparar con el <input type="date">.
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

export const holdingFormSchema = z
  .object({
    symbol: z
      .string()
      .transform((v) => v.trim().replace(/\s+/g, "").toUpperCase())
      .refine((v) => v.length > 0, { message: "Ingresá el símbolo (ej. BTC)." }),
    assetClass: z.enum(["crypto", "stock", "etf", "cedear", "forex", "other"]),
    quantity: decimal("La cantidad", "positive"),
    costBasis: optional(decimal("El costo por unidad", "non-negative")),
    sourceName: z
      .string()
      .transform((v) => v.trim())
      .refine((v) => v.length > 0, { message: "Ingresá la sede (ej. Binance)." }),
    sourceType: z.enum(["exchange", "wallet", "broker", "other"]),
    acquiredAt: optional(z.iso.date().refine((d) => d <= today(), { message: "La fecha de adquisición no puede ser futura." })),
    fee: optional(decimal("La comisión", "non-negative")),
    ratio: optional(decimal("El ratio", "positive")),
    lockupExpiry: optional(z.iso.date()),
    notes: optional(z.string().transform((v) => v.trim())),
  })
  .superRefine((h, ctx) => {
    if (h.assetClass === "cedear" && !h.ratio) {
      ctx.addIssue({ code: "custom", path: ["ratio"], message: "Para un CEDEAR ingresá el ratio." });
    }
  })
  // El ratio solo tiene sentido para CEDEAR: si se cambió de clase, no se manda.
  .transform((h): NewHolding => ({ ...h, ratio: h.assetClass === "cedear" ? h.ratio : undefined }));

type Field = keyof z.input<typeof holdingFormSchema>;
type Values = Record<Field, string>;

const EMPTY: Values = {
  symbol: "",
  assetClass: "crypto",
  quantity: "",
  costBasis: "",
  sourceName: "",
  sourceType: "exchange",
  acquiredAt: "",
  fee: "",
  ratio: "",
  lockupExpiry: "",
  notes: "",
};

interface Props {
  portfolioId: string;
  currency: string;
  // Sedes ya usadas en el portfolio, para autocompletar nombre y tipo.
  sources: Array<{ name: string; type: SourceType }>;
  onSaved: (holding: Holding) => void;
  onCancel: () => void;
}

export function HoldingForm({ portfolioId, currency, sources, onSaved, onCancel }: Props) {
  const [values, setValues] = useState<Values>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const sourcesListId = useId();

  const set = (field: Field) => (value: string) => {
    setValues((v) => {
      const next = { ...v, [field]: value };
      // Si la sede ya existe, su tipo se completa solo (RN-07: misma sede sin
      // distinguir mayúsculas ni espacios).
      if (field === "sourceName") {
        const known = sources.find((s) => s.name.trim().toLowerCase() === value.trim().toLowerCase());
        if (known) next.sourceType = known.type;
      }
      return next;
    });
    setErrors((e) => ({ ...e, [field]: undefined }));
  };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = holdingFormSchema.safeParse(values);
    if (!parsed.success) {
      const fieldErrors: Partial<Record<Field, string>> = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as Field;
        fieldErrors[field] ??= issue.message;
      }
      setErrors(fieldErrors);
      return;
    }
    setPending(true);
    setFormError(null);
    try {
      onSaved(await api.createHolding(portfolioId, parsed.data));
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setPending(false);
    }
  }

  const isCedear = values.assetClass === "cedear";
  const knownSource = sources.some((s) => s.name.trim().toLowerCase() === values.sourceName.trim().toLowerCase());

  return (
    <form onSubmit={submit} noValidate className="rounded-lg border border-neutral-200 p-5 dark:border-neutral-800">
      <h3 className="font-semibold">Cargar tenencia</h3>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <TextField label="Símbolo" value={values.symbol} onChange={set("symbol")} error={errors.symbol} required placeholder="BTC" autoCapitalize="characters" />
        <SelectField label="Clase de activo" value={values.assetClass} onChange={set("assetClass")} options={ASSET_CLASS_OPTIONS} required />
        <TextField label="Cantidad" value={values.quantity} onChange={set("quantity")} error={errors.quantity} required inputMode="decimal" placeholder="0,5" />
        <TextField
          label={`Costo por unidad (${currency})`}
          value={values.costBasis}
          onChange={set("costBasis")}
          error={errors.costBasis}
          inputMode="decimal"
          hint="Precio que pagaste por cada unidad."
        />
        <TextField
          label="Sede"
          value={values.sourceName}
          onChange={set("sourceName")}
          error={errors.sourceName}
          required
          placeholder="Binance"
          list={sourcesListId}
          hint={knownSource ? "Sede existente: el tipo se completó solo." : undefined}
        />
        <datalist id={sourcesListId}>
          {sources.map((s) => (
            <option key={s.name} value={s.name} />
          ))}
        </datalist>
        <SelectField label="Tipo de sede" value={values.sourceType} onChange={set("sourceType")} options={SOURCE_TYPE_OPTIONS} required />
        <TextField label="Fecha de adquisición" type="date" value={values.acquiredAt} onChange={set("acquiredAt")} error={errors.acquiredAt} max={today()} />
        <TextField label={`Comisión (${currency})`} value={values.fee} onChange={set("fee")} error={errors.fee} inputMode="decimal" />
        {isCedear && (
          <TextField
            label="Ratio"
            value={values.ratio}
            onChange={set("ratio")}
            error={errors.ratio}
            required
            inputMode="decimal"
            hint="Cuántos CEDEAR equivalen a 1 acción."
          />
        )}
        <TextField label="Fin de lockup" type="date" value={values.lockupExpiry} onChange={set("lockupExpiry")} error={errors.lockupExpiry} />
        <div className="sm:col-span-2">
          <TextField label="Notas" value={values.notes} onChange={set("notes")} error={errors.notes} />
        </div>
      </div>

      {formError && (
        <p role="alert" className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {formError}
        </p>
      )}

      <div className="mt-5 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
        >
          {pending ? "Guardando…" : "Guardar"}
        </button>
      </div>
    </form>
  );
}

const INPUT =
  "mt-1 w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/20 dark:border-neutral-700";

function FieldShell({ id, label, required, error, hint, children }: { id: string; label: string; required?: boolean; error?: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
        {!required && <span className="font-normal text-neutral-500"> (opcional)</span>}
      </label>
      {children}
      {error ? (
        <p id={`${id}-msg`} className="mt-1 text-xs text-red-700 dark:text-red-300">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-msg`} className="mt-1 text-xs text-neutral-500">
            {hint}
          </p>
        )
      )}
    </div>
  );
}

type TextFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
  required?: boolean;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">;

function TextField({ label, value, onChange, error, hint, required, ...rest }: TextFieldProps) {
  const id = useId();
  return (
    <FieldShell id={id} label={label} required={required} error={error} hint={hint}>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? `${id}-msg` : undefined}
        className={INPUT}
        {...rest}
      />
    </FieldShell>
  );
}

function SelectField({ label, value, onChange, options, required }: { label: string; value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string }>; required?: boolean }) {
  const id = useId();
  return (
    <FieldShell id={id} label={label} required={required}>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={INPUT}>
        {options.map((o) => (
          <option key={o.value} value={o.value} className="text-neutral-900">
            {o.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}
