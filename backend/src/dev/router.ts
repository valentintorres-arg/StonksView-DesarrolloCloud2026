// Ruteo del servidor local de desarrollo: traduce un request HTTP al evento
// de API Gateway (HTTP API v2) que reciben las Lambdas, con el mismo
// `routeKey` y los mismos `pathParameters` que en AWS.

import type { APIGatewayProxyEventV2, APIGatewayProxyHandlerV2 } from "aws-lambda";

export interface Route {
  method: string;
  // Igual que en template.yaml, p. ej. /portfolios/{portfolioId}/holdings
  path: string;
  handler: APIGatewayProxyHandlerV2;
}

export interface Match {
  route: Route;
  routeKey: string;
  pathParameters: Record<string, string>;
}

export function matchRoute(routes: Route[], method: string, pathname: string): Match | null {
  const segments = pathname.replace(/\/+$/, "").split("/");
  for (const route of routes) {
    if (route.method !== method) continue;
    const pattern = route.path.split("/");
    if (pattern.length !== segments.length) continue;

    const pathParameters: Record<string, string> = {};
    const matches = pattern.every((part, i) => {
      const segment = segments[i]!;
      const param = /^\{(\w+)\}$/.exec(part);
      if (param) {
        if (!segment) return false;
        pathParameters[param[1]!] = decodeURIComponent(segment);
        return true;
      }
      return part === segment;
    });
    if (matches) return { route, routeKey: `${route.method} ${route.path}`, pathParameters };
  }
  return null;
}

export function toEvent(
  match: Match,
  request: { method: string; url: URL; headers: Record<string, string>; body: string },
): APIGatewayProxyEventV2 {
  const query = Object.fromEntries(request.url.searchParams);
  return {
    version: "2.0",
    routeKey: match.routeKey,
    rawPath: request.url.pathname,
    rawQueryString: request.url.search.replace(/^\?/, ""),
    headers: request.headers,
    queryStringParameters: Object.keys(query).length ? query : undefined,
    pathParameters: Object.keys(match.pathParameters).length ? match.pathParameters : undefined,
    body: request.body || undefined,
    isBase64Encoded: false,
    requestContext: {
      http: { method: request.method, path: request.url.pathname, protocol: "HTTP/1.1", sourceIp: "127.0.0.1", userAgent: request.headers["user-agent"] ?? "" },
      routeKey: match.routeKey,
      stage: "$default",
      requestId: crypto.randomUUID(),
      timeEpoch: Date.now(),
    },
  } as unknown as APIGatewayProxyEventV2;
}
