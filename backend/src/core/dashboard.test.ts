import { describe, expect, it, vi } from "vitest";
import { getDashboard, type PriceRow, type PriceStore } from "./dashboard";
import type { HoldingRow, PortfolioStore } from "./portfolios";

const P = "11111111-1111-4111-8111-111111111111";
const T = "2026-11-23T12:00:00+00:00";

function lot(id: string, symbol: string, quantity: string, costBasis: string | null, sourceName = "Binance"): HoldingRow {
  return {
    id,
    portfolio_id: P,
    symbol,
    asset_class: "crypto",
    quantity,
    cost_basis: costBasis,
    fee: null,
    source_type: "exchange",
    source_name: sourceName,
    acquired_at: null,
    lockup_expiry: null,
    ratio: null,
    notes: null,
    created_at: T,
    updated_at: T,
  };
}

function price(symbol: string, value: string, fetchedAt: string, source = "coingecko", currency = "USD"): PriceRow {
  return { symbol, asset_class: "crypto", source, price: value, currency, fetched_at: fetchedAt };
}

function stores(holdings: HoldingRow[], prices: PriceRow[], baseCurrency = "USD") {
  const portfolios = {
    getPortfolio: vi.fn(async () => ({
      data: { id: P, name: "Principal", base_currency: baseCurrency, created_at: T },
      error: null,
    })),
    listHoldings: vi.fn(async () => ({ data: holdings, error: null })),
  } as unknown as PortfolioStore;
  const priceStore: PriceStore = { pricesFor: vi.fn(async () => ({ data: prices, error: null })) };
  return { portfolios, priceStore };
}

const noop = () => undefined;

describe("getDashboard", () => {
  it("calcula las métricas con el último precio cacheado de cada activo", async () => {
    const { portfolios, priceStore } = stores(
      [lot("a", "BTC", "1", "40000"), lot("b", "ETH", "2", "1000", "Ledger")],
      [
        price("BTC", "50000", "2026-11-23T10:00:00Z", "yahoo"),
        price("BTC", "51000", "2026-11-23T11:00:00Z", "coingecko"),
        price("ETH", "2000", "2026-11-23T09:00:00Z"),
      ],
    );

    const outcome = await getDashboard({ portfolioId: P }, portfolios, priceStore, noop);

    expect(outcome.status).toBe(200);
    if (outcome.status !== 200) return;
    expect(outcome.body.metrics.totalValue).toBe("55000");
    expect(outcome.body.metrics.unrealizedGain).toMatchObject({ value: "13000", costBasis: "42000" });
    expect(outcome.body.prices).toEqual([
      { symbol: "BTC", assetClass: "crypto", price: "51000", source: "coingecko", fetchedAt: "2026-11-23T11:00:00Z" },
      { symbol: "ETH", assetClass: "crypto", price: "2000", source: "coingecko", fetchedAt: "2026-11-23T09:00:00Z" },
    ]);
    expect(outcome.body.pricesAsOf).toBe("2026-11-23T09:00:00Z");
    expect(outcome.body.portfolio).toEqual({ id: P, name: "Principal", baseCurrency: "USD" });
  });

  it("no usa precios en otra moneda: esos lotes quedan sin precio", async () => {
    const { portfolios, priceStore } = stores(
      [lot("a", "BTC", "1", "40000"), lot("b", "GGAL", "10", "5")],
      [price("BTC", "50000", T), price("GGAL", "7000", T, "iol", "ARS")],
    );

    const outcome = await getDashboard({ portfolioId: P }, portfolios, priceStore, noop);

    if (outcome.status !== 200) throw new Error(`status ${outcome.status}`);
    expect(outcome.body.metrics.totalValue).toBe("50000");
    expect(outcome.body.metrics.unpricedHoldings).toEqual([{ id: "b", symbol: "GGAL", assetClass: "crypto" }]);
    expect(outcome.body.prices.map((p) => p.symbol)).toEqual(["BTC"]);
  });

  it("con un portfolio vacío no consulta precios", async () => {
    const { portfolios, priceStore } = stores([], []);
    const outcome = await getDashboard({ portfolioId: P }, portfolios, priceStore, noop);

    expect(outcome.status).toBe(200);
    expect(priceStore.pricesFor).not.toHaveBeenCalled();
    if (outcome.status === 200) expect(outcome.body.pricesAsOf).toBeNull();
  });

  it("acepta un umbral de concentración por query", async () => {
    const { portfolios, priceStore } = stores([lot("a", "BTC", "1", "1")], [price("BTC", "1", T)]);
    const outcome = await getDashboard({ portfolioId: P, concentrationThreshold: "80" }, portfolios, priceStore, noop);

    if (outcome.status !== 200) throw new Error(`status ${outcome.status}`);
    expect(outcome.body.metrics.concentration.thresholdPercent).toBe(80);
  });

  it.each([
    [{ portfolioId: "x" }],
    [{ portfolioId: P, concentrationThreshold: "0" }],
    [{ portfolioId: P, concentrationThreshold: "abc" }],
  ])("rechaza parámetros inválidos con 400 (%#)", async (input) => {
    const { portfolios, priceStore } = stores([], []);
    expect((await getDashboard(input, portfolios, priceStore, noop)).status).toBe(400);
  });

  it("devuelve 404 si el portfolio no existe o es de otro usuario", async () => {
    const { portfolios, priceStore } = stores([], []);
    (portfolios.getPortfolio as ReturnType<typeof vi.fn>).mockResolvedValue({ data: null, error: null });

    expect((await getDashboard({ portfolioId: P }, portfolios, priceStore, noop)).status).toBe(404);
    expect(portfolios.listHoldings).not.toHaveBeenCalled();
  });

  it("devuelve 500 sin detalle si falla la consulta de precios", async () => {
    const { portfolios } = stores([lot("a", "BTC", "1", "1")], []);
    const onError = vi.fn();
    const failing: PriceStore = { pricesFor: async () => { throw new Error("timeout"); } };

    expect((await getDashboard({ portfolioId: P }, portfolios, failing, onError)).status).toBe(500);
    expect(onError).toHaveBeenCalled();
  });
});
