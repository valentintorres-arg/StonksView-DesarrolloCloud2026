// Venta de un activo con costo base FIFO/LIFO (tarea 1.8, issue #19).
//
// Valida el pedido y delega en la función Postgres `sell_holding`, que
// consume los lotes de forma atómica, calcula la ganancia realizada y
// verifica que el portfolio sea del usuario (auth.uid()). Los montos viajan
// como string decimal exacto en los dos sentidos (migración 04sellholdingtext).

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

export const ASSET_CLASSES = ["crypto", "stock", "etf", "forex", "other", "cedear"] as const;
export const COST_METHODS = ["fifo", "lifo"] as const;

export const saleRequestSchema = z.object({
  portfolioId: z.uuid({ message: "portfolioId debe ser un UUID" }),
  symbol: z.string().trim().min(1, { message: "El símbolo es obligatorio" }),
  assetClass: z.enum(ASSET_CLASSES),
  quantity: decimalString({ min: "positive", label: "La cantidad" }),
  salePrice: decimalString({ min: "non-negative", label: "El precio de venta" }),
  method: z.enum(COST_METHODS).default("fifo"),
  soldAt: z.iso.datetime({ offset: true, message: "soldAt debe ser una fecha ISO 8601" }).optional(),
  sourceName: z.string().trim().min(1).optional(),
});

export type SaleRequest = z.infer<typeof saleRequestSchema>;

export interface SellHoldingParams {
  p_portfolio_id: string;
  p_symbol: string;
  p_asset_class: string;
  p_quantity: string;
  p_sale_price: string;
  p_method: string;
  p_sold_at?: string;
  p_source_name: string | null;
}

export type SellHoldingRpc = (params: SellHoldingParams) => Promise<RpcResponse>;

export interface LotConsumed {
  holdingId: string;
  sourceName: string;
  acquiredAt: string | null;
  quantity: string;
  unitCost: string;
  fee: string;
  cost: string;
}

export interface SaleResult {
  saleId: string;
  quantity: string;
  salePrice: string;
  proceeds: string;
  costBasis: string;
  realizedGain: string;
  method: (typeof COST_METHODS)[number];
  lotsConsumed: LotConsumed[];
}

export type SaleOutcome = Outcome<SaleResult>;

const MESSAGES = {
  notFound: "El portfolio no existe",
  internal: "No se pudo registrar la venta",
};

// sell_holding devuelve los montos como texto; un number acá significaría
// que la base tiene una versión anterior a 04sellholdingtext.
const amount = z.string().regex(/^-?\d+(\.\d+)?$/);

const rpcResultSchema = z.object({
  sale_id: z.uuid(),
  quantity: amount,
  sale_price: amount,
  proceeds: amount,
  cost_basis: amount,
  realized_gain: amount,
  method: z.enum(COST_METHODS),
  lots_consumed: z.array(
    z.object({
      holding_id: z.uuid(),
      source_name: z.string(),
      acquired_at: z.string().nullable(),
      quantity: amount,
      unit_cost: amount,
      fee: amount,
      cost: amount,
    }),
  ),
});

export async function createSale(
  input: unknown,
  sellHolding: SellHoldingRpc,
  onError: (error: unknown) => void = () => undefined,
): Promise<SaleOutcome> {
  const parsed = saleRequestSchema.safeParse(input);
  if (!parsed.success) return invalidRequest("El pedido de venta no es válido", parsed.error);

  const request = parsed.data;
  const params: SellHoldingParams = {
    p_portfolio_id: request.portfolioId,
    p_symbol: request.symbol,
    p_asset_class: request.assetClass,
    p_quantity: request.quantity,
    p_sale_price: request.salePrice,
    p_method: request.method,
    p_source_name: request.sourceName ?? null,
  };
  // Sin soldAt, la función usa now() de la base.
  if (request.soldAt) params.p_sold_at = request.soldAt;

  const response = await callRpc(() => sellHolding(params), onError);
  if (!response) return internalError(MESSAGES.internal);
  if (response.error) return mapRpcError(response.error, MESSAGES, onError);

  const result = rpcResultSchema.safeParse(response.data);
  if (!result.success) {
    onError(new Error(`Respuesta inesperada de sell_holding: ${JSON.stringify(response.data)}`));
    return internalError(MESSAGES.internal);
  }

  const sale = result.data;
  return {
    status: 201,
    body: {
      saleId: sale.sale_id,
      quantity: sale.quantity,
      salePrice: sale.sale_price,
      proceeds: sale.proceeds,
      costBasis: sale.cost_basis,
      realizedGain: sale.realized_gain,
      method: sale.method,
      lotsConsumed: sale.lots_consumed.map((lot) => ({
        holdingId: lot.holding_id,
        sourceName: lot.source_name,
        acquiredAt: lot.acquired_at,
        quantity: lot.quantity,
        unitCost: lot.unit_cost,
        fee: lot.fee,
        cost: lot.cost,
      })),
    },
  };
}
