import type { APIGatewayProxyEventV2, Context } from "aws-lambda";
import { describe, expect, it, vi } from "vitest";
import { createHandler } from "./health";

async function invoke(handler: ReturnType<typeof createHandler>) {
  const result = await handler(
    {} as APIGatewayProxyEventV2,
    {} as Context,
    () => undefined,
  );
  return result as { statusCode: number; headers: object; body: string };
}

describe("handler de health", () => {
  it("responde 200 cuando la base responde", async () => {
    const result = await invoke(createHandler(async () => undefined));

    expect(result.statusCode).toBe(200);
    expect(result.headers).toMatchObject({
      "content-type": "application/json",
      "cache-control": "no-store",
    });
    expect(JSON.parse(result.body)).toMatchObject({
      status: "ok",
      checks: { database: "ok" },
    });
  });

  it("responde 503 sin exponer el error cuando la base falla", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await invoke(
      createHandler(async () => {
        throw new Error("password authentication failed for user postgres");
      }),
    );

    expect(result.statusCode).toBe(503);
    expect(JSON.parse(result.body)).toMatchObject({
      status: "error",
      checks: { database: "error" },
    });
    expect(result.body).not.toContain("password");
  });
});
