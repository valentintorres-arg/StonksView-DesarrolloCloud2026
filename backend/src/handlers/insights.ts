// Lambda del insight con IA (tarea 4.2): POST para generar uno y GET para el
// último. Va aparte de la de portfolios porque necesita más timeout (la IA
// puede tardar hasta 10 s) y es la única que recibe GROQ_API_KEY.

import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { generateInsight, type InsightStore, latestInsight, type Llm } from "../core/insights";
import type { Outcome } from "../core/rpc";
import { groqFromEnv } from "./groq";
import { json } from "./http";
import { withRequestLog } from "./observability";
import { supabaseInsightStore } from "./insight-store";
import { supabasePortfolioStore, supabasePriceStore } from "./portfolio-store";
import { defaultPriceRefreshDeps, priceRefresher } from "./price-refresh";
import type { Stores } from "./portfolios";
import { NO_STORE, readAuthenticatedJson } from "./request";
import { supabaseForUser } from "./supabase";

export interface InsightStores extends Stores {
  insights: InsightStore;
}

export const ROUTES = ["POST /portfolios/{portfolioId}/insights", "GET /portfolios/{portfolioId}/insights/latest"] as const;

export function createHandler(storesFor: (token: string) => InsightStores, llm: Llm | null): APIGatewayProxyHandlerV2 {
  return async (event) => {
    const request = readAuthenticatedJson(event);
    if (!request.ok) return request.response;

    const stores = storesFor(request.token);
    const onError = (error: unknown) => console.error(`${event.routeKey} falló`, error);
    const portfolioId = event.pathParameters?.portfolioId;
    let outcome: Outcome<unknown>;

    switch (event.routeKey) {
      case "POST /portfolios/{portfolioId}/insights":
        outcome = await generateInsight(portfolioId, {
          portfolios: stores.portfolios,
          prices: stores.prices,
          refresh: priceRefresher(stores),
          insights: stores.insights,
          llm,
          onError,
        });
        break;
      case "GET /portfolios/{portfolioId}/insights/latest":
        outcome = await latestInsight(portfolioId, stores.portfolios, stores.insights, onError);
        break;
      default:
        outcome = { status: 404, body: { error: "not_found", message: "Ruta inexistente" } };
    }
    return json(outcome.status, outcome.body, NO_STORE);
  };
}

// Fuera del handler: se reutilizan entre invocaciones del mismo contenedor.
const priceDeps = defaultPriceRefreshDeps();

export const handler = withRequestLog(
  createHandler((token) => {
    const client = supabaseForUser(token);
    return {
      portfolios: supabasePortfolioStore(client),
      prices: supabasePriceStore(client),
      ...priceDeps,
      insights: supabaseInsightStore(client),
    };
  }, groqFromEnv()),
);
