import { describe, expect, it } from "vitest";

import type { RuntimeEvent } from "../contracts.ts";
import {
  DEFAULT_TURN_MAX_CONTINUATIONS,
  DEFAULT_TURN_MAX_MINUTES,
  DEFAULT_TURN_MAX_STEPS,
  createTurnBudget,
  partialRender,
  turnBudgetConfigSchema,
  turnBudgetSettings,
  type TurnBudgetSettings,
} from "./turn-budget.ts";

const T = "thread-1";
const base = { threadId: T, instanceId: "i1", driver: "d", createdAt: "2026-11-07T00:00:00.000Z", turnId: "turn-1" };
const ev = (event: object) => ({ ...base, ...event }) as unknown as RuntimeEvent;
const tool = (n: number) => ev({ type: "item.started", itemType: "tool", itemId: `tool-${n}`, title: "shell" });

function harness(settings: Partial<TurnBudgetSettings> = {}, language: "fr" | "en" = "fr") {
  let clock = 0;
  const timers: { fire: () => void; at: number; live: boolean }[] = [];
  const steers: string[] = [];
  const stops: string[] = [];
  const posts: string[] = [];
  const notes: string[] = [];
  const budget = createTurnBudget({
    settings: () => ({ enabled: true, maxMinutes: 20, maxSteps: 80, wrapUpAt: 0.75, ...settings }),
    live: () => true,
    canSteer: () => true,
    steer: async (_t, note) => { steers.push(note); return "steered"; },
    interrupt: async (_t, cause) => { stops.push(cause); },
    post: (_t, text) => posts.push(text),
    note: (_t, text) => notes.push(text),
    language: () => language,
    now: () => clock,
    setTimer: (fire, ms) => { const timer = { fire, at: clock + ms, live: true }; timers.push(timer); return timer; },
    clearTimer: (timer) => { (timer as { live: boolean }).live = false; },
    log: () => {},
  });
  const advance = (ms: number) => {
    clock += ms;
    for (const timer of timers.filter((t) => t.live && t.at <= clock)) { timer.live = false; timer.fire(); }
  };
  return { budget, steers, stops, posts, notes, advance };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("turn budget (#2737)", () => {
  it("defaults to a 20 minute and 80 step ceiling, settable per config, bot and env (0 = no ceiling)", () => {
    expect(turnBudgetSettings({}, {})).toEqual({ enabled: true, maxMinutes: DEFAULT_TURN_MAX_MINUTES, maxSteps: DEFAULT_TURN_MAX_STEPS, maxContinuations: DEFAULT_TURN_MAX_CONTINUATIONS, wrapUpAt: 0.75 });
    expect(DEFAULT_TURN_MAX_CONTINUATIONS).toBe(10);
    expect(turnBudgetSettings({ turnBudget: turnBudgetConfigSchema.parse({ maxContinuations: 3 }) }, {}).maxContinuations).toBe(3);
    expect(turnBudgetSettings({}, { SAGAX_TURN_MAX_CONTINUATIONS: "0" }).maxContinuations).toBe(0);
    const cfg = { turnBudget: turnBudgetConfigSchema.parse({ maxMinutes: 45, maxSteps: null, bots: { b1: { maxMinutes: 5 } } }) };
    expect(turnBudgetSettings(cfg, {})).toMatchObject({ maxMinutes: 45 });
    expect(turnBudgetSettings(cfg, {}).maxSteps).toBeUndefined();
    expect(turnBudgetSettings(cfg, {}, "b1").maxMinutes).toBe(5);
    expect(turnBudgetSettings(cfg, { SAGAX_TURN_MAX_MINUTES: "0", SAGAX_TURN_MAX_STEPS: "30" }, "b1")).toMatchObject({ maxSteps: 30 });
    expect(turnBudgetSettings(cfg, { SAGAX_TURN_MAX_MINUTES: "0" }).maxMinutes).toBeUndefined();
    expect(turnBudgetSettings({}, { SAGAX_TURN_BUDGET: "0" }).enabled).toBe(false);
  });

  it("asks once for a partial answer at 75 % of the steps, then stops at the ceiling with a partial render", async () => {
    const h = harness({ maxSteps: 8 });
    h.budget.onEvent(ev({ type: "turn.started" }));
    h.budget.onEvent(ev({ type: "item.completed", itemType: "assistant_text", text: "J'ai trouvé trois billets ouverts." }));
    for (let n = 1; n <= 6; n += 1) h.budget.onEvent(tool(n));
    h.budget.onEvent(tool(6));
    expect(h.steers).toHaveLength(1);
    expect(h.steers[0]).toContain("réponds tout de suite à la personne avec ce que tu as");
    h.budget.onEvent(tool(7));
    expect(h.steers).toHaveLength(1);
    expect(h.stops).toHaveLength(0);
    h.budget.onEvent(tool(8));
    expect(h.stops).toHaveLength(1);
    await flush();
    expect(h.posts).toHaveLength(1);
    expect(h.posts[0]).toContain("Tour arrêté après");
    expect(h.posts[0]).toContain("8 étapes");
    expect(h.posts[0]).toContain("J'ai trouvé trois billets ouverts.");
    expect(h.posts[0]).toContain("« continue »");
    h.budget.onEvent(tool(9));
    expect(h.stops).toHaveLength(1);
  });

  it("stops on active time with no event at all, and does not count time parked on a card", async () => {
    const h = harness({ maxMinutes: 20, maxSteps: undefined }, "en");
    h.budget.onEvent(ev({ type: "turn.started" }));
    h.advance(10 * 60_000);
    h.budget.onEvent(ev({ type: "request.opened", requestId: "r1" }));
    h.advance(60 * 60_000);
    expect(h.steers).toHaveLength(0);
    expect(h.stops).toHaveLength(0);
    h.budget.onEvent(ev({ type: "request.resolved", requestId: "r1" }));
    h.advance(5 * 60_000);
    expect(h.steers).toHaveLength(1);
    h.advance(5 * 60_000);
    expect(h.stops).toHaveLength(1);
    await flush();
    expect(h.posts[0]).toContain("Turn stopped after 20 min");
    expect(h.posts[0]).toContain("No working note was written before the stop.");
  });

  it("forgets a turn that completes, and never acts when off", () => {
    const h = harness({ maxSteps: 5 });
    h.budget.onEvent(ev({ type: "turn.started" }));
    for (let n = 1; n <= 3; n += 1) h.budget.onEvent(tool(n));
    h.budget.onEvent(ev({ type: "turn.completed", state: "completed" }));
    for (let n = 4; n <= 9; n += 1) h.budget.onEvent(tool(n));
    expect(h.stops).toHaveLength(0);
    const off = harness({ enabled: false, maxSteps: 5 });
    off.budget.onEvent(ev({ type: "turn.started" }));
    for (let n = 1; n <= 9; n += 1) off.budget.onEvent(tool(n));
    expect(off.stops).toHaveLength(0);
    expect(off.steers).toHaveLength(0);
  });

  it("continues a long task past the ceiling in visible segments, and stops only at the last one", async () => {
    const h = harness({ maxSteps: 8, maxContinuations: 2 });
    h.budget.onEvent(ev({ type: "turn.started" }));
    for (let n = 1; n <= 8; n += 1) h.budget.onEvent(tool(n));
    expect(h.stops).toHaveLength(0);
    expect(h.steers).toHaveLength(0);
    expect(h.notes).toEqual([expect.stringContaining("Suite automatique 1/2")]);
    for (let n = 9; n <= 16; n += 1) h.budget.onEvent(tool(n));
    expect(h.notes).toHaveLength(2);
    expect(h.notes[1]).toContain("Suite automatique 2/2");
    expect(h.steers).toHaveLength(0);
    for (let n = 17; n <= 22; n += 1) h.budget.onEvent(tool(n));
    expect(h.steers).toHaveLength(1);
    for (let n = 23; n <= 24; n += 1) h.budget.onEvent(tool(n));
    expect(h.stops).toHaveLength(1);
    await flush();
    expect(h.posts[0]).toContain("24 étapes");
    expect(h.notes).toHaveLength(2);
  });

  it("continues on active time too, with a fresh time segment", () => {
    const h = harness({ maxMinutes: 20, maxSteps: undefined, maxContinuations: 1 }, "en");
    h.budget.onEvent(ev({ type: "turn.started" }));
    h.advance(20 * 60_000);
    expect(h.stops).toHaveLength(0);
    expect(h.notes).toEqual([expect.stringContaining("Automatic continuation 1/1")]);
    h.advance(14 * 60_000);
    expect(h.steers).toHaveLength(0);
    h.advance(1 * 60_000);
    expect(h.steers).toHaveLength(1);
    h.advance(5 * 60_000);
    expect(h.stops).toHaveLength(1);
  });

  it("renders the partial answer in the person's language", () => {
    const facts = { minutes: 22, steps: 86, ceiling: "20 min", notes: ["Note"] };
    expect(partialRender({ language: "fr", ...facts })).toContain("Où j'en étais");
    expect(partialRender({ language: "en", ...facts })).toContain("Where I was");
  });
});
