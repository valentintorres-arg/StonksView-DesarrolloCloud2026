// El CRUD de portfolios/holdings (core) contra Postgres con RLS: un
// PortfolioStore en SQL que hace lo mismo que el de Supabase, ejecutado como
// el usuario. Verifica los supuestos del core sobre los errores de la base:
// RLS rechaza el alta en un portfolio ajeno con 42501, un UPDATE/DELETE
// ajeno no afecta filas y borrar un lote transferido viola la FK (23503).

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createHolding,
  createPortfolio,
  deleteHolding,
  listHoldings,
  listPortfolios,
  updateHolding,
} from "../core/portfolios";
import { insertLot, insertPortfolio, readLot, USER_1, USER_2 } from "./fixtures";
import { sqlPortfolioStore } from "./sql-store";
import { createTestDb, type TestDb } from "./testdb";

let t: TestDb;
let p1: string;

beforeAll(async () => {
  t = await createTestDb();
}, 60_000);

beforeEach(async () => {
  await t.reset();
  p1 = await insertPortfolio(t.db, USER_1, "Principal");
});

const sqlStore = (userId: string) => sqlPortfolioStore(t, userId);

const noop = () => undefined;
const holding = {
  symbol: "eth",
  assetClass: "crypto",
  quantity: "1.123456789012345678",
  costBasis: "2500.5",
  sourceType: "wallet",
  sourceName: "Ledger",
  acquiredAt: "2026-05-01",
};

describe("CRUD contra Postgres con RLS", () => {
  it("un usuario autenticado crea y lista holdings (criterio de la 1.7)", async () => {
    const created = await createHolding(p1, holding, sqlStore(USER_1), noop);
    expect(created).toMatchObject({ status: 201, body: { symbol: "ETH", quantity: "1.123456789012345678" } });

    const listed = await listHoldings(p1, false, sqlStore(USER_1), noop);
    expect(listed.status).toBe(200);
    expect(listed.body).toHaveLength(1);
  });

  it("crea un portfolio a nombre del usuario de la sesión", async () => {
    await createPortfolio({ name: "Ahorro" }, sqlStore(USER_2), noop);

    expect((await listPortfolios(sqlStore(USER_2), noop)).body).toMatchObject([{ name: "Ahorro" }]);
    expect((await listPortfolios(sqlStore(USER_1), noop)).body).toMatchObject([{ name: "Principal" }]);
  });

  it("otro usuario no puede cargar, ver, editar ni borrar holdings del portfolio", async () => {
    const lot = await insertLot(t.db, p1, { quantity: "1", costBasis: "1" });
    const other = sqlStore(USER_2);

    expect((await createHolding(p1, holding, other, noop)).status).toBe(404);
    expect((await listHoldings(p1, false, other, noop)).status).toBe(404);
    expect((await updateHolding(lot, { costBasis: "999" }, other, noop)).status).toBe(404);
    expect((await deleteHolding(lot, other, noop)).status).toBe(404);
    expect(await readLot(t.db, lot)).toMatchObject({ quantity: "1", cost_basis: "1" });
  });

  it("el dueño edita el costo base y borra un lote sin historial", async () => {
    const lot = await insertLot(t.db, p1, { quantity: "1", costBasis: "1" });

    expect(await updateHolding(lot, { costBasis: "1.5" }, sqlStore(USER_1), noop)).toMatchObject({
      status: 200,
      body: { costBasis: "1.5" },
    });
    expect((await deleteHolding(lot, sqlStore(USER_1), noop)).status).toBe(204);
    expect(await readLot(t.db, lot)).toBeUndefined();
  });

  it("no deja borrar un lote que tiene transferencias (409)", async () => {
    const lot = await insertLot(t.db, p1, { quantity: "2", costBasis: "1" });
    await t.as(USER_1, (db) => db.query("select public.transfer_holding($1, 1, 'Ledger', 'wallet')", [lot]));

    expect((await deleteHolding(lot, sqlStore(USER_1), noop)).status).toBe(409);
  });

  it("oculta los lotes agotados salvo que se pidan", async () => {
    await insertLot(t.db, p1, { quantity: "0", costBasis: "1" });
    await insertLot(t.db, p1, { quantity: "1", costBasis: "1" });

    expect((await listHoldings(p1, false, sqlStore(USER_1), noop)).body).toHaveLength(1);
    expect((await listHoldings(p1, true, sqlStore(USER_1), noop)).body).toHaveLength(2);
  });
});
