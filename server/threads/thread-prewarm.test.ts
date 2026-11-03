import { afterEach, describe, expect, it, vi } from "vitest";
import { namedTeammates, prewarmWindowMs, ThreadPrewarm } from "./thread-prewarm.ts";

afterEach(() => vi.useRealTimers());

describe("ThreadPrewarm", () => {
  it("aborts the warm when nothing is sent within the window, and a refresh pushes it back", async () => {
    vi.useFakeTimers();
    const warm = new ThreadPrewarm({ windowMs: 1_000 });
    let signal: AbortSignal | null = null;
    expect(warm.begin("t1", "p", async (s) => { signal = s; })).toBe("started");
    await warm.join("t1");
    vi.advanceTimersByTime(800);
    expect(warm.begin("t1", "p", async () => { throw new Error("never runs twice"); })).toBe("extended");
    vi.advanceTimersByTime(800);
    expect(signal!.aborted).toBe(false);
    vi.advanceTimersByTime(300);
    expect(signal!.aborted).toBe(true);
    expect(warm.has("t1")).toBe(false);
  });

  it("a real turn claims the warm without aborting it", async () => {
    vi.useFakeTimers();
    const warm = new ThreadPrewarm({ windowMs: 1_000 });
    let signal: AbortSignal | null = null;
    warm.begin("t1", "p", async (s) => { signal = s; });
    await warm.join("t1");
    warm.claim("t1");
    vi.advanceTimersByTime(5_000);
    expect(signal!.aborted).toBe(false);
    expect(warm.has("t1")).toBe(false);
  });

  it("evicts the warm used longest ago, not the one the person keeps refreshing", () => {
    const warm = new ThreadPrewarm({ windowMs: 60_000, maxWaiting: 2 });
    const aborted: string[] = [];
    const run = (id: string) => async (s: AbortSignal) => { s.addEventListener("abort", () => aborted.push(id)); };
    warm.begin("a", "p1", run("a"));
    warm.begin("b", "p2", run("b"));
    expect(warm.begin("a", "p1", run("a"))).toBe("extended");
    warm.begin("c", "p3", run("c"));
    expect(aborted).toEqual(["b"]);
    expect(warm.has("a")).toBe(true);
  });

  it("limits new warms per person per minute; refreshes are free", () => {
    let now = 0;
    const warm = new ThreadPrewarm({ windowMs: 1_000, perPersonPerMinute: 2, now: () => now });
    expect(warm.begin("a", "p", async () => {})).toBe("started");
    expect(warm.begin("b", "p", async () => {})).toBe("started");
    expect(warm.begin("c", "p", async () => {})).toBe("limited");
    expect(warm.begin("a", "p", async () => {})).toBe("extended");
    expect(warm.begin("c", "q", async () => {})).toBe("started");
    now = 61_000;
    expect(warm.begin("d", "p", async () => {})).toBe("started");
    for (const id of ["a", "b", "c", "d"]) warm.cancel(id);
  });

  it("keeps at most maxWaiting warms: a new one closes the oldest", () => {
    const warm = new ThreadPrewarm({ windowMs: 60_000, maxWaiting: 2 });
    const signals: Record<string, AbortSignal> = {};
    for (const id of ["a", "b", "c"]) warm.begin(id, "p", async (s) => { signals[id] = s; });
    expect(signals.a!.aborted).toBe(true);
    expect(signals.b!.aborted).toBe(false);
    expect(warm.size()).toBe(2);
    for (const id of ["b", "c"]) warm.cancel(id);
  });

  it("join waits for the setup of the warm in flight", async () => {
    const warm = new ThreadPrewarm({ windowMs: 60_000 });
    let release!: () => void;
    warm.begin("t1", "p", () => new Promise<void>((resolve) => { release = resolve; }));
    let joined = false;
    const waiting = warm.join("t1").then(() => { joined = true; });
    await Promise.resolve();
    expect(joined).toBe(false);
    release();
    await waiting;
    expect(joined).toBe(true);
    warm.cancel("t1");
  });

  it("reads the window from SAGAX_PREWARM_WINDOW_MS, bounded", () => {
    expect(prewarmWindowMs({})).toBe(90_000);
    expect(prewarmWindowMs({ SAGAX_PREWARM_WINDOW_MS: "5000" })).toBe(5_000);
    expect(prewarmWindowMs({ SAGAX_PREWARM_WINDOW_MS: "99999999" })).toBe(600_000);
    expect(prewarmWindowMs({ SAGAX_PREWARM_WINDOW_MS: "nope" })).toBe(90_000);
  });
});

describe("namedTeammates", () => {
  const beta = { id: "b", name: "Beta" };
  const max = { id: "m", name: "Max" };
  const al = { id: "a", name: "Al" };
  const ghost = { id: "g", name: "Ghost", hidden: true };
  it("finds a teammate named as a whole word, @mentions first, at most two", () => {
    expect(namedTeammates("Demande à ton coéquipier Beta la capitale", [beta, max], [])).toEqual([beta]);
    expect(namedTeammates("Betamax ou alphabet ? demande à max.", [beta, max], [])).toEqual([max]);
    expect(namedTeammates("@Max puis Beta", [beta, max, { id: "c", name: "Gamma" }], [max])).toEqual([max, beta]);
    expect(namedTeammates("beta gamma max", [beta, max, { id: "c", name: "Gamma" }], [])).toHaveLength(2);
  });
  it("never a short name or a hidden bot", () => {
    expect(namedTeammates("Al, Ghost", [al, ghost], [ghost])).toEqual([]);
  });
});
