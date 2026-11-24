// Base Postgres en memoria (PGlite) para los tests de integración (tarea 2.2).
//
// Aplica las migraciones reales de prisma/migrations en orden, sobre un
// entorno que imita lo mínimo de Supabase que usan: los roles anon,
// authenticated y service_role, y auth.uid() leyendo el `sub` de
// request.jwt.claims (la misma definición que usa Supabase). Así las
// funciones y las políticas RLS se prueban tal cual están en producción,
// sin red ni credenciales.
//
// Solo para tests: no lo importa ningún handler.

import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../prisma/migrations", import.meta.url));

const SUPABASE_SHIM = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  grant usage on schema public to anon, authenticated, service_role;

  create schema auth;
  grant usage on schema auth to anon, authenticated, service_role;
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(
      coalesce(
        nullif(current_setting('request.jwt.claim.sub', true), ''),
        nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
      ),
      ''
    )::uuid
  $$;
`;

export type Role = "anon" | "authenticated";

export interface TestDb {
  db: PGlite;
  // Corre `fn` en una transacción como el usuario indicado, con RLS activo.
  // Con userId null corre como anon (sin sesión). Si `fn` falla, hace
  // rollback y relanza el error.
  as<T>(userId: string | null, fn: (db: PGlite) => Promise<T>): Promise<T>;
  // Borra todos los datos de dominio (como superusuario).
  reset(): Promise<void>;
}

export function migrationNames(): string[] {
  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
}

export async function createTestDb(): Promise<TestDb> {
  const db = new PGlite();
  await db.exec(SUPABASE_SHIM);
  for (const name of migrationNames()) {
    await db.exec(readFileSync(join(MIGRATIONS_DIR, name, "migration.sql"), "utf8"));
  }

  return {
    db,
    async as(userId, fn) {
      await db.exec("begin");
      try {
        if (userId) {
          await db.query("select set_config('request.jwt.claims', $1, true)", [
            JSON.stringify({ sub: userId, role: "authenticated" }),
          ]);
        }
        await db.exec(`set local role ${userId ? "authenticated" : "anon"}`);
        const result = await fn(db);
        await db.exec("commit");
        return result;
      } catch (error) {
        await db.exec("rollback");
        throw error;
      }
    },
    async reset() {
      await db.exec(
        "truncate public.sales, public.transfers, public.transactions, public.snapshots, " +
          "public.price_alerts, public.ai_insights, public.holdings, public.portfolios, " +
          "public.push_subscriptions, public.news_watches, public.price_cache cascade",
      );
    },
  };
}

// Código SQLSTATE del error que lanza `promise`, o null si no falla.
export async function sqlState(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    return (error as { code?: string }).code ?? "sin-codigo";
  }
}
