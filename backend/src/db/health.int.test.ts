// GET /health corre sin usuario (clave anon). La función health_check tiene
// que responder para anon sin abrirle ninguna tabla.

import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, sqlState, type TestDb } from "./testdb";

let t: TestDb;

beforeAll(async () => {
  t = await createTestDb();
}, 60_000);

describe("health_check", () => {
  it("responde true para anon (sin sesión)", async () => {
    const rows = await t.as(null, async (db) => (await db.query<{ ok: boolean }>("select public.health_check() as ok")).rows);
    expect(rows).toEqual([{ ok: true }]);
  });

  it("no le abre ninguna tabla a anon", async () => {
    for (const table of ["price_cache", "portfolios", "holdings"]) {
      expect(await sqlState(t.as(null, (db) => db.query(`select 1 from public.${table} limit 1`)))).toBe("42501");
    }
  });
});
