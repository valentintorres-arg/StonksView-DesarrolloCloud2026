// Lectura común del request en los endpoints autenticados: token Bearer y
// body JSON. Devuelve la respuesta de error lista si falta algo.

import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { json } from "./http";
import { bearerToken } from "./supabase";

export const NO_STORE = { "cache-control": "no-store" };

export type AuthenticatedRequest =
  | { ok: true; token: string; body: unknown }
  | { ok: false; response: APIGatewayProxyStructuredResultV2 };

export function readAuthenticatedJson(event: APIGatewayProxyEventV2): AuthenticatedRequest {
  const token = bearerToken(event);
  if (!token) {
    return {
      ok: false,
      response: json(401, { error: "unauthorized", message: "Falta el token de sesión" }, NO_STORE),
    };
  }

  try {
    const raw = event.isBase64Encoded && event.body
      ? Buffer.from(event.body, "base64").toString("utf8")
      : event.body;
    return { ok: true, token, body: raw ? JSON.parse(raw) : undefined };
  } catch {
    return {
      ok: false,
      response: json(400, { error: "invalid_request", message: "El body no es JSON válido" }, NO_STORE),
    };
  }
}
