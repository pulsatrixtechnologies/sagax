import { afterEach, describe, expect, it, vi } from "vitest";

import {
  armIdleClose, idleEnginesAllowed, keepWarm, sessionIdlePolicy, SMALL_BOX_IDLE_MS, stopIdleClose, warmEngineKeys,
} from "./session-idle.ts";

const GB = 1024 ** 3;
const DESKTOP = 16 * GB;

describe("sessionIdlePolicy", () => {
  it("defaults to ten minutes with a ten-second floor", () => {
    expect(sessionIdlePolicy("CLAUDE", {}, DESKTOP)).toEqual({ idleMs: 10 * 60_000, minimumMs: 10_000 });
    expect(sessionIdlePolicy("ACP", {}, DESKTOP)).toEqual({ idleMs: 10 * 60_000, minimumMs: 10_000 });
  });

  it("keeps an idle engine two and a half minutes on a box of 1.5 GB or less, unless configured", () => {
    expect(sessionIdlePolicy("CLAUDE", {}, 1.5 * GB).idleMs).toBe(SMALL_BOX_IDLE_MS);
    expect(sessionIdlePolicy("ACP", {}, 512 * 1024 ** 2).idleMs).toBe(SMALL_BOX_IDLE_MS);
    expect(sessionIdlePolicy("ACP", {}, 2 * GB).idleMs).toBe(10 * 60_000);
    expect(sessionIdlePolicy("CLAUDE", { SAGAX_SESSION_IDLE_MS: "600000" }, GB).idleMs).toBe(600_000);
    expect(sessionIdlePolicy("ACP", { SAGAX_ACP_SESSION_IDLE_MIN_MS: "200000" }, GB)).toEqual({ idleMs: 200_000, minimumMs: 200_000 });
  });

  it("honors each harness's own legacy names", () => {
    expect(sessionIdlePolicy("CLAUDE", { SAGAX_CLAUDE_SESSION_IDLE_MS: "120000" }, DESKTOP).idleMs).toBe(120_000);
    expect(sessionIdlePolicy("ACP", { SAGAX_ACP_SESSION_IDLE_MS: "120000" }, DESKTOP).idleMs).toBe(120_000);
    expect(sessionIdlePolicy("CLAUDE", { SAGAX_CLAUDE_SESSION_IDLE_MIN_MS: "30000" }, DESKTOP).minimumMs).toBe(30_000);
    expect(sessionIdlePolicy("ACP", { SAGAX_ACP_SESSION_IDLE_MIN_MS: "30000" }, DESKTOP).minimumMs).toBe(30_000);
  });

  it("lets the unified names set every harness at once, below a per-harness override", () => {
    expect(sessionIdlePolicy("CLAUDE", { SAGAX_SESSION_IDLE_MS: "90000" }, DESKTOP).idleMs).toBe(90_000);
    expect(sessionIdlePolicy("ACP", { SAGAX_SESSION_IDLE_MS: "90000", SAGAX_ACP_SESSION_IDLE_MS: "120000" }, DESKTOP).idleMs).toBe(120_000);
    expect(sessionIdlePolicy("ACP", { SAGAX_SESSION_IDLE_MIN_MS: "4000", SAGAX_ACP_SESSION_IDLE_MIN_MS: "30000" }, DESKTOP).minimumMs).toBe(30_000);
    expect(sessionIdlePolicy("CLAUDE", { SAGAX_SESSION_IDLE_MIN_MS: "4000" }, DESKTOP).minimumMs).toBe(10_000);
  });

  it("never floors below ten seconds, however low the configured minimum", () => {
    expect(sessionIdlePolicy("CLAUDE", { SAGAX_CLAUDE_SESSION_IDLE_MIN_MS: "2000" }, DESKTOP).minimumMs).toBe(10_000);
    expect(
      sessionIdlePolicy("CLAUDE", { SAGAX_CLAUDE_SESSION_IDLE_MS: "15000", SAGAX_CLAUDE_SESSION_IDLE_MIN_MS: "2000" }, DESKTOP).idleMs,
    ).toBe(15_000);
    expect(
      sessionIdlePolicy("ACP", { SAGAX_ACP_SESSION_IDLE_MS: "1", SAGAX_ACP_SESSION_IDLE_MIN_MS: "2000" }, DESKTOP).idleMs,
    ).toBe(10_000);
    expect(sessionIdlePolicy("ACP", { SAGAX_SESSION_IDLE_MIN_MS: "-5" }, DESKTOP).minimumMs).toBe(10_000);
  });

  it("rejects unusable delays before the floor instead of coercing them to a 1 ms timer", () => {
    for (const raw of ["not-a-number", "0", "-5", "", "Infinity", "1e309", "2147483648"]) {
      expect(sessionIdlePolicy("CLAUDE", { SAGAX_CLAUDE_SESSION_IDLE_MS: raw }, DESKTOP).idleMs).toBe(10 * 60_000);
      expect(sessionIdlePolicy("ACP", { SAGAX_SESSION_IDLE_MS: raw }, DESKTOP).idleMs).toBe(10 * 60_000);
    }
    expect(sessionIdlePolicy("CLAUDE", { SAGAX_CLAUDE_SESSION_IDLE_MS: "2147483647" }, DESKTOP).idleMs).toBe(2_147_483_647);
    expect(sessionIdlePolicy("ACP", { SAGAX_ACP_SESSION_IDLE_MIN_MS: "Infinity" }, DESKTOP).minimumMs).toBe(10_000);
  });
});

describe("idle engines on a small box", () => {
  const small = { bytes: GB };
  const engine = (busy = false) => {
    const state = { busy, closed: 0 };
    return { state, warm: { idle: () => !state.busy, close: () => { state.closed += 1; } } };
  };
  afterEach(() => { for (const key of warmEngineKeys()) stopIdleClose(key, null); });

  it("allows one idle engine once less than half of a small box is free, and any number otherwise", () => {
    expect(idleEnginesAllowed(small, 0.4 * GB)).toBe(1);
    expect(idleEnginesAllowed(small, 0.6 * GB)).toBe(Infinity);
    expect(idleEnginesAllowed({ bytes: DESKTOP }, 0)).toBe(Infinity);
  });

  it("closes the engine idle longest when another goes idle and memory is tight, never a busy one", () => {
    const [a, b, c] = [engine(), engine(true), engine()];
    keepWarm("a", a.warm, small, () => 0.6 * GB);
    keepWarm("b", b.warm, small, () => 0.6 * GB);
    expect(a.state.closed).toBe(0);
    keepWarm("c", c.warm, small, () => 0.3 * GB);
    expect([a.state.closed, b.state.closed, c.state.closed]).toEqual([1, 0, 0]);
    expect(warmEngineKeys()).toEqual(["c"]);
  });

  it("keeps every idle engine on a large box, and forgets one once it closes or works again", () => {
    const [a, b] = [engine(), engine()];
    keepWarm("a", a.warm, { bytes: DESKTOP }, () => 0);
    keepWarm("b", b.warm, { bytes: DESKTOP }, () => 0);
    expect([a.state.closed, b.state.closed, warmEngineKeys()]).toEqual([0, 0, []]);
    keepWarm("a", a.warm, small, () => 0.6 * GB);
    stopIdleClose("a", null);
    keepWarm("b", b.warm, small, () => 0.1 * GB);
    expect(a.state.closed).toBe(0);
  });

  it("closes on its timer like any idle engine", () => {
    vi.useFakeTimers();
    try {
      const a = engine();
      const timer = armIdleClose("a", 150_000, a.warm);
      vi.advanceTimersByTime(149_999);
      expect(a.state.closed).toBe(0);
      vi.advanceTimersByTime(1);
      expect(a.state.closed).toBe(1);
      stopIdleClose("a", timer);
    } finally {
      vi.useRealTimers();
    }
  });
});
