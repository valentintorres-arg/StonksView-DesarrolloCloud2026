import { describe, expect, it, vi } from "vitest";
import { createTransfer, type TransferHoldingRpc } from "./transfers";

const HOLDING = "11111111-1111-4111-8111-111111111111";
const TO_HOLDING = "22222222-2222-4222-8222-222222222222";
const TRANSFER = "33333333-3333-4333-8333-333333333333";

const valid = { fromHoldingId: HOLDING, quantity: "0.5", toSourceName: "Ledger", toSourceType: "wallet" };

function rpcOk(overrides: object = {}): TransferHoldingRpc {
  return vi.fn(async () => ({
    data: {
      transfer_id: TRANSFER,
      from_holding_id: HOLDING,
      to_holding_id: TO_HOLDING,
      quantity: 0.5,
      merged: false,
      relocated: false,
      ...overrides,
    },
    error: null,
  }));
}

function rpcError(code: string, message = "error", status = 400): TransferHoldingRpc {
  return async () => ({ data: null, error: { code, message, status } });
}

describe("createTransfer", () => {
  it("llama a transfer_holding con los parámetros validados y devuelve 201", async () => {
    const rpc = rpcOk();
    const outcome = await createTransfer(valid, rpc);

    expect(rpc).toHaveBeenCalledWith({
      p_from_holding_id: HOLDING,
      p_quantity: "0.5",
      p_to_source_name: "Ledger",
      p_to_source_type: "wallet",
    });
    expect(outcome).toEqual({
      status: 201,
      body: {
        transferId: TRANSFER,
        fromHoldingId: HOLDING,
        toHoldingId: TO_HOLDING,
        quantity: "0.5",
        merged: false,
        relocated: false,
      },
    });
  });

  it("manda la cantidad como string exacto y sin tipo de sede si no viene", async () => {
    const rpc = rpcOk();
    await createTransfer({ fromHoldingId: HOLDING, quantity: 0.1, toSourceName: "  Ledger  " }, rpc);

    expect(rpc).toHaveBeenCalledWith(
      expect.objectContaining({ p_quantity: "0.1", p_to_source_name: "Ledger", p_to_source_type: null }),
    );
  });

  it("devuelve la cantidad pedida, no la que vuelve como number del RPC", async () => {
    const outcome = await createTransfer(
      { ...valid, quantity: "0.123456789012345678" },
      rpcOk({ quantity: 0.12345678901234568 }),
    );

    expect(outcome.status).toBe(201);
    expect(outcome.body).toMatchObject({ quantity: "0.123456789012345678" });
  });

  it.each([
    [{ ...valid, fromHoldingId: "no-es-uuid" }, "fromHoldingId"],
    [{ ...valid, quantity: "0" }, "mayor a 0"],
    [{ ...valid, quantity: "-1" }, "mayor a 0"],
    [{ ...valid, quantity: "abc" }, "número válido"],
    [{ ...valid, toSourceName: "   " }, "sede destino"],
    [{ ...valid, toSourceType: "banco" }, "toSourceType"],
    [undefined, ""],
  ])("rechaza pedidos inválidos con 400 sin llamar al RPC (%#)", async (input, expected) => {
    const rpc = rpcOk();
    const outcome = await createTransfer(input, rpc);

    expect(outcome.status).toBe(400);
    expect(outcome.body).toMatchObject({ error: "invalid_request" });
    expect(JSON.stringify(outcome.body)).toContain(expected);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("devuelve 404 si el holding no existe o no es del usuario", async () => {
    const outcome = await createTransfer(valid, rpcError("P0002", `Holding ${HOLDING} no encontrado`));
    expect(outcome).toEqual({
      status: 404,
      body: { error: "holding_not_found", message: "El holding no existe" },
    });
  });

  it("devuelve 422 con el mensaje de la función cuando la transferencia no es válida", async () => {
    const message = "Cantidad insuficiente: se pidieron 2, el lote tiene 1";
    const outcome = await createTransfer(valid, rpcError("22023", message));
    expect(outcome).toEqual({ status: 422, body: { error: "invalid_transfer", message } });
  });

  it("devuelve 401 si el JWT no es válido", async () => {
    const outcome = await createTransfer(valid, rpcError("PGRST303", "JWT expired", 401));
    expect(outcome.status).toBe(401);
    expect(outcome.body).toMatchObject({ error: "unauthorized" });
  });

  it("devuelve 403 si Postgres niega el permiso", async () => {
    const outcome = await createTransfer(valid, rpcError("42501", "permission denied", 403));
    expect(outcome.status).toBe(403);
  });

  it("devuelve 500 sin exponer el detalle ante un error desconocido", async () => {
    const onError = vi.fn();
    const outcome = await createTransfer(valid, rpcError("XX000", "detalle interno de Postgres"), onError);

    expect(outcome).toEqual({
      status: 500,
      body: { error: "internal_error", message: "No se pudo registrar la transferencia" },
    });
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: "XX000" }));
  });

  it("devuelve 500 si el RPC lanza o responde algo inesperado", async () => {
    const onError = vi.fn();
    const thrown = await createTransfer(valid, async () => {
      throw new Error("fetch failed");
    }, onError);
    const malformed = await createTransfer(valid, async () => ({ data: { ok: true }, error: null }), onError);

    expect(thrown.status).toBe(500);
    expect(malformed.status).toBe(500);
    expect(onError).toHaveBeenCalledTimes(2);
  });
});
