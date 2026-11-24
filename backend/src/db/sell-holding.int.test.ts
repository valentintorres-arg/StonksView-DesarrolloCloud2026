// Integración de sell_holding contra Postgres (PGlite) con las migraciones
// reales y RLS activo. Tarea 2.2: "venta FIFO/LIFO".

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { count, insertLot, insertPortfolio, readLot, USER_1, USER_2 } from "./fixtures";
import { createTestDb, sqlState, type TestDb } from "./testdb";

let t: TestDb;
let portfolio: string;
let lotA: string;
let lotB: string;
let lotC: string;

beforeAll(async () => {
  t = await createTestDb();
}, 60_000);

// A: 2 a 100 (+2 de comisión), enero · B: 1 a 200, febrero, en Ledger · C: 3 a 300, marzo
beforeEach(async () => {
  await t.reset();
  portfolio = await insertPortfolio(t.db, USER_1);
  lotA = await insertLot(t.db, portfolio, { quantity: "2", costBasis: "100", fee: "2", acquiredAt: "2026-01-01" });
  lotB = await insertLot(t.db, portfolio, {
    quantity: "1",
    costBasis: "200",
    acquiredAt: "2026-02-01",
    sourceName: "Ledger",
    sourceType: "wallet",
  });
  lotC = await insertLot(t.db, portfolio, { quantity: "3", costBasis: "300", acquiredAt: "2026-03-01" });
});

type Sale = {
  sale_id: string;
  proceeds: string;
  cost_basis: string;
  realized_gain: string;
  method: string;
  lots_consumed: Array<{ holding_id: string; quantity: string; fee: string; cost: string }>;
};

function sell(
  userId: string | null,
  args: { quantity: string; price: string; method?: string; source?: string; portfolioId?: string },
) {
  return t.as(userId, async (db) => {
    const { rows } = await db.query<{ r: Sale }>(
      "select public.sell_holding($1, 'BTC', 'crypto', $2, $3, $4, '2026-11-20T00:00:00Z', $5) as r",
      [args.portfolioId ?? portfolio, args.quantity, args.price, args.method ?? "fifo", args.source ?? null],
    );
    return rows[0]!.r;
  });
}

const num = (value: string) => Number(value);

describe("sell_holding", () => {
  it("FIFO consume primero el lote más viejo e imputa su comisión", async () => {
    const sale = await sell(USER_1, { quantity: "2.5", price: "400" });

    expect(sale.lots_consumed.map((lot) => lot.holding_id)).toEqual([lotA, lotB]);
    expect(num(sale.proceeds)).toBe(1000);
    expect(num(sale.cost_basis)).toBe(302);
    expect(num(sale.realized_gain)).toBe(698);
    expect(await readLot(t.db, lotA)).toMatchObject({ quantity: "0", fee: "0" });
    expect(num((await readLot(t.db, lotB))!.quantity)).toBe(0.5);
  });

  it("LIFO consume primero el lote más nuevo", async () => {
    const sale = await sell(USER_1, { quantity: "4", price: "400", method: "lifo" });

    expect(sale.method).toBe("lifo");
    expect(sale.lots_consumed.map((lot) => lot.holding_id)).toEqual([lotC, lotB]);
    expect(num(sale.cost_basis)).toBe(1100);
    expect((await readLot(t.db, lotA))!.quantity).toBe("2");
  });

  it("devuelve los montos como texto para no perder precisión", async () => {
    const sale = await sell(USER_1, { quantity: "0.1", price: "3000.123456789012345678" });

    expect(typeof sale.proceeds).toBe("string");
    expect(sale.proceeds).toBe("300.0123456789012345678");
  });

  it("imputa la comisión en forma proporcional y deja el resto en el lote", async () => {
    const sale = await sell(USER_1, { quantity: "0.5", price: "100" });

    expect(num(sale.lots_consumed[0]!.fee)).toBe(0.5);
    expect(num(sale.cost_basis)).toBe(50.5);
    expect(num((await readLot(t.db, lotA))!.fee!)).toBe(1.5);
  });

  it("con sede solo consume lotes de esa sede", async () => {
    const sale = await sell(USER_1, { quantity: "1", price: "250", source: " ledger " });

    expect(sale.lots_consumed.map((lot) => lot.holding_id)).toEqual([lotB]);
    expect(num(sale.realized_gain)).toBe(50);
  });

  it("registra la venta y la transacción sell", async () => {
    const sale = await sell(USER_1, { quantity: "1", price: "150" });

    const { rows } = await t.db.query<{ id: string; method: string; type: string; price: string }>(
      `select s.id, s.method, t.type, t.price::text
       from public.sales s join public.transactions t on t.notes like '%' || s.id || '%'`,
    );
    expect(rows).toEqual([{ id: sale.sale_id, method: "fifo", type: "sell", price: "150" }]);
  });

  it("no vuelve a consumir lotes agotados", async () => {
    await sell(USER_1, { quantity: "2", price: "1" });
    const sale = await sell(USER_1, { quantity: "1", price: "1" });

    expect(sale.lots_consumed.map((lot) => lot.holding_id)).toEqual([lotB]);
  });

  it.each([
    ["cantidad insuficiente", { quantity: "7", price: "1" }, "22023"],
    ["cantidad 0", { quantity: "0", price: "1" }, "22023"],
    ["precio negativo", { quantity: "1", price: "-1" }, "22023"],
    ["método inválido", { quantity: "1", price: "1", method: "promedio" }, "22023"],
  ])("rechaza %s sin modificar nada", async (_case, args, code) => {
    expect(await sqlState(sell(USER_1, args))).toBe(code);
    expect((await readLot(t.db, lotA))!.quantity).toBe("2");
    expect(await count(t.db, "sales")).toBe(0);
  });

  it("rechaza vender un lote sin costo base y no lo modifica", async () => {
    await t.db.query("update public.holdings set cost_basis = null where id = $1", [lotA]);

    expect(await sqlState(sell(USER_1, { quantity: "1", price: "1" }))).toBe("22023");
    expect((await readLot(t.db, lotA))!.quantity).toBe("2");
  });

  it("no deja vender en el portfolio de otro usuario ni sin sesión", async () => {
    expect(await sqlState(sell(USER_2, { quantity: "1", price: "1" }))).toBe("P0002");
    expect(await sqlState(sell(null, { quantity: "1", price: "1" }))).toBe("42501");
    expect(await count(t.db, "sales")).toBe(0);
  });
});
