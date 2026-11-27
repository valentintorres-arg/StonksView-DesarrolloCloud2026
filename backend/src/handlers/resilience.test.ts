// Prueba de resiliencia con el LLM caído (tarea 4.6, issue #36).
//
// Simula cada forma en que puede fallar Groq y verifica, con los handlers
// reales de las Lambdas (insight y métricas), que:
//   1. el insight responde 201 con estado `no_disponible`, sin texto y sin
//      tardar más que el timeout;
//   2. el intento queda guardado en ai_insights (auditable);
//   3. el dashboard (GET /portfolios/{id}/metrics) sigue respondiendo 200 con
//      los mismos números que cuando la IA anda.
// Es la evidencia automatizada para la defensa: `npm test -- resilience`.

import type { APIGatewayProxyEventV2, Context } from "aws-lambda";
import { describe, expect, it, vi } from "vitest";
import type { PriceRow, PriceStore } from "../core/dashboard";
import type { InsightRow, InsightStore, Llm, NewInsightRow } from "../core/insights";
import type { HoldingRow, PortfolioStore } from "../core/portfolios";
import { groqLlm } from "./groq";
import { createHandler as insightsHandler } from "./insights";
import { createHandler as portfoliosHandler } from "./portfolios";

const P = "11111111-1111-4111-8111-111111111111";
const T = "2026-11-27T12:00:00Z";
const TIMEOUT_MS = 50;

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

// Portfolio de ejemplo: 1 BTC en Binance (60.000) y 20 ETH en Ledger (36.000).
function backend() {
  const portfolios = {
    getPortfolio: vi.fn(async () => ({ data: { id: P, name: "Principal", base_currency: "USD", created_at: T }, error: null })),
    listHoldings: vi.fn(async () => ({
      data: [lot("a", "BTC", "1", "40000", "Binance"), lot("b", "ETH", "20", "1000", "Ledger")],
      error: null,
    })),
  } as unknown as PortfolioStore;
  const prices: PriceStore = { pricesFor: vi.fn(async () => ({ data: [price("BTC", "60000"), price("ETH", "1800")], error: null })) };
  const saved: NewInsightRow[] = [];
  const insights: InsightStore = {
    countSince: vi.fn(async () => ({ data: 0, error: null })),
    insert: vi.fn(async (row: NewInsightRow) => {
      saved.push(row);
      const stored: InsightRow = { id: `i${saved.length}`, portfolio_id: row.portfolio_id, respuesta_texto: row.respuesta_texto, estado: row.estado, created_at: T };
      return { data: stored, error: null };
    }),
    latest: vi.fn(async () => ({ data: null, error: null })),
  };
  return { stores: { portfolios, prices, insights }, saved };
}

function event(routeKey: string): APIGatewayProxyEventV2 {
  return {
    routeKey,
    pathParameters: { portfolioId: P },
    headers: { authorization: "Bearer jwt" },
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2;
}

type Result = { statusCode: number; body: string };

async function scenario(llm: Llm | null) {
  const { stores, saved } = backend();
  const started = performance.now();
  const insight = (await insightsHandler(() => stores, llm)(
    event("POST /portfolios/{portfolioId}/insights"),
    {} as Context,
    () => undefined,
  )) as Result;
  const elapsedMs = performance.now() - started;
  const metrics = (await portfoliosHandler(() => stores)(
    event("GET /portfolios/{portfolioId}/metrics"),
    {} as Context,
    () => undefined,
  )) as Result;
  return { insight, insightBody: JSON.parse(insight.body), metrics, metricsBody: JSON.parse(metrics.body), saved, elapsedMs };
}

// Groq simulado con fetch: cada caso es una forma distinta de "caído".
const groqWith = (fetchImpl: (url: string, init: RequestInit) => Promise<Response>) =>
  groqLlm("gsk_test", undefined, fetchImpl as unknown as typeof fetch, TIMEOUT_MS);

const hanging = (_url: string, init: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    // Nunca responde: solo termina cuando vence el timeout del cliente.
    init.signal?.addEventListener("abort", () => reject(init.signal!.reason));
  });

const FAILURES: Array<[string, Llm | null]> = [
  ["sin API key configurada", null],
  ["sin red (falla la conexión)", groqWith(async () => Promise.reject(new TypeError("fetch failed")))],
  ["Groq no responde (timeout)", groqWith(hanging)],
  ["Groq responde 500", groqWith(async () => new Response("error", { status: 500 }))],
  ["Groq responde 503 (servicio caído)", groqWith(async () => new Response("unavailable", { status: 503 }))],
  ["API key inválida (401)", groqWith(async () => new Response("unauthorized", { status: 401 }))],
  ["respuesta vacía", groqWith(async () => Response.json({ choices: [{ message: { content: "" } }] }))],
  ["respuesta con un número inventado", groqWith(async () => Response.json({ choices: [{ message: { content: "Tu patrimonio creció un 15 %." } }] }))],
];

describe("resiliencia con el LLM caído (#36)", () => {
  it("control: con la IA andando, el insight sale ok", async () => {
    const ok = groqWith(async () => Response.json({ choices: [{ message: { content: "El 62,5 % de tu patrimonio está en Binance." } }] }));
    const { insight, insightBody, metrics } = await scenario(ok);

    expect(insight.statusCode).toBe(201);
    expect(insightBody).toMatchObject({ state: "ok", text: "El 62,5 % de tu patrimonio está en Binance." });
    expect(metrics.statusCode).toBe(200);
  });

  it.each(FAILURES)("%s: el insight queda no_disponible y el dashboard sigue andando", async (_name, llm) => {
    const { insight, insightBody, metrics, metricsBody, saved, elapsedMs } = await scenario(llm);

    // 1. El insight no rompe: 201 con estado explícito y sin texto.
    expect(insight.statusCode).toBe(201);
    expect(insightBody).toMatchObject({ state: "no_disponible", text: null });
    // Nunca espera más que el timeout (más margen para el resto del pedido).
    expect(elapsedMs).toBeLessThan(TIMEOUT_MS + 500);

    // 2. Queda registrado para auditar, con el contexto que se iba a mandar.
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ portfolio_id: P, estado: "no_disponible" });
    expect(saved[0]!.contexto_enviado.patrimonioTotal).toBe("96000.00");

    // 3. El dashboard es 100 % determinístico: no depende de la IA.
    expect(metrics.statusCode).toBe(200);
    expect(metricsBody.metrics.totalValue).toBe("96000");
    expect(metricsBody.metrics.unrealizedGain.value).toBe("36000");
  });
});
