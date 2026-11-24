import { describe, expect, it } from "vitest";
import { computePortfolioMetrics, type HoldingLot, type PriceLookup } from "./metrics";

let nextId = 0;
function lot(overrides: Partial<HoldingLot>): HoldingLot {
  nextId += 1;
  return {
    id: `lot-${nextId}`,
    symbol: "BTC",
    assetClass: "crypto",
    quantity: "1",
    costBasis: null,
    fee: null,
    sourceName: "Binance",
    sourceType: "exchange",
    ...overrides,
  };
}

function prices(table: Record<string, string>): PriceLookup {
  return (symbol, assetClass) => table[`${assetClass}:${symbol}`];
}

describe("computePortfolioMetrics", () => {
  it("devuelve todo en cero para un portfolio vacío", () => {
    const metrics = computePortfolioMetrics([], prices({}));

    expect(metrics.totalValue).toBe("0");
    expect(metrics.bySource).toEqual([]);
    expect(metrics.unrealizedGain).toEqual({
      value: "0",
      costBasis: "0",
      marketValue: "0",
      percent: null,
      lotsWithoutCostBasis: 0,
    });
    expect(metrics.concentration.largestSource).toBeNull();
  });

  it("calcula el patrimonio por sede con montos exactos", () => {
    const metrics = computePortfolioMetrics(
      [
        lot({ symbol: "ETH", quantity: "0.1", sourceName: "Binance" }),
        lot({ symbol: "ETH", quantity: "0.2", sourceName: "Ledger", sourceType: "wallet" }),
      ],
      prices({ "crypto:ETH": "3000.10" }),
    );

    expect(metrics.totalValue).toBe("900.03");
    expect(metrics.bySource).toEqual([
      { sourceName: "Ledger", sourceType: "wallet", value: "600.02", sharePercent: "66.67", lots: 1 },
      { sourceName: "Binance", sourceType: "exchange", value: "300.01", sharePercent: "33.33", lots: 1 },
    ]);
  });

  it("agrupa la misma sede sin distinguir mayúsculas ni espacios", () => {
    const metrics = computePortfolioMetrics(
      [lot({ sourceName: "Binance" }), lot({ sourceName: "  binance " })],
      prices({ "crypto:BTC": "100" }),
    );

    expect(metrics.bySource).toHaveLength(1);
    expect(metrics.bySource[0]).toMatchObject({ sourceName: "Binance", value: "200", lots: 2 });
  });

  it("separa por clase de activo y por símbolo", () => {
    const metrics = computePortfolioMetrics(
      [
        lot({ symbol: "BTC", assetClass: "crypto", quantity: "1" }),
        lot({ symbol: "AAPL", assetClass: "stock", quantity: "10", sourceName: "IOL", sourceType: "broker" }),
        lot({ symbol: "aapl", assetClass: "stock", quantity: "5", sourceName: "IOL", sourceType: "broker" }),
      ],
      prices({ "crypto:BTC": "300", "stock:AAPL": "20", "stock:aapl": "20" }),
    );

    expect(metrics.byAssetClass).toEqual([
      { assetClass: "crypto", value: "300", sharePercent: "50.00", lots: 1 },
      { assetClass: "stock", value: "300", sharePercent: "50.00", lots: 2 },
    ]);
    expect(metrics.bySymbol.map((s) => s.symbol)).toEqual(["AAPL", "BTC"]);
    expect(metrics.bySymbol[0]).toMatchObject({ value: "300", sharePercent: "50.00" });
  });

  it("no valúa lotes sin precio y los informa aparte", () => {
    const sinPrecio = lot({ symbol: "XYZ", assetClass: "other", quantity: "1000" });
    const metrics = computePortfolioMetrics(
      [lot({ quantity: "2" }), sinPrecio],
      prices({ "crypto:BTC": "50" }),
    );

    expect(metrics.totalValue).toBe("100");
    expect(metrics.valuedLots).toBe(1);
    expect(metrics.unpricedHoldings).toEqual([{ id: sinPrecio.id, symbol: "XYZ", assetClass: "other" }]);
  });

  it("calcula la ganancia no realizada con costo por unidad más comisión", () => {
    const metrics = computePortfolioMetrics(
      [
        // 2 BTC comprados a 30.000 c/u con 10 de comisión: costo 60.010
        lot({ quantity: "2", costBasis: "30000", fee: "10" }),
        // 1 BTC comprado a 60.000 sin comisión
        lot({ quantity: "1", costBasis: "60000", sourceName: "Ledger" }),
      ],
      prices({ "crypto:BTC": "50000" }),
    );

    expect(metrics.unrealizedGain).toEqual({
      value: "29990",
      costBasis: "120010",
      marketValue: "150000",
      percent: "24.99",
      lotsWithoutCostBasis: 0,
    });
  });

  it("refleja pérdidas no realizadas con signo negativo", () => {
    const metrics = computePortfolioMetrics(
      [lot({ quantity: "1", costBasis: "100" })],
      prices({ "crypto:BTC": "80" }),
    );

    expect(metrics.unrealizedGain.value).toBe("-20");
    expect(metrics.unrealizedGain.percent).toBe("-20.00");
  });

  it("excluye de la ganancia los lotes sin costo base, pero no del patrimonio", () => {
    const metrics = computePortfolioMetrics(
      [lot({ quantity: "1", costBasis: "40" }), lot({ quantity: "1", costBasis: null })],
      prices({ "crypto:BTC": "50" }),
    );

    expect(metrics.totalValue).toBe("100");
    expect(metrics.unrealizedGain).toMatchObject({
      value: "10",
      costBasis: "40",
      marketValue: "50",
      lotsWithoutCostBasis: 1,
    });
  });

  it("marca la concentración cuando una sede o un activo supera el umbral", () => {
    const metrics = computePortfolioMetrics(
      [
        lot({ quantity: "6", sourceName: "Binance" }),
        lot({ quantity: "2", sourceName: "Ledger", sourceType: "wallet" }),
        lot({ symbol: "ETH", quantity: "2", sourceName: "Ledger", sourceType: "wallet" }),
      ],
      prices({ "crypto:BTC": "10", "crypto:ETH": "10" }),
    );

    expect(metrics.concentration.thresholdPercent).toBe(50);
    expect(metrics.concentration.largestSource).toMatchObject({ sourceName: "Binance", sharePercent: "60.00" });
    expect(metrics.concentration.sourcesOverThreshold.map((s) => s.sourceName)).toEqual(["Binance"]);
    expect(metrics.concentration.symbolsOverThreshold.map((s) => s.symbol)).toEqual(["BTC"]);
  });

  it("no marca concentración si nadie supera el umbral configurado", () => {
    const metrics = computePortfolioMetrics(
      [lot({ quantity: "6", sourceName: "Binance" }), lot({ quantity: "4", sourceName: "Ledger" })],
      prices({ "crypto:BTC": "10" }),
      { concentrationThresholdPercent: 60 },
    );

    expect(metrics.concentration.sourcesOverThreshold).toEqual([]);
  });

  it("rechaza un umbral fuera de rango", () => {
    expect(() =>
      computePortfolioMetrics([], prices({}), { concentrationThresholdPercent: 0 }),
    ).toThrow(RangeError);
    expect(() =>
      computePortfolioMetrics([], prices({}), { concentrationThresholdPercent: 120 }),
    ).toThrow(RangeError);
  });

  it("ignora los lotes agotados por una venta (quantity 0)", () => {
    const metrics = computePortfolioMetrics(
      [lot({ quantity: "0", symbol: "SIN-PRECIO" }), lot({ quantity: "0", costBasis: "999" }), lot({ quantity: "1" })],
      prices({ "crypto:BTC": "10" }),
    );

    expect(metrics.totalValue).toBe("10");
    expect(metrics.valuedLots).toBe(1);
    expect(metrics.unpricedHoldings).toEqual([]);
    expect(metrics.unrealizedGain.lotsWithoutCostBasis).toBe(1);
    expect(metrics.unrealizedGain.costBasis).toBe("0");
  });

  it("acepta cantidades chicas y precios como number sin perder exactitud", () => {
    const metrics = computePortfolioMetrics(
      [lot({ quantity: 0.00000001 }), lot({ quantity: 0.1 }), lot({ quantity: 0.2 })],
      () => 1,
    );

    expect(metrics.totalValue).toBe("0.30000001");
  });
});
