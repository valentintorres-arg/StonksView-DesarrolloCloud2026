// Adaptador fino: traduce el evento de API Gateway a una llamada a core.

import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { ping } from "../core/ping";
import { json } from "./http";

export const handler: APIGatewayProxyHandlerV2 = async () => json(200, ping());
