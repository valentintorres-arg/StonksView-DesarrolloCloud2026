// Rutas del servidor local: las mismas de template.yaml, cada una con su
// handler. Hay un test que verifica que coincidan con el template.

import { handler as health } from "../handlers/health";
import { handler as ping } from "../handlers/ping";
import { handler as portfolios } from "../handlers/portfolios";
import { handler as sales } from "../handlers/sales";
import { handler as transfers } from "../handlers/transfers";
import type { Route } from "./router";

export const ROUTES: Route[] = [
  { method: "GET", path: "/ping", handler: ping },
  { method: "GET", path: "/health", handler: health },
  { method: "POST", path: "/transfers", handler: transfers },
  { method: "POST", path: "/sales", handler: sales },
  { method: "GET", path: "/portfolios", handler: portfolios },
  { method: "POST", path: "/portfolios", handler: portfolios },
  { method: "GET", path: "/portfolios/{portfolioId}/holdings", handler: portfolios },
  { method: "POST", path: "/portfolios/{portfolioId}/holdings", handler: portfolios },
  { method: "GET", path: "/portfolios/{portfolioId}/metrics", handler: portfolios },
  { method: "PATCH", path: "/holdings/{holdingId}", handler: portfolios },
  { method: "DELETE", path: "/holdings/{holdingId}", handler: portfolios },
];
