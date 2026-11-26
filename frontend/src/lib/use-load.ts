"use client";

// Carga de datos de la API con estados de carga y error, compartida por las
// pantallas privadas.

import { useEffect, useState } from "react";
import { ApiError } from "./api";

export type Load<T> = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; data: T };

// Carga `fetcher` al montar y cada vez que cambia `deps` o se llama a
// `reload`. El estado solo se actualiza cuando llega la respuesta (y se
// descarta si el componente ya cambió de datos).
export function useLoad<T>(fetcher: () => Promise<T>, deps: unknown[]) {
  const [result, setResult] = useState<Load<T>>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    fetcher().then(
      (data) => active && setResult({ state: "ready", data }),
      (error) => active && setResult({ state: "error", message: errorMessage(error) }),
    );
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, attempt]);

  const reload = () => {
    setResult({ state: "loading" });
    setAttempt((n) => n + 1);
  };
  return [result, setResult, reload] as const;
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 0) {
    return "No se pudo conectar con la API. En desarrollo, corré `npm run dev` en backend/.";
  }
  return error instanceof Error ? error.message : "Ocurrió un error inesperado.";
}
