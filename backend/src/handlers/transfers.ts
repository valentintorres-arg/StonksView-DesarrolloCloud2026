// Adaptador fino de POST /transfers: lee token y body, arma la llamada RPC
// con el cliente del usuario y traduce el resultado a HTTP. La validación y
// el mapeo de errores viven en core/transfers.

import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { createTransfer, type TransferHoldingRpc } from "../core/transfers";
import { json } from "./http";
import { NO_STORE, readAuthenticatedJson } from "./request";
import { supabaseForUser } from "./supabase";

export type RpcFactory = (accessToken: string) => TransferHoldingRpc;

const supabaseRpc: RpcFactory = (accessToken) => async (params) => {
  const { data, error, status } = await supabaseForUser(accessToken).rpc("transfer_holding", params);
  return { data, error: error ? { code: error.code, message: error.message, status } : null };
};

export function createHandler(rpcFor: RpcFactory): APIGatewayProxyHandlerV2 {
  return async (event) => {
    const request = readAuthenticatedJson(event);
    if (!request.ok) return request.response;

    const outcome = await createTransfer(request.body, rpcFor(request.token), (error) =>
      console.error("POST /transfers falló", error),
    );
    return json(outcome.status, outcome.body, NO_STORE);
  };
}

export const handler = createHandler(supabaseRpc);
