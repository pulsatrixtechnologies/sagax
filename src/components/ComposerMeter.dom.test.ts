// @vitest-environment happy-dom
// The context and usage meter under the message box (owner 2026-11-25,
// M-20261125-070, M-20261125-072 to M-20261125-074, #5372), now the usage
// pill (owner 2026-11-26, M-20261126-095, M-20261126-096, M-20261126-099,
// M-20261126-106, M-20261126-108, #5406): it replaces the orange limit dot.
// One pill, a shape of three measures and a named percentage read without a
// hover, summed over every account that can serve the bot; a click opens the
// accounts' detail.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EngineLimit } from "../../shared/limit-reset";
import type { PlanProvider } from "@/lib/plan-usage";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fixture = vi.hoisted(() => ({
  dispatch: vi.fn(),
  bots: [] as unknown[],
  plan: [] as unknown[],
  serves: undefined as string[] | undefined,
  api: vi.fn(async (..._args: unknown[]) => ({}) as unknown),
}));
const modelWindow = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("@/lib/model-window", async (importOriginal) => ({ ...await importOriginal<typeof import("@/lib/model-window")>(), openModelWindow: modelWindow.open }));
vi.mock("@/state/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/state/store")>()),
  useStore: () => ({ state: { routines: [], bots: fixture.bots }, dispatch: fixture.dispatch }),
  api: (...args: unknown[]) => fixture.api(...args),
}));

const { setLocale } = await import("@/lib/i18n");
const limits = await import("@/lib/limit-resets");
const { ComposerMeter } = await import("./ComposerMeter");
const prefs = await import("@/lib/usage-pill-preferences");

const NOW = Date.parse("2026-10-19T15:00:00Z");
const limit = (usedPercent: number, blocked = false): EngineLimit => ({ engine: "claude", name: "Claude", driver: "claude", window: "weekly", usedPercent, resetsAt: Date.parse("2026-10-21T19:40:00Z"), blocked });
const window = (used: number | null, resetsAt = "2026-10-21T19:40:00Z") => ({ available: used !== null, usedPercent: used, remainingPercent: used === null ? null : 100 - used, resetsAt: used === null ? null : resetsAt });
const provider = (over: Partial<PlanProvider> = {}): PlanProvider => ({
  id: "claude", name: "ada@acme.test", driver: "claude", plan: "max", ok: true, error: null, state: "windows", access: "subscription", instanceId: "claude", instanceIds: ["claude"],
  fiveHour: window(31, "2026-10-19T17:30:00Z"), weekly: window(89), ...over,
});
const bot = (over: Record<string, unknown> = {}) => ({
  id: "scout", name: "Scout", threadId: "t-1", busy: false, messages: [],
  modelSelection: { instanceId: "claude", model: "claude-opus-5-5" },
  tasks: [{ threadId: "t-1", usage: { turns: 4, input: 100, output: 50, context: { tokens: 84_000, window: 200_000 } } }],
  ...over,
}) as never;

let host: HTMLDivElement;
let root: Root;
const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
const mount = async (props: Record<string, unknown> = {}) => {
  act(() => root.render(createElement(ComposerMeter, { bot: bot(), threadId: "t-1", ...props } as never)));
  await settle();
};
const half = (name: string) => host.querySelector<HTMLButtonElement>(`[data-composer-meter-half="${name}"]`);
const click = async (node: Element | null) => { act(() => { (node as HTMLElement).click(); }); await settle(); };
/** The server: the plan report, who can serve this conversation (`serves` of
 * the Auto preview; absent: an older server), the limit report. */
const answer = (path: unknown, plan: () => unknown, engines: EngineLimit[]) => {
  if (path === "/api/plan-usage") return plan();
  if (typeof path === "string" && path.includes("/auto-model")) return { auto: false, pick: null, chain: [], excluded: [], backups: [], ...(fixture.serves ? { serves: fixture.serves } : {}) };
  return { checkedAt: NOW, engines };
};
/** What the server's own limit report says, on mount and on every poll. */
const engineLimits = (engines: EngineLimit[], plan: () => unknown = () => ({ providers: fixture.plan })) => {
  fixture.api.mockImplementation(async (path: unknown) => answer(path, plan, engines));
  limits.rememberLimits({ checkedAt: NOW, engines });
};
const planCalls = () => fixture.api.mock.calls.filter((call) => call[0] === "/api/plan-usage").length;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(NOW);
  setLocale("en");
  fixture.dispatch.mockReset();
  modelWindow.open.mockReset();
  fixture.plan = [provider()];
  fixture.api.mockReset();
  fixture.serves = undefined;
  for (const key of ["sagax.usagePillInBar.v1", "sagax.usagePillShape.v1", "sagax.contextIndicator.v1"]) localStorage.removeItem(key);
  fixture.api.mockImplementation(async (path: unknown) => answer(path, () => ({ providers: fixture.plan }), [limit(89)]));
  limits.rememberLimits({ checkedAt: NOW, engines: [limit(89)] });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

const pillText = () => half("usage")?.querySelector("[data-usage-pill-text]")?.textContent ?? "";
const detailOf = () => host.querySelector<HTMLElement>('[data-composer-meter-detail="usage"]')!;
const accountIds = () => [...detailOf().querySelectorAll<HTMLElement>("[data-usage-account]")].map((node) => node.dataset.usageAccount);
const second = (over: Partial<PlanProvider> = {}) => provider({ id: "work", name: "work@acme.test", instanceId: "work", instanceIds: ["work"], fiveHour: window(0, "2026-10-19T17:30:00Z"), weekly: window(11), ...over });

describe("the usage pill of the message bar", () => {
  it("shows one pill: three circles and a named percentage read without a hover, and no dot", async () => {
    await mount();
    expect(pillText()).toBe("wk 89%");
    const pill = half("usage")!.querySelector<HTMLElement>("[data-usage-pill]")!;
    expect(pill.dataset.shape).toBe("circles");
    // three measures: the week, the session, the context
    expect(pill.querySelectorAll("svg g")).toHaveLength(3);
    expect(half("usage")?.getAttribute("aria-label")).toBe("Usage of every account that can serve this bot: ctx 42% · 5h 31% · wk 89%");
    // the pill carries the context: no second ring
    expect(half("context")).toBeNull();
    expect(host.querySelector('[data-testid="engine-limit-indicator"]')).toBeNull();
  });

  it("M-20261126-096: the serving account full is not 100% while another account can take over", async () => {
    fixture.plan = [provider({ weekly: window(100) }), second()];
    fixture.serves = ["claude", "work"];
    engineLimits([limit(100)]);
    await mount();
    expect(pillText()).toBe("wk 56%");
    expect(half("usage")?.dataset.tone).toBe("quiet");
    await click(half("usage"));
    // nothing is blocked: no action, no sentence
    expect(detailOf().querySelector('[data-testid="engine-limit-switch"]')).toBeNull();
    expect(detailOf().querySelector("[data-composer-meter-limit]")).toBeNull();
  });

  it("an older server names no pool: the accounts of the serving engine's provider are summed", async () => {
    fixture.plan = [provider({ weekly: window(100) }), second(), provider({ id: "codex", driver: "codex", instanceId: "codex", instanceIds: ["codex"], weekly: window(1) })];
    await mount();
    expect(pillText()).toBe("wk 56%");
  });

  it("an answer without its lists (an older or partial server) still draws the pill", async () => {
    fixture.api.mockImplementation(async (path: unknown) => (typeof path === "string" && path.includes("/auto-model") ? {} : answer(path, () => ({ providers: fixture.plan }), [limit(89)])));
    await mount();
    expect(pillText()).toBe("wk 89%");
  });

  it("M-20261126-099: says the return only when every account is blocked, in danger, and then offers the actions", async () => {
    fixture.plan = [provider({ weekly: window(100) }), second({ weekly: window(100, "2026-10-22T03:00:00Z") })];
    fixture.serves = ["claude", "work"];
    // the server's limit report blocks both (#5421 review H1: its verdict, not the windows')
    engineLimits([limit(100, true), { ...limit(100, true), engine: "work", name: "Claude (work)" }]);
    await mount();
    expect(pillText()).toMatch(/^wk 100% · back /);
    expect(half("usage")?.dataset.tone).toBe("danger");
    await click(half("usage"));
    expect(detailOf().querySelector('[data-testid="engine-limit-continue"]')?.textContent).toContain("Continue at");
    await click(detailOf().querySelector('[data-testid="engine-limit-switch"]'));
    expect(modelWindow.open).toHaveBeenCalledWith("scout");
    await click(half("usage"));
    await click(host.querySelector('[data-testid="engine-limit-usage"]'));
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "toggleAppSettings", open: true, section: "usage" });
  });

  // #5421 review, HIGH 1: "blocked" is the server's limit report, never a window at 100%
  it("#5421 review H1: one Claude account, its week at 100%, Extra Usage free, the report says not blocked: no danger, no return, no limit action", async () => {
    fixture.plan = [provider({ weekly: window(100) })];
    engineLimits([{ ...limit(100), blocked: false }]);
    await mount();
    expect(pillText()).toBe("wk 100%");
    expect(half("usage")?.dataset.tone).toBe("warning");
    expect(half("usage")?.querySelector("[data-usage-pill]")?.className).not.toContain("text-danger");
    await click(half("usage"));
    for (const action of ["engine-limit-continue", "engine-limit-release", "engine-limit-switch", "engine-limit-usage"]) {
      expect(detailOf().querySelector(`[data-testid="${action}"]`)).toBeNull();
    }
    expect(detailOf().querySelector('[data-usage-account="claude"]')?.hasAttribute("data-blocked")).toBe(false);
    expect(detailOf().querySelector('[data-usage-col="back"]')?.textContent).toBe("");
  });

  // #5421 review, HIGH 2: the pool is never dropped while it is read again
  describe("#5421 review H2: who can serve stays on screen", () => {
    const codex = () => provider({ id: "codex", name: "dev@acme.test", driver: "codex", instanceId: "codex", instanceIds: ["codex"], fiveHour: window(null), weekly: window(10) });
    /** The pool's read: answered (`serves`), never answered, or refused. */
    const pool = (answers: Array<"answer" | "pending" | "fail">) => {
      const held = [{ ...limit(100, true), held: true }];
      limits.rememberLimits({ checkedAt: NOW, engines: held });
      fixture.api.mockImplementation(async (path: unknown) => {
        if (typeof path === "string" && path.includes("/auto-model")) {
          const next = answers.shift() ?? "answer";
          if (next === "pending") return new Promise(() => {});
          if (next === "fail") throw new Error("server away");
        }
        return answer(path, () => ({ providers: fixture.plan }), held);
      });
    };

    beforeEach(() => {
      fixture.plan = [provider({ weekly: window(100) }), codex()];
      fixture.serves = ["claude", "codex"];
    });

    it("the detail opens while the pool is read again: the same figure, both accounts, no limit action but Try again now", async () => {
      pool(["answer", "pending"]);
      await mount();
      expect(pillText()).toBe("wk 55%");
      await click(half("usage"));
      expect(pillText()).toBe("wk 55%");
      expect(half("usage")?.dataset.tone).not.toBe("danger");
      // Codex free in sight, Claude held folded below: both still there
      expect(accountIds()).toEqual(["codex"]);
      expect(detailOf().querySelector("[data-usage-free]")?.textContent).toBe("Available accounts: 1 of 2");
      expect(detailOf().querySelector('[data-usage-fold="limited"]')?.textContent).toBe("At the limit (1)");
      for (const action of ["engine-limit-continue", "engine-limit-switch", "engine-limit-usage"]) {
        expect(detailOf().querySelector(`[data-testid="${action}"]`)).toBeNull();
      }
      // the serving engine's hold keeps its own action, as before the pill
      expect(detailOf().querySelector('[data-testid="engine-limit-release"]')?.textContent).toBe("Try again now");
    });

    it("a read that fails keeps the last pool", async () => {
      pool(["answer", "fail"]);
      await mount();
      await click(half("usage"));
      expect(pillText()).toBe("wk 55%");
      expect(detailOf().querySelector("[data-usage-free]")?.textContent).toBe("Available accounts: 1 of 2");
    });

    it("before the first answer, what the app knows shows, never called blocked", async () => {
      pool(["pending"]);
      await mount();
      expect(pillText()).toBe("wk 100%");
      expect(half("usage")?.dataset.tone).toBe("warning");
      await click(half("usage"));
      expect(detailOf().querySelector('[data-testid="engine-limit-continue"]')).toBeNull();
      expect(detailOf().querySelector('[data-testid="engine-limit-switch"]')).toBeNull();
    });
  });

  it("turns warning from 75% of the sum, quiet below", async () => {
    await mount();
    expect(half("usage")?.dataset.tone).toBe("warning");
    fixture.plan = [provider({ weekly: window(40) })];
    act(() => root.unmount());
    root = createRoot(host);
    await mount();
    expect(half("usage")?.dataset.tone).toBe("quiet");
  });

  it("with no account figure there is no pill, the context keeps its own ring; with neither there is no meter", async () => {
    fixture.plan = [provider({ access: "api-key", state: "no-windows", fiveHour: window(null), weekly: window(null) })];
    engineLimits([]);
    await mount();
    expect(half("usage")).toBeNull();
    expect(half("context")?.textContent).toBe("42%");
    await mount({ bot: bot({ tasks: [{ threadId: "t-1", usage: { turns: 4, input: 100, output: 50, context: { tokens: 84_000 } } }] }) });
    expect(half("context")).toBeNull();
    expect(host.querySelector("[data-composer-meter]")).toBeNull();
  });

  // #5372 review, HIGH 1: the dot this meter replaces showed whenever the
  // engine's own limit report said near or reached, with or without a plan
  // window. The pill then draws from that limit, so its line and its
  // actions stay within reach.
  it("with the plan read rejected, an engine at its limit and held still shows the pill, its line, Try again now, Switch engine and See usage", async () => {
    engineLimits([{ ...limit(100, true), held: true }], () => { throw new Error("plan report unreachable"); });
    await mount();
    expect(pillText()).toMatch(/^wk 100% · back /);
    expect(half("usage")?.dataset.tone).toBe("danger");
    await click(half("usage"));
    expect(detailOf().querySelector("[data-composer-meter-limit]")?.textContent).toContain("Claude: at its limit");
    expect(accountIds()).toEqual(["engine:claude"]);
    expect(detailOf().querySelector('[data-testid="engine-limit-release"]')?.textContent).toBe("Try again now");
    expect(detailOf().querySelector('[data-testid="engine-limit-usage"]')).not.toBeNull();
    await click(detailOf().querySelector('[data-testid="engine-limit-switch"]'));
    expect(modelWindow.open).toHaveBeenCalledWith("scout");
  });

  it("an API key account has no plan window: near its limit the pill reads the engine's own share; under the threshold there is no pill", async () => {
    fixture.plan = [provider({ access: "api-key", state: "no-windows", fiveHour: window(null), weekly: window(null) })];
    engineLimits([limit(93)]);
    await mount();
    expect(pillText()).toBe("wk 93%");
    expect(half("usage")?.dataset.tone).toBe("warning");
    await click(half("usage"));
    expect(detailOf().querySelector("[data-composer-meter-limit]")?.textContent).toContain("Claude: 93% used");
    await click(half("usage"));
    engineLimits([limit(40)]);
    await settle();
    expect(half("usage")).toBeNull();
  });

  it("a refusal's hold with no window reported shows the pill in danger without a figure it does not have", async () => {
    fixture.plan = [];
    engineLimits([{ ...limit(0, true), usedPercent: null, window: null, resetsAt: null, held: true }]);
    await mount();
    expect(half("usage")).not.toBeNull();
    expect(pillText()).toBe("");
    expect(half("usage")?.dataset.tone).toBe("danger");
    await click(half("usage"));
    expect(host.querySelector('[data-testid="engine-limit-release"]')).not.toBeNull();
  });

  it("M-20261126-095: the detail is one row per account: its provider and plan, the session and the week as columns, the serving one marked, one star each, no sentence", async () => {
    fixture.plan = [provider(), second()];
    fixture.serves = ["claude", "work"];
    await mount();
    await click(half("usage"));
    const rows = [...detailOf().querySelectorAll<HTMLElement>("[data-usage-account]")];
    expect(rows.map((node) => node.querySelector("[data-usage-account-name]")?.textContent)).toEqual(["Claude · ada@acme.test · Max", "Claude · work@acme.test · Max"]);
    expect(rows.map((node) => node.hasAttribute("data-serving"))).toEqual([true, false]);
    expect([...rows[0]!.querySelectorAll('td[data-usage-col]')].map((cell) => cell.textContent)).toEqual(["31%", "89%", ""]);
    expect(detailOf().querySelector("[data-usage-free]")?.textContent).toBe("Available accounts: 2 of 2");
    expect(detailOf().querySelectorAll("[data-usage-favorite]")).toHaveLength(2);
    expect(detailOf().querySelector("[data-composer-meter-limit]")).toBeNull();
    expect(detailOf().querySelector("p[data-composer-meter-window]")).toBeNull();
  });

  it("the free accounts come first, three in sight; the others and the accounts at their limit are folded, the return time said once per limited account", async () => {
    const free = ["b", "c", "d", "e"].map((id, index) => provider({ id, name: `${id}@acme.test`, instanceId: id, instanceIds: [id], fiveHour: window(0), weekly: window(10 + index) }));
    const full = provider({ id: "z", name: "z@acme.test", instanceId: "z", instanceIds: ["z"], fiveHour: window(5), weekly: window(100) });
    fixture.plan = [full, provider({ weekly: window(60) }), ...free];
    fixture.serves = ["claude", "b", "c", "d", "e", "z"];
    engineLimits([limit(60), { ...limit(100, true), engine: "z", name: "Claude (z)" }]);
    await mount();
    await click(half("usage"));
    expect(accountIds()).toEqual(["claude", "b", "c"]);
    expect(detailOf().querySelector("[data-usage-free]")?.textContent).toBe("Available accounts: 5 of 6");
    const more = detailOf().querySelector<HTMLButtonElement>('[data-usage-fold="more-free"]')!;
    expect(detailOf().querySelector("[data-usage-free]")?.getAttribute("title"))
      .toBe("Available: no 5 h or weekly limit reached.");
    expect(more.textContent).toBe("Other available accounts (2)");
    await click(more);
    expect(accountIds()).toEqual(["claude", "b", "c", "d", "e"]);
    const limited = detailOf().querySelector<HTMLButtonElement>('[data-usage-fold="limited"]')!;
    expect(limited.textContent).toBe("At the limit (1)");
    expect(limited.getAttribute("aria-expanded")).toBe("false");
    await click(limited);
    const row = detailOf().querySelector<HTMLElement>('[data-usage-account="z"]')!;
    expect(row.hasAttribute("data-blocked")).toBe(true);
    expect(row.querySelector('[data-usage-col="back"]')?.textContent).not.toBe("");
    // a free account says no return
    expect(detailOf().querySelector('[data-usage-account="b"] [data-usage-col="back"]')?.textContent).toBe("");
  });

  it("an account with no 5-hour limit says so in that column", async () => {
    fixture.plan = [provider({ fiveHour: window(null) })];
    await mount();
    await click(half("usage"));
    expect([...detailOf().querySelectorAll("td[data-usage-col]")].map((cell) => cell.textContent)).toEqual(["no 5h limit", "89%", ""]);
  });

  it("the detail holds the context's tokens and Compact now, which calls the existing compaction", async () => {
    await mount();
    await click(half("usage"));
    const context = detailOf().querySelector("[data-composer-meter-context]")!;
    expect(context.textContent).toContain("Context 84k (42% of 200k)");
    const compact = context.querySelector<HTMLButtonElement>("[data-composer-meter-compact]")!;
    expect(compact.textContent).toBe("Compact now");
    await click(compact);
    expect(fixture.api).toHaveBeenCalledWith("/api/bots/scout/compact", expect.objectContaining({ method: "POST", body: JSON.stringify({ threadId: "t-1" }) }));
  });

  it("D-20261125-014: the figures and who can serve are read again when the detail opens, then the figures every minute while it stays open", async () => {
    await mount();
    const before = planCalls();
    const pools = () => fixture.api.mock.calls.filter((call) => String(call[0]).includes("/auto-model")).length;
    const poolsBefore = pools();
    fixture.plan = [provider({ weekly: window(93) })];
    await click(half("usage"));
    expect(planCalls()).toBe(before + 1);
    expect(pools()).toBe(poolsBefore + 1);
    expect(pillText()).toBe("wk 93%");
    fixture.plan = [provider({ weekly: window(95) })];
    await act(async () => { vi.advanceTimersByTime(60_000); });
    await settle();
    expect(planCalls()).toBe(before + 2);
    expect(pillText()).toBe("wk 95%");
    // closed: no read every minute any more
    await click(half("usage"));
    const closed = planCalls();
    await act(async () => { vi.advanceTimersByTime(3 * 60_000); });
    expect(planCalls()).toBeLessThanOrEqual(closed + 1);
  });

  it("Escape and a press outside close the detail", async () => {
    await mount();
    await click(half("usage"));
    expect(host.querySelector("[data-composer-meter-detail]")).not.toBeNull();
    act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(host.querySelector("[data-composer-meter-detail]")).toBeNull();
    await click(half("usage"));
    act(() => { document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); });
    expect(host.querySelector("[data-composer-meter-detail]")).toBeNull();
  });
});

describe("Settings > Appearance: the pill, its shape, the context indicator (M-20261126-106, M-20261126-108)", () => {
  afterEach(() => {
    prefs.usagePillInBar.set("on");
    prefs.usagePillShape.set("circles");
    prefs.contextIndicator.set("on");
  });

  it("each shape draws the same measures and keeps the named percentage", async () => {
    await mount();
    const pill = () => half("usage")!.querySelector<HTMLElement>("[data-usage-pill]")!;
    for (const shape of prefs.USAGE_PILL_SHAPES) {
      act(() => prefs.usagePillShape.set(shape));
      expect(pill().dataset.shape).toBe(shape);
      if (shape === "text") {
        expect(pill().querySelector("svg")).toBeNull();
        expect([...pill().querySelectorAll("[data-measure]")].map((node) => node.textContent)).toEqual(["ctx 42%", "5h 31%", "wk 89%"]);
      } else {
        expect(pill().querySelector("svg")).not.toBeNull();
        expect(pillText()).toBe("wk 89%");
      }
    }
  });

  it("the pill switched off leaves the context's own ring and its detail", async () => {
    act(() => prefs.usagePillInBar.set("off"));
    await mount();
    expect(half("usage")).toBeNull();
    expect(half("context")?.textContent).toBe("42%");
    await click(half("context"));
    const detail = host.querySelector('[data-composer-meter-detail="context"]')!;
    expect(detail.textContent).toContain("Context 84k (42% of 200k)");
    expect(detail.querySelector("[data-composer-meter-compact]")).not.toBeNull();
  });

  it("the context indicator switched off leaves two measures and no context figure, and keeps Compact now (#5421 review M4); with the pill off too there is no meter", async () => {
    act(() => prefs.contextIndicator.set("off"));
    await mount();
    expect(half("usage")!.querySelectorAll("svg g")).toHaveLength(2);
    expect(half("usage")?.getAttribute("aria-label")).toBe("Usage of every account that can serve this bot: 5h 31% · wk 89%");
    await click(half("usage"));
    const context = detailOf().querySelector("[data-composer-meter-context]")!;
    expect(context.textContent).not.toContain("Context 84k");
    const compact = context.querySelector<HTMLButtonElement>("[data-composer-meter-compact]")!;
    expect(compact.textContent).toBe("Compact now");
    await click(compact);
    expect(fixture.api).toHaveBeenCalledWith("/api/bots/scout/compact", expect.objectContaining({ method: "POST" }));
    act(() => prefs.usagePillInBar.set("off"));
    expect(host.querySelector("[data-composer-meter]")).toBeNull();
  });

  it("#5421 review M4: the pill and the context both hidden, a nearly full context brings its ring back, with Compact now", async () => {
    act(() => prefs.contextIndicator.set("off"));
    act(() => prefs.usagePillInBar.set("off"));
    await mount({ bot: bot({ tasks: [{ threadId: "t-1", usage: { turns: 4, input: 100, output: 50, context: { tokens: 170_000, window: 200_000 } } }] }) });
    expect(half("context")?.textContent).toBe("85%");
    await click(half("context"));
    expect(host.querySelector('[data-composer-meter-detail="context"] [data-composer-meter-compact]')?.textContent).toBe("Compact now");
  });

  it("#5421 review M3: the pill hidden, a held serving engine brings the pill back with Try again now, never the limit dot (M-20261125-070)", async () => {
    engineLimits([{ ...limit(100, true), held: true }]);
    act(() => prefs.usagePillInBar.set("off"));
    await mount();
    expect(host.querySelector('[data-testid="engine-limit-indicator"]')).toBeNull();
    expect(half("usage")).not.toBeNull();
    await click(half("usage"));
    const release = detailOf().querySelector<HTMLButtonElement>('[data-testid="engine-limit-release"]');
    expect(release?.textContent).toBe("Try again now");
    fixture.api.mockClear();
    await click(release);
    expect(fixture.api).toHaveBeenCalledWith("/api/limit-resets/release", expect.objectContaining({ method: "POST", body: JSON.stringify({ engine: "claude" }) }));
  });

  it("#5421 round 2: a hold of the serving engine shows its pill and Try again now even while other accounts are free", async () => {
    fixture.plan = [provider({ weekly: window(100) }), second()];
    fixture.serves = ["claude", "work"];
    engineLimits([{ ...limit(100, true), held: true }]);
    await mount();
    expect(pillText()).toBe("wk 56%");
    await click(half("usage"));
    expect(detailOf().querySelector('[data-testid="engine-limit-release"]')).not.toBeNull();
    expect(detailOf().querySelector('[data-testid="engine-limit-switch"]')).toBeNull();
  });

  it("#5421 review M3: the pill hidden and nothing held, no pill and no dot; the pill off reads no pool", async () => {
    act(() => prefs.usagePillInBar.set("off"));
    await mount();
    expect(half("usage")).toBeNull();
    expect(host.querySelector('[data-testid="engine-limit-indicator"]')).toBeNull();
    expect(fixture.api.mock.calls.some((call) => String(call[0]).includes("/auto-model"))).toBe(false);
  });
});
