// #1753: calendar quick-create recovers a create whose answer was lost.
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { ConfirmProvider } from "@/components/ConfirmProvider";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";
import type { Routine } from "../../shared/routines";

const fixture = vi.hoisted(() => ({
  api: vi.fn(),
  dispatch: vi.fn(),
  state: {} as Record<string, unknown>,
}));

vi.mock("@/state/store", async (original) => ({
  ...await original<typeof import("@/state/store")>(),
  api: fixture.api,
  useStore: () => ({ state: fixture.state, dispatch: fixture.dispatch, flushBotPatches: () => Promise.resolve() }),
}));
vi.mock("./DesktopCapabilities", async (original) => ({
  ...await original<typeof import("./DesktopCapabilities")>(),
  useCaptionChrome: () => ({ padClass: "" }),
  useMacInsetChrome: () => ({ macInset: false, browser: true }),
  useDesktopCapabilities: () => ({ capabilities: { host: {}, dictation: { available: false } }, ready: true }),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

const { setLocale, t } = await import("@/lib/i18n");
const { QuickComposer } = await import("./RoutineCalendarPage");

const bot = {
  id: "scout", threadId: "thread", name: "Scout", title: "", description: "",
  color: "green", notifications: true, unread: false, busy: false, messages: [], hidden: false,
  modelSelection: { instanceId: "claude", model: "m" },
} as unknown as Bot;

const created = {
  id: "quick-1", name: "Check inbox", prompt: "Read new mail", target: "bot", botId: bot.id,
  runOn: "maus", enabled: true, schedule: { type: "once", at: Date.UTC(2026, 9, 10, 9) }, durationMinutes: 30,
  nextRunAt: null, createdAt: 10, updatedAt: 10,
} as Routine;

let host: HTMLDivElement;
let root: Root;
const settle = async () => {
  for (let i = 0; i < 8; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};
const button = (text: string) =>
  [...host.querySelectorAll<HTMLButtonElement>("button")].find((element) => element.textContent?.trim() === text);

beforeEach(() => {
  setLocale("en");
  fixture.api.mockReset();
  fixture.dispatch.mockReset();
  fixture.state = { bots: [bot], groups: [], config: null, routines: [], routineRuns: [], calendarCalls: [] };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

describe("QuickComposer lost-answer recovery (#1753)", () => {
  it("keeps the routine and closes when the create answer is lost", async () => {
    const lost = Object.assign(new Error("499 Unknown Status Code"), { status: 499, body: {} });
    fixture.api
      .mockRejectedValueOnce(lost)
      .mockResolvedValueOnce({ routines: [created] });
    const onSavedRoutine = vi.fn();
    const onClose = vi.fn();
    flushSync(() => root.render(createElement(ConfirmProvider, null, createElement(QuickComposer, {
      seed: { kind: "routine", at: Date.UTC(2026, 9, 10, 9), durationMinutes: 30, botIds: [bot.id], name: "Check inbox", description: "Read new mail" },
      bots: [bot], routinesOnly: true, onClose, onMore: vi.fn(), onSavedRoutine, onSavedCall: vi.fn(),
    }))));
    flushSync(() => button("Save")!.click());
    await settle();
    expect(fixture.api).toHaveBeenCalledTimes(2);
    expect(fixture.api.mock.calls[0]![0]).toBe("/api/routines");
    expect(fixture.api.mock.calls[1]![0]).toBe("/api/routines");
    expect(onSavedRoutine).toHaveBeenCalledWith(created);
    expect(onClose).toHaveBeenCalledOnce();
    expect(host.textContent).not.toContain("499");
  });

  it("shows the readable lost-answer line when the routine is not found", async () => {
    const lost = Object.assign(new Error("499 Unknown Status Code"), { status: 499, body: {} });
    fixture.api
      .mockRejectedValueOnce(lost)
      .mockResolvedValueOnce({ routines: [] });
    const onSavedRoutine = vi.fn();
    flushSync(() => root.render(createElement(ConfirmProvider, null, createElement(QuickComposer, {
      seed: { kind: "routine", at: Date.UTC(2026, 9, 10, 9), durationMinutes: 30, botIds: [bot.id], name: "Check inbox", description: "Read new mail" },
      bots: [bot], routinesOnly: true, onClose: vi.fn(), onMore: vi.fn(), onSavedRoutine, onSavedCall: vi.fn(),
    }))));
    flushSync(() => button("Save")!.click());
    await settle();
    expect(onSavedRoutine).not.toHaveBeenCalled();
    expect(host.textContent).toContain(t("routineCalendar.saveAnswerLost"));
    expect(host.textContent).not.toContain("499 Unknown Status Code");
  });
});

// 2026-11-01 (no modals): quick create is a popover hung off the slot, with no
// scrim; an empty one gets out of the way on a press outside, a draft stays.
describe("QuickComposer as an anchored popover", () => {
  const render = (seed: Partial<Parameters<typeof QuickComposer>[0]["seed"]> = {}, onClose = vi.fn()) => {
    flushSync(() => root.render(createElement(ConfirmProvider, null, createElement(QuickComposer, {
      seed: { kind: "routine", at: Date.UTC(2026, 9, 10, 9), durationMinutes: 30, botIds: [bot.id], anchor: { x: 300, y: 200, left: 200 }, ...seed },
      bots: [bot], routinesOnly: true, onClose, onMore: vi.fn(), onSavedRoutine: vi.fn(), onSavedCall: vi.fn(),
    }))));
    return onClose;
  };
  const pressOutside = () => document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  const escape = () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));

  it("is a non-modal popover with no scrim, anchored where it was opened", () => {
    render();
    const popover = host.querySelector<HTMLElement>("[data-quick-create]")!;
    expect(popover.getAttribute("aria-modal")).toBe("false");
    expect(popover.classList.contains("popover-surface")).toBe(true);
    expect(popover.hasAttribute("data-quick-create-anchored")).toBe(true);
    expect(document.querySelector(".bg-black\\/25, .bg-black\\/50")).toBeNull();
  });

  it("closes on a press outside while empty", () => {
    const onClose = render();
    pressOutside();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("keeps a draft on a press outside, and asks before Escape drops it", async () => {
    const onClose = render({ name: "Check inbox" });
    pressOutside();
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => { escape(); });
    expect(document.getElementById("confirm-dialog-body")?.textContent).toBe(t("routineEditor.discard"));
    await act(async () => { [...document.querySelectorAll("button")].find((button) => button.textContent === "Cancel")!.click(); });
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => { escape(); });
    await act(async () => { (document.querySelector("[data-confirm-action]") as HTMLButtonElement).click(); });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes on Escape without asking while empty", async () => {
    const onClose = render();
    await act(async () => { escape(); });
    expect(document.querySelector("[role=alertdialog]")).toBeNull();
    expect(onClose).toHaveBeenCalledOnce();
  });
});
