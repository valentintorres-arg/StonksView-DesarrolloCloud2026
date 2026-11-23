import { describe, expect, it, vi } from "vitest";
import { checkHealth } from "./health";

const now = () => new Date("2026-11-23T12:00:00.000Z");

describe("checkHealth", () => {
  it("devuelve ok cuando la base responde", async () => {
    const result = await checkHealth(async () => undefined, { now });

    expect(result).toEqual({
      status: "ok",
      checks: { database: "ok" },
      timestamp: "2026-11-23T12:00:00.000Z",
    });
  });

  it("devuelve error y reporta la causa cuando la consulta falla", async () => {
    const cause = new Error("connection refused");
    const onError = vi.fn();

    const result = await checkHealth(
      async () => {
        throw cause;
      },
      { now, onError },
    );

    expect(result.status).toBe("error");
    expect(result.checks.database).toBe("error");
    expect(onError).toHaveBeenCalledWith(cause);
  });

  it("devuelve error y aborta la consulta si la base no responde a tiempo", async () => {
    let signal: AbortSignal | undefined;
    const onError = vi.fn();

    const result = await checkHealth(
      (s) => {
        signal = s;
        return new Promise(() => undefined);
      },
      { now, onError, timeoutMs: 10 },
    );

    expect(result.status).toBe("error");
    expect(signal?.aborted).toBe(true);
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "La base no respondió en 10 ms" }),
    );
  });
});
