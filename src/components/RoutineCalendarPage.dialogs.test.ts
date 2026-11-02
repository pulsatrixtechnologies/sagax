// The calendar's paused-routines list (2026-11-01, no modals) is the shared
// right detail panel (DetailPanel.tsx), like an event's details: no modal
// keyboard trap, no scrim, a named close button, and Escape inside closes it.
import { Children, createElement, isValidElement, type ReactElement, type ReactNode, type RefObject } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";
import type { Routine } from "../../shared/routines";

const fixture = vi.hoisted(() => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  return { calls: [] as { ref: RefObject<unknown>; onClose: () => void }[] };
});
vi.mock("@/hooks/use-modal-dialog", () => ({
  useModalDialog: (ref: RefObject<unknown>, onClose: () => void) => { fixture.calls.push({ ref, onClose }); },
}));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({ state: original.initialState, dispatch: vi.fn() }) };
});
vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: { host: {}, dictation: { available: false } }, ready: true }),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

const { t } = await import("@/lib/i18n");
const { PausedList } = await import("./RoutineCalendarPage");

const bot = {
  id: "runner", threadId: "execution", name: "Runner", title: "", description: "", color: "green",
  notifications: true, unread: false, busy: false, messages: [],
  modelSelection: { instanceId: "test", model: "test" },
} as Bot;
const routine: Routine = {
  id: "weekly", name: "Weekly digest", prompt: "Summarise the week", target: "bot", botId: bot.id,
  runOn: "maus", enabled: false, schedule: { type: "daily", time: "09:00", weekdays: [1, 2, 3, 4, 5] }, durationMinutes: 30,
  nextRunAt: null, createdAt: 1, updatedAt: 1,
};

type Props = { children?: ReactNode; ref?: unknown; role?: string; tabIndex?: number; onClick?: () => void; [key: string]: unknown };
function nodes(value: ReactNode): ReactElement<Props>[] {
  return Children.toArray(value).flatMap((child) => isValidElement<Props>(child) ? [child, ...nodes(child.props.children)] : []);
}
function render(element: () => ReactNode) {
  let tree: ReactNode;
  function Capture() { tree = element(); return tree; }
  renderToStaticMarkup(createElement(Capture));
  return nodes(tree);
}

beforeEach(() => { fixture.calls = []; });
afterAll(() => vi.unstubAllGlobals());

describe("calendar paused routines panel", () => {
  const panel = (onClose: () => void) => render(() => PausedList({ routines: [routine], bots: [bot], groups: [], onClose, onEdit: vi.fn(), onOpenRoom: vi.fn() }));
  const detailPanel = (tree: ReactElement<Props>[]) => tree.find((node) => typeof node.type === "function" && node.type.name === "DetailPanel")!;

  it("opens in the shared detail panel, not a modal dialog", () => {
    const onClose = vi.fn();
    const tree = panel(onClose);
    expect(fixture.calls).toHaveLength(0);
    expect(tree.some((node) => node.props.role === "dialog")).toBe(false);
    const element = detailPanel(tree);
    expect(element.props.label).toBe(t("routineCalendar.pausedTitle"));
    expect(element.props["data-paused-list-panel"]).toBe("");
    // its close button (drawn by the panel) carries the list's own label
    expect(element.props.closeLabel).toBe(t("routines.paused.close"));
    (element.props.onClose as () => void)();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("keeps every row's actions: Resume and Edit", () => {
    const html = renderToStaticMarkup(createElement(() => PausedList({ routines: [routine], bots: [bot], groups: [], onClose: vi.fn(), onEdit: vi.fn(), onOpenRoom: vi.fn() })));
    expect(html).toContain("Weekly digest");
    expect(html).toContain(`>${t("routines.resume")}<`);
    expect(html).toContain(`>${t("routines.edit")}<`);
    expect(html).toContain(`aria-label="${t("routines.paused.close")}"`);
    expect(html).toContain('role="region"');
  });
});
