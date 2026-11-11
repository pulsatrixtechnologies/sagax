// @vitest-environment happy-dom
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EngineLimit } from "../../shared/limit-reset";

const fixture = vi.hoisted(() => ({
  dispatch: vi.fn(),
  /** The bots the store holds (the open conversation's lines). */
  bots: [] as unknown[],
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
const { EngineLimitIndicator } = await import("./LimitResetContinue");

const NOW = Date.parse("2026-10-19T15:00:00Z");
const RESET = Date.parse("2026-10-19T19:40:00Z");
const claude = (usedPercent: number, blocked = false): EngineLimit => ({
  engine: "claude",
  name: "Claude",
  driver: "claude",
  window: "5-hour",
  usedPercent,
  resetsAt: RESET,
  blocked,
});

let root: Root | undefined;
function remount(element: ReturnType<typeof createElement>) {
  root?.unmount();
  document.body.innerHTML = "";
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  flushSync(() => root!.render(element));
  return container;
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  setLocale("en");
  window.localStorage.clear();
  fixture.dispatch.mockReset();
  fixture.bots = [];
  modelWindow.open.mockReset();
  fixture.api.mockReset();
  fixture.api.mockImplementation(async () => ({ checkedAt: NOW, engines: [claude(92)] }));
  limits.rememberLimits({ checkedAt: NOW, engines: [claude(92)] });
});

afterEach(() => {
  root?.unmount();
  root = undefined;
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("EngineLimitIndicator (no banner above the chat, the owner 2026-11-08)", () => {
  it("is a quiet dot with the usage line as tooltip, never a banner", () => {
    const container = remount(createElement(EngineLimitIndicator, { engine: "claude", botId: "scout", threadId: "t-1" }));
    const dot = container.querySelector('[data-testid="engine-limit-indicator"]') as HTMLButtonElement;
    expect(dot.getAttribute("title")).toContain("Claude: 92% used");
    expect(container.querySelector('[data-notice], [data-testid="engine-limit-notice"]')).toBeNull();
    expect(container.querySelector('[data-testid="engine-limit-menu"]')).toBeNull();
  });

  it("opens a menu with the line, Switch engine and, for a turn the limit stopped with nothing held, Continue at", () => {
    limits.rememberLimits({ checkedAt: NOW, engines: [claude(100, true)] });
    const container = remount(createElement(EngineLimitIndicator, { engine: "claude", botId: "scout", threadId: "t-1" }));
    flushSync(() => (container.querySelector('[data-testid="engine-limit-indicator"]') as HTMLButtonElement).click());
    const menu = container.querySelector('[data-testid="engine-limit-menu"]')!;
    expect(menu.textContent).toContain("Claude");
    expect(menu.querySelector('[data-testid="engine-limit-continue"]')?.textContent).toMatch(/Continue at/);
    const change = menu.querySelector('[data-testid="engine-limit-switch"]') as HTMLButtonElement;
    expect(change.textContent).toBe("Switch engine");
    flushSync(() => change.click());
    expect(modelWindow.open).toHaveBeenCalledWith("scout");
  });

  // #3552: one way to resume. The server holds the message and sends it again
  // at the reset, so the dot offers no second one.
  it("offers no Continue at while the server holds the conversation's message for the reset", () => {
    limits.rememberLimits({ checkedAt: NOW, engines: [claude(100, true)] });
    fixture.bots = [{ id: "scout", threadId: "t-1", messages: [
      { id: "u1", role: "user", kind: "text", text: "hello", at: NOW - 1000 },
      { id: "l1", role: "bot", kind: "activity", at: NOW - 900, tool: { name: "recovery: Limit reached", ok: true,
        limitFailover: { kind: "waiting", from: "Claude", resetsAt: RESET } } },
    ] }];
    const container = remount(createElement(EngineLimitIndicator, { engine: "claude", botId: "scout", threadId: "t-1" }));
    flushSync(() => (container.querySelector('[data-testid="engine-limit-indicator"]') as HTMLButtonElement).click());
    const menu = container.querySelector('[data-testid="engine-limit-menu"]')!;
    expect(menu.querySelector('[data-testid="engine-limit-continue"]')).toBeNull();
    expect(menu.textContent).not.toMatch(/Continue at/);
    expect(menu.querySelector('[data-testid="engine-limit-switch"]')).not.toBeNull();
  });

  // review: the model picker passes the thread shown, which may be a task or a
  // previewed conversation, not the bot's main thread.
  it("reads the held state for the thread shown, not only the bot's main thread", () => {
    limits.rememberLimits({ checkedAt: NOW, engines: [claude(100, true)] });
    const waiting = [
      { id: "u1", role: "user", kind: "text", text: "hello", at: NOW - 1000 },
      { id: "l1", role: "bot", kind: "activity", at: NOW - 900, tool: { name: "recovery: Limit reached", ok: true,
        limitFailover: { kind: "waiting", from: "Claude", resetsAt: RESET } } },
    ];
    const open = (props: Record<string, unknown>) => {
      const container = remount(createElement(EngineLimitIndicator, { engine: "claude", botId: "scout", ...props }));
      flushSync(() => (container.querySelector('[data-testid="engine-limit-indicator"]') as HTMLButtonElement).click());
      return container.querySelector('[data-testid="engine-limit-continue"]');
    };
    // the picker hands the transcript of the task it shows
    fixture.bots = [{ id: "scout", threadId: "t-main", messages: [] }];
    expect(open({ threadId: "t-task", messages: waiting })).toBeNull();
    // a conversation a switch is previewing
    fixture.bots = [{ id: "scout", threadId: "t-main", messages: [], switchPreview: { threadId: "t-task", messages: waiting } }];
    expect(open({ threadId: "t-task" })).toBeNull();
    // nothing held in the thread shown: the one way to resume a stopped turn stays
    expect(open({ threadId: "t-main" })).not.toBeNull();
  });

  // review: the dot's menu said "Wed 12:11 AM" in French while the chat line
  // said "mer. 00 h 12": one clock helper for both, in the reader's language.
  it("writes the reset in the reader's clock, as the conversation's line does", async () => {
    const { limitFailoverLineText } = await import("@/lib/limit-failover");
    const later = NOW + 30 * 3_600_000;
    limits.rememberLimits({ checkedAt: NOW, engines: [{ ...claude(100, true), resetsAt: later }] });
    setLocale("fr");
    const container = remount(createElement(EngineLimitIndicator, { engine: "claude", botId: "scout", threadId: "t-1" }));
    const title = container.querySelector('[data-testid="engine-limit-indicator"]')!.getAttribute("title")!;
    const line = limitFailoverLineText({ kind: "waiting", from: "Claude", resetsAt: later }, NOW);
    const clock = /\d{1,2} h \d{2}/;
    expect(title).toMatch(clock);
    expect(title).not.toMatch(/AM|PM|Mon|Tue|Wed|Thu|Fri|Sat|Sun/);
    expect(line.match(clock)?.[0]).toBe(title.match(clock)?.[0]);
  });

  it("offers no Continue at near the limit, when no turn was stopped", () => {
    const container = remount(createElement(EngineLimitIndicator, { engine: "claude", botId: "scout", threadId: "t-1" }));
    flushSync(() => (container.querySelector('[data-testid="engine-limit-indicator"]') as HTMLButtonElement).click());
    expect(container.querySelector('[data-testid="engine-limit-continue"]')).toBeNull();
  });

  it("#2902: bot on Claude, Codex weekly limit reached, no dot, no menu, no bubble", async () => {
    const plan = (id: string, driver: string, name: string, used: number) => ({
      id, name, driver, ok: true, error: null, state: "windows", access: "subscription", instanceId: id,
      fiveHour: { available: false, remainingPercent: null, usedPercent: null, resetsAt: null },
      weekly: { available: true, remainingPercent: 100 - used, usedPercent: used, resetsAt: "2026-11-12T00:00:00Z" },
    });
    fixture.api.mockImplementation(async (path: unknown) =>
      String(path) === "/api/plan-usage"
        ? { providers: [plan("claude", "claude", "Claude", 12), plan("codex", "codex", "Codex", 100)] }
        : { checkedAt: NOW, engines: [claude(10)] });
    limits.rememberLimits({ checkedAt: NOW, engines: [claude(10)] });
    const container = remount(createElement(EngineLimitIndicator, { engine: "claude", botId: "scout", threadId: "t-1" }));
    await settle();
    await settle();
    expect(fixture.api).toHaveBeenCalledWith("/api/plan-usage");
    expect(container.innerHTML).toBe("");
    // the same report still shows for the engine that is actually at its limit
    const codex = remount(createElement(EngineLimitIndicator, { engine: "codex", botId: "scout", threadId: "t-1" }));
    await settle();
    await settle();
    expect(codex.querySelector('[data-testid="engine-limit-indicator"]')?.getAttribute("title")).toContain("weekly Codex limit");
  });

  it("#0867: an instance folded on a shared login still shows that login's weekly limit", async () => {
    const plan = (id: string, driver: string, name: string, used: number, instanceIds: string[]) => ({
      id, name, driver, ok: true, error: null, state: "windows", access: "subscription", instanceId: instanceIds[0], instanceIds,
      fiveHour: { available: false, remainingPercent: null, usedPercent: null, resetsAt: null },
      weekly: { available: true, remainingPercent: 100 - used, usedPercent: used, resetsAt: "2026-11-12T00:00:00Z" },
    });
    fixture.api.mockImplementation(async (path: unknown) =>
      String(path) === "/api/plan-usage"
        ? { providers: [plan("claude", "claude", "Claude", 95, ["claude", "claude-opus"]), plan("codex", "codex", "Codex", 100, ["codex", "chatgpt"]), plan("grok", "grok", "Grok", 99, ["grok"])] }
        : { checkedAt: NOW, engines: [] });
    limits.rememberLimits({ checkedAt: NOW, engines: [] });
    const opus = remount(createElement(EngineLimitIndicator, { engine: "claude-opus", botId: "scout", threadId: "t-1" }));
    await settle();
    await settle();
    expect(opus.querySelector('[data-testid="engine-limit-indicator"]')?.getAttribute("title")).toContain("Claude");
    expect(opus.querySelector('[data-testid="engine-limit-indicator"]')?.getAttribute("title")).toContain("95");
    // the ChatGPT plan instance folded on the Codex login reads the Codex row at its limit
    const chatgpt = remount(createElement(EngineLimitIndicator, { engine: "chatgpt", botId: "scout", threadId: "t-1" }));
    await settle();
    await settle();
    const dot = chatgpt.querySelector('[data-testid="engine-limit-indicator"]');
    expect(dot?.getAttribute("title")).toContain("Codex");
    expect(dot?.className).toContain("bg-danger");
    // an instance no row lists stays quiet, even beside rows over the threshold
    const other = remount(createElement(EngineLimitIndicator, { engine: "claude-haiku", botId: "scout", threadId: "t-1" }));
    await settle();
    await settle();
    expect(other.innerHTML).toBe("");
  });

  it("stays quiet for another engine", () => {
    expect(remount(createElement(EngineLimitIndicator, { engine: "codex" })).innerHTML).toBe("");
  });

  // #3552: the same state came back above the message box through the send
  // block bar. Every component that can draw above the message box is read:
  // the chat's banner stack, the group view, every part of the composer, the
  // send block bar and anything that draws in the composer's notice band.
  it("no usage or limit banner is drawn by any component above the message box", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const files = new Set(["ChatView.tsx-parts/ChatViewBanners.tsx", "GroupView.tsx", "ComposerSendBlock.tsx", "WorkplaceNotice.tsx", "Composer.tsx"]);
    for (const name of readdirSync(join(here, "Composer.tsx-parts"))) files.add(`Composer.tsx-parts/${name}`);
    const walk = (dir: string, prefix: string) => {
      for (const name of readdirSync(dir)) {
        const entry = join(dir, name);
        if (statSync(entry).isDirectory()) walk(entry, `${prefix}${name}/`);
        else if (name.endsWith(".tsx") && !/\.test\./.test(name) && /ComposerNoticeBand/.test(readFileSync(entry, "utf8"))) files.add(`${prefix}${name}`);
      }
    };
    walk(here, "");
    expect(files.size).toBeGreaterThan(6);
    for (const file of files) {
      if (/\.test\./.test(file)) continue;
      const source = readFileSync(join(here, file), "utf8");
      expect(source, file).not.toMatch(/EngineLimitNotice|WeeklyLimitNotice|engine_limit|useLimitResetContinue|LimitResetContinue|sendBlockLocks|limit-resets\/continue/);
      // #3690: nor the group cost notice ("Group conversations use more"):
      // the room panel's Members tab says it.
      expect(source, file).not.toMatch(/GroupCostNotice|chat\.notice\.groupCost|data-notice/);
    }
    // the send block's words hold no limit line either
    const words = readFileSync(join(here, "..", "lib", "send-state.ts"), "utf8");
    expect(words).not.toMatch(/engine_limit|sendBlock\.engineLimit|sendBlock\.engineCredits/);
  });

});
