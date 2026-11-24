import { describe, expect, it, vi } from "vitest";
import {
  createHolding,
  createPortfolio,
  deleteHolding,
  type HoldingRow,
  listHoldings,
  listPortfolios,
  type PortfolioStore,
  updateHolding,
} from "./portfolios";

const P = "11111111-1111-4111-8111-111111111111";
const H = "22222222-2222-4222-8222-222222222222";
const NOW = "2026-11-23T12:00:00+00:00";

const holdingRow: HoldingRow = {
  id: H,
  portfolio_id: P,
  symbol: "BTC",
  asset_class: "crypto",
  quantity: "0.5",
  cost_basis: "30000",
  fee: "1.5",
  source_type: "exchange",
  source_name: "Binance",
  acquired_at: "2026-03-15T00:00:00+00:00",
  lockup_expiry: null,
  ratio: null,
  notes: null,
  created_at: NOW,
  updated_at: NOW,
};

function store(overrides: Partial<PortfolioStore> = {}): PortfolioStore {
  return {
    listPortfolios: vi.fn(async () => ({
      data: [{ id: P, name: "Principal", base_currency: "USD", created_at: NOW }],
      error: null,
    })),
    getPortfolio: vi.fn(async () => ({
      data: { id: P, name: "Principal", base_currency: "USD", created_at: NOW },
      error: null,
    })),
    createPortfolio: vi.fn(async (input) => ({ data: { id: P, created_at: NOW, ...input }, error: null })),
    listHoldings: vi.fn(async () => ({ data: [holdingRow], error: null })),
    createHolding: vi.fn(async () => ({ data: holdingRow, error: null })),
    updateHolding: vi.fn(async () => ({ data: holdingRow, error: null })),
    deleteHolding: vi.fn(async () => ({ data: true, error: null })),
    ...overrides,
  };
}

const noop = () => undefined;

describe("portfolios", () => {
  it("lista los portfolios del usuario en camelCase", async () => {
    expect(await listPortfolios(store(), noop)).toEqual({
      status: 200,
      body: [{ id: P, name: "Principal", baseCurrency: "USD", createdAt: NOW }],
    });
  });

  it("crea un portfolio con USD por defecto y normaliza la moneda", async () => {
    const s = store();
    await createPortfolio({ name: "  Familiar " }, s, noop);
    await createPortfolio({ name: "Ahorro", baseCurrency: "ars" }, s, noop);

    expect(s.createPortfolio).toHaveBeenNthCalledWith(1, { name: "Familiar", base_currency: "USD" });
    expect(s.createPortfolio).toHaveBeenNthCalledWith(2, { name: "Ahorro", base_currency: "ARS" });
  });

  it.each([[{}], [{ name: " " }], [{ name: "x", baseCurrency: "dolar" }]])(
    "rechaza un portfolio inválido con 400 (%#)",
    async (input) => {
      const s = store();
      expect((await createPortfolio(input, s, noop)).status).toBe(400);
      expect(s.createPortfolio).not.toHaveBeenCalled();
    },
  );
});

describe("holdings", () => {
  const valid = {
    symbol: " btc ",
    assetClass: "crypto",
    quantity: "0.5",
    costBasis: "30000",
    fee: 1.5,
    sourceType: "exchange",
    sourceName: " Binance ",
    acquiredAt: "2026-03-15",
  };

  it("lista las tenencias actuales del portfolio", async () => {
    const s = store();
    const outcome = await listHoldings(P, false, s, noop);

    expect(s.listHoldings).toHaveBeenCalledWith(P, false);
    expect(outcome).toMatchObject({
      status: 200,
      body: [{ id: H, symbol: "BTC", quantity: "0.5", costBasis: "30000", acquiredAt: "2026-03-15T00:00:00+00:00" }],
    });
  });

  it("devuelve 404 si el portfolio no existe o es de otro usuario", async () => {
    const s = store({ getPortfolio: vi.fn(async () => ({ data: null, error: null })) });

    expect(await listHoldings(P, false, s, noop)).toEqual({
      status: 404,
      body: { error: "not_found", message: "El portfolio no existe" },
    });
    expect(s.listHoldings).not.toHaveBeenCalled();
  });

  it("crea un holding con símbolo en mayúsculas y montos como string exacto", async () => {
    const s = store();
    const outcome = await createHolding(P, valid, s, noop);

    expect(outcome.status).toBe(201);
    expect(s.createHolding).toHaveBeenCalledWith({
      portfolio_id: P,
      symbol: "BTC",
      asset_class: "crypto",
      quantity: "0.5",
      cost_basis: "30000",
      fee: "1.5",
      source_type: "exchange",
      source_name: "Binance",
      acquired_at: "2026-03-15",
      lockup_expiry: null,
      ratio: null,
      notes: null,
    });
  });

  it("acepta un holding sin costo base (se valúa pero no entra en la ganancia)", async () => {
    const s = store();
    const { costBasis: _omit, ...withoutCost } = valid;
    expect((await createHolding(P, withoutCost, s, noop)).status).toBe(201);
    expect(s.createHolding).toHaveBeenCalledWith(expect.objectContaining({ cost_basis: null }));
  });

  it.each([
    [{ ...valid, quantity: "0" }, "mayor a 0"],
    [{ ...valid, costBasis: "-1" }, "negativo"],
    [{ ...valid, assetClass: "bono" }, "assetClass"],
    [{ ...valid, sourceType: "banco" }, "sourceType"],
    [{ ...valid, sourceName: "" }, "sede"],
    [{ ...valid, acquiredAt: "15/03/2026" }, "ISO 8601"],
    [{ ...valid, ratio: "0" }, "ratio"],
  ])("rechaza un holding inválido con 400 (%#)", async (input, expected) => {
    const s = store();
    const outcome = await createHolding(P, input, s, noop);

    expect(outcome.status).toBe(400);
    expect(JSON.stringify(outcome.body)).toContain(expected);
    expect(s.createHolding).not.toHaveBeenCalled();
  });

  it("responde 404 si RLS rechaza el alta en un portfolio ajeno", async () => {
    const s = store({
      createHolding: vi.fn(async () => ({
        data: null,
        error: { code: "42501", message: "new row violates row-level security policy", status: 403 },
      })),
    });

    expect(await createHolding(P, valid, s, noop)).toEqual({
      status: 404,
      body: { error: "not_found", message: "El portfolio no existe" },
    });
  });

  it("actualiza solo los campos permitidos", async () => {
    const s = store();
    const outcome = await updateHolding(H, { costBasis: "31000", notes: "compra DCA", fee: null }, s, noop);

    expect(outcome.status).toBe(200);
    expect(s.updateHolding).toHaveBeenCalledWith(H, { cost_basis: "31000", notes: "compra DCA", fee: null });
  });

  it.each([[{}], [{ quantity: "2" }], [{ sourceName: "Ledger" }], [{ symbol: "ETH" }]])(
    "no deja cambiar cantidad, sede ni símbolo por PATCH (%#)",
    async (input) => {
      const s = store();
      expect((await updateHolding(H, input, s, noop)).status).toBe(400);
      expect(s.updateHolding).not.toHaveBeenCalled();
    },
  );

  it("devuelve 404 al actualizar o borrar un holding inexistente o ajeno", async () => {
    const s = store({
      updateHolding: vi.fn(async () => ({ data: null, error: null })),
      deleteHolding: vi.fn(async () => ({ data: false, error: null })),
    });

    expect((await updateHolding(H, { notes: "x" }, s, noop)).status).toBe(404);
    expect((await deleteHolding(H, s, noop)).status).toBe(404);
  });

  it("borra un holding con 204", async () => {
    expect(await deleteHolding(H, store(), noop)).toEqual({ status: 204, body: null });
  });

  it("no borra un lote referenciado por una transferencia: 409", async () => {
    const s = store({
      deleteHolding: vi.fn(async () => ({
        data: null,
        error: { code: "23503", message: "violates foreign key constraint", status: 409 },
      })),
    });

    expect(await deleteHolding(H, s, noop)).toEqual({
      status: 409,
      body: { error: "conflict", message: "El lote tiene transferencias registradas y no se puede borrar" },
    });
  });

  it("valida los ids de la ruta", async () => {
    expect((await listHoldings("abc", false, store(), noop)).status).toBe(400);
    expect((await deleteHolding(undefined, store(), noop)).status).toBe(400);
  });

  it("devuelve 500 sin detalle si el store falla", async () => {
    const onError = vi.fn();
    const s = store({ listPortfolios: vi.fn(async () => { throw new Error("fetch failed"); }) });

    expect((await listPortfolios(s, onError)).status).toBe(500);
    expect(onError).toHaveBeenCalled();
  });
});
