import type { APIGatewayProxyEventV2, Context } from "aws-lambda";
import { describe, expect, it, vi } from "vitest";
import type { InsightStore } from "../core/insights";
import type { PortfolioStore } from "../core/portfolios";
import { createHandler } from "./insights";

const P = "11111111-1111-4111-8111-111111111111";

function stores() {
  const portfolios = {
    getPortfolio: vi.fn(async () => ({ data: { id: P, name: "x", base_currency: "USD", created_at: "t" }, error: null })),
    listHoldings: vi.fn(async () => ({ data: [], error: null })),
  } as unknown as PortfolioStore;
  const insights: InsightStore = {
    countSince: vi.fn(async () => ({ data: 0, error: null })),
    insert: vi.fn(),
    latest: vi.fn(async () => ({ data: null, error: null })),
  };
  return { portfolios, prices: { pricesFor: vi.fn(async () => ({ data: [], error: null })) }, insights };
}

async function invoke(routeKey: string, token: string | null = "jwt") {
  const s = stores();
  const result = (await createHandler(() => s, null)(
    {
      routeKey,
      pathParameters: { portfolioId: P },
      headers: token ? { authorization: `Bearer ${token}` } : {},
      isBase64Encoded: false,
    } as unknown as APIGatewayProxyEventV2,
    {} as Context,
    () => undefined,
  )) as { statusCode: number; body: string };
  return { result, s };
}

describe("handler del insight", () => {
  it("pide sesión", async () => {
    expect((await invoke("POST /portfolios/{portfolioId}/insights", null)).result.statusCode).toBe(401);
  });

  it("GET latest devuelve null si no hay insights", async () => {
    const { result } = await invoke("GET /portfolios/{portfolioId}/insights/latest");
    expect(result).toMatchObject({ statusCode: 200, body: "null" });
  });

  it("POST sin tenencias valuadas responde 422", async () => {
    const { result, s } = await invoke("POST /portfolios/{portfolioId}/insights");
    expect(result.statusCode).toBe(422);
    expect(s.insights.insert).not.toHaveBeenCalled();
  });
});
