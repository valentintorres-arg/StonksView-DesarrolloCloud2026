// Stores en SQL para los tests de integración: mismo contrato que
// supabasePortfolioStore y supabasePriceStore, ejecutados sobre PGlite como
// el usuario (con RLS), así los casos de uso del core se prueban contra
// Postgres real.

import type { PGlite } from "@electric-sql/pglite";
import type { PriceRow, PriceStore } from "../core/dashboard";
import type { HoldingRow, PortfolioRow, PortfolioStore, StoreResult } from "../core/portfolios";
import type { TestDb } from "./testdb";

const HOLDING_COLUMNS =
  "id, portfolio_id, symbol, asset_class, quantity::text, cost_basis::text, fee::text, source_type, " +
  "source_name, acquired_at::text, lockup_expiry::text, ratio::text, notes, created_at::text, updated_at::text";

const PORTFOLIO_COLUMNS = "id, name, base_currency, created_at::text";

function runner(t: TestDb, userId: string) {
  return async <T>(fn: (db: PGlite) => Promise<T>): Promise<StoreResult<T>> => {
    try {
      return { data: await t.as(userId, fn), error: null };
    } catch (error) {
      const e = error as { code?: string; message: string };
      return { data: null, error: { code: e.code, message: e.message } };
    }
  };
}

export function sqlPortfolioStore(t: TestDb, userId: string): PortfolioStore {
  const run = runner(t, userId);
  return {
    listPortfolios: () =>
      run(async (db) => (await db.query<PortfolioRow>(`select ${PORTFOLIO_COLUMNS} from public.portfolios`)).rows),
    getPortfolio: (id) =>
      run(async (db) =>
        (await db.query<PortfolioRow>(`select ${PORTFOLIO_COLUMNS} from public.portfolios where id = $1`, [id])).rows[0] ?? null,
      ),
    createPortfolio: (input) =>
      run(async (db) =>
        (await db.query<PortfolioRow>(
          `insert into public.portfolios (name, base_currency) values ($1, $2) returning ${PORTFOLIO_COLUMNS}`,
          [input.name, input.base_currency],
        )).rows[0]!,
      ),
    listHoldings: (portfolioId, includeClosed) =>
      run(async (db) =>
        (await db.query<HoldingRow>(
          `select ${HOLDING_COLUMNS} from public.holdings where portfolio_id = $1 ${includeClosed ? "" : "and quantity > 0"} order by symbol`,
          [portfolioId],
        )).rows,
      ),
    createHolding: (h) =>
      run(async (db) =>
        (await db.query<HoldingRow>(
          `insert into public.holdings (portfolio_id, symbol, asset_class, quantity, cost_basis, fee, source_type,
             source_name, acquired_at, lockup_expiry, ratio, notes)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning ${HOLDING_COLUMNS}`,
          [h.portfolio_id, h.symbol, h.asset_class, h.quantity, h.cost_basis, h.fee, h.source_type,
            h.source_name, h.acquired_at, h.lockup_expiry, h.ratio, h.notes],
        )).rows[0]!,
      ),
    updateHolding: (id, patch) =>
      run(async (db) => {
        const entries = Object.entries(patch);
        const sets = entries.map(([column], i) => `${column} = $${i + 2}`).join(", ");
        const { rows } = await db.query<HoldingRow>(
          `update public.holdings set ${sets} where id = $1 returning ${HOLDING_COLUMNS}`,
          [id, ...entries.map(([, value]) => value)],
        );
        return rows[0] ?? null;
      }),
    deleteHolding: (id) =>
      run(async (db) => (await db.query("delete from public.holdings where id = $1 returning id", [id])).rows.length > 0),
  };
}

export function sqlPriceStore(t: TestDb, userId: string): PriceStore {
  const run = runner(t, userId);
  return {
    pricesFor: (symbols) =>
      run(async (db) =>
        (await db.query<PriceRow>(
          `select symbol, asset_class, source, price::text, currency, fetched_at::text
           from public.price_cache where symbol = any($1)`,
          [symbols],
        )).rows,
      ),
  };
}
