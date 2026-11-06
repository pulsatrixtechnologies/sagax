import { closeSideThread, currentSideThread } from "@/lib/side-thread";
import { Children, createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup as renderMarkup } from "react-dom/server";
import { ConfirmProvider } from "@/components/ConfirmProvider";

const renderToStaticMarkup = (node: ReactNode) => renderMarkup(createElement(ConfirmProvider, null, node));
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppState, Bot, Group } from "@/state/store";
import type { Routine, RoutineRun } from "@/lib/routines";

const fixture = vi.hoisted(() => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  return { state: undefined as AppState | undefined, dispatch: vi.fn(), showThreads: true };
});
vi.mock("@/lib/thread-preferences", () => ({ useShowThreads: () => fixture.showThreads }));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({ state: fixture.state ?? original.initialState, dispatch: fixture.dispatch }) };
});
// The real useCaptionChrome rides along: it only asks this module for the
// window chrome, and these tests render the desktop-neutral layout.
vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: { host: {}, dictation: { available: false } }, ready: true }),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

const { initialState } = await import("@/state/store");
const { EventDetails } = await import("./RoutineCalendarPage");
const { ChatView } = await import("./ChatView");

const bot: Bot = {
  id: "runner", threadId: "execution", name: "Runner", title: "", description: "", color: "green",
  notifications: true, unread: false, busy: false, messages: [],
  modelSelection: { instanceId: "test", model: "test" },
  tasks: [
    { threadId: "execution", title: "Run details", createdAt: 1, routineRunId: "run", busy: false },
    { threadId: "new-results", title: "New destination", createdAt: 2 },
    { threadId: "original-source", title: "Original conversation", createdAt: 0 },
  ],
};
const group: Group = {
  id: "room", threadId: "current-room-thread", name: "Team", memberIds: [bot.id],
  createdAt: 0, messages: [], unread: false, defaultResponder: { kind: "mentions" }, bulletin: "",
  tasks: [
    { threadId: "current-room-thread", title: "Current", createdAt: 2 },
    { threadId: "original-room-source", title: "Original request", createdAt: 0 },
  ],
};
const routine: Routine = {
  id: "routine", name: "Daily report", prompt: "Report progress", target: "bot", botId: bot.id,
  runOn: "maus", enabled: true, schedule: { type: "daily", time: "09:00", weekdays: [1] },
  durationMinutes: 30, nextRunAt: 1_000, createdAt: 0, updatedAt: 2,
  resultsThreadId: "new-results", sourceThreadId: "original-source",
};
const run: RoutineRun = {
  id: "run", routineId: routine.id, routineName: routine.name, target: "bot", botId: bot.id,
  runOn: "maus", threadId: "execution", sourceThreadId: "original-source", scheduledFor: 100,
  createdAt: 100, finishedAt: 200, status: "completed", manual: false,
};

// 2026-11-05 (#2098): a run opens in the chat, at its message; its actions
// sit in the routine panel (RoutineRunDetail), inside a render prop of
// ConnectedRunActivity. The routine page sits in the shared right panel
// (DetailPanel).
const EXPANDED = new Set(["ConnectedRunActivity", "RoutineRunDetail", "RoutineDetail", "DetailPanel"]);
const NO_ACTIVITY = { detail: null, error: false, reload: async () => {}, waiting: [], conversation: () => null };
type Button = { children?: ReactNode; onClick?: () => void };
function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  return Children.toArray(node).map((child) => isValidElement<{ children?: ReactNode }>(child) ? textOf(child.props.children) : textOf(child)).join("");
}

/** Capture the real component's returned controls under React's hook
 * dispatcher; no DOM imitation or replacement navigation implementation. */
function buttonsFrom(render: () => ReactNode): Map<string, Button> {
  const buttons = new Map<string, Button>();
  function visit(node: ReactNode) {
    Children.forEach(node, (child) => {
      if (!isValidElement<Button>(child)) return;
      if (child.type === "button") buttons.set(textOf(child.props.children), child.props);
      // The run's and the routine's pages (2026-10-29) are components of
      // their own: walk into what they draw.
      if (typeof child.type === "function" && EXPANDED.has(child.type.name)) { visit((child.type as (props: unknown) => ReactNode)(child.props)); return; }
      const { children, footer } = child.props as { children?: unknown; footer?: ReactNode };
      if (typeof children === "function") visit((children as (activity: typeof NO_ACTIVITY) => ReactNode)(NO_ACTIVITY));
      else visit(child.props.children);
      if (footer) visit(footer);
    });
  }
  function Capture() { visit(render()); return null; }
  renderToStaticMarkup(createElement(Capture));
  return buttons;
}

function details(receipt: RoutineRun | null = run, definition: Routine | null = routine) {
  const onClose = vi.fn();
  const buttons = buttonsFrom(() => EventDetails({
    item: { kind: "routine", id: receipt?.id ?? definition!.id, at: 100, durationMinutes: 30, routine: definition, run: receipt },
    bots: fixture.state!.bots, onClose, onEdit: vi.fn(), onCallChanged: vi.fn(), onOpenRoom: vi.fn(),
  }));
  return { buttons, onClose };
}

beforeEach(() => {
  fixture.dispatch.mockClear();
  fixture.showThreads = true;
  fixture.state = { ...initialState, bots: [bot], groups: [group], routines: [routine], routineRuns: [run] };
});
afterAll(() => vi.unstubAllGlobals());


/** The navigation dispatched, without the fresh topic bookkeeping every
 * thread open also dispatches (src/lib/fresh-topic.ts). */
function navigationCalls(): unknown[][] {
  return fixture.dispatch.mock.calls.filter(([action]) => (action as { type?: string }).type !== "freshTopic");
}

describe("routine results navigation", () => {
  // 2026-10-29 (maintainer: "we are in a unified chat"): a run's report is
  // in the bot's one conversation; nothing opens a separate results thread.
  it("offers no Open results thread, on a run or on its routine", () => {
    expect(details().buttons.has("Open results thread")).toBe(false);
    expect(details(null).buttons.has("Open results thread")).toBe(false);
  });

  // 2026-11-05 (#2098, the operator: "C'EST INNACEPTABLE"): a run never opens beside
  // the chat. The calendar's details draw nothing for a run (no Continue in
  // the conversation, no Close Chat) and send it to the chat, at its message.
  it("a run item draws no run view beside the chat, whatever the threads setting", () => {
    for (const showThreads of [false, true]) {
      fixture.showThreads = showThreads;
      const { buttons } = details();
      expect(buttons.has("Continue in the conversation")).toBe(false);
      expect(buttons.has("Close Chat")).toBe(false);
      expect(buttons.size).toBe(0);
      // Nothing opens a column or a thread beside the chat while it renders.
      closeSideThread();
      expect(currentSideThread()).toBeNull();
      expect(navigationCalls().some(([action]) => (action as { threadId?: string }).threadId === "execution")).toBe(false);
    }
  });

  it("a team goal's routine page keeps its Open group thread", () => {
    fixture.state!.routineRuns = [];
    const goalRoutine = { ...routine, target: "room-goal" as const, groupId: group.id };
    fixture.state!.routines = [goalRoutine];
    const { buttons } = details(null, goalRoutine);
    expect(buttons.size).toBeGreaterThan(0);
    expect(buttons.has("Continue in the conversation")).toBe(false);
  });

  it("shows no Run details bar at the top of an execution's chat", () => {
    fixture.state!.routineRuns = [run];
    const buttons = buttonsFrom(() => ChatView({ bot }));
    expect(buttons.has("Back to results")).toBe(false);
    expect(buttons.has("Run logs")).toBe(false);
  });
});
