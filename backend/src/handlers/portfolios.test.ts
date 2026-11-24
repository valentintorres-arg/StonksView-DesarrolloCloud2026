import type { APIGatewayProxyEventV2, Context } from "aws-lambda";
import { describe, expect, it, vi } from "vitest";
import type { PortfolioStore } from "../core/portfolios";
import { createHandler } from "./portfolios";

const P = "11111111-1111-4111-8111-111111111111";
const H = "22222222-2222-4222-8222-222222222222";

function fakeStore(): PortfolioStore {
  return {
    listPortfolios: vi.fn(async () => ({ data: [], error: null })),
    getPortfolio: vi.fn(async () => ({
      data: { id: P, name: "x", base_currency: "USD", created_at: "t" },
      error: null,
    })),
    createPortfolio: vi.fn(async (input) => ({ data: { id: P, created_at: "t", ...input }, error: null })),
    listHoldings: vi.fn(async () => ({ data: [], error: null })),
    createHolding: vi.fn(),
    updateHolding: vi.fn(async () => ({ data: null, error: null })),
    deleteHolding: vi.fn(async () => ({ data: true, error: null })),
  };
}

async function invoke(store: PortfolioStore, event: Partial<APIGatewayProxyEventV2>, token = "jwt") {
  const storeFor = vi.fn(() => ({ portfolios: store, prices: { pricesFor: vi.fn(async () => ({ data: [], error: null })) } }));
  const result = (await createHandler(storeFor)(
    {
      headers: token ? { authorization: `Bearer ${token}` } : {},
      isBase64Encoded: false,
      ...event,
    } as APIGatewayProxyEventV2,
    {} as Context,
    () => undefined,
  )) as { statusCode: number; headers: Record<string, string>; body?: string };
  return { result, storeFor };
}

describe("handler de portfolios", () => {
  it("GET /portfolios lista con el store del usuario", async () => {
    const store = fakeStore();
    const { result, storeFor } = await invoke(store, { routeKey: "GET /portfolios" });

    expect(storeFor).toHaveBeenCalledWith("jwt");
    expect(result.statusCode).toBe(200);
    expect(result.headers).toMatchObject({ "cache-control": "no-store" });
    expect(store.listPortfolios).toHaveBeenCalled();
  });

  it("POST /portfolios crea con el body", async () => {
    const store = fakeStore();
    const { result } = await invoke(store, { routeKey: "POST /portfolios", body: JSON.stringify({ name: "Principal" }) });

    expect(result.statusCode).toBe(201);
    expect(JSON.parse(result.body!)).toMatchObject({ name: "Principal", baseCurrency: "USD" });
  });

  it("GET holdings pasa el id de la ruta e includeClosed", async () => {
    const store = fakeStore();
    await invoke(store, {
      routeKey: "GET /portfolios/{portfolioId}/holdings",
      pathParameters: { portfolioId: P },
      queryStringParameters: { includeClosed: "true" },
    });

    expect(store.listHoldings).toHaveBeenCalledWith(P, true);
  });

  it("DELETE responde 204 sin body", async () => {
    const { result } = await invoke(fakeStore(), {
      routeKey: "DELETE /holdings/{holdingId}",
      pathParameters: { holdingId: H },
    });

    expect(result.statusCode).toBe(204);
    expect(result.body).toBeUndefined();
  });

  it("PATCH de un holding ajeno responde 404", async () => {
    const { result } = await invoke(fakeStore(), {
      routeKey: "PATCH /holdings/{holdingId}",
      pathParameters: { holdingId: H },
      body: JSON.stringify({ notes: "x" }),
    });

    expect(result.statusCode).toBe(404);
  });

  it("sin token responde 401 y no crea el store", async () => {
    const { result, storeFor } = await invoke(fakeStore(), { routeKey: "GET /portfolios" }, "");

    expect(result.statusCode).toBe(401);
    expect(storeFor).not.toHaveBeenCalled();
  });

  it("una ruta desconocida responde 404", async () => {
    const { result } = await invoke(fakeStore(), { routeKey: "PUT /portfolios" });
    expect(result.statusCode).toBe(404);
  });
});
