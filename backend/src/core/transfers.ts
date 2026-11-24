// Transferencia interna entre sedes propias (tarea 1.8, issue #19).
//
// Valida el pedido y delega la operación en la función Postgres
// `transfer_holding`, que es la que garantiza atomicidad, conserva el costo
// base y verifica que el holding sea del usuario (auth.uid()). La llamada RPC
// se inyecta, así esta lógica no depende de Supabase ni de AWS y se testea
// sin red.

import { z } from "zod";
import { compare, dec, toString } from "./decimal";

export const SOURCE_TYPES = ["exchange", "wallet", "broker", "other"] as const;

const quantitySchema = z.union([z.string(), z.number()]).transform((value, ctx) => {
  let parsed;
  try {
    parsed = dec(value);
  } catch {
    ctx.addIssue({ code: "custom", message: "La cantidad no es un número válido" });
    return z.NEVER;
  }
  if (compare(parsed, 0) <= 0) {
    ctx.addIssue({ code: "custom", message: "La cantidad debe ser mayor a 0" });
    return z.NEVER;
  }
  // Como string: un `numeric` de Postgres no pierde precisión en el camino.
  return toString(parsed);
});

export const transferRequestSchema = z.object({
  fromHoldingId: z.uuid({ message: "fromHoldingId debe ser un UUID" }),
  quantity: quantitySchema,
  toSourceName: z.string().trim().min(1, { message: "La sede destino es obligatoria" }),
  toSourceType: z.enum(SOURCE_TYPES).optional(),
});

export type TransferRequest = z.infer<typeof transferRequestSchema>;

export interface TransferHoldingParams {
  p_from_holding_id: string;
  p_quantity: string;
  p_to_source_name: string;
  p_to_source_type: string | null;
}

export interface RpcError {
  code?: string;
  message: string;
  // Status HTTP que devolvió PostgREST (401 si el JWT no es válido).
  status?: number;
}

export type TransferHoldingRpc = (
  params: TransferHoldingParams,
) => Promise<{ data: unknown; error: RpcError | null }>;

export interface TransferResult {
  transferId: string;
  fromHoldingId: string;
  toHoldingId: string;
  quantity: string;
  // true si se sumó a un lote idéntico que ya existía en la sede destino.
  merged: boolean;
  // true si se movió el lote entero (se le cambió la sede, mismo id).
  relocated: boolean;
}

export type ErrorCode =
  | "invalid_request"
  | "unauthorized"
  | "forbidden"
  | "holding_not_found"
  | "invalid_transfer"
  | "internal_error";

export type TransferOutcome =
  | { status: 201; body: TransferResult }
  | {
      status: 400 | 401 | 403 | 404 | 422 | 500;
      body: { error: ErrorCode; message: string; issues?: string[] };
    };

const rpcResultSchema = z.object({
  transfer_id: z.uuid(),
  from_holding_id: z.uuid(),
  to_holding_id: z.uuid(),
  merged: z.boolean(),
  relocated: z.boolean(),
});

export async function createTransfer(
  input: unknown,
  transferHolding: TransferHoldingRpc,
  onError: (error: unknown) => void = () => undefined,
): Promise<TransferOutcome> {
  const parsed = transferRequestSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: 400,
      body: {
        error: "invalid_request",
        message: "El pedido de transferencia no es válido",
        issues: parsed.error.issues.map((issue) =>
          issue.path.length ? `${issue.path.join(".")}: ${issue.message}` : issue.message,
        ),
      },
    };
  }

  const request = parsed.data;
  let response;
  try {
    response = await transferHolding({
      p_from_holding_id: request.fromHoldingId,
      p_quantity: request.quantity,
      p_to_source_name: request.toSourceName,
      p_to_source_type: request.toSourceType ?? null,
    });
  } catch (error) {
    onError(error);
    return internalError();
  }

  if (response.error) return mapRpcError(response.error, onError);

  const result = rpcResultSchema.safeParse(response.data);
  if (!result.success) {
    onError(new Error(`Respuesta inesperada de transfer_holding: ${JSON.stringify(response.data)}`));
    return internalError();
  }

  return {
    status: 201,
    body: {
      transferId: result.data.transfer_id,
      fromHoldingId: result.data.from_holding_id,
      toHoldingId: result.data.to_holding_id,
      // La cantidad validada del pedido: el JSON de vuelta la parsea como
      // number y podría perder decimales.
      quantity: request.quantity,
      merged: result.data.merged,
      relocated: result.data.relocated,
    },
  };
}

// Traduce los errores de transfer_holding (y de PostgREST) a HTTP. Los
// mensajes de la función son para el usuario; los demás no se exponen.
function mapRpcError(error: RpcError, onError: (error: unknown) => void): TransferOutcome {
  if (error.status === 401 || error.code === "PGRST301" || error.code === "PGRST303") {
    return { status: 401, body: { error: "unauthorized", message: "La sesión no es válida o venció" } };
  }
  switch (error.code) {
    case "P0002":
      return { status: 404, body: { error: "holding_not_found", message: "El holding no existe" } };
    case "22023":
    case "23514":
      return { status: 422, body: { error: "invalid_transfer", message: error.message } };
    case "22004":
      return { status: 400, body: { error: "invalid_request", message: error.message } };
    case "42501":
      return { status: 403, body: { error: "forbidden", message: "No tenés permiso para esta operación" } };
    default:
      onError(error);
      return internalError();
  }
}

function internalError(): TransferOutcome {
  return {
    status: 500,
    body: { error: "internal_error", message: "No se pudo registrar la transferencia" },
  };
}
