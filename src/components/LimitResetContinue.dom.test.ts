// @vitest-environment happy-dom
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
const { EngineLimitNotice, engineLimitNoticeKey } = await import("./LimitResetContinue");

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

describe("engineLimitNoticeKey", () => {
  it("changes when the reset time or blocked state changes", () => {
    expect(engineLimitNoticeKey(claude(92))).not.toBe(engineLimitNoticeKey(claude(100, true)));
    expect(engineLimitNoticeKey(claude(92))).not.toBe(
      engineLimitNoticeKey({ ...claude(92), resetsAt: RESET + 3_600_000 }),
    );
  });
});

describe("EngineLimitNotice banner", () => {
  it("draws a full-width dismissible banner, not a header pill", () => {
    const container = remount(createElement(EngineLimitNotice, { engine: "claude", botId: "scout", threadId: "t-1" }));
    const banner = container.querySelector('[data-testid="engine-limit-notice"]')!;
    expect(banner.parentElement?.className).toContain("w-full");
    expect(banner.getAttribute("data-notice")).toBe("engine-limit");
    expect(banner.querySelector("button[aria-label]")).toBeTruthy();
    expect(banner.textContent).toContain("Claude: 92% used");
    expect(banner.className).not.toContain("rounded-full");
  });

  it("stays hidden after dismiss until a new limit event", () => {
    const first = remount(createElement(EngineLimitNotice, { engine: "claude" }));
    const close = first.querySelector("button[aria-label]") as HTMLButtonElement;
    flushSync(() => close.click());
    expect(first.querySelector('[data-testid="engine-limit-notice"]')).toBeNull();
    const again = remount(createElement(EngineLimitNotice, { engine: "claude" }));
    expect(again.querySelector('[data-testid="engine-limit-notice"]')).toBeNull();
    limits.rememberLimits({ checkedAt: NOW, engines: [claude(100, true)] });
    const blocked = remount(createElement(EngineLimitNotice, { engine: "claude" }));
    expect(blocked.querySelector('[data-testid="engine-limit-notice"]')?.textContent).toContain("at its limit");
  });

  it("offers Continue at reset when bot and thread are known", async () => {
    limits.rememberLimits({ checkedAt: NOW, engines: [claude(100, true)] });
    fixture.api.mockImplementation(async (path: unknown) =>
      String(path) === "/api/limit-resets/continue"
        ? { routine: { id: "r1" } }
        : { checkedAt: NOW, engines: [claude(100, true)] });
    const container = remount(createElement(EngineLimitNotice, {
      engine: "claude",
      botId: "scout",
      threadId: "t-1",
    }));
    const continueBtn = container.querySelector('[data-testid="engine-limit-continue"]') as HTMLButtonElement;
    expect(continueBtn?.textContent).toMatch(/Continue at/);
    flushSync(() => continueBtn.click());
    await settle();
    expect(fixture.api).toHaveBeenCalledWith("/api/limit-resets/continue", {
      method: "POST",
      body: JSON.stringify({ botId: "scout", threadId: "t-1" }),
    });
  });

  it("stays quiet for another engine", () => {
    expect(remount(createElement(EngineLimitNotice, { engine: "codex" })).innerHTML).toBe("");
  });
});
