import { describe, expect, it, vi } from "vitest";
import { createSale, type SellHoldingRpc } from "./sales";

const PORTFOLIO = "11111111-1111-4111-8111-111111111111";
const LOT_A = "22222222-2222-4222-8222-222222222222";
const LOT_B = "44444444-4444-4444-8444-444444444444";
const SALE = "33333333-3333-4333-8333-333333333333";

const valid = {
  portfolioId: PORTFOLIO,
  symbol: "BTC",
  assetClass: "crypto",
  quantity: "2.5",
  salePrice: "400",
};

// Respuesta real de sell_holding (04sellholdingtext) para la venta FIFO del
// caso de prueba: A (2 × 100 + 2 de comisión) y medio B (0.5 × 200).
const rpcData = {
  sale_id: SALE,
  quantity: "2.5",
  sale_price: "400",
  proceeds: "1000.0",
  cost_basis: "302",
  realized_gain: "698.0",
  method: "fifo",
  lots_consumed: [
    { holding_id: LOT_A, source_name: "Binance", acquired_at: "2026-01-01T00:00:00+00:00", quantity: "2", unit_cost: "100", fee: "2", cost: "202" },
    { holding_id: LOT_B, source_name: "Ledger", acquired_at: null, quantity: "0.5", unit_cost: "200", fee: "0", cost: "100.0" },
  ],
};

function rpcOk(data: object = rpcData): SellHoldingRpc {
  return vi.fn(async () => ({ data, error: null }));
}

function rpcError(code: string, message = "error", status = 400): SellHoldingRpc {
  return async () => ({ data: null, error: { code, message, status } });
}

describe("createSale", () => {
  it("llama a sell_holding con los parámetros validados y FIFO por defecto", async () => {
    const rpc = rpcOk();
    await createSale(valid, rpc);

    expect(rpc).toHaveBeenCalledWith({
      p_portfolio_id: PORTFOLIO,
      p_symbol: "BTC",
      p_asset_class: "crypto",
      p_quantity: "2.5",
      p_sale_price: "400",
      p_method: "fifo",
      p_source_name: null,
    });
  });

  it("devuelve 201 con los montos exactos y el detalle de lotes en camelCase", async () => {
    const outcome = await createSale(valid, rpcOk());

    expect(outcome).toEqual({
      status: 201,
      body: {
        saleId: SALE,
        quantity: "2.5",
        salePrice: "400",
        proceeds: "1000.0",
        costBasis: "302",
        realizedGain: "698.0",
        method: "fifo",
        lotsConsumed: [
          { holdingId: LOT_A, sourceName: "Binance", acquiredAt: "2026-01-01T00:00:00+00:00", quantity: "2", unitCost: "100", fee: "2", cost: "202" },
          { holdingId: LOT_B, sourceName: "Ledger", acquiredAt: null, quantity: "0.5", unitCost: "200", fee: "0", cost: "100.0" },
        ],
      },
    });
  });

  it("pasa método, fecha y sede cuando vienen", async () => {
    const rpc = rpcOk();
    await createSale(
      { ...valid, method: "lifo", soldAt: "2026-11-20T15:30:00-03:00", sourceName: " Ledger ", quantity: 0.1 },
      rpc,
    );

    expect(rpc).toHaveBeenCalledWith(
      expect.objectContaining({
        p_method: "lifo",
        p_sold_at: "2026-11-20T15:30:00-03:00",
        p_source_name: "Ledger",
        p_quantity: "0.1",
      }),
    );
  });

  it("acepta precio de venta 0", async () => {
    const rpc = rpcOk();
    const outcome = await createSale({ ...valid, salePrice: "0" }, rpc);
    expect(outcome.status).toBe(201);
    expect(rpc).toHaveBeenCalledWith(expect.objectContaining({ p_sale_price: "0" }));
  });

  it.each([
    [{ ...valid, portfolioId: "x" }, "portfolioId"],
    [{ ...valid, symbol: "  " }, "símbolo"],
    [{ ...valid, assetClass: "bono" }, "assetClass"],
    [{ ...valid, quantity: "0" }, "mayor a 0"],
    [{ ...valid, salePrice: "-1" }, "negativo"],
    [{ ...valid, salePrice: "mucho" }, "número válido"],
    [{ ...valid, method: "promedio" }, "method"],
    [{ ...valid, soldAt: "ayer" }, "ISO 8601"],
  ])("rechaza pedidos inválidos con 400 sin llamar al RPC (%#)", async (input, expected) => {
    const rpc = rpcOk();
    const outcome = await createSale(input, rpc);

    expect(outcome.status).toBe(400);
    expect(JSON.stringify(outcome.body)).toContain(expected);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("devuelve 404 si el portfolio no existe o no es del usuario", async () => {
    const outcome = await createSale(valid, rpcError("P0002"));
    expect(outcome).toEqual({ status: 404, body: { error: "not_found", message: "El portfolio no existe" } });
  });

  it("devuelve 422 con el mensaje de la función (cantidad insuficiente, lote sin costo)", async () => {
    const message = "El lote 2222 (Binance) no tiene costo base; cargalo antes de vender";
    const outcome = await createSale(valid, rpcError("22023", message));
    expect(outcome).toEqual({ status: 422, body: { error: "unprocessable", message } });
  });

  it("devuelve 500 si la base devuelve montos como number (falta la migración 04)", async () => {
    const onError = vi.fn();
    const outcome = await createSale(valid, rpcOk({ ...rpcData, proceeds: 1000 }), onError);

    expect(outcome.status).toBe(500);
    expect(onError).toHaveBeenCalled();
  });
});
