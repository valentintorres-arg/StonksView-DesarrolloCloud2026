// Validación del formulario de transferencia interna (tarea 3.4, pantalla P6
// de la spec). Es pura (sin React ni red) para poder probarla aparte. La API
// y transfer_holding vuelven a validar todo; esto es para avisar antes.

import type { Holding, TransferRequest } from "./api";
import { findSource, parseDecimal, sourceKey, type KnownSource } from "./holding-form";

export const NEW_SOURCE = "__nueva__";

export interface TransferFormValues {
  quantity: string;
  // Clave de una sede existente (sourceKey) o NEW_SOURCE.
  destination: string;
  newSourceName: string;
  newSourceType: string;
}

export type TransferFormErrors = Partial<Record<keyof TransferFormValues, string>>;

export type TransferFormResult =
  | { ok: true; request: TransferRequest; destinationName: string; all: boolean }
  | { ok: false; errors: TransferFormErrors };

export function validateTransfer(values: TransferFormValues, lot: Holding, sources: KnownSource[]): TransferFormResult {
  const errors: TransferFormErrors = {};

  const quantity = parseDecimal(values.quantity);
  if (!values.quantity.trim()) errors.quantity = "Ingresá la cantidad a mover.";
  else if (quantity === null) errors.quantity = "Ingresá un número (ej. 0,5).";
  else if (compareDecimal(quantity, "0") <= 0) errors.quantity = "La cantidad tiene que ser mayor a 0.";
  else if (compareDecimal(quantity, lot.quantity) > 0) errors.quantity = "No podés mover más de lo que tiene el lote.";

  let destinationName = "";
  let destinationType: string | undefined;
  if (values.destination === NEW_SOURCE) {
    destinationName = values.newSourceName.trim().replace(/\s+/g, " ");
    if (!destinationName) errors.newSourceName = "Ingresá el nombre de la sede destino.";
    else if (findSource(sources, destinationName)) {
      // Ya existe: se usa como existente (RN-07), con su nombre y tipo.
      const existing = findSource(sources, destinationName)!;
      destinationName = existing.name;
      destinationType = existing.type;
    } else if (!values.newSourceType) errors.newSourceType = "Elegí el tipo de la sede nueva.";
    else destinationType = values.newSourceType;
  } else {
    const existing = sources.find((s) => sourceKey(s.name) === values.destination);
    if (!existing) errors.destination = "Elegí la sede destino.";
    else {
      destinationName = existing.name;
      destinationType = existing.type;
    }
  }
  if (destinationName && sourceKey(destinationName) === sourceKey(lot.sourceName)) {
    const field = values.destination === NEW_SOURCE ? "newSourceName" : "destination";
    errors[field] = "La sede destino tiene que ser distinta de la de origen.";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    destinationName,
    all: compareDecimal(quantity!, lot.quantity) === 0,
    request: {
      fromHoldingId: lot.id,
      quantity: quantity!,
      toSourceName: destinationName,
      ...(destinationType ? { toSourceType: destinationType } : {}),
    },
  };
}

// Compara dos decimales no negativos en texto, sin pasar por number (una
// cripto puede tener más decimales de los que un double representa bien).
export function compareDecimal(a: string, b: string): number {
  const [ai = "0", af = ""] = a.split(".");
  const [bi = "0", bf = ""] = b.split(".");
  const scale = Math.max(af.length, bf.length);
  const x = BigInt(ai + af.padEnd(scale, "0"));
  const y = BigInt(bi + bf.padEnd(scale, "0"));
  return x === y ? 0 : x > y ? 1 : -1;
}
