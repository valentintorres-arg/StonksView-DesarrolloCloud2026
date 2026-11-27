import { describe, expect, it, vi } from "vitest";
import type { PriceRow, PriceStore } from "./dashboard";
import {
  buildInsightContext,
  buildPrompt,
  DAILY_INSIGHT_LIMIT,
  generateInsight,
  type InsightStore,
  latestInsight,
  numbersNotInContext,
  startOfArgentinaDay,
} from "./insights";
import { computePortfolioMetrics } from "./metrics";
import type { HoldingRow, PortfolioStore } from "./portfolios";

const P = "11111111-1111-4111-8111-111111111111";
const T = "2026-11-26T12:00:00Z";
const NOW = new Date("2026-11-26T15:00:00Z");

function lot(id: string, symbol: string, quantity: string, costBasis: string, sourceName: string): HoldingRow {
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

const price = (symbol: string, value: string): PriceRow => ({
  symbol,
  asset_class: "crypto",
  source: "coingecko",
  price: value,
  currency: "USD",
  fetched_at: T,
});

// BTC 1 × 60000 en Binance (62,5 %) y ETH 20 × 1800 en Ledger (37,5 %): total 96000.
function deps(overrides: { holdings?: HoldingRow[]; used?: number; llm?: (() => Promise<string>) | null } = {}) {
  const holdings = overrides.holdings ?? [lot("a", "BTC", "1", "40000", "Binance"), lot("b", "ETH", "20", "1000", "Ledger")];
  const portfolios = {
    getPortfolio: vi.fn(async () => ({ data: { id: P, name: "Principal", base_currency: "USD", created_at: T }, error: null })),
    listHoldings: vi.fn(async () => ({ data: holdings, error: null })),
  } as unknown as PortfolioStore;
  const prices: PriceStore = { pricesFor: vi.fn(async () => ({ data: [price("BTC", "60000"), price("ETH", "1800")], error: null })) };
  const insights: InsightStore = {
    countSince: vi.fn(async () => ({ data: overrides.used ?? 0, error: null })),
    insert: vi.fn(async (row) => ({
      data: { id: "i1", portfolio_id: row.portfolio_id, respuesta_texto: row.respuesta_texto, estado: row.estado, created_at: T },
      error: null,
    })),
    latest: vi.fn(async () => ({ data: null, error: null })),
  };
  const llm = overrides.llm === undefined ? vi.fn(async () => "El 62,5 % de tu patrimonio está en Binance.") : overrides.llm;
  return { portfolios, prices, insights, llm, now: () => NOW, onError: vi.fn() };
}

describe("generateInsight", () => {
  it("manda solo métricas a la IA, guarda el insight y lo devuelve", async () => {
    const d = deps();
    const outcome = await generateInsight(P, d);

    expect(outcome).toEqual({
      status: 201,
      body: { id: "i1", portfolioId: P, state: "ok", text: "El 62,5 % de tu patrimonio está en Binance.", createdAt: T },
    });
    const prompt = JSON.stringify((d.llm as ReturnType<typeof vi.fn>).mock.calls[0]![0]);
    expect(prompt).toContain("62.50");
    expect(prompt).toContain("Binance");
    // RN-32: ni el nombre del portfolio ni ids.
    expect(prompt).not.toContain("Principal");
    expect(prompt).not.toContain(P);
    expect(d.insights.insert).toHaveBeenCalledWith(expect.objectContaining({ portfolio_id: P, estado: "ok" }));
  });

  it("cuenta el límite desde la medianoche de Argentina y responde 429 sin llamar a la IA", async () => {
    const d = deps({ used: DAILY_INSIGHT_LIMIT });
    const outcome = await generateInsight(P, d);

    expect(d.insights.countSince).toHaveBeenCalledWith("2026-11-26T03:00:00.000Z");
    expect(outcome.status).toBe(429);
    expect(d.llm).not.toHaveBeenCalled();
    expect(d.insights.insert).not.toHaveBeenCalled();
  });

  it("si la IA falla queda no_disponible, se guarda igual y responde 201", async () => {
    const d = deps({ llm: vi.fn(async () => Promise.reject(new Error("timeout"))) });
    const outcome = await generateInsight(P, d);

    expect(outcome).toMatchObject({ status: 201, body: { state: "no_disponible", text: null } });
    expect(d.insights.insert).toHaveBeenCalledWith(expect.objectContaining({ estado: "no_disponible", respuesta_texto: null }));
    expect(d.onError).toHaveBeenCalled();
  });

  it("descarta una respuesta con números que no están en el contexto (RN-33)", async () => {
    const d = deps({ llm: vi.fn(async () => "Tu patrimonio creció un 15 % este mes.") });
    const outcome = await generateInsight(P, d);

    expect(outcome).toMatchObject({ status: 201, body: { state: "no_disponible", text: null } });
    // Se guarda el texto descartado para auditar.
    expect(d.insights.insert).toHaveBeenCalledWith(
      expect.objectContaining({ estado: "no_disponible", respuesta_texto: "Tu patrimonio creció un 15 % este mes." }),
    );
  });

  it("sin API key configurada queda no_disponible", async () => {
    const outcome = await generateInsight(P, deps({ llm: null }));
    expect(outcome).toMatchObject({ status: 201, body: { state: "no_disponible" } });
  });

  it("sin tenencias valuadas responde 422 sin gastar un insight", async () => {
    const d = deps({ holdings: [] });
    expect((await generateInsight(P, d)).status).toBe(422);
    expect(d.llm).not.toHaveBeenCalled();
    expect(d.insights.insert).not.toHaveBeenCalled();
  });

  it("si falla el guardado devuelve igual el insight", async () => {
    const d = deps();
    d.insights.insert = vi.fn(async () => ({ data: null, error: { message: "boom" } }));
    expect(await generateInsight(P, d)).toMatchObject({ status: 201, body: { id: null, state: "ok" } });
  });

  it("valida el portfolioId", async () => {
    expect((await generateInsight("x", deps())).status).toBe(400);
  });
});

describe("latestInsight", () => {
  it("devuelve null si no hay insights y oculta el texto de uno no disponible", async () => {
    const d = deps();
    expect(await latestInsight(P, d.portfolios, d.insights, vi.fn())).toEqual({ status: 200, body: null });

    d.insights.latest = vi.fn(async () => ({
      data: { id: "i2", portfolio_id: P, respuesta_texto: "texto descartado 15 %", estado: "no_disponible" as const, created_at: T },
      error: null,
    }));
    expect(await latestInsight(P, d.portfolios, d.insights, vi.fn())).toEqual({
      status: 200,
      body: { id: "i2", portfolioId: P, state: "no_disponible", text: null, createdAt: T },
    });
  });
});

describe("numbersNotInContext", () => {
  const metrics = computePortfolioMetrics(
    [
      { id: "a", symbol: "BTC", assetClass: "crypto", quantity: "1", costBasis: "40000", fee: null, sourceName: "Binance", sourceType: "exchange" },
      { id: "b", symbol: "ETH", assetClass: "crypto", quantity: "20", costBasis: "1000", fee: null, sourceName: "Ledger", sourceType: "wallet" },
    ],
    (symbol) => (symbol === "BTC" ? "60000" : "1800"),
  );
  const context = buildInsightContext(metrics, "USD");

  it.each([
    "El 62,5 % de tu patrimonio está en Binance.",
    "El 62.5% está en Binance y el 37,5 % en Ledger.",
    "Tu patrimonio es de US$ 96.000.",
    "Tu patrimonio es de USD 96,000.00 repartido en 2 sedes.",
    "Casi el 63 % está en una sola sede, por encima del umbral de 50 %.",
    "Tenés unos 96.300 dólares.",
  ])("acepta números del contexto, redondeados o en otro formato: %s", (text) => {
    expect(numbersNotInContext(text, context)).toEqual([]);
  });

  it.each([
    ["Tu patrimonio creció un 15 % este mes.", ["15"]],
    ["Si BTC sube un 10 %, ganarías 6.000 dólares.", ["10", "6.000"]],
    ["Tenés 61 % en Binance.", ["61"]],
  ])("rechaza números inventados: %s", (text, expected) => {
    expect(numbersNotInContext(text, context)).toEqual(expected);
  });

  it("el prompt prohíbe calcular números nuevos y dar consejos", () => {
    const [system] = buildPrompt(context);
    expect(system!.content).toContain("No calcules números nuevos");
    expect(system!.content).toContain("No des consejos");
  });
});

describe("startOfArgentinaDay", () => {
  it("usa UTC−3", () => {
    expect(startOfArgentinaDay(new Date("2026-11-26T02:59:00Z")).toISOString()).toBe("2026-11-25T03:00:00.000Z");
    expect(startOfArgentinaDay(new Date("2026-11-26T03:00:00Z")).toISOString()).toBe("2026-11-26T03:00:00.000Z");
  });
});
