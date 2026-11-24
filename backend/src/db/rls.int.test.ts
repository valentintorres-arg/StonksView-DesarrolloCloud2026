// Aislamiento por RLS entre usuarios (tareas 1.2 y 2.2): un usuario no puede
// leer ni modificar el portfolio de otro, y sin sesión no se accede a nada.

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { count, insertLot, insertPortfolio, readLot, USER_1, USER_2 } from "./fixtures";
import { createTestDb, sqlState, type TestDb } from "./testdb";

let t: TestDb;
let p1: string;
let lot1: string;

beforeAll(async () => {
  t = await createTestDb();
}, 60_000);

beforeEach(async () => {
  await t.reset();
  p1 = await insertPortfolio(t.db, USER_1, "De usuario 1");
  await insertPortfolio(t.db, USER_2, "De usuario 2");
  lot1 = await insertLot(t.db, p1, { quantity: "1", costBasis: "100" });
  await t.db.query(
    `insert into public.sales (portfolio_id, symbol, quantity, sale_price, proceeds, cost_basis,
       realized_gain, method, lots_consumed, sold_at)
     values ($1, 'BTC', 1, 1, 1, 1, 0, 'fifo', '[]', now())`,
    [p1],
  );
  await t.db.query(
    "insert into public.price_cache (symbol, asset_class, source, price) values ('BTC', 'crypto', 'coingecko', 1)",
  );
});

const select = (userId: string | null, sql: string, params: unknown[] = []) =>
  t.as(userId, async (db) => (await db.query(sql, params)).rows);

describe("RLS entre usuarios", () => {
  it("cada usuario ve solo sus portfolios", async () => {
    expect(await select(USER_1, "select name from public.portfolios")).toEqual([{ name: "De usuario 1" }]);
    expect(await select(USER_2, "select name from public.portfolios")).toEqual([{ name: "De usuario 2" }]);
  });

  it.each(["holdings", "sales"])("un usuario no lee %s del portfolio de otro", async (table) => {
    expect(await select(USER_1, `select id from public.${table}`)).toHaveLength(1);
    expect(await select(USER_2, `select id from public.${table}`)).toEqual([]);
  });

  it("un usuario no puede cargar un holding en el portfolio de otro", async () => {
    const code = await sqlState(
      select(
        USER_2,
        `insert into public.holdings (portfolio_id, symbol, asset_class, quantity, cost_basis, source_type, source_name)
         values ($1, 'ETH', 'crypto', 1, 1, 'exchange', 'Binance')`,
        [p1],
      ),
    );

    expect(code).toBe("42501");
    expect(await count(t.db, "holdings")).toBe(1);
  });

  it("un usuario no puede modificar ni borrar holdings de otro", async () => {
    await select(USER_2, "update public.holdings set quantity = 999 where id = $1", [lot1]);
    await select(USER_2, "delete from public.holdings where id = $1", [lot1]);

    expect(await readLot(t.db, lot1)).toMatchObject({ quantity: "1" });
  });

  it("un usuario no puede crear un portfolio a nombre de otro", async () => {
    const code = await sqlState(
      select(USER_2, "insert into public.portfolios (user_id, name) values ($1, 'robado')", [USER_1]),
    );
    expect(code).toBe("42501");
  });

  it("las ventas son append-only: ni el dueño puede modificarlas", async () => {
    const code = await sqlState(select(USER_1, "update public.sales set realized_gain = 1000000"));
    expect(code).toBe("42501");
  });

  it("los precios cacheados se leen pero no se escriben desde la app", async () => {
    expect(await select(USER_1, "select symbol from public.price_cache")).toEqual([{ symbol: "BTC" }]);
    expect(await sqlState(select(USER_1, "update public.price_cache set price = 0"))).toBe("42501");
  });

  it.each(["portfolios", "holdings", "sales", "price_cache"])("sin sesión no se puede leer %s", async (table) => {
    expect(await sqlState(select(null, `select 1 from public.${table}`))).toBe("42501");
  });
});
