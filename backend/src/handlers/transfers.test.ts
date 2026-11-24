import type { APIGatewayProxyEventV2, Context } from "aws-lambda";
import { describe, expect, it, vi } from "vitest";
import { createHandler, type RpcFactory } from "./transfers";

const HOLDING = "11111111-1111-4111-8111-111111111111";

const okRpc: RpcFactory = () => async () => ({
  data: {
    transfer_id: "33333333-3333-4333-8333-333333333333",
    from_holding_id: HOLDING,
    to_holding_id: HOLDING,
    merged: false,
    relocated: true,
  },
  error: null,
});

async function invoke(rpcFor: RpcFactory, event: Partial<APIGatewayProxyEventV2>) {
  const result = await createHandler(rpcFor)(
    { headers: {}, isBase64Encoded: false, ...event } as APIGatewayProxyEventV2,
    {} as Context,
    () => undefined,
  );
  return result as { statusCode: number; headers: Record<string, string>; body: string };
}

const body = JSON.stringify({ fromHoldingId: HOLDING, quantity: "1", toSourceName: "Ledger" });

describe("handler de POST /transfers", () => {
  it("responde 201 y usa el token del usuario para el RPC", async () => {
    const rpcFor = vi.fn(okRpc);
    const result = await invoke(rpcFor, { headers: { authorization: "Bearer jwt-del-usuario" }, body });

    expect(rpcFor).toHaveBeenCalledWith("jwt-del-usuario");
    expect(result.statusCode).toBe(201);
    expect(result.headers).toMatchObject({ "content-type": "application/json", "cache-control": "no-store" });
    expect(JSON.parse(result.body)).toMatchObject({ relocated: true, quantity: "1" });
  });

  it("responde 401 sin token y no llama al RPC", async () => {
    const rpcFor = vi.fn(okRpc);
    const result = await invoke(rpcFor, { body });

    expect(result.statusCode).toBe(401);
    expect(rpcFor).not.toHaveBeenCalled();
  });

  it("responde 401 si el header no es Bearer", async () => {
    const result = await invoke(okRpc, { headers: { authorization: "Basic abc" }, body });
    expect(result.statusCode).toBe(401);
  });

  it("responde 400 si el body no es JSON", async () => {
    const result = await invoke(okRpc, { headers: { authorization: "Bearer t" }, body: "{no json" });

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body)).toMatchObject({ error: "invalid_request" });
  });

  it("acepta el body en base64", async () => {
    const result = await invoke(okRpc, {
      headers: { authorization: "Bearer t" },
      body: Buffer.from(body).toString("base64"),
      isBase64Encoded: true,
    });

    expect(result.statusCode).toBe(201);
  });

  it("loguea el detalle de un error interno sin devolverlo", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failing: RpcFactory = () => async () => ({
      data: null,
      error: { code: "XX000", message: "detalle interno", status: 500 },
    });
    const result = await invoke(failing, { headers: { authorization: "Bearer t" }, body });

    expect(result.statusCode).toBe(500);
    expect(result.body).not.toContain("detalle interno");
    expect(log).toHaveBeenCalled();
  });
});
