import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";

export function json(
  statusCode: number,
  body: unknown,
  headers: Record<string, string> = {},
): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  };
}
