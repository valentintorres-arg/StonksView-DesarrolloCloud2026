import type { APIGatewayProxyEventV2, Context } from "aws-lambda";
import { describe, expect, it, vi } from "vitest";
import { withRequestLog, type RequestLog } from "./observability";

const event = {
  routeKey: "GET /portfolios/{portfolioId}/metrics",
  rawPath: "/portfolios/abc/metrics",
  headers: { authorization: "Bearer secreto" },
  body: '{"dato":"privado"}',
  requestContext: { requestId: "api-req-1", http: { method: "GET" } },
} as unknown as APIGatewayProxyEventV2;

function run(handler: Parameters<typeof withRequestLog>[0]) {
  const logs: RequestLog[] = [];
  let t = 1000;
  const wrapped = withRequestLog(handler, { log: (e) => logs.push(e), clock: () => (t += 42.4) - 42.4 });
  return { logs, call: () => wrapped(event, {} as Context, () => undefined) };
}

describe("withRequestLog", () => {
  it("registra ruta, status, latencia e id de API Gateway, y devuelve el id en un header", async () => {
    const { logs, call } = run(async () => ({ statusCode: 201, headers: { "content-type": "application/json" }, body: "{}" }));

    const result = await call();

    expect(logs).toEqual([
      { msg: "request", route: "GET /portfolios/{portfolioId}/metrics", status: 201, latencyMs: 42, apiRequestId: "api-req-1" },
    ]);
    expect(result).toMatchObject({ statusCode: 201, headers: { "content-type": "application/json", "x-request-id": "api-req-1" } });
  });

  it("no loguea headers ni body", async () => {
    const { logs, call } = run(async () => ({ statusCode: 200 }));
    await call();
    expect(JSON.stringify(logs)).not.toMatch(/secreto|privado/);
  });

  it("si el handler tira error lo registra como 500 y lo vuelve a tirar", async () => {
    const { logs, call } = run(async () => {
      throw new Error("se cayó");
    });

    await expect(call()).rejects.toThrow("se cayó");
    expect(logs[0]).toMatchObject({ status: 500, error: "se cayó", apiRequestId: "api-req-1" });
  });

  it("por defecto usa console.error para los 5xx", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await withRequestLog(async () => ({ statusCode: 503 }))(event, {} as Context, () => undefined);
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ msg: "request", status: 503 }));
    error.mockRestore();
  });
});
