// The context and usage meter under the message box (owner 2026-11-25,
// M-20261125-070, M-20261125-072 to M-20261125-074, #5372): two halves, each
// a ring and its percentage. A half with no data is absent, never at zero.
import { describe, expect, it } from "vitest";

import type { PlanRow, PlanWindow } from "./plan-usage";
import { accountRowName } from "./plan-usage";
import { contextHalf, usageHalf, usageTone } from "./composer-meter";

const window = (used: number | null, resetsAt: string | null = "2026-11-26T15:00:00Z"): PlanWindow => ({ available: used !== null, usedPercent: used, remainingPercent: used === null ? null : 100 - used, resetsAt });
const row = (over: Partial<PlanRow> = {}): PlanRow => ({
  id: "claude", name: "ada@acme.test", driver: "claude", plan: "Max", state: "windows", access: "subscription", instanceId: "claude", instanceIds: ["claude"],
  message: null, fiveHour: window(31), weekly: window(56), extra: [], models: [], ...over,
});
const usage = (tokens: number, size?: number) => ({ turns: 3, input: 10, output: 5, context: { tokens, ...(size ? { window: size } : {}) } }) as never;

describe("the context half", () => {
  it("is the share of the model's window this conversation uses, with the tokens of its detail", () => {
    expect(contextHalf(usage(84_000, 200_000), [])).toEqual({ percent: 42, tokens: 84_000, window: 200_000 });
  });

  it("is absent when the engine gives no window, when nothing was measured, and once the thread was compacted after its last reading", () => {
    expect(contextHalf(usage(84_000), [])).toBeNull();
    expect(contextHalf(undefined, [])).toBeNull();
    expect(contextHalf(usage(0, 200_000), [])).toBeNull();
    expect(contextHalf(usage(84_000, 200_000), [{ role: "bot", kind: "text" }, { role: "bot", kind: "compaction" }] as never)).toBeNull();
  });
});

describe("the usage half", () => {
  it("is the most advanced window, the session or the week, of the account that serves the bot", () => {
    expect(usageHalf([row()])).toMatchObject({ percent: 56, window: "weekly", row: { id: "claude" } });
    expect(usageHalf([row({ fiveHour: window(89) })])).toMatchObject({ percent: 89, window: "five-hour" });
  });

  it("reads the fullest account when several rows answer for the engine, capped at 100", () => {
    const half = usageHalf([row(), row({ id: "claude-2", name: "nimbus@acme.test", weekly: window(140) })]);
    expect(half).toMatchObject({ percent: 100, window: "weekly", row: { id: "claude-2" } });
  });

  it("is absent for an API key account with no readable limit, a signed-out row and no row at all", () => {
    expect(usageHalf([row({ access: "api-key", state: "no-windows", fiveHour: window(null), weekly: window(null) })])).toBeNull();
    expect(usageHalf([row({ state: "signed-out", fiveHour: window(null), weekly: window(null) })])).toBeNull();
    expect(usageHalf([])).toBeNull();
  });

  it("only changes colour where the limit dot did: warning near the limit, danger at it, quiet below", () => {
    expect(usageTone({ near: false, weeklyNotice: false, hard: false })).toBe("quiet");
    expect(usageTone({ near: true, weeklyNotice: false, hard: false })).toBe("warning");
    expect(usageTone({ near: false, weeklyNotice: true, hard: false })).toBe("warning");
    expect(usageTone({ near: true, weeklyNotice: true, hard: true })).toBe("danger");
  });
});

describe("D-20261125-015: an account reads with its provider", () => {
  it("names the provider before the account's own name, once", () => {
    expect(accountRowName({ driver: "claude", name: "ada@acme.test" })).toBe("Claude · ada@acme.test");
    expect(accountRowName({ driver: "claude", name: "Claude" })).toBe("Claude");
    expect(accountRowName({ driver: "claude", name: "Claude (API key)" })).toBe("Claude (API key)");
    expect(accountRowName({ driver: "other", name: "Nimbus" })).toBe("Nimbus");
  });
});
