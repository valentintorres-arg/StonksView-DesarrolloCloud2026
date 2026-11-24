import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { matchRoute, toEvent, type Route } from "./router";

const handler = async () => ({ statusCode: 200 });
const routes: Route[] = [
  { method: "GET", path: "/portfolios", handler },
  { method: "GET", path: "/portfolios/{portfolioId}/holdings", handler },
  { method: "DELETE", path: "/holdings/{holdingId}", handler },
];

describe("router del servidor local", () => {
  it("arma el routeKey y los pathParameters igual que API Gateway", () => {
    const match = matchRoute(routes, "GET", "/portfolios/abc-123/holdings");

    expect(match?.routeKey).toBe("GET /portfolios/{portfolioId}/holdings");
    expect(match?.pathParameters).toEqual({ portfolioId: "abc-123" });
  });

  it("ignora la barra final y distingue el método", () => {
    expect(matchRoute(routes, "GET", "/portfolios/")?.routeKey).toBe("GET /portfolios");
    expect(matchRoute(routes, "POST", "/portfolios")).toBeNull();
    expect(matchRoute(routes, "GET", "/holdings/x")).toBeNull();
    expect(matchRoute(routes, "GET", "/portfolios//holdings")).toBeNull();
  });

  it("pasa query, headers y body al evento", () => {
    const match = matchRoute(routes, "GET", "/portfolios/p1/holdings")!;
    const event = toEvent(match, {
      method: "GET",
      url: new URL("http://localhost:3001/portfolios/p1/holdings?includeClosed=true"),
      headers: { authorization: "Bearer t" },
      body: "",
    });

    expect(event).toMatchObject({
      routeKey: "GET /portfolios/{portfolioId}/holdings",
      pathParameters: { portfolioId: "p1" },
      queryStringParameters: { includeClosed: "true" },
      headers: { authorization: "Bearer t" },
      body: undefined,
    });
  });

  it("cubre todas las rutas de template.yaml", async () => {
    const template = readFileSync(new URL("../../../template.yaml", import.meta.url), "utf8");
    const inTemplate = [...template.matchAll(/Path: (\S+)\s+Method: (\w+)/g)].map(([, path, method]) => `${method} ${path}`);
    const { ROUTES } = await import("./server-routes");

    expect(ROUTES.map((r) => `${r.method} ${r.path}`).sort()).toEqual(inTemplate.sort());
  });
});
