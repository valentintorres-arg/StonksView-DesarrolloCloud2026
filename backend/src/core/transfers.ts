// Transferencia interna entre sedes propias (tarea 1.8, issue #19).
//
// Valida el pedido y delega la operación en la función Postgres
// `transfer_holding`, que es la que garantiza atomicidad, conserva el costo
// base y verifica que el holding sea del usuario (auth.uid()). La llamada RPC
// se inyecta, así esta lógica no depende de Supabase ni de AWS y se testea
// sin red.

import { z } from "zod";
import {
  callRpc,
  decimalString,
  internalError,
  invalidRequest,
  mapRpcError,
  type Outcome,
  type RpcResponse,
} from "./rpc";

export const SOURCE_TYPES = ["exchange", "wallet", "broker", "other"] as const;

export const transferRequestSchema = z.object({
  fromHoldingId: z.uuid({ message: "fromHoldingId debe ser un UUID" }),
  quantity: decimalString({ min: "positive", label: "La cantidad" }),
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

export type TransferHoldingRpc = (params: TransferHoldingParams) => Promise<RpcResponse>;

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

export type TransferOutcome = Outcome<TransferResult>;

const MESSAGES = {
  notFound: "El holding no existe",
  internal: "No se pudo registrar la transferencia",
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
  if (!parsed.success) return invalidRequest("El pedido de transferencia no es válido", parsed.error);

  const request = parsed.data;
  const response = await callRpc(
    () =>
      transferHolding({
        p_from_holding_id: request.fromHoldingId,
        p_quantity: request.quantity,
        p_to_source_name: request.toSourceName,
        p_to_source_type: request.toSourceType ?? null,
      }),
    onError,
  );
  if (!response) return internalError(MESSAGES.internal);
  if (response.error) return mapRpcError(response.error, MESSAGES, onError);

  const result = rpcResultSchema.safeParse(response.data);
  if (!result.success) {
    onError(new Error(`Respuesta inesperada de transfer_holding: ${JSON.stringify(response.data)}`));
    return internalError(MESSAGES.internal);
  }

  return {
    status: 201,
    body: {
      transferId: result.data.transfer_id,
      fromHoldingId: result.data.from_holding_id,
      toHoldingId: result.data.to_holding_id,
      // La cantidad validada del pedido: transfer_holding la devuelve como
      // number de JSON y podría perder decimales.
      quantity: request.quantity,
      merged: result.data.merged,
      relocated: result.data.relocated,
    },
  };
}
