import { describe, expect, it, vi } from "vitest";
import { DEFAULT_GROQ_MODEL, GROQ_URL, groqLlm } from "./groq";

const reply = (content: unknown, status = 200) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status });

describe("groqLlm", () => {
  it("manda los mensajes al endpoint de chat con la API key y devuelve el texto", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => reply("Hola"));
    const llm = groqLlm("gsk_test", undefined, fetchMock as unknown as typeof fetch);

    expect(await llm([{ role: "user", content: "x" }])).toBe("Hola");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(GROQ_URL);
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer gsk_test");
    expect(JSON.parse(init.body as string)).toMatchObject({ model: DEFAULT_GROQ_MODEL, messages: [{ role: "user", content: "x" }] });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("tira error si Groq responde mal o vacío", async () => {
    await expect(groqLlm("k", "m", (async () => reply("x", 429)) as unknown as typeof fetch)([])).rejects.toThrow("429");
    await expect(groqLlm("k", "m", (async () => reply("  ")) as unknown as typeof fetch)([])).rejects.toThrow("vacía");
  });
});
