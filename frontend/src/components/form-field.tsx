// Campo de formulario: etiqueta, control, ayuda y error, conectados por id y
// aria-describedby para los lectores de pantalla.

import type { ReactNode } from "react";

const INPUT_CLASS =
  "mt-1 w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/20 disabled:opacity-60";

export interface ControlProps {
  id: string;
  className: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}

export function Field({
  id,
  label,
  optional,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  optional?: boolean;
  hint?: string;
  error?: string;
  children: (props: ControlProps) => ReactNode;
}) {
  const controlId = `holding-${id}`;
  const describedBy = [error && `${controlId}-error`, hint && `${controlId}-hint`].filter(Boolean).join(" ");
  return (
    <div>
      <label htmlFor={controlId} className="block text-sm font-medium">
        {label} {optional && <span className="font-normal text-neutral-500">(opcional)</span>}
      </label>
      {children({
        id: controlId,
        className: `${INPUT_CLASS} ${error ? "border-red-500 dark:border-red-400" : "border-neutral-300 dark:border-neutral-700"}`,
        ...(error ? { "aria-invalid": true } : {}),
        ...(describedBy ? { "aria-describedby": describedBy } : {}),
      })}
      {error && (
        <p id={`${controlId}-error`} className="mt-1 text-xs text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
      {hint && (
        <p id={`${controlId}-hint`} className="mt-1 text-xs text-neutral-500">
          {hint}
        </p>
      )}
    </div>
  );
}
