// Datos de prueba para los tests de integración. Se insertan como
// superusuario (sin RLS), igual que los cargaría un seed.

import type { PGlite } from "@electric-sql/pglite";

export const USER_1 = "aaaaaaaa-0000-4000-8000-000000000001";
export const USER_2 = "aaaaaaaa-0000-4000-8000-000000000002";

export async function insertPortfolio(db: PGlite, userId: string, name = "Principal"): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    "insert into public.portfolios (user_id, name) values ($1, $2) returning id",
    [userId, name],
  );
  return rows[0]!.id;
}

export interface LotInput {
  symbol?: string;
  assetClass?: string;
  quantity: string;
  costBasis: string | null;
  fee?: string | null;
  sourceName?: string;
  sourceType?: string;
  acquiredAt?: string | null;
}

export async function insertLot(db: PGlite, portfolioId: string, lot: LotInput): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.holdings
       (portfolio_id, symbol, asset_class, quantity, cost_basis, fee, source_type, source_name, acquired_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     returning id`,
    [
      portfolioId,
      lot.symbol ?? "BTC",
      lot.assetClass ?? "crypto",
      lot.quantity,
      lot.costBasis,
      lot.fee ?? null,
      lot.sourceType ?? "exchange",
      lot.sourceName ?? "Binance",
      lot.acquiredAt ?? null,
    ],
  );
  return rows[0]!.id;
}

export interface LotRow {
  id: string;
  quantity: string;
  cost_basis: string | null;
  fee: string | null;
  source_name: string;
  source_type: string;
  acquired_at: string | null;
}

// Lote leído como superusuario, con los numeric como texto exacto.
export async function readLot(db: PGlite, id: string): Promise<LotRow | undefined> {
  const { rows } = await db.query<LotRow>(
    `select id, quantity::text, cost_basis::text, fee::text, source_name, source_type,
            to_char(acquired_at at time zone 'UTC', 'YYYY-MM-DD') as acquired_at
     from public.holdings where id = $1`,
    [id],
  );
  return rows[0];
}

export async function count(db: PGlite, table: string): Promise<number> {
  const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from public.${table}`);
  return rows[0]!.n;
}
