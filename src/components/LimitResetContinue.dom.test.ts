// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EngineLimit } from "../../shared/limit-reset";

const fixture = vi.hoisted(() => ({
  dispatch: vi.fn(),
  api: vi.fn(async (..._args: unknown[]) => ({}) as unknown),
}));

vi.mock("@/state/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/state/store")>()),
  useStore: () => ({ state: { routines: [] }, dispatch: fixture.dispatch }),
  api: (...args: unknown[]) => fixture.api(...args),
}));

const { setLocale } = await import("@/lib/i18n");
const limits = await import("@/lib/limit-resets");
const { EngineLimitIndicator } = await import("./LimitResetContinue");
const { ComposerSendBlock } = await import("./ComposerSendBlock");

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

  it("opens a menu with the line and Continue at", () => {
    const container = remount(createElement(EngineLimitIndicator, { engine: "claude", botId: "scout", threadId: "t-1" }));
    flushSync(() => (container.querySelector('[data-testid="engine-limit-indicator"]') as HTMLButtonElement).click());
    const menu = container.querySelector('[data-testid="engine-limit-menu"]')!;
    expect(menu.textContent).toContain("Claude: 92% used");
    expect(menu.querySelector('[data-testid="engine-limit-continue"]')?.textContent).toMatch(/Continue at/);
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

  it("no usage or limit banner is rendered by the chat banner stack or the group view", () => {
    for (const file of ["./ChatView.tsx-parts/ChatViewBanners.tsx", "./GroupView.tsx"]) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(source).not.toMatch(/EngineLimitNotice|WeeklyLimitNotice/);
    }
  });

  it("offers Continue at reset in the composer line when bot and thread are known", async () => {
    fixture.api.mockImplementation(async (path: unknown) =>
      String(path) === "/api/limit-resets/continue"
        ? { routine: { id: "r1" } }
        : { checkedAt: NOW, engines: [claude(100, true)] });
    const block = {
      reason: "engine_limit" as const,
      message: "",
      action: { kind: "switch_engine" as const },
      name: "Claude",
      limit: { cause: "usage_limit" as const, resetsAt: RESET },
    };
    const container = remount(createElement(ComposerSendBlock, {
      block,
      botId: "scout",
      threadId: "t-1",
      onConnect: () => {},
      onRetry: () => {},
    } as never));
    // An opaque row on the composer's ground, never transparent over the thread.
    const line = container.querySelector("[data-composer-send-block]")!;
    expect(line.className).toContain("bg-raised");
    expect(line.closest("[data-composer-notice-band]")).not.toBeNull();
    const continueBtn = container.querySelector("[data-composer-send-block-continue]") as HTMLButtonElement;
    expect(continueBtn?.textContent).toMatch(/Continue at/);
    flushSync(() => continueBtn.click());
    await settle();
    expect(fixture.api).toHaveBeenCalledWith("/api/limit-resets/continue", {
      method: "POST",
      body: JSON.stringify({ botId: "scout", threadId: "t-1" }),
    });
  });

});
