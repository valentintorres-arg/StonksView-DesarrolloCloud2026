// Métricas del dashboard contra Postgres con RLS. Criterio de la tarea 3.3:
// "los números coinciden con la base". Se calcula lo mismo con SQL y se
// compara con lo que devuelve el endpoint.

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDashboard } from "../core/dashboard";
import { insertLot, insertPortfolio, USER_1, USER_2 } from "./fixtures";
import { sqlPortfolioStore, sqlPriceStore } from "./sql-store";
import { createTestDb, type TestDb } from "./testdb";

let t: TestDb;
let p1: string;

beforeAll(async () => {
  t = await createTestDb();
}, 60_000);

async function setPrice(symbol: string, price: string, fetchedAt: string, source = "coingecko", currency = "USD") {
  await t.db.query(
    `insert into public.price_cache (symbol, asset_class, source, price, currency, fetched_at)
     values ($1, 'crypto', $2, $3, $4, $5)`,
    [symbol, source, price, currency, fetchedAt],
  );
}

beforeEach(async () => {
  await t.reset();
  p1 = await insertPortfolio(t.db, USER_1);
  await insertLot(t.db, p1, { symbol: "BTC", quantity: "0.12345678", costBasis: "30000", fee: "2.5" });
  await insertLot(t.db, p1, { symbol: "BTC", quantity: "0.5", costBasis: "60000", sourceName: "Ledger", sourceType: "wallet" });
  await insertLot(t.db, p1, { symbol: "ETH", quantity: "3.3", costBasis: "1800.75" });
  await insertLot(t.db, p1, { symbol: "ETH", quantity: "0", costBasis: "1" }); // lote agotado
  await setPrice("BTC", "64000.10", "2026-11-23T10:00:00Z", "yahoo");
  await setPrice("BTC", "65432.12", "2026-11-23T11:00:00Z");
  await setPrice("ETH", "3123.45", "2026-11-23T09:00:00Z");
});

const dashboard = (userId: string, portfolioId = p1) =>
  getDashboard({ portfolioId }, sqlPortfolioStore(t, userId), sqlPriceStore(t, userId), () => undefined);

// Lo mismo, calculado directo en SQL con el precio más reciente de cada activo.
async function sqlTotals() {
  const { rows } = await t.db.query<{ total: string; gain: string; ledger: string }>(`
    with latest as (
      select distinct on (symbol, asset_class) symbol, asset_class, price
      from public.price_cache where currency = 'USD'
      order by symbol, asset_class, fetched_at desc
    )
    select
      trim_scale(sum(h.quantity * l.price))::text as total,
      trim_scale(sum(h.quantity * l.price - (h.quantity * h.cost_basis + coalesce(h.fee, 0))))::text as gain,
      trim_scale(sum(h.quantity * l.price) filter (where h.source_name = 'Ledger'))::text as ledger
    from public.holdings h join latest l on l.symbol = h.symbol and l.asset_class = h.asset_class
    where h.portfolio_id = '${p1}' and h.quantity > 0`);
  return rows[0]!;
}

describe("GET /portfolios/{id}/metrics contra Postgres", () => {
  it("los números coinciden con los que calcula la base", async () => {
    const outcome = await dashboard(USER_1);
    const expected = await sqlTotals();

    expect(outcome.status).toBe(200);
    if (outcome.status !== 200) return;
    const { metrics } = outcome.body;
    expect(metrics.totalValue).toBe(expected.total);
    expect(metrics.unrealizedGain.value).toBe(expected.gain);
    expect(metrics.bySource.find((s) => s.sourceName === "Ledger")?.value).toBe(expected.ledger);
    expect(metrics.valuedLots).toBe(3);
    expect(outcome.body.prices.find((p) => p.symbol === "BTC")?.price).toBe("65432.12");
  });

  it("otro usuario recibe 404", async () => {
    expect((await dashboard(USER_2)).status).toBe(404);
  });
});
