// Lambda de portfolios, holdings y métricas (tareas 1.7 y 3.3). Una sola
// función atiende todas las rutas y elige el caso de uso por `routeKey`; así
// se comparte el contenedor caliente y la lectura del request. La validación
// y el mapeo de errores viven en core/portfolios y core/dashboard.

import type { APIGatewayProxyEventV2, APIGatewayProxyHandlerV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { getDashboard, type PriceStore } from "../core/dashboard";
import {
  createHolding,
  createPortfolio,
  deleteHolding,
  listHoldings,
  listPortfolios,
  type PortfolioStore,
  updateHolding,
} from "../core/portfolios";
import type { Outcome } from "../core/rpc";
import { json } from "./http";
import { supabasePortfolioStore, supabasePriceStore } from "./portfolio-store";
import { NO_STORE, readAuthenticatedJson } from "./request";
import { supabaseForUser } from "./supabase";

export interface Stores {
  portfolios: PortfolioStore;
  prices: PriceStore;
}

export type StoreFactory = (accessToken: string) => Stores;

export const ROUTES = [
  "GET /portfolios",
  "POST /portfolios",
  "GET /portfolios/{portfolioId}/holdings",
  "POST /portfolios/{portfolioId}/holdings",
  "GET /portfolios/{portfolioId}/metrics",
  "PATCH /holdings/{holdingId}",
  "DELETE /holdings/{holdingId}",
] as const;

function dispatch(event: APIGatewayProxyEventV2, body: unknown, stores: Stores): Promise<Outcome<unknown>> {
  const onError = (error: unknown) => console.error(`${event.routeKey} falló`, error);
  const params = event.pathParameters ?? {};
  const query = event.queryStringParameters ?? {};
  const store = stores.portfolios;

  switch (event.routeKey) {
    case "GET /portfolios":
      return listPortfolios(store, onError);
    case "POST /portfolios":
      return createPortfolio(body, store, onError);
    case "GET /portfolios/{portfolioId}/holdings":
      return listHoldings(params.portfolioId, query.includeClosed === "true", store, onError);
    case "POST /portfolios/{portfolioId}/holdings":
      return createHolding(params.portfolioId, body, store, onError);
    case "GET /portfolios/{portfolioId}/metrics":
      return getDashboard(
        { portfolioId: params.portfolioId, concentrationThreshold: query.concentrationThreshold },
        store,
        stores.prices,
        onError,
      );
    case "PATCH /holdings/{holdingId}":
      return updateHolding(params.holdingId, body, store, onError);
    case "DELETE /holdings/{holdingId}":
      return deleteHolding(params.holdingId, store, onError);
    default:
      return Promise.resolve({ status: 404, body: { error: "not_found", message: "Ruta inexistente" } });
  }
}

function respond(outcome: Outcome<unknown>): APIGatewayProxyStructuredResultV2 {
  if (outcome.status === 204) return { statusCode: 204, headers: NO_STORE };
  return json(outcome.status, outcome.body, NO_STORE);
}

export function createHandler(storesFor: StoreFactory): APIGatewayProxyHandlerV2 {
  return async (event) => {
    const request = readAuthenticatedJson(event);
    if (!request.ok) return request.response;
    return respond(await dispatch(event, request.body, storesFor(request.token)));
  };
}

export const handler = createHandler((token) => {
  const client = supabaseForUser(token);
  return { portfolios: supabasePortfolioStore(client), prices: supabasePriceStore(client) };
});
