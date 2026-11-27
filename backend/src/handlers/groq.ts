// Cliente de Groq (API compatible con la de OpenAI) para el insight (tarea
// 4.2). Modelo open-source servido por Groq; se elige con GROQ_MODEL.
// El timeout es el de RN-35: si vence, el insight queda no_disponible.

import type { ChatMessage, Llm } from "../core/insights";

export const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
export const DEFAULT_GROQ_MODEL = "llama-3.3-70b-versatile";
export const LLM_TIMEOUT_MS = 10_000;

export function groqLlm(
  apiKey: string,
  model = DEFAULT_GROQ_MODEL,
  fetchImpl: typeof fetch = fetch,
  // Solo para los tests de resiliencia (tarea 4.6): simular un Groq colgado
  // sin esperar los 10 s reales.
  timeoutMs = LLM_TIMEOUT_MS,
): Llm {
  return async (messages: ChatMessage[]) => {
    const response = await fetchImpl(GROQ_URL, {
      method: "POST",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model, messages, temperature: 0.2, max_tokens: 300 }),
    });
    if (!response.ok) throw new Error(`Groq respondió ${response.status}`);
    const body = (await response.json()) as { choices?: Array<{ message?: { content?: unknown } }> };
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) throw new Error("Groq devolvió una respuesta vacía");
    return content;
  };
}

// null si no hay API key: el insight queda no_disponible sin llamar a nadie.
export function groqFromEnv(): Llm | null {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;
  return groqLlm(apiKey, process.env.GROQ_MODEL || DEFAULT_GROQ_MODEL);
}
