// Servidor local de la API para desarrollo (`npm run dev`).
//
// Sirve los mismos handlers que las Lambdas, con las mismas rutas que
// template.yaml, sin SAM ni AWS. Lee SUPABASE_URL y SUPABASE_ANON_KEY del
// .env de la raíz del repo. Solo para desarrollo: no se despliega.

import { createServer, type IncomingMessage } from "node:http";
import type { APIGatewayProxyStructuredResultV2, Context } from "aws-lambda";
import { matchRoute, toEvent } from "./router";
import { ROUTES } from "./server-routes";

const PORT = Number(process.env.API_PORT ?? 3001);
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? "http://localhost:3000").split(",");

function corsHeaders(origin: string | undefined): Record<string, string> {
  if (!origin || !ALLOWED_ORIGINS.includes(origin)) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "access-control-allow-headers": "authorization,content-type",
    "access-control-max-age": "600",
    vary: "origin",
  };
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

const server = createServer(async (req, res) => {
  const started = Date.now();
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const method = req.method ?? "GET";
  const cors = corsHeaders(req.headers.origin);

  if (method === "OPTIONS") {
    res.writeHead(204, cors).end();
    return;
  }

  const match = matchRoute(ROUTES, method, url.pathname);
  if (!match) {
    res.writeHead(404, { ...cors, "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not_found", message: "Ruta inexistente" }));
    return;
  }

  const headers = Object.fromEntries(
    Object.entries(req.headers).map(([k, v]) => [k.toLowerCase(), Array.isArray(v) ? v.join(",") : (v ?? "")]),
  );
  const event = toEvent(match, { method, url, headers, body: await readBody(req) });

  try {
    const result = (await match.route.handler(event, {} as Context, () => undefined)) as APIGatewayProxyStructuredResultV2;
    const status = result.statusCode ?? 200;
    res.writeHead(status, { ...cors, ...(result.headers as Record<string, string>) });
    res.end(result.body ?? "");
    console.log(`${method} ${url.pathname} → ${status} (${Date.now() - started} ms)`);
  } catch (error) {
    console.error(`${method} ${url.pathname} lanzó`, error);
    res.writeHead(500, { ...cors, "content-type": "application/json" });
    res.end(JSON.stringify({ error: "internal_error", message: "Error interno" }));
  }
});

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
  console.warn("Aviso: faltan SUPABASE_URL / SUPABASE_ANON_KEY en el .env de la raíz.");
}

server.listen(PORT, () => {
  console.log(`API local en http://localhost:${PORT} (CORS: ${ALLOWED_ORIGINS.join(", ")})`);
});
