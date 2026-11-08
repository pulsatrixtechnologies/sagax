// #2915: which relay a finished turn takes; a background reply is mirrored
// only when no attention card, late run or incidents copy already carried it.
import { describe, expect, it, vi } from "vitest";

import { relayFinishedTurn } from "./turn-completed.ts";

const steps = (posted: boolean, reason?: string, late = false, background = true) => ({
  attention: vi.fn(() => ({ posted, reason })),
  lateRun: vi.fn(() => late),
  background: vi.fn(() => background),
});

describe("relayFinishedTurn (#2915)", () => {
  it("stops at an attention card", () => {
    const s = steps(true);
    expect(relayFinishedTurn(s, false)).toBe("attention");
    expect(s.lateRun).not.toHaveBeenCalled();
    expect(s.background).not.toHaveBeenCalled();
  });
  it("posts nothing more for a muted kind", () => {
    const s = steps(false, "muted");
    expect(relayFinishedTurn(s, false)).toBe("muted");
    expect(s.background).not.toHaveBeenCalled();
  });
  it("lets a late run's reply or an incidents copy carry the turn", () => {
    expect(relayFinishedTurn(steps(false, undefined, true), false)).toBe("late-run");
    const s = steps(false);
    expect(relayFinishedTurn(s, true)).toBe("incidents");
    expect(s.background).not.toHaveBeenCalled();
  });
  it("mirrors the background reply otherwise", () => {
    expect(relayFinishedTurn(steps(false), false)).toBe("background");
    expect(relayFinishedTurn(steps(false, undefined, false, false), false)).toBe("none");
  });
});
