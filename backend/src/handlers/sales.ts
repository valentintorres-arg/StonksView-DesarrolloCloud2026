// Adaptador fino de POST /sales: lee token y body, arma la llamada RPC con
// el cliente del usuario y traduce el resultado a HTTP. La validación y el
// mapeo de errores viven en core/sales.

import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { createSale, type SellHoldingRpc } from "../core/sales";
import { json } from "./http";
import { withRequestLog } from "./observability";
import { NO_STORE, readAuthenticatedJson } from "./request";
import { supabaseForUser } from "./supabase";

export type RpcFactory = (accessToken: string) => SellHoldingRpc;

const supabaseRpc: RpcFactory = (accessToken) => async (params) => {
  const { data, error, status } = await supabaseForUser(accessToken).rpc("sell_holding", params);
  return { data, error: error ? { code: error.code, message: error.message, status } : null };
};

export function createHandler(rpcFor: RpcFactory): APIGatewayProxyHandlerV2 {
  return async (event) => {
    const request = readAuthenticatedJson(event);
    if (!request.ok) return request.response;

    const outcome = await createSale(request.body, rpcFor(request.token), (error) =>
      console.error("POST /sales falló", error),
    );
    return json(outcome.status, outcome.body, NO_STORE);
  };
}

export const handler = withRequestLog(createHandler(supabaseRpc));
