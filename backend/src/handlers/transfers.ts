// Adaptador fino de POST /transfers: saca el token y el body del evento,
// arma la llamada RPC con el cliente del usuario y traduce el resultado a
// HTTP. La validación y el mapeo de errores viven en core/transfers.

import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { createTransfer, type TransferHoldingRpc } from "../core/transfers";
import { json } from "./http";
import { bearerToken, supabaseForUser } from "./supabase";

export type RpcFactory = (accessToken: string) => TransferHoldingRpc;

const supabaseRpc: RpcFactory = (accessToken) => async (params) => {
  const { data, error, status } = await supabaseForUser(accessToken).rpc("transfer_holding", params);
  return {
    data,
    error: error ? { code: error.code, message: error.message, status } : null,
  };
};

const NO_STORE = { "cache-control": "no-store" };

export function createHandler(rpcFor: RpcFactory): APIGatewayProxyHandlerV2 {
  return async (event) => {
    const token = bearerToken(event);
    if (!token) {
      return json(401, { error: "unauthorized", message: "Falta el token de sesión" }, NO_STORE);
    }

    let body: unknown;
    try {
      const raw = event.isBase64Encoded && event.body
        ? Buffer.from(event.body, "base64").toString("utf8")
        : event.body;
      body = raw ? JSON.parse(raw) : undefined;
    } catch {
      return json(400, { error: "invalid_request", message: "El body no es JSON válido" }, NO_STORE);
    }

    const outcome = await createTransfer(body, rpcFor(token), (error) =>
      console.error("POST /transfers falló", error),
    );
    return json(outcome.status, outcome.body, NO_STORE);
  };
}

export const handler = createHandler(supabaseRpc);
