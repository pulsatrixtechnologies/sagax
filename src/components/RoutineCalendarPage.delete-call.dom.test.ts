// @vitest-environment happy-dom
// #1754: deleting a scheduled call that the server refuses must show the
// error in the event dialog and leave it open (same pattern as joinRoom).
import { act, createElement } from "react";
import { ConfirmProvider } from "@/components/ConfirmProvider";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";
import type { CalendarCall } from "@/lib/calendar-calls";

const fixture = vi.hoisted(() => ({
  api: vi.fn(),
  dispatch: vi.fn(),
}));
vi.mock("@/hooks/use-modal-dialog", () => ({ useModalDialog: () => {} }));
vi.mock("@/state/store", async (importOriginal) => {
  const store = await importOriginal<typeof import("@/state/store")>();
  return {
    ...store,
    api: fixture.api,
    useStore: () => ({ state: store.initialState, dispatch: fixture.dispatch }),
  };
});
vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: { host: {}, dictation: { available: false } }, ready: true }),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

const { EventDetails } = await import("./RoutineCalendarPage");
const { t } = await import("@/lib/i18n");

const bot = {
  id: "runner", threadId: "main", name: "Runner", title: "", description: "", color: "green",
  notifications: true, unread: false, busy: false, messages: [],
  modelSelection: { instanceId: "test", model: "test" },
} as Bot;

const call: CalendarCall = {
  id: "call-1",
  name: "Standup",
  description: "",
  botIds: [bot.id],
  schedule: { type: "once", at: Date.parse("2026-10-31T15:00:00Z") },
  durationMinutes: 30,
  attachments: [],
  nextRunAt: Date.parse("2026-10-31T15:00:00Z"),
  createdAt: 1,
  updatedAt: 1,
};

let root: Root;
let container: HTMLDivElement;
const flush = async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };

beforeEach(() => {
  fixture.api.mockReset();
  fixture.dispatch.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("EventDetails scheduled call delete (#1754)", () => {
  it("keeps the dialog open and shows the server refusal", async () => {
    fixture.api.mockRejectedValue(new Error("you need the right to run every bot in this call"));
    const onClose = vi.fn();
    const onCallChanged = vi.fn();
    act(() => {
      root.render(createElement(ConfirmProvider, null, createElement(EventDetails, {
        item: { kind: "call", id: call.id, at: call.schedule.type === "once" ? call.schedule.at : 0, durationMinutes: call.durationMinutes, call },
        bots: [bot],
        onClose,
        onEdit: vi.fn(),
        onCallChanged,
        onOpenRoom: vi.fn(),
      })));
    });
    const trash = container.querySelector(`button[title="${t("common.delete")}"]`) as HTMLButtonElement;
    expect(trash).toBeTruthy();
    await act(async () => { trash.click(); });
    await act(async () => { (document.querySelector("[data-confirm-action]") as HTMLButtonElement).click(); });
    await flush();
    expect(fixture.api).toHaveBeenCalledWith(`/api/calendar-calls/${call.id}`, { method: "DELETE" });
    expect(onCallChanged).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("you need the right to run every bot in this call");
  });

  it("removes the call and closes the dialog when delete succeeds", async () => {
    fixture.api.mockResolvedValue({ ok: true });
    const onClose = vi.fn();
    const onCallChanged = vi.fn();
    act(() => {
      root.render(createElement(ConfirmProvider, null, createElement(EventDetails, {
        item: { kind: "call", id: call.id, at: call.schedule.type === "once" ? call.schedule.at : 0, durationMinutes: call.durationMinutes, call },
        bots: [bot],
        onClose,
        onEdit: vi.fn(),
        onCallChanged,
        onOpenRoom: vi.fn(),
      })));
    });
    const trash = container.querySelector(`button[title="${t("common.delete")}"]`) as HTMLButtonElement;
    await act(async () => { trash.click(); });
    await act(async () => { (document.querySelector("[data-confirm-action]") as HTMLButtonElement).click(); });
    await flush();
    expect(onCallChanged).toHaveBeenCalledWith(call.id);
    expect(onClose).toHaveBeenCalledOnce();
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
});
