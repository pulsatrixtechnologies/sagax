// @vitest-environment happy-dom
// The context and usage meter under the message box (owner 2026-11-25,
// M-20261125-070, M-20261125-072 to M-20261125-074, #5372): it replaces the
// orange limit dot. Two halves, each a ring and its percentage, read without
// a hover; a click on a half opens its detail.
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
const planCalls = () => fixture.api.mock.calls.filter((call) => call[0] === "/api/plan-usage").length;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(NOW);
  setLocale("en");
  fixture.dispatch.mockReset();
  modelWindow.open.mockReset();
  fixture.plan = [provider()];
  fixture.api.mockReset();
  fixture.api.mockImplementation(async (path: unknown) => (path === "/api/plan-usage" ? { providers: fixture.plan } : { checkedAt: NOW, engines: [limit(89)] }));
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

describe("the context and usage meter", () => {
  it("shows two halves, each a ring and its percentage read without a hover, and no dot", async () => {
    await mount();
    expect(half("context")?.textContent).toBe("42%");
    expect(half("usage")?.textContent).toBe("89%");
    expect(half("context")?.querySelector("svg[data-meter-ring]")).not.toBeNull();
    expect(half("usage")?.querySelector("svg[data-meter-ring]")).not.toBeNull();
    expect(host.querySelector('[data-testid="engine-limit-indicator"]')).toBeNull();
    // the context half sits before the usage half
    expect([...host.querySelectorAll("[data-composer-meter-half]")].map((node) => (node as HTMLElement).dataset.composerMeterHalf)).toEqual(["context", "usage"]);
  });

  it("only the usage half changes colour near the limit: warning from the dot's thresholds, danger at the limit", async () => {
    await mount();
    expect(half("usage")?.dataset.tone).toBe("warning");
    expect(half("context")?.dataset.tone).toBeUndefined();
    fixture.plan = [provider({ weekly: window(40) })];
    limits.rememberLimits({ checkedAt: NOW, engines: [limit(40)] });
    act(() => root.unmount());
    root = createRoot(host);
    await mount();
    expect(half("usage")?.dataset.tone).toBe("quiet");
    limits.rememberLimits({ checkedAt: NOW, engines: [limit(100, true)] });
    await settle();
    expect(half("usage")?.dataset.tone).toBe("danger");
  });

  it("a half with no data is absent, never greyed or at zero; with neither there is no meter", async () => {
    fixture.plan = [provider({ access: "api-key", state: "no-windows", fiveHour: window(null), weekly: window(null) })];
    limits.rememberLimits({ checkedAt: NOW, engines: [] });
    await mount();
    expect(half("usage")).toBeNull();
    expect(half("context")?.textContent).toBe("42%");
    await mount({ bot: bot({ tasks: [{ threadId: "t-1", usage: { turns: 4, input: 100, output: 50, context: { tokens: 84_000 } } }] }) });
    expect(half("context")).toBeNull();
    expect(host.querySelector("[data-composer-meter]")).toBeNull();
  });

  it("a click on the context half opens the tokens used of the total and Compact now, which calls the existing compaction", async () => {
    await mount();
    await click(half("context"));
    const detail = host.querySelector('[data-composer-meter-detail="context"]')!;
    expect(detail.textContent).toContain("Context 84k (42% of 200k)");
    const compact = detail.querySelector<HTMLButtonElement>("[data-composer-meter-compact]")!;
    expect(compact.textContent).toBe("Compact now");
    await click(compact);
    expect(fixture.api).toHaveBeenCalledWith("/api/bots/scout/compact", expect.objectContaining({ method: "POST", body: JSON.stringify({ threadId: "t-1" }) }));
  });

  it("D-20261125-015, M-20261125-084: the usage detail is one row for the account, named with its provider, its two windows side by side, one star; then Switch engine and See usage", async () => {
    await mount();
    await click(half("usage"));
    const detail = host.querySelector('[data-composer-meter-detail="usage"]')!;
    // one row for the account, the row of Settings > Usage limits (PlanUsage.tsx)
    const rows = detail.querySelectorAll("[data-plan-line]");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.querySelector("[data-plan-name]")?.textContent).toBe("Claude · ada@acme.test");
    expect(rows[0]!.textContent).toContain("Max");
    // the short session then the week, on that same row, each with its percent and its renewal
    const windows = [...rows[0]!.querySelectorAll<HTMLElement>("[data-plan-window-kind]")];
    expect(windows.map((node) => node.dataset.planWindowKind)).toEqual(["fiveHour", "weekly"]);
    expect(windows.map((node) => node.querySelector("[data-limit-figure]")?.textContent)).toEqual(["5-hour session31% used", "Week89% used"]);
    for (const node of windows) expect(node.querySelector("[data-plan-window]")).not.toBeNull();
    expect(detail.querySelectorAll("[data-usage-favorite]")).toHaveLength(1);
    // no line per window any more
    expect(detail.querySelector("[data-composer-meter-window]")).toBeNull();
    await click(detail.querySelector('[data-testid="engine-limit-switch"]'));
    expect(modelWindow.open).toHaveBeenCalledWith("scout");
    await click(half("usage"));
    await click(host.querySelector('[data-testid="engine-limit-usage"]'));
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "toggleAppSettings", open: true, section: "usage" });
  });

  it("M-20261125-084: an account with one window shows one", async () => {
    fixture.plan = [provider({ fiveHour: window(null) })];
    await mount();
    await click(half("usage"));
    const kinds = [...host.querySelectorAll<HTMLElement>('[data-composer-meter-detail="usage"] [data-plan-window-kind]')].map((node) => node.dataset.planWindowKind);
    expect(kinds).toEqual(["weekly"]);
  });

  it("D-20261125-014: the figures are read again when the detail opens, then every minute while it stays open", async () => {
    await mount();
    const before = planCalls();
    fixture.plan = [provider({ weekly: window(93) })];
    await click(half("usage"));
    expect(planCalls()).toBe(before + 1);
    expect(half("usage")?.textContent).toBe("93%");
    fixture.plan = [provider({ weekly: window(95) })];
    await act(async () => { vi.advanceTimersByTime(60_000); });
    await settle();
    expect(planCalls()).toBe(before + 2);
    expect(half("usage")?.textContent).toBe("95%");
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
    await click(half("context"));
    act(() => { document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); });
    expect(host.querySelector("[data-composer-meter-detail]")).toBeNull();
  });
});
