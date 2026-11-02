// @vitest-environment happy-dom
// New topic (header pencil): clears to the empty greeting; Back restores.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, InstanceInfo } from "@/state/store";
import { setLocale } from "@/lib/i18n";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
setLocale("en");

const fixture = vi.hoisted(() => ({
  fresh: {} as Record<string, { threadId: string; auto: boolean }>,
  dispatch: vi.fn((action: { type: string; botId?: string; threadId?: string | null; auto?: boolean }) => {
    if (action.type === "freshTopic") {
      if (action.threadId == null) delete fixture.fresh[action.botId!];
      else fixture.fresh[action.botId!] = { threadId: action.threadId, auto: Boolean(action.auto) };
    }
  }),
}));

vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  const state = () => ({
    ...original.initialState,
    freshTopic: fixture.fresh,
    instances: [{ instanceId: "test", driverKind: "codex", displayName: "Test" } as InstanceInfo],
  });
  return {
    ...original,
    useStore: () => ({ state: state(), dispatch: fixture.dispatch }),
    useStoreSelector: (select: (value: unknown) => unknown) => select(state()),
    useStoreDispatch: () => fixture.dispatch,
  };
});
vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: { dictation: { available: false }, host: { packaged: true, platform: "other" }, localComputer: { available: false, reasonCode: "cua-driver-unavailable", message: "" } }, ready: true }),
  useCaptionChrome: () => ({}),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("./ModelPicker", () => ({ ModelPicker: () => createElement("span") }));
vi.mock("./ApprovalModeSelector", () => ({ ApprovalModeSelector: () => createElement("span") }));
vi.mock("@/lib/thread-preferences", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/thread-preferences")>();
  return {
    ...original,
    useShowThreads: () => false,
    useThreadsMode: () => "one" as const,
    useShowThreadsChoice: () => false,
    setShowThreads: () => {},
  };
});

class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", TestResizeObserver);

const { ChatView } = await import("./ChatView");

const bot: Bot = {
  id: "bot", threadId: "now", name: "Pepper", title: "", description: "Ready when you are.", color: "green",
  notifications: true, unread: false, busy: false, hasMore: false,
  messages: [{ id: "m1", role: "bot", kind: "text", text: "Live answer", at: 3 } as Bot["messages"][number]],
  modelSelection: { instanceId: "test", model: "profile-default" },
  tasks: [
    { threadId: "first", title: "Invoices", createdAt: 1 },
    { threadId: "now", title: "Backups", createdAt: 3, updatedAt: 4 },
  ],
} as Bot;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  fixture.fresh = {};
  fixture.dispatch.mockClear();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
afterAll(() => {
  setLocale("en");
});

describe("ChatView New topic DOM", () => {
  it("shows an empty view after New topic and Back restores the timeline", () => {
    act(() => root.render(createElement(ChatView, { bot })));
    expect(host.textContent).toContain("Live answer");
    expect(host.querySelector("[data-fresh-topic-divider]")).toBeNull();

    fixture.fresh = { bot: { threadId: "now", auto: false } };
    act(() => root.render(createElement(ChatView, { bot })));
    expect(host.textContent).not.toContain("Live answer");
    expect(host.textContent).toContain("Ready when you are.");
    expect(host.querySelector("[data-fresh-topic-divider]")).toBeTruthy();
    const back = host.querySelector<HTMLButtonElement>("[data-fresh-topic-resume]");
    expect(back?.textContent).toContain("Back to the previous topic");

    act(() => back!.click());
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "freshTopic", botId: "bot", threadId: null });
    expect(fixture.fresh.bot).toBeUndefined();

    act(() => root.render(createElement(ChatView, { bot })));
    expect(host.textContent).toContain("Live answer");
    expect(host.querySelector("[data-fresh-topic-divider]")).toBeNull();
  });
});
