import type { APIGatewayProxyEventV2, Context } from "aws-lambda";
import { describe, expect, it } from "vitest";
import { handler } from "./ping";

describe("handler de ping", () => {
  it("responde 200 con JSON", async () => {
    const result = await handler(
      {} as APIGatewayProxyEventV2,
      {} as Context,
      () => undefined,
    );

    expect(result).toMatchObject({
      statusCode: 200,
      headers: { "content-type": "application/json" },
    });
    const body = JSON.parse((result as { body: string }).body);
    expect(body.status).toBe("ok");
  });
});
