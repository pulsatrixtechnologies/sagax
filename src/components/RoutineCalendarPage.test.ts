import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Children, createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup as renderMarkup } from "react-dom/server";
import { ConfirmProvider } from "@/components/ConfirmProvider";

const renderToStaticMarkup = (node: ReactNode) => renderMarkup(createElement(ConfirmProvider, null, node));
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppState, Bot } from "@/state/store";
import type { RoutineRun } from "@/lib/routines";

const fixture = vi.hoisted(() => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  return { state: undefined as AppState | undefined, dispatch: vi.fn() };
});
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({ state: fixture.state ?? original.initialState, dispatch: fixture.dispatch }) };
});
// The real useDesktopCapabilities rides along: it only asks this module for the
// window chrome, and these tests render the desktop-neutral layout.
vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: { host: {}, dictation: { available: false } }, ready: true }),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

const { initialState } = await import("@/state/store");
const { RoutinesPage: MemoRoutinesPage, RoutineEditor, EventDetails } = await import("./RoutineCalendarPage");
// The page is memoized (2026-11-02, calendar performance): these tests call
// its function directly.
const RoutinesPage = MemoRoutinesPage.type;
const { PageMenuItem } = await import("./content-page");
const bot: Bot = {
  id: "runner", threadId: "execution", name: "Runner", title: "", description: "", color: "green",
  notifications: true, unread: false, busy: false, messages: [],
  modelSelection: { instanceId: "test", model: "test" },
};
const failed: RoutineRun = {
  id: "failed-run", routineId: "broken", routineName: "Broken report", target: "bot", botId: bot.id,
  runOn: "maus", scheduledFor: 100, createdAt: 100, status: "failed", manual: false, error: "Provider crashed",
};
const missed: RoutineRun = { ...failed, id: "missed-run", routineId: "stale", routineName: "Stale digest", status: "missed" };
const completed: RoutineRun = { ...failed, id: "fine-run", routineId: "fine", routineName: "Fine brief", status: "completed" };

type Button = { "aria-label"?: string; title?: string; children?: ReactNode; onClick?: () => void };
function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  return Children.toArray(node).map((child) => isValidElement<{ children?: ReactNode }>(child) ? textOf(child.props.children) : textOf(child)).join("");
}

/** Capture the real page's returned controls under React's hook dispatcher. */
function buttonsFrom(render: () => ReactNode): Map<string, Button> {
  const buttons = new Map<string, Button>();
  function visit(node: ReactNode) {
    Children.forEach(node, (child) => {
      if (!isValidElement<Button>(child)) return;
      // a ☰ entry (content-page.tsx) renders a button of its own
      if (child.type === "button" || child.type === PageMenuItem) buttons.set(child.props["aria-label"] ?? child.props.title ?? textOf(child.props.children), child.props);
      visit(child.props.children);
      // the shared header takes its controls as props (primary, actions)
      for (const [key, value] of Object.entries(child.props as Record<string, unknown>)) {
        if (key !== "children" && isValidElement(value)) visit(value);
      }
    });
  }
  function Capture() { visit(render()); return null; }
  renderToStaticMarkup(createElement(Capture));
  return buttons;
}

function page() {
  return buttonsFrom(() => RoutinesPage({ onBack: vi.fn(), onOpenRoom: vi.fn() }));
}

function markupOf() {
  function Capture() { return RoutinesPage({ onBack: vi.fn(), onOpenRoom: vi.fn() }); }
  return renderToStaticMarkup(createElement(Capture));
}

beforeEach(() => {
  fixture.dispatch.mockClear();
  fixture.state = { ...initialState, bots: [bot], routineRuns: [failed, missed, completed] };
});
afterAll(() => vi.unstubAllGlobals());

describe("routine failure indicators", () => {
  it("shows the errors pill and mark-all control only while failures are unread", () => {
    const buttons = page();
    expect(textOf(buttons.get("Open problem run logs")!.children)).toBe("2");
    expect(buttons.has("Mark all as read")).toBe(true);

    fixture.state = { ...initialState, bots: [bot], routineRuns: [
      { ...failed, seenAt: 1 }, { ...missed, seenAt: 1 }, completed,
    ] };
    const read = markupOf();
    expect(read).not.toContain('aria-label="Open problem run logs"');
    expect(read).not.toContain('aria-label="Mark all as read"');
  });

  it("clears every failure indicator in one action from the header", () => {
    page().get("Mark all as read")!.onClick!();
    expect(fixture.dispatch).toHaveBeenCalledExactlyOnceWith({ type: "markAllRoutineRunsSeen" });
  });

  it("opens the logs on the shared problems set from the errors pill", () => {
    page().get("Open problem run logs")!.onClick!();
    expect(fixture.dispatch).toHaveBeenCalledExactlyOnceWith({ type: "showRoutines", section: "logs", runStatus: "problems" });
  });

  it("lands the focused problems filter on the logs instead of every status", () => {
    fixture.state = { ...initialState, bots: [bot], routineRuns: [failed, missed, completed],
      routinesFocus: { section: "logs", runStatus: "problems", nonce: 1 } };
    const markup = markupOf();
    expect(markup).toContain("Broken report");
    expect(markup).toContain("Stale digest");
    // the routine filter still offers it; no run of it is listed
    const rows = markup.slice(markup.lastIndexOf("</select>"));
    expect(rows).not.toContain("Fine brief");
    expect(markup).toContain('<option value="problems" selected="">Problems</option>');
  });
});

describe("routine setup", () => {
  function editorMarkup() {
    function Capture() { return createElement(RoutineEditor, { bots: [bot], lockedBotId: bot.id, onClose: vi.fn() }); }
    return renderToStaticMarkup(createElement(Capture));
  }
  it("runs on the bot's current setup without offering a runner choice", () => {
    const html = editorMarkup();
    expect(html).not.toContain("current setup");
    expect(html).not.toContain("Boat-hosted agent");
    expect(html).not.toContain("data-routine-run-on");
  });
  it("offers the Boat runner only behind the experimental Boat flag", () => {
    fixture.state = { ...fixture.state!, config: { ...fixture.state!.config, features: { boatComputer: true }, box: { configured: false } } as unknown as AppState["config"] };
    // 2026-11-03: a "Runs on" row with the app's pill menu (the choices open on click).
    const html = editorMarkup();
    expect(html).toContain("data-routine-run-on");
    expect(html).toContain('aria-label="Runs on"');
  });
  it("offers routine Effort beside Model with the bot default", () => {
    fixture.state = { ...fixture.state!, instances: [{ instanceId: "test", capabilities: { effortLevels: ["low", "high"] }, models: { default: "test", options: [{ id: "test", label: "Test" }] } }] as unknown as AppState["instances"] };
    const html = editorMarkup();
    expect(html).toContain("data-routine-effort");
    expect(html).toContain('aria-label="Effort"');
    expect(html).toContain("Bot&#x27;s effort");
  });

  it("offers the sub-agent Model only on a Claude engine (#2049)", () => {
    const instance = (driverKind: string) => ({ instanceId: "test", driverKind, models: { default: "test", options: [{ id: "test", label: "Test" }, { id: "fast", label: "Fast" }] } });
    fixture.state = { ...fixture.state!, instances: [instance("claudeAgent")] as unknown as AppState["instances"] };
    const claude = editorMarkup();
    expect(claude).toContain("data-routine-subagent-model");
    expect(claude).toContain('aria-label="Sub-agent model"');
    fixture.state = { ...fixture.state!, instances: [instance("codex")] as unknown as AppState["instances"] };
    expect(editorMarkup()).not.toContain("data-routine-subagent-model");
  });

  it("offers a Model choice that starts on the bot's model (2026-11-04)", () => {
    fixture.state = { ...fixture.state!, instances: [{ instanceId: "test", models: { default: "test", options: [{ id: "test", label: "Test" }, { id: "fast", label: "Fast" }] } }] as unknown as AppState["instances"] };
    const html = editorMarkup();
    expect(html).toContain("data-routine-model");
    expect(html).toContain('aria-label="Model"');
    expect(html).toContain("Bot&#x27;s model");
  });
});

describe("a routine's page (2026-10-29: its runs, then its Configuration, as cloud routines read)", () => {
  const routine = {
    id: "dispatch", name: "Morning board", prompt: "Read the board.\n".repeat(40), target: "bot", botId: bot.id, runOn: "maus", enabled: true,
    schedule: { type: "daily", time: "06:00", weekdays: [1, 2, 3, 4, 5] }, durationMinutes: 30, nextRunAt: null, createdAt: 1, updatedAt: 1,
    runAs: { principalId: "pr_bob", name: "Bob" },
  } as unknown as import("@/lib/routines").Routine;
  function details() {
    const item = { kind: "routine" as const, id: "dispatch", at: Date.parse("2026-10-09T10:00:00Z"), durationMinutes: 30, routine, run: null };
    return renderToStaticMarkup(createElement(EventDetails, { item, bots: [bot], onClose: vi.fn(), onEdit: vi.fn(), onCallChanged: vi.fn(), onOpenRoom: vi.fn() }));
  }

  it("opens on the run history in the right detail panel (no modal, no scrim), its summary opening the configuration", () => {
    const html = details();
    expect(html).toContain("data-routine-detail");
    expect(html).toContain("data-routine-summary");
    expect(html).toContain("data-routine-trigger-row");
    expect(html).not.toContain('data-routine-view="configuration"');
    expect(html).toContain('data-event-details="routine"');
    // 2026-11-01: the shared DetailPanel, beside the calendar, not over it
    expect(html).toContain("data-detail-panel");
    expect(html).toContain('role="region"');
    expect(html).not.toContain('role="dialog"');
    expect(html).not.toContain("bg-black/");
    expect(html).not.toContain("fixed inset-0");
    // the instructions live in the editor: the page leads with what happened
    expect(html).not.toContain("Read the board.");
  });

  it("a routine's bar is exactly Run now, Edit, Disable or Enable, Delete (2026-11-03); Duplicate is in Edit > Advanced", () => {
    const html = details();
    for (const marker of ["data-routine-toggle", "data-routine-edit", "data-routine-delete"]) expect(html).toContain(marker);
    for (const marker of ["data-routine-duplicate", "data-routine-logs"]) expect(html).not.toContain(marker);
  });
});

describe("the Automations header (Owner, 2026-10-27: one row, secondary controls grouped)", () => {
  function header() {
    const html = markupOf();
    return html.slice(html.indexOf("<header"), html.indexOf("</header>"));
  }

  it("has no Team map button: it lives under the avatar menu's Tools", () => {
    const buttons = page();
    expect([...buttons.keys()].some((label) => label === "Team map" || label === "Carte de l'équipe")).toBe(false);
    expect(markupOf()).not.toContain("data-routines-team-map");
  });

  it("keeps the view, the dates and New visible, and folds scope, bot and range into Filters", () => {
    const html = header();
    expect(html).toContain('aria-label="Schedule view"');
    expect(html).toContain('aria-label="Previous dates"');
    expect(html).toContain(">Today</button>");
    expect(html).toContain("data-automations-range");
    expect(html).toContain("data-automations-create");
    expect(html).toContain('aria-label="Create an automation"');
    // the bot and range selects sit inside the Filters popover, not on the row
    const filters = html.slice(html.indexOf("data-automations-filters"));
    expect(filters).toContain('aria-label="Filter schedule by bot"');
    expect(filters).toContain('aria-label="Schedule range"');
    expect(html.indexOf('aria-label="Filter schedule by bot"')).toBeGreaterThan(html.indexOf("data-automations-filters"));
  });

  it("counts the active filters on the Filters button and clears them in one action", () => {
    expect(header()).toContain('aria-label="Filters"');
    fixture.state = { ...fixture.state!, routinesFocus: { section: "schedule", botId: bot.id, nonce: 2 } };
    const html = header();
    expect(html).toContain('aria-label="Filters, 1 active"');
    expect(html).toContain("data-automations-filter-count");
    expect(html).toContain("data-routine-filter-reset");
  });

  it("puts Paused routines in the menu with its count, and keeps the run indicators", () => {
    const paused = { id: "p1", name: "Paused digest", prompt: "", target: "bot", botId: bot.id, runOn: "maus", enabled: false,
      schedule: { type: "daily", time: "06:00", weekdays: [1] }, durationMinutes: 30, createdAt: 1, updatedAt: 1 } as unknown as import("@/lib/routines").Routine;
    fixture.state = { ...fixture.state!, routines: [paused], routineRuns: [failed, { ...completed, id: "busy", status: "running" }] };
    const buttons = page();
    expect(buttons.has("View paused routines")).toBe(true);
    expect(textOf(buttons.get("Open problem run logs")!.children)).toBe("1");
    const html = header();
    expect(html).toContain("data-automations-running");
    expect(html).toContain('title="1 active"');
  });

  it("labels every icon-only control and clears the Windows caption buttons", () => {
    const html = header();
    for (const label of ["Previous dates", "Next dates", "Create an automation", "Filters"]) expect(html).toContain(`title="${label}"`);
    expect(html).toContain("@container/page-header");
    const routinesPageView = readFileSync(join(process.cwd(), "src/components/RoutineCalendarPage.tsx-parts/RoutinesPageView.tsx"), "utf8");
    expect(routinesPageView).toMatch(/actionsStyle=\{[^\n]*controlsShiftStyle/);
  });
});
