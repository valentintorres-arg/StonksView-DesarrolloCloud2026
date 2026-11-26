// Motor de métricas determinístico del portfolio (tarea 4.1, issue #31).
//
// Funciones puras: reciben los lotes (`holdings`) y los precios actuales y
// devuelven el patrimonio por sede y por clase de activo, la ganancia no
// realizada y la concentración de riesgo. No consultan la base ni la red,
// así se reutilizan desde cualquier adaptador y son las cifras que después
// recibe el LLM: la IA interpreta estos números, nunca los calcula.
//
// Supuestos (los mismos que usa transfer_holding):
// - Cada fila de holdings es un lote; `costBasis` es el costo POR UNIDAD.
// - `fee` es la comisión de la compra del lote y forma parte de su costo.
// - El precio y el costo están en la moneda base del portfolio.
// - Las sedes se agrupan sin distinguir mayúsculas ni espacios
//   ("binance" y " Binance " son la misma sede).
//
// Los montos se devuelven como string decimal exacto; los porcentajes como
// string con 2 decimales. Un lote sin precio no se valúa (no se inventa un
// valor): queda listado en `unpricedHoldings` y fuera de los totales.

import {
  add,
  compare,
  dec,
  type Decimal,
  type DecimalInput,
  divide,
  isZero,
  mul,
  percent,
  sub,
  toFixed,
  toString,
  ZERO,
} from "./decimal";

export interface HoldingLot {
  id: string;
  symbol: string;
  assetClass: string;
  quantity: DecimalInput;
  costBasis: DecimalInput | null;
  fee: DecimalInput | null;
  sourceName: string;
  sourceType: string;
}

// Precio actual de una unidad del activo, o undefined si no se conoce.
export type PriceLookup = (symbol: string, assetClass: string) => DecimalInput | undefined;

export interface MetricsOptions {
  // Porcentaje del patrimonio a partir del cual una sede o un activo se
  // considera concentración de riesgo.
  concentrationThresholdPercent?: number;
}

export const DEFAULT_CONCENTRATION_THRESHOLD_PERCENT = 50;

export interface SourceBreakdown {
  sourceName: string;
  sourceType: string;
  value: string;
  sharePercent: string | null;
  lots: number;
}

export interface AssetClassBreakdown {
  assetClass: string;
  value: string;
  sharePercent: string | null;
  lots: number;
}

export interface SymbolBreakdown {
  symbol: string;
  assetClass: string;
  value: string;
  sharePercent: string | null;
}

export interface UnrealizedGain {
  // Solo lotes con precio y costo conocidos.
  value: string;
  costBasis: string;
  marketValue: string;
  percent: string | null;
  lotsWithoutCostBasis: number;
}

export interface ConcentrationRisk {
  thresholdPercent: number;
  largestSource: SourceBreakdown | null;
  largestSymbol: SymbolBreakdown | null;
  sourcesOverThreshold: SourceBreakdown[];
  symbolsOverThreshold: SymbolBreakdown[];
}

// Valuación de un lote, para la pantalla de tenencias (P4).
export interface LotValuation {
  id: string;
  sourceName: string;
  quantity: string;
  costBasis: string | null;
  // null si el activo no tiene precio.
  value: string | null;
  // Valor menos costo (cantidad × costo por unidad + comisión). null sin
  // precio o sin costo base.
  unrealizedGain: string | null;
}

// Posición: todos los lotes vigentes de un mismo símbolo y clase, sumados.
export interface Position {
  symbol: string;
  assetClass: string;
  quantity: string;
  price: string | null;
  value: string | null;
  sharePercent: string | null;
  // Promedio del costo por unidad ponderado por cantidad, sobre los lotes con
  // costo base. Solo para mostrar: los lotes nunca se promedian (RN-10).
  averageCost: string | null;
  // Suma de la ganancia de los lotes con costo base; null si no hay precio o
  // ningún lote tiene costo.
  unrealizedGain: string | null;
  unrealizedGainPercent: string | null;
  // Cantidad de sedes distintas donde está el activo.
  sources: number;
  lots: LotValuation[];
}

export interface PortfolioMetrics {
  totalValue: string;
  valuedLots: number;
  unpricedHoldings: Array<Pick<HoldingLot, "id" | "symbol" | "assetClass">>;
  bySource: SourceBreakdown[];
  byAssetClass: AssetClassBreakdown[];
  bySymbol: SymbolBreakdown[];
  unrealizedGain: UnrealizedGain;
  concentration: ConcentrationRisk;
  // Mayor valor primero; las posiciones sin precio van al final.
  positions: Position[];
}

interface Group {
  value: Decimal;
  lots: number;
}

export function computePortfolioMetrics(
  holdings: readonly HoldingLot[],
  priceOf: PriceLookup,
  { concentrationThresholdPercent = DEFAULT_CONCENTRATION_THRESHOLD_PERCENT }: MetricsOptions = {},
): PortfolioMetrics {
  if (!(concentrationThresholdPercent > 0 && concentrationThresholdPercent <= 100)) {
    throw new RangeError("El umbral de concentración debe estar entre 0 y 100");
  }

  let total = ZERO;
  let valuedLots = 0;
  let gainMarketValue = ZERO;
  let gainCost = ZERO;
  let lotsWithoutCostBasis = 0;
  const unpricedHoldings: PortfolioMetrics["unpricedHoldings"] = [];

  const sources = new Map<string, Group & { sourceName: string; sourceType: string }>();
  const assetClasses = new Map<string, Group & { assetClass: string }>();
  const symbols = new Map<string, Group & { symbol: string; assetClass: string }>();

  for (const lot of holdings) {
    // Lote agotado por una venta (quantity 0): queda en la base por historial,
    // pero ya no es una tenencia.
    const quantity = dec(lot.quantity);
    if (isZero(quantity)) continue;

    const price = priceOf(lot.symbol, lot.assetClass);
    if (price === undefined) {
      unpricedHoldings.push({ id: lot.id, symbol: lot.symbol, assetClass: lot.assetClass });
      continue;
    }

    const value = mul(quantity, price);
    total = add(total, value);
    valuedLots += 1;

    const sourceKey = normalizeSource(lot.sourceName);
    const source = sources.get(sourceKey) ?? {
      sourceName: lot.sourceName.trim(),
      sourceType: lot.sourceType,
      value: ZERO,
      lots: 0,
    };
    source.value = add(source.value, value);
    source.lots += 1;
    sources.set(sourceKey, source);

    const assetClass = assetClasses.get(lot.assetClass) ?? {
      assetClass: lot.assetClass,
      value: ZERO,
      lots: 0,
    };
    assetClass.value = add(assetClass.value, value);
    assetClass.lots += 1;
    assetClasses.set(lot.assetClass, assetClass);

    const symbolKey = `${lot.assetClass}:${lot.symbol.toUpperCase()}`;
    const symbol = symbols.get(symbolKey) ?? {
      symbol: lot.symbol.toUpperCase(),
      assetClass: lot.assetClass,
      value: ZERO,
      lots: 0,
    };
    symbol.value = add(symbol.value, value);
    symbol.lots += 1;
    symbols.set(symbolKey, symbol);

    if (lot.costBasis === null) {
      lotsWithoutCostBasis += 1;
    } else {
      const lotCost = add(mul(quantity, lot.costBasis), lot.fee ?? ZERO);
      gainMarketValue = add(gainMarketValue, value);
      gainCost = add(gainCost, lotCost);
    }
  }

  const share = (value: Decimal) => formatPercent(percent(value, total));

  const bySource = sortByValue([...sources.values()], (s) => s.sourceName).map(
    ({ sourceName, sourceType, value, lots }) => ({
      sourceName,
      sourceType,
      value: toString(value),
      sharePercent: share(value),
      lots,
    }),
  );

  const byAssetClass = sortByValue([...assetClasses.values()], (a) => a.assetClass).map(
    ({ assetClass, value, lots }) => ({
      assetClass,
      value: toString(value),
      sharePercent: share(value),
      lots,
    }),
  );

  const bySymbol = sortByValue([...symbols.values()], (s) => s.symbol).map(({ value, symbol, assetClass }) => ({
    symbol,
    assetClass,
    value: toString(value),
    sharePercent: share(value),
  }));

  const gain = sub(gainMarketValue, gainCost);
  const overThreshold = <T extends { sharePercent: string | null }>(rows: T[]) =>
    rows.filter(
      (row) => row.sharePercent !== null && compare(row.sharePercent, concentrationThresholdPercent) > 0,
    );

  return {
    totalValue: toString(total),
    valuedLots,
    unpricedHoldings,
    bySource,
    byAssetClass,
    bySymbol,
    unrealizedGain: {
      value: toString(gain),
      costBasis: toString(gainCost),
      marketValue: toString(gainMarketValue),
      percent: formatPercent(percent(gain, gainCost)),
      lotsWithoutCostBasis,
    },
    concentration: {
      thresholdPercent: concentrationThresholdPercent,
      largestSource: bySource[0] ?? null,
      largestSymbol: bySymbol[0] ?? null,
      sourcesOverThreshold: overThreshold(bySource),
      symbolsOverThreshold: overThreshold(bySymbol),
    },
    positions: computePositions(holdings, priceOf, share),
  };
}

// Dígitos del costo promedio: alcanza para cripto con precios chicos.
const AVERAGE_COST_DIGITS = 8;

function computePositions(
  holdings: readonly HoldingLot[],
  priceOf: PriceLookup,
  share: (value: Decimal) => string | null,
): Position[] {
  const groups = new Map<string, { symbol: string; assetClass: string; lots: HoldingLot[] }>();
  for (const lot of holdings) {
    if (isZero(dec(lot.quantity))) continue;
    const symbol = lot.symbol.toUpperCase();
    const key = `${lot.assetClass}:${symbol}`;
    const group = groups.get(key) ?? { symbol, assetClass: lot.assetClass, lots: [] };
    group.lots.push(lot);
    groups.set(key, group);
  }

  const positions = [...groups.values()].map(({ symbol, assetClass, lots }) => {
    const priceInput = priceOf(symbol, assetClass);
    const price = priceInput === undefined ? null : dec(priceInput);

    let quantity = ZERO;
    let value = ZERO;
    let costedQuantity = ZERO;
    let costedUnits = ZERO; // Σ cantidad × costo por unidad, sin comisión
    let gain = ZERO;
    let gainCost = ZERO; // Σ costo con comisión de los lotes con costo
    let lotsWithCost = 0;

    const valuations = lots.map((lot): LotValuation => {
      const q = dec(lot.quantity);
      quantity = add(quantity, q);
      const lotValue = price === null ? null : mul(q, price);
      if (lotValue) value = add(value, lotValue);

      let lotGain: Decimal | null = null;
      if (lot.costBasis !== null) {
        const units = mul(q, lot.costBasis);
        costedQuantity = add(costedQuantity, q);
        costedUnits = add(costedUnits, units);
        lotsWithCost += 1;
        if (lotValue) {
          const cost = add(units, lot.fee ?? ZERO);
          lotGain = sub(lotValue, cost);
          gain = add(gain, lotGain);
          gainCost = add(gainCost, cost);
        }
      }

      return {
        id: lot.id,
        sourceName: lot.sourceName.trim(),
        quantity: toString(q),
        costBasis: lot.costBasis === null ? null : toString(lot.costBasis),
        value: lotValue && toString(lotValue),
        unrealizedGain: lotGain && toString(lotGain),
      };
    });

    const averageCost = lotsWithCost > 0 ? divide(costedUnits, costedQuantity, AVERAGE_COST_DIGITS) : null;
    const hasGain = price !== null && lotsWithCost > 0;
    return {
      symbol,
      assetClass,
      quantity: toString(quantity),
      price: price && toString(price),
      value: price === null ? null : toString(value),
      sharePercent: price === null ? null : share(value),
      averageCost: averageCost && toString(averageCost),
      unrealizedGain: hasGain ? toString(gain) : null,
      unrealizedGainPercent: hasGain ? formatPercent(percent(gain, gainCost)) : null,
      sources: new Set(lots.map((lot) => normalizeSource(lot.sourceName))).size,
      lots: valuations,
      sortValue: price === null ? null : value,
    };
  });

  return positions
    .sort(
      (a, b) =>
        (a.sortValue === null ? 1 : 0) - (b.sortValue === null ? 1 : 0) ||
        (a.sortValue && b.sortValue ? compare(b.sortValue, a.sortValue) : 0) ||
        a.symbol.localeCompare(b.symbol) ||
        a.assetClass.localeCompare(b.assetClass),
    )
    .map(({ sortValue: _sortValue, ...position }) => position);
}

function normalizeSource(name: string): string {
  return name.trim().toLowerCase();
}

// Mayor valor primero; empates en orden alfabético para que el resultado
// sea siempre el mismo.
function sortByValue<T extends { value: Decimal }>(rows: T[], labelOf: (row: T) => string): T[] {
  return rows.sort((a, b) => compare(b.value, a.value) || labelOf(a).localeCompare(labelOf(b)));
}

// null cuando no hay base sobre la cual calcular (patrimonio o costo en 0).
function formatPercent(value: Decimal | null): string | null {
  return value === null ? null : toFixed(value, 2);
}
