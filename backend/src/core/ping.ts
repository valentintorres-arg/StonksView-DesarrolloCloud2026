// Lógica de dominio: sin dependencias de AWS para poder reutilizarla
// desde otro adaptador (por ejemplo, API routes de Next.js en el Plan B).

export interface PingResult {
  status: "ok";
  timestamp: string;
}

export function ping(now: Date = new Date()): PingResult {
  return { status: "ok", timestamp: now.toISOString() };
}
