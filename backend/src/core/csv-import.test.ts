import { describe, expect, it, vi } from "vitest";
import { type CsvImportStore, importHoldingsCsv } from "./csv-import";
import type { HoldingRow, NewHolding } from "./portfolios";

const P = "11111111-1111-4111-8111-111111111111";
const NOW = "2026-11-27T12:00:00+00:00";

function makeStore(overrides: Partial<CsvImportStore> = {}): CsvImportStore {
  return {
    listHoldings: vi.fn(async () => ({ data: [], error: null })),
    createHoldings: vi.fn(async (inputs: NewHolding[]) => ({
      data: inputs.map((input, i) => ({
        id: `00000000-0000-4000-8000-00000000000${i}`,
        created_at: NOW,
        updated_at: NOW,
        ...input,
      })),
      error: null,
    })),
    ...overrides,
  };
}

const noop = () => undefined;

describe("importHoldingsCsv", () => {
  it("importa un CSV válido y normaliza símbolos y sedes (RN-43, RN-07)", async () => {
    const existing: HoldingRow = {
      id: "a",
      portfolio_id: P,
      symbol: "ETH",
      asset_class: "crypto",
      quantity: "1",
      cost_basis: "2000",
      fee: null,
      source_type: "exchange",
      source_name: "Binance",
      acquired_at: null,
      lockup_expiry: null,
      ratio: null,
      notes: null,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };
    const store = makeStore({
      listHoldings: vi.fn(async () => ({ data: [existing], error: null })),
    });

    const csv = [
      "symbol,asset_class,quantity,cost_basis,source_type,source_name,acquired_at",
      "btc,crypto,0.5,60000,exchange, binance ,2026-03-15",
      "aapl,stock,10,180.5,broker,IOL,2026-04-01",
      "spy,etf,2,,broker, iol ,",
    ].join("\n");

    const outcome = await importHoldingsCsv(P, { csv }, store, noop);

    expect(outcome.status).toBe(201);
    expect(outcome.body).toMatchObject({ imported: 3 });
    expect(store.createHoldings).toHaveBeenCalledWith([
      expect.objectContaining({ symbol: "BTC", source_name: "Binance", quantity: "0.5", cost_basis: "60000" }),
      expect.objectContaining({ symbol: "AAPL", source_name: "IOL", quantity: "10", cost_basis: "180.5" }),
      expect.objectContaining({ symbol: "SPY", source_name: "IOL", quantity: "2", cost_basis: null }),
    ]);
  });

  it("es todo o nada: si una fila falla no inserta ninguna y devuelve el número de línea (RN-44)", async () => {
    const store = makeStore();
    const csv = [
      "symbol,asset_class,quantity,cost_basis,source_type,source_name,acquired_at",
      "BTC,crypto,0.5,60000,exchange,Binance,2026-03-15",
      "ETH,crypto,0,2000,exchange,Binance,2026-03-16",
      "AAPL,stock,5,-10,broker,IOL,fecha-mala",
    ].join("\n");

    const outcome = await importHoldingsCsv(P, { csv }, store, noop);

    expect(outcome.status).toBe(400);
    expect(store.createHoldings).not.toHaveBeenCalled();
    const body = outcome.body as unknown as { errors: { line: number }[] };
    expect(body.errors.map((e) => e.line)).toEqual(expect.arrayContaining([3, 4]));
  });

  it("rechaza si faltan columnas obligatorias", async () => {
    const store = makeStore();
    const csv = "symbol,quantity\nBTC,1";

    const outcome = await importHoldingsCsv(P, { csv }, store, noop);

    expect(outcome.status).toBe(400);
    expect(store.createHoldings).not.toHaveBeenCalled();
  });

  it("responde 404 si RLS rechaza el insert en un portfolio ajeno", async () => {
    const store = makeStore({
      createHoldings: vi.fn(async () => ({
        data: null,
        error: { code: "42501", message: "row-level security", status: 403 },
      })),
    });
    const csv = "symbol,asset_class,quantity,source_type,source_name\nBTC,crypto,1,exchange,Binance";

    const outcome = await importHoldingsCsv(P, { csv }, store, noop);
    expect(outcome.status).toBe(404);
  });

  it("acepta CSV exportado desde Excel en español (separado por ; y decimales con coma)", async () => {
    const store = makeStore();
    const csv = [
      "symbol;asset_class;quantity;cost_basis;source_type;source_name;acquired_at",
      "BTC;crypto;0,25;62000;exchange;Binance;2026-03-15",
      "SPY;etf;5;510,5;broker;IOL;2026-05-10",
    ].join("\n");

    const outcome = await importHoldingsCsv(P, { csv }, store, noop);

    expect(outcome.status).toBe(201);
    expect(store.createHoldings).toHaveBeenCalledWith([
      expect.objectContaining({ symbol: "BTC", quantity: "0.25", cost_basis: "62000" }),
      expect.objectContaining({ symbol: "SPY", quantity: "5", cost_basis: "510.5" }),
    ]);
  });
});