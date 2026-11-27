// RLS de ai_insights (tarea 4.2): el límite diario cuenta las filas que el
// usuario puede ver, así que solo tienen que ser las de sus portfolios; y
// nadie puede guardar un insight en un portfolio ajeno ni editarlo después.

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { insertPortfolio, USER_1, USER_2 } from "./fixtures";
import { createTestDb, sqlState, type TestDb } from "./testdb";

let t: TestDb;
let p1: string;
let p1b: string;
let p2: string;

beforeAll(async () => {
  t = await createTestDb();
}, 60_000);

beforeEach(async () => {
  await t.reset();
  p1 = await insertPortfolio(t.db, USER_1, "Principal");
  p1b = await insertPortfolio(t.db, USER_1, "Familiar");
  p2 = await insertPortfolio(t.db, USER_2, "De usuario 2");
});

const run = (userId: string, sql: string, params: unknown[] = []) =>
  t.as(userId, async (db) => (await db.query(sql, params)).rows);

const insertInsight = (userId: string, portfolioId: string, estado = "ok") =>
  run(
    userId,
    `insert into public.ai_insights (portfolio_id, contexto_enviado, respuesta_texto, estado)
     values ($1, '{}', 'texto', $2)`,
    [portfolioId, estado],
  );

describe("ai_insights", () => {
  it("el conteo del día incluye todos los portfolios del usuario y ninguno ajeno", async () => {
    await insertInsight(USER_1, p1);
    await insertInsight(USER_1, p1b, "no_disponible");
    await insertInsight(USER_2, p2);

    const countFor = async (userId: string) =>
      (await run(userId, "select count(*)::int as n from public.ai_insights where created_at >= now() - interval '1 day'"))[0];
    expect(await countFor(USER_1)).toEqual({ n: 2 });
    expect(await countFor(USER_2)).toEqual({ n: 1 });
  });

  it("no se puede guardar un insight en el portfolio de otro", async () => {
    expect(await sqlState(insertInsight(USER_2, p1))).toBe("42501");
  });

  it("es append-only: no se puede editar ni borrar", async () => {
    await insertInsight(USER_1, p1);
    expect(await sqlState(run(USER_1, "update public.ai_insights set respuesta_texto = 'otro'"))).toBe("42501");
    expect(await sqlState(run(USER_1, "delete from public.ai_insights"))).toBe("42501");
  });
});
