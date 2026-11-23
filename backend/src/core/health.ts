// Lógica de dominio del chequeo de salud: sin dependencias de AWS ni de
// Supabase. La forma de consultar la base se inyecta como `probe`, así el
// mismo chequeo sirve para otro adaptador (Plan B) y se testea sin red.

export type CheckStatus = "ok" | "error";

export interface HealthResult {
  status: CheckStatus;
  checks: { database: CheckStatus };
  timestamp: string;
}

// Hace una consulta mínima contra la base. Rechaza si no hay conexión.
// Recibe una señal que se aborta cuando vence el timeout.
export type DatabaseProbe = (signal: AbortSignal) => Promise<void>;

export interface HealthOptions {
  timeoutMs?: number;
  now?: () => Date;
  onError?: (error: unknown) => void;
}

export const DEFAULT_TIMEOUT_MS = 3000;

export async function checkHealth(
  probe: DatabaseProbe,
  {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    now = () => new Date(),
    onError,
  }: HealthOptions = {},
): Promise<HealthResult> {
  const database = await runProbe(probe, timeoutMs, onError);
  return {
    status: database,
    checks: { database },
    timestamp: now().toISOString(),
  };
}

async function runProbe(
  probe: DatabaseProbe,
  timeoutMs: number,
  onError?: (error: unknown) => void,
): Promise<CheckStatus> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`La base no respondió en ${timeoutMs} ms`);
      controller.abort(error);
      reject(error);
    }, timeoutMs);
  });

  try {
    await Promise.race([probe(controller.signal), timeout]);
    return "ok";
  } catch (error) {
    onError?.(error);
    return "error";
  } finally {
    clearTimeout(timer);
  }
}
