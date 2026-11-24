// Integración de transfer_holding contra Postgres (PGlite) con las
// migraciones reales y RLS activo. Tarea 2.2: "la transferencia conserva
// costo base y fecha".

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { count, insertLot, insertPortfolio, readLot, USER_1, USER_2 } from "./fixtures";
import { createTestDb, sqlState, type TestDb } from "./testdb";

let t: TestDb;
let portfolio: string;

beforeAll(async () => {
  t = await createTestDb();
}, 60_000);

beforeEach(async () => {
  await t.reset();
  portfolio = await insertPortfolio(t.db, USER_1);
});

type TransferResult = { transfer_id: string; to_holding_id: string; merged: boolean; relocated: boolean };

function transfer(userId: string | null, holdingId: string, quantity: string, toSource: string, toType?: string) {
  return t.as(userId, async (db) => {
    const { rows } = await db.query<{ r: TransferResult }>(
      "select public.transfer_holding($1, $2, $3, $4) as r",
      [holdingId, quantity, toSource, toType ?? null],
    );
    return rows[0]!.r;
  });
}

describe("transfer_holding", () => {
  it("transferencia parcial: crea un lote nuevo con el mismo costo por unidad y la misma fecha", async () => {
    const lot = await insertLot(t.db, portfolio, {
      quantity: "2",
      costBasis: "30000",
      fee: "10",
      acquiredAt: "2026-03-15",
    });

    const r = await transfer(USER_1, lot, "0.5", "Ledger", "wallet");

    expect(r).toMatchObject({ merged: false, relocated: false });
    expect(await readLot(t.db, lot)).toMatchObject({ quantity: "1.5", cost_basis: "30000", fee: "10" });
    expect(await readLot(t.db, r.to_holding_id)).toMatchObject({
      quantity: "0.5",
      cost_basis: "30000",
      fee: null,
      source_name: "Ledger",
      source_type: "wallet",
      acquired_at: "2026-03-15",
    });
  });

  it("una segunda transferencia del mismo lote se suma al lote destino", async () => {
    const lot = await insertLot(t.db, portfolio, { quantity: "2", costBasis: "100", acquiredAt: "2026-01-01" });

    const first = await transfer(USER_1, lot, "0.5", "Ledger", "wallet");
    const second = await transfer(USER_1, lot, "0.5", " ledger ", "wallet");

    expect(second).toMatchObject({ merged: true, to_holding_id: first.to_holding_id });
    expect(await readLot(t.db, first.to_holding_id)).toMatchObject({ quantity: "1.0", source_name: "Ledger" });
  });

  it("no mezcla lotes con distinto costo por unidad", async () => {
    const cheap = await insertLot(t.db, portfolio, { quantity: "1", costBasis: "100", acquiredAt: "2026-01-01" });
    const ledgerLot = await insertLot(t.db, portfolio, {
      quantity: "1",
      costBasis: "200",
      acquiredAt: "2026-01-01",
      sourceName: "Ledger",
      sourceType: "wallet",
    });

    const r = await transfer(USER_1, cheap, "0.5", "Ledger", "wallet");

    expect(r.merged).toBe(false);
    expect(r.to_holding_id).not.toBe(ledgerLot);
  });

  it("transferencia total: reubica el mismo lote y conserva su comisión", async () => {
    const lot = await insertLot(t.db, portfolio, { quantity: "1", costBasis: "500", fee: "3", acquiredAt: "2026-02-01" });

    const r = await transfer(USER_1, lot, "1", "IOL", "broker");

    expect(r).toMatchObject({ relocated: true, to_holding_id: lot });
    expect(await readLot(t.db, lot)).toMatchObject({
      quantity: "1",
      cost_basis: "500",
      fee: "3",
      source_name: "IOL",
      acquired_at: "2026-02-01",
    });
  });

  it("no altera la cantidad ni el costo total del portfolio y no genera ventas", async () => {
    await insertLot(t.db, portfolio, { quantity: "3", costBasis: "10", fee: "1" });
    const lot = await insertLot(t.db, portfolio, { quantity: "2", costBasis: "20" });
    const totals = () =>
      t.db.query<{ q: string; c: string }>(
        // trim_scale: 5.00 y 5 son el mismo monto con distinta escala.
        "select trim_scale(sum(quantity))::text as q, " +
          "trim_scale(sum(quantity * cost_basis + coalesce(fee, 0)))::text as c from public.holdings",
      );
    const before = (await totals()).rows[0];

    await transfer(USER_1, lot, "1.25", "Ledger", "wallet");

    expect((await totals()).rows[0]).toEqual(before);
    expect(await count(t.db, "sales")).toBe(0);
    expect(await count(t.db, "transfers")).toBe(1);
    const { rows } = await t.db.query<{ type: string }>("select type from public.transactions order by type");
    expect(rows.map((row) => row.type)).toEqual(["transfer_in", "transfer_out"]);
  });

  it.each([
    ["cantidad mayor al lote", "5", "Ledger", "22023"],
    ["cantidad 0", "0", "Ledger", "22023"],
    ["misma sede", "1", " binance ", "22023"],
    ["sede vacía", "1", "  ", "22023"],
  ])("rechaza %s sin modificar nada", async (_case, quantity, toSource, code) => {
    const lot = await insertLot(t.db, portfolio, { quantity: "2", costBasis: "1" });

    expect(await sqlState(transfer(USER_1, lot, quantity, toSource))).toBe(code);
    expect(await readLot(t.db, lot)).toMatchObject({ quantity: "2", source_name: "Binance" });
    expect(await count(t.db, "transfers")).toBe(0);
  });

  it("no deja transferir un holding de otro usuario ni sin sesión", async () => {
    const lot = await insertLot(t.db, portfolio, { quantity: "2", costBasis: "1" });

    expect(await sqlState(transfer(USER_2, lot, "1", "Ledger"))).toBe("P0002");
    expect(await sqlState(transfer(null, lot, "1", "Ledger"))).toBe("42501");
    expect(await readLot(t.db, lot)).toMatchObject({ quantity: "2" });
  });
});
