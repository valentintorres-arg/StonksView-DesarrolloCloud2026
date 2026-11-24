// Piezas comunes a los endpoints que invocan funciones Postgres por RPC
// (transfer_holding, sell_holding): validación de montos decimales y
// traducción de los errores de Postgres/PostgREST a HTTP.

import { z } from "zod";
import { compare, dec, toString } from "./decimal";

export interface RpcError {
  code?: string;
  message: string;
  // Status HTTP que devolvió PostgREST (401 si el JWT no es válido).
  status?: number;
}

export type RpcResponse = { data: unknown; error: RpcError | null };

export type ErrorCode =
  | "invalid_request"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "unprocessable"
  | "internal_error";

export type ErrorStatus = 400 | 401 | 403 | 404 | 409 | 422 | 500;

export interface ErrorBody {
  error: ErrorCode;
  message: string;
  issues?: string[];
}

export type SuccessStatus = 200 | 201 | 204;

export type Outcome<T> = { status: SuccessStatus; body: T } | { status: ErrorStatus; body: ErrorBody };

// Número decimal (string o number) que se devuelve como string exacto, para
// que un `numeric` de Postgres no pierda precisión en el camino.
export function decimalString(options: { min: "positive" | "non-negative"; label: string }) {
  return z.union([z.string(), z.number()]).transform((value, ctx) => {
    let parsed;
    try {
      parsed = dec(value);
    } catch {
      ctx.addIssue({ code: "custom", message: `${options.label} no es un número válido` });
      return z.NEVER;
    }
    const sign = compare(parsed, 0);
    if (options.min === "positive" ? sign <= 0 : sign < 0) {
      ctx.addIssue({
        code: "custom",
        message:
          options.min === "positive"
            ? `${options.label} debe ser mayor a 0`
            : `${options.label} no puede ser negativo`,
      });
      return z.NEVER;
    }
    return toString(parsed);
  });
}

export function invalidRequest(message: string, error: z.ZodError): Outcome<never> {
  return {
    status: 400,
    body: {
      error: "invalid_request",
      message,
      issues: error.issues.map((issue) =>
        issue.path.length ? `${issue.path.join(".")}: ${issue.message}` : issue.message,
      ),
    },
  };
}

export interface RpcErrorMessages {
  notFound: string;
  internal: string;
  // Mensaje para una violación de FK al borrar (23503): la fila está
  // referenciada por otra. Sin él, 23503 se trata como error interno.
  conflict?: string;
  // RLS rechazó la escritura (42501): para no revelar que el recurso de otro
  // usuario existe, se puede responder como si no existiera.
  forbiddenAsNotFound?: boolean;
}

// Traduce los errores de Postgres/PostgREST a HTTP. Los mensajes de negocio
// (22023/22004) los escribe la función para el usuario y se pasan tal cual;
// cualquier otro error no se expone y va al log.
export function mapRpcError(
  error: RpcError,
  messages: RpcErrorMessages,
  onError: (error: unknown) => void,
): Outcome<never> {
  if (error.status === 401 || error.code === "PGRST301" || error.code === "PGRST303") {
    return { status: 401, body: { error: "unauthorized", message: "La sesión no es válida o venció" } };
  }
  switch (error.code) {
    case "P0002":
      return { status: 404, body: { error: "not_found", message: messages.notFound } };
    case "22023":
    case "23514":
      return { status: 422, body: { error: "unprocessable", message: error.message } };
    case "22004":
      return { status: 400, body: { error: "invalid_request", message: error.message } };
    case "23503":
      if (!messages.conflict) break;
      return { status: 409, body: { error: "conflict", message: messages.conflict } };
    case "42501":
      if (messages.forbiddenAsNotFound) {
        return { status: 404, body: { error: "not_found", message: messages.notFound } };
      }
      return { status: 403, body: { error: "forbidden", message: "No tenés permiso para esta operación" } };
  }
  onError(error);
  return internalError(messages.internal);
}

export function internalError(message: string): Outcome<never> {
  return { status: 500, body: { error: "internal_error", message } };
}

// Llama al RPC atajando una excepción (red caída, etc.) como error interno.
export async function callRpc(
  call: () => Promise<RpcResponse>,
  onError: (error: unknown) => void,
): Promise<RpcResponse | null> {
  try {
    return await call();
  } catch (error) {
    onError(error);
    return null;
  }
}
