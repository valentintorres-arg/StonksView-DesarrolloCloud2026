import { describe, expect, it } from "vitest";
import { ping } from "./ping";

describe("ping", () => {
  it("devuelve status ok con el timestamp en ISO", () => {
    const now = new Date("2026-11-23T12:00:00.000Z");
    expect(ping(now)).toEqual({
      status: "ok",
      timestamp: "2026-11-23T12:00:00.000Z",
    });
  });
});
