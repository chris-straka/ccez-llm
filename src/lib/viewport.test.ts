import { describe, it, expect } from "vitest";
import { emptyViewport } from "./viewport";

describe("emptyViewport", () => {
  it("starts pinned, unheld, uncached", () => {
    expect(emptyViewport()).toEqual({
      stick: true,
      holding: false,
      hold: null,
      holdSeq: 0,
      idleTimer: undefined,
      lastStreamLen: 0,
    });
  });

  it("hands out independent states", () => {
    const a = emptyViewport();
    const b = emptyViewport();
    a.stick = false;
    a.lastStreamLen = 42;
    a.holdSeq = 7;
    expect(b.stick).toBe(true);
    expect(b.lastStreamLen).toBe(0);
    expect(b.holdSeq).toBe(0);
  });
});
