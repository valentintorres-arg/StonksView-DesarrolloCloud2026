#!/usr/bin/env node
// Genera los archivos de entorno para desarrollo local a partir de las
// variables del repo en GitHub:
//
//   .env                 -> SUPABASE_URL, SUPABASE_ANON_KEY (API local y Lambdas)
//   frontend/.env.local  -> NEXT_PUBLIC_API_URL, NEXT_PUBLIC_SUPABASE_URL,
//                           NEXT_PUBLIC_SUPABASE_ANON_KEY
//
// Uso (desde la raíz del repo, con `gh auth login` hecho):
//
//   node scripts/setup-env.mjs
//
// Solo lee variables públicas: los secrets de GitHub (service_role,
// DATABASE_URL, Groq) no se pueden leer fuera de Actions y se comparten por
// canal seguro. Si los archivos ya existen, actualiza solo estas claves y
// deja el resto como está (por ejemplo, un DATABASE_URL cargado a mano).
//
// Una variable de entorno con el mismo nombre tiene prioridad sobre la de
// GitHub (útil si no tenés acceso al repo con gh).

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LOCAL_API_URL = "http://localhost:3001";

function fromGitHub(name) {
  if (process.env[name]) return process.env[name];
  try {
    return execFileSync("gh", ["variable", "get", name], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    const detail = error.code === "ENOENT" ? "no se encontró el comando gh" : String(error.stderr ?? error.message).trim();
    throw new Error(`No se pudo leer la variable ${name} del repo: ${detail}`);
  }
}

// Reemplaza o agrega cada clave en un archivo .env, conservando el resto.
function upsertEnvFile(path, header, values) {
  const lines = existsSync(path) ? readFileSync(path, "utf8").split(/\r?\n/) : header.split("\n");
  for (const [key, value] of Object.entries(values)) {
    const index = lines.findIndex((line) => line.startsWith(`${key}=`));
    if (index >= 0) lines[index] = `${key}=${value}`;
    else lines.splice(lines.at(-1) === "" ? lines.length - 1 : lines.length, 0, `${key}=${value}`);
  }
  if (lines.at(-1) !== "") lines.push("");
  writeFileSync(path, lines.join("\n"));
  console.log(`✓ ${relative(ROOT, path)} (${Object.keys(values).join(", ")})`);
}

function main() {
  const supabaseUrl = fromGitHub("SUPABASE_URL");
  const anonKey = fromGitHub("SUPABASE_ANON_KEY");
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(supabaseUrl)) {
    throw new Error(`SUPABASE_URL no parece una URL de Supabase: ${supabaseUrl}`);
  }

  upsertEnvFile(
    join(ROOT, ".env"),
    "# Generado por scripts/setup-env.mjs. Ver .env.example.\n# Los secretos (service_role, DATABASE_URL, Groq) se agregan a mano.\n",
    { SUPABASE_URL: supabaseUrl, SUPABASE_ANON_KEY: anonKey },
  );
  upsertEnvFile(
    join(ROOT, "frontend", ".env.local"),
    "# Generado por scripts/setup-env.mjs. Ver frontend/.env.example.\n",
    {
      NEXT_PUBLIC_API_URL: LOCAL_API_URL,
      NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
    },
  );
  console.log("\nListo. Levantá la API con `npm run dev` en backend/ y el frontend con `pnpm dev` en frontend/.");
}

try {
  main();
} catch (error) {
  console.error(`✗ ${error.message}`);
  console.error("Revisá que estés logueado (`gh auth status`) y que las variables existan (`gh variable list`).");
  process.exit(1);
}
