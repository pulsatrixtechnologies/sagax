// @vitest-environment happy-dom
// Real desktop surfaces and reducer in an isolated, network-free workspace.
// Count function executions at an existing hook on each surface, rather than
// Profiler subtree commits (a child's own render is not its parent's render).
import { act, createElement, useReducer, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Action, AppState, Bot } from "@/state/store";

const measured = vi.hoisted(() => ({
  counts: {} as Record<string, number>,
  record() {
    const caller = new Error().stack?.match(/at (?:Module\.|Object\.)?(Shell|ChatView|BotSettingsDialog)\s*\(/)?.[1];
    if (caller) this.counts[caller] = (this.counts[caller] ?? 0) + 1;
  },
}));
vi.mock("./DesktopCapabilities", async (original) => ({
  ...await original<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: { dictation: { available: false }, host: { packaged: true, platform: "other" }, localComputer: { available: false } }, ready: true }),
  useCaptionChrome: () => ({}),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn(), initAnalytics: vi.fn() }));
vi.mock("@/lib/cloud-guest", () => ({ useCanWriteIn: () => true }));
vi.mock("./ModelPicker", () => ({ ModelPicker: () => null }));
await import("@/state/store");
await import("./ChatView");
const { Shell } = await import("../App");
const screens = await import("./lazy-screens");
const mode = await import("@/lib/interface-mode");
const sidebarHelpers = await import("./Sidebar.tsx-parts/helpers");
const composerFocus = await import("./Composer.tsx-parts/useComposerFocus");
const { BotEditorStore, initialState } = await import("@/state/store");
const { reducer } = await import("@/state/store/reducer");
const { ConfirmProvider } = await import("./ConfirmProvider");
const { ThreadRefsProvider } = await import("./ThreadRefs");
const { setLocale } = await import("@/lib/i18n");
setLocale("en");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const at = Date.UTC(2026, 10, 3, 12);
const bots: Bot[] = Array.from({ length: 24 }, (_, i) => ({
  id: `bot-${i}`, name: i === 0 ? "Osprey" : `Wren ${i}`, threadId: `thread-${i}`, title: "", description: "", color: "blue",
  notifications: true, unread: false, busy: false, activity: "idle", modelSelection: { instanceId: "fixture", model: "test" },
  tasks: [{ threadId: `thread-${i}`, title: "Conversation", createdAt: at, busy: false, activity: "idle", unread: false }],
  messages: Array.from({ length: 40 }, (_, j) => ({ id: `m-${i}-${j}`, parentId: j ? `m-${i}-${j - 1}` : undefined,
    at: at + j, role: j % 2 ? "bot" : "user", kind: "text", text: `Message ${j}` })),
})) as Bot[];
const run = { id: "run-1", routineId: "routine-1", routineName: "Daily report", botId: "bot-1", status: "running", createdAt: at, scheduledFor: at, target: "bot", runOn: "maus", manual: false, prompt: "Report", timeoutMinutes: 30 } as import("@/lib/routines").RoutineRun;
const start: AppState = { ...initialState, bots, selectedId: bots[0]!.id, connected: true, everConnected: true, hydrated: true, settingsOpen: true, routineRuns: [run] };
let send: (action: Action) => void;
let seen: AppState;
function Host({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, start);
  send = dispatch;
  seen = state;
  return createElement(BotEditorStore, { value: { state, dispatch, flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} }, children });
}
class Observer { observe() {} unobserve() {} disconnect() {} }
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  localStorage.clear();
  measured.counts = {};
  vi.spyOn(screens, "preloadScreens").mockImplementation(() => () => {});
  vi.spyOn(mode, "useAdvancedMode").mockImplementation(() => { measured.record(); return true; });
  const fade = sidebarHelpers.useScrollFade;
  vi.spyOn(sidebarHelpers, "useScrollFade").mockImplementation(() => {
    measured.counts.Sidebar = (measured.counts.Sidebar ?? 0) + 1;
    return fade();
  });
  const focus = composerFocus.useComposerFocus;
  vi.spyOn(composerFocus, "useComposerFocus").mockImplementation((...args) => {
    measured.counts.Composer = (measured.counts.Composer ?? 0) + 1;
    return focus(...args);
  });
  vi.stubGlobal("ResizeObserver", Observer);
  vi.stubGlobal("IntersectionObserver", Observer);
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).includes("/activity")
    ? new Response(JSON.stringify({ items: [], subagents: [], launchedAgents: [] }))
    : new Response("{}", { status: 404 })));
  vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(() => {});
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const settle = async () => { await act(async () => { for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0)); }); };
it("isolates the desktop from background reply, routine and activity frames", async () => {
  await screens.BotSettingsDialog.preload();
  await act(async () => root.render(createElement(Host, null, createElement(ConfirmProvider, null, createElement(ThreadRefsProvider, null, createElement(Shell))))));
  await settle();
  for (const name of ["Shell", "ChatView", "Sidebar", "BotSettingsDialog", "Composer"]) expect(measured.counts[name], name).toBeGreaterThan(0);
  const report: Record<string, Record<string, number>> = {};
  for (const scenario of ["reply", "routine", "activity", "poll", "activeReply"] as const) {
    const before = { ...measured.counts };
    for (let step = 0; step < 12; step++) {
      await act(async () => {
        if (scenario === "poll") window.dispatchEvent(new CustomEvent("sagax-cloud-agent", { detail: { botId: "bot-0" } }));
        else if (scenario === "activeReply") send({ type: "messagePatched", threadId: "thread-0", message: { ...bots[0]!.messages[39]!, text: `Visible reply ${step}` } });
        else if (scenario === "reply") send({ type: "messagePatched", threadId: "thread-1", message: { ...bots[1]!.messages[39]!, text: `Streaming reply ${step}` } });
        else if (scenario === "routine") send({ type: "routineRunPatched", run: { ...run, attention: `Step ${step}` } });
        // Activity polling's store notification: a refreshed off-screen bot
        // announces the same visible fields, without a change to its visible fields.
        else send({ type: "botPatched", bot: { ...seen.bots[2]! } });
      });
    }
    report[scenario] = Object.fromEntries(Object.entries(measured.counts).map(([name, n]) => [name, n - (before[name] ?? 0)]));
  }
  process.stdout.write(`STORE-RENDERS ${JSON.stringify(report)}\n`);
  expect(container.querySelector("[data-chat-column]")).not.toBeNull();
  expect(container.textContent).toContain("Visible reply 11");
  expect(report.activeReply!.ChatView).toBeGreaterThan(0);
  if (!process.env.STORE_RENDER_BASELINE) {
    expect(report.activeReply!.Shell).toBe(0);
    for (const count of Object.values(report.poll!)) expect(count).toBe(0);
    for (const scenario of ["routine", "activity"]) for (const name of ["Shell", "ChatView"]) expect(report[scenario]![name], `${scenario}:${name}`).toBe(0);
    for (const name of ["Shell", "ChatView"]) expect(report.reply![name], `reply:${name}`).toBe(0);
  }
});
