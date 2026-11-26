// Insight con IA (tarea 4.2, issue #32; spec RN-31 a RN-36).
//
// El backend calcula las métricas (getDashboard) y la IA solo las interpreta:
// recibe un JSON con montos, porcentajes, símbolos y nombres de sede, sin
// ningún dato que identifique al usuario (RN-32), y devuelve texto.
//
// Degradación (RN-34): si la IA falla, tarda más que el timeout o devuelve un
// número que no está en el contexto (RN-33), el insight queda `no_disponible`
// y la respuesta sigue siendo 201: el dashboard no se rompe. Igual se guarda
// en ai_insights con el contexto enviado, para auditar.
//
// Límite diario (RN-35): 5 insights por usuario por día de Argentina. Cuenta
// las filas de ai_insights del usuario (RLS solo deja ver las suyas), ok o no:
// cada una es una llamada a la IA. Superado el límite se responde 429 sin
// llamar a la IA ni guardar nada. Dos pedidos simultáneos pueden pasarse del
// límite por uno: se acepta, el límite es para acotar costo, no de seguridad.

import { z } from "zod";
import { getDashboard, type PriceRow, type PriceStore } from "./dashboard";
import type { PortfolioMetrics } from "./metrics";
import type { PortfolioStore, StoreResult } from "./portfolios";
import type { Asset } from "./prices";
import { internalError, invalidRequest, mapRpcError, type Outcome } from "./rpc";

export const DAILY_INSIGHT_LIMIT = 5;
const MAX_SYMBOLS_IN_CONTEXT = 10;

export type InsightState = "ok" | "no_disponible";

export interface InsightRow {
  id: string;
  portfolio_id: string;
  respuesta_texto: string | null;
  estado: InsightState;
  created_at: string;
}

export interface NewInsightRow {
  portfolio_id: string;
  contexto_enviado: InsightContext;
  respuesta_texto: string | null;
  estado: InsightState;
}

export interface InsightStore {
  // Insights del usuario (todas sus carteras) creados desde `since`.
  countSince(since: string): Promise<StoreResult<number>>;
  insert(row: NewInsightRow): Promise<StoreResult<InsightRow>>;
  // null si no hay ninguno (o el portfolio no es del usuario: RLS).
  latest(portfolioId: string): Promise<StoreResult<InsightRow | null>>;
}

export interface ChatMessage {
  role: "system" | "user";
  content: string;
}

// Llama al modelo y devuelve el texto; tira error si falla o vence el timeout.
export type Llm = (messages: ChatMessage[]) => Promise<string>;

export interface Insight {
  id: string | null;
  portfolioId: string;
  state: InsightState;
  text: string | null;
  createdAt: string;
}

export interface InsightDeps {
  portfolios: PortfolioStore;
  prices: PriceStore;
  refresh?: (assets: Asset[], cached: PriceRow[]) => Promise<PriceRow[]>;
  insights: InsightStore;
  llm: Llm | null;
  now?: () => Date;
  onError: (error: unknown) => void;
}

const portfolioIdSchema = z.uuid({ message: "portfolioId debe ser un UUID" });
const MESSAGES = { notFound: "El portfolio no existe", internal: "No se pudo generar el insight" };

export async function generateInsight(portfolioId: unknown, deps: InsightDeps): Promise<Outcome<Insight>> {
  const parsed = portfolioIdSchema.safeParse(portfolioId);
  if (!parsed.success) return invalidRequest("El portfolio no es válido", parsed.error);
  const id = parsed.data;
  const now = (deps.now ?? (() => new Date()))();

  try {
    const used = await deps.insights.countSince(startOfArgentinaDay(now).toISOString());
    if (used.error) return mapRpcError(used.error, MESSAGES, deps.onError);
    if (used.data >= DAILY_INSIGHT_LIMIT) {
      return {
        status: 429,
        body: { error: "rate_limited", message: "Alcanzaste el límite de insights de hoy" },
      };
    }

    const dashboard = await getDashboard({ portfolioId: id }, deps.portfolios, deps.prices, deps.onError, deps.refresh);
    // getDashboard solo responde 200 cuando sale bien; lo demás es un error.
    if (dashboard.status !== 200) return dashboard as Outcome<never>;
    const { metrics, portfolio } = dashboard.body;
    if (metrics.valuedLots === 0) {
      return {
        status: 422,
        body: { error: "unprocessable", message: "Cargá tenencias con precio para poder generar un insight" },
      };
    }

    const context = buildInsightContext(metrics, portfolio.baseCurrency);
    let text: string | null = null;
    let state: InsightState = "no_disponible";
    if (deps.llm) {
      try {
        text = (await deps.llm(buildPrompt(context))).trim();
        const unknown = numbersNotInContext(text, context);
        if (text && unknown.length === 0) state = "ok";
        else deps.onError(new Error(`Insight descartado: números fuera del contexto (${unknown.join(", ")})`));
      } catch (error) {
        deps.onError(error);
      }
    }

    const saved = await deps.insights.insert({
      portfolio_id: id,
      contexto_enviado: context,
      // El texto descartado se guarda igual, para auditar qué devolvió la IA.
      respuesta_texto: text || null,
      estado: state,
    });
    if (saved.error) deps.onError(saved.error);

    return {
      status: 201,
      body: {
        id: saved.data?.id ?? null,
        portfolioId: id,
        state,
        text: state === "ok" ? text : null,
        createdAt: saved.data?.created_at ?? now.toISOString(),
      },
    };
  } catch (error) {
    deps.onError(error);
    return internalError(MESSAGES.internal);
  }
}

export async function latestInsight(
  portfolioId: unknown,
  store: PortfolioStore,
  insights: InsightStore,
  onError: (error: unknown) => void,
): Promise<Outcome<Insight | null>> {
  const parsed = portfolioIdSchema.safeParse(portfolioId);
  if (!parsed.success) return invalidRequest("El portfolio no es válido", parsed.error);

  try {
    const portfolio = await store.getPortfolio(parsed.data);
    if (portfolio.error) return mapRpcError(portfolio.error, MESSAGES, onError);
    if (!portfolio.data) return { status: 404, body: { error: "not_found", message: MESSAGES.notFound } };

    const row = await insights.latest(parsed.data);
    if (row.error) return mapRpcError(row.error, MESSAGES, onError);
    if (!row.data) return { status: 200, body: null };
    return {
      status: 200,
      body: {
        id: row.data.id,
        portfolioId: row.data.portfolio_id,
        state: row.data.estado,
        text: row.data.estado === "ok" ? row.data.respuesta_texto : null,
        createdAt: row.data.created_at,
      },
    };
  } catch (error) {
    onError(error);
    return internalError("No se pudo leer el insight");
  }
}

// ---------- Contexto y prompt ----------

export interface InsightContext {
  moneda: string;
  patrimonioTotal: string;
  cantidadDeSedes: number;
  cantidadDeActivos: number;
  gananciaNoRealizada: { monto: string; porcentaje: string | null; lotesSinCostoBase: number };
  porSede: Array<{ sede: string; tipo: string; valor: string; porcentaje: string | null }>;
  porClaseDeActivo: Array<{ clase: string; valor: string; porcentaje: string | null }>;
  principalesActivos: Array<{ simbolo: string; clase: string; valor: string; porcentaje: string | null }>;
  concentracion: { umbralPorcentaje: number; sedesSobreUmbral: string[]; activosSobreUmbral: string[] };
  activosSinPrecio: string[];
}

// Montos y porcentajes con 2 decimales: el modelo no necesita más y así los
// números que cita son fáciles de verificar.
const round2 = (value: string | null) => (value === null ? null : Number(value).toFixed(2));

export function buildInsightContext(metrics: PortfolioMetrics, currency: string): InsightContext {
  return {
    moneda: currency,
    patrimonioTotal: round2(metrics.totalValue)!,
    cantidadDeSedes: metrics.bySource.length,
    cantidadDeActivos: metrics.bySymbol.length,
    gananciaNoRealizada: {
      monto: round2(metrics.unrealizedGain.value)!,
      porcentaje: round2(metrics.unrealizedGain.percent),
      lotesSinCostoBase: metrics.unrealizedGain.lotsWithoutCostBasis,
    },
    porSede: metrics.bySource.map((s) => ({
      sede: s.sourceName,
      tipo: s.sourceType,
      valor: round2(s.value)!,
      porcentaje: round2(s.sharePercent),
    })),
    porClaseDeActivo: metrics.byAssetClass.map((a) => ({
      clase: a.assetClass,
      valor: round2(a.value)!,
      porcentaje: round2(a.sharePercent),
    })),
    principalesActivos: metrics.bySymbol.slice(0, MAX_SYMBOLS_IN_CONTEXT).map((s) => ({
      simbolo: s.symbol,
      clase: s.assetClass,
      valor: round2(s.value)!,
      porcentaje: round2(s.sharePercent),
    })),
    concentracion: {
      umbralPorcentaje: metrics.concentration.thresholdPercent,
      sedesSobreUmbral: metrics.concentration.sourcesOverThreshold.map((s) => s.sourceName),
      activosSobreUmbral: metrics.concentration.symbolsOverThreshold.map((s) => s.symbol),
    },
    activosSinPrecio: [...new Set(metrics.unpricedHoldings.map((h) => h.symbol))],
  };
}

const SYSTEM_PROMPT = `Sos un asistente que interpreta métricas ya calculadas de un portfolio de inversiones.
Reglas:
1. Escribí en castellano rioplatense, de 2 a 4 oraciones y como máximo 90 palabras.
2. Usá solo números que aparezcan en el JSON, tal cual o redondeados. No calcules números nuevos: nada de sumas, restas, diferencias, promedios ni proyecciones.
3. Citá el dato de origen de lo que decís (por ejemplo: "el 62 % de tu patrimonio está en Binance").
4. Enfocate en la concentración por sede y por activo, y en las posiciones que más pesan.
5. No des consejos de compra o venta ni recomendaciones de inversión.
6. Respondé solo con el texto, sin títulos, listas ni formato.`;

export function buildPrompt(context: InsightContext): ChatMessage[] {
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: `Métricas del portfolio (JSON):\n${JSON.stringify(context, null, 2)}` },
  ];
}

// ---------- Verificación de números (RN-33) ----------

const NUMBER_RE = /\d[\d.,]*\d|\d/g;

// Números del texto que no salen del contexto. Cada número se interpreta con
// formato argentino (1.234,5) y anglosajón (1,234.5); vale si alguna de las
// dos lecturas coincide con un número del contexto redondeado a la misma
// cantidad de decimales, o, para montos grandes sin decimales, si está a
// menos del 1 % (redondeos como "unos 12.300").
export function numbersNotInContext(text: string, context: InsightContext): string[] {
  const allowed = [...JSON.stringify(context).matchAll(NUMBER_RE)].map((m) => Number(m[0].replace(/,/g, "")));
  const unknown: string[] = [];
  for (const [token] of text.matchAll(NUMBER_RE)) {
    const ok = readings(token).some((reading) => allowed.some((value) => matches(reading, value)));
    if (!ok) unknown.push(token);
  }
  return unknown;
}

interface Reading {
  value: number;
  decimals: number;
}

function readings(token: string): Reading[] {
  const variants = [
    token.replace(/\./g, "").replace(",", "."), // 1.234,5
    token.replace(/,/g, ""), // 1,234.5
  ];
  return variants
    .filter((v) => /^\d+(\.\d+)?$/.test(v))
    .map((v) => ({ value: Number(v), decimals: v.includes(".") ? v.split(".")[1]!.length : 0 }));
}

function matches({ value, decimals }: Reading, allowed: number): boolean {
  const factor = 10 ** decimals;
  for (const candidate of [allowed, Math.abs(allowed)]) {
    if (Math.round(candidate * factor) === Math.round(value * factor)) return true;
    if (decimals === 0 && candidate >= 1000 && Math.abs(value - candidate) / candidate < 0.01) return true;
  }
  return false;
}

// Medianoche de Argentina (UTC−3, sin horario de verano).
export function startOfArgentinaDay(now: Date): Date {
  const offsetMs = 3 * 60 * 60 * 1000;
  const local = new Date(now.getTime() - offsetMs);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) + offsetMs);
}
