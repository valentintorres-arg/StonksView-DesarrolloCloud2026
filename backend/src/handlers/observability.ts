// Log estructurado por request (tarea 2.4, issue #24).
//
// Cada Lambda HTTP se envuelve con withRequestLog: al terminar escribe una
// línea con la ruta, el status, la latencia y el id del request de API
// Gateway. Las Lambdas usan el formato de log JSON (LoggingConfig en
// template.yaml), así que el objeto queda como `message` y CloudWatch Logs
// Insights lo consulta por campo (`message.latencyMs`); Lambda agrega solo su
// propio `requestId`.
//
// El id de API Gateway también vuelve en el header `x-request-id`: si un
// usuario reporta un error, con ese id se encuentra su línea en los logs.
//
// No se loguean headers, body ni query: pueden tener el token o datos del
// usuario.

import type { APIGatewayProxyEventV2, APIGatewayProxyHandlerV2, APIGatewayProxyStructuredResultV2, Context } from "aws-lambda";

export interface RequestLog {
  msg: "request";
  route: string;
  status: number;
  latencyMs: number;
  apiRequestId: string | null;
  error?: string;
}

type Logger = (entry: RequestLog) => void;

const defaultLogger: Logger = (entry) => (entry.status >= 500 ? console.error(entry) : console.info(entry));

export function withRequestLog(
  handler: APIGatewayProxyHandlerV2,
  { log = defaultLogger, clock = () => performance.now() }: { log?: Logger; clock?: () => number } = {},
): APIGatewayProxyHandlerV2 {
  return async (event: APIGatewayProxyEventV2, context: Context) => {
    const start = clock();
    const apiRequestId = event.requestContext?.requestId ?? null;
    const route = event.routeKey ?? `${event.requestContext?.http?.method ?? "?"} ${event.rawPath ?? "?"}`;
    const entry = (status: number, error?: string): RequestLog => ({
      msg: "request",
      route,
      status,
      latencyMs: Math.round(clock() - start),
      apiRequestId,
      ...(error ? { error } : {}),
    });

    try {
      const raw = await handler(event, context, () => undefined);
      const result: APIGatewayProxyStructuredResultV2 =
        typeof raw === "object" && raw !== null ? raw : { statusCode: 200, body: raw ?? undefined };
      const status = result.statusCode ?? 200;
      log(entry(status));
      return apiRequestId ? { ...result, headers: { ...result.headers, "x-request-id": apiRequestId } } : result;
    } catch (error) {
      // API Gateway responde 500 igual; queda registrado con su latencia.
      log(entry(500, error instanceof Error ? error.message : String(error)));
      throw error;
    }
  };
}
