import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { CIRCLE_BUTTON } from "@/lib/circle-button";
import { describe, expect, it, vi } from "vitest";

import type { Bot } from "@/state/store";
import type { Routine, RoutineRun } from "@/lib/routines";

// RoutinesSection mounts RoutineEditor from RoutineCalendarPage.tsx (only
// when "New schedule" is clicked, which these tests never do) but that
// module's top-level import of DesktopCapabilities reads `window.ogb` at
// import time; the src test suite runs under vitest's "node" environment
// (no window), so it must be stubbed as SidebarBotListItem.test.ts does.
vi.mock("@/components/DesktopCapabilities", () => ({
  useDesktopCapabilities: () => ({ capabilities: { host: { homeDir: undefined } } }),
  useCaptionChrome: () => ({ padClass: "" }),
  useMacInsetChrome: () => ({ macInset: false, browser: false }),
}));

vi.mock("@/state/store", () => ({
  api: vi.fn(),
  useStore: () => ({ state: { routinesLoadState: "ready", config: { viewer: { principalId: "pr_me" } } }, dispatch: vi.fn() }),
}));

const { RoutinesSection, RoutineDetailHeader } = await import("./RoutinesSection");
const { SettingsSurfaceProvider } = await import("../SettingsPrimitives");

const bot: Bot = {
  id: "bot-1",
  threadId: "thread-1",
  name: "Osprey",
  title: "Osprey",
  description: "",
  notifications: false,
  color: "green",
  unread: false,
  modelSelection: { instanceId: "local", model: "test-model" },
  messages: [],
};

const activeRoutine: Routine = {
  id: "r1",
  name: "Morning brief",
  prompt: "Summarize overnight news",
  target: "bot",
  botId: bot.id,
  runOn: "maus",
  enabled: true,
  schedule: { type: "daily", time: "09:00", weekdays: [1, 2, 3, 4, 5] },
  durationMinutes: 5,
  nextRunAt: Date.UTC(2026, 8, 7, 9),
  createdAt: 0,
  updatedAt: 0,
};

const pausedRoutine: Routine = {
  id: "r2",
  name: "Weekly digest",
  prompt: "Summarize the week",
  target: "bot",
  botId: bot.id,
  runOn: "maus",
  enabled: false,
  schedule: { type: "once", at: Date.now() + 86_400_000 },
  durationMinutes: 5,
  nextRunAt: null,
  createdAt: 0,
  updatedAt: 0,
};

const finishedRun: RoutineRun = {
  id: "run-1",
  routineId: "r1",
  routineName: "Morning brief",
  target: "bot",
  botId: bot.id,
  runOn: "maus",
  scheduledFor: Date.UTC(2026, 8, 6, 9),
  status: "completed",
  manual: false,
  finishedAt: Date.UTC(2026, 8, 6, 9, 2),
  createdAt: Date.UTC(2026, 8, 6, 9),
};

function render(routines: Routine[], runs: RoutineRun[]) {
  return renderToStaticMarkup(
    createElement(RoutinesSection, { bot, routines, runs }),
  );
}

describe("RoutinesSection on the bot's profile (plain surface, #3400)", () => {
  const plainRender = (routines: Routine[]) => renderToStaticMarkup(createElement(SettingsSurfaceProvider, {
    surface: "plain",
    children: createElement(RoutinesSection, { bot, routines, runs: [] }),
  }));

  it("draws the shared group: a grey label with its actions at the right, the rows inside one card", () => {
    const markup = plainRender([activeRoutine, pausedRoutine]);
    expect(markup).toContain("data-routines-group");
    // the grey label, then its actions on the same row, then one filled card
    const label = markup.indexOf('text-ink-secondary">Routines</h3>');
    const create = markup.indexOf('aria-label="Create schedule"');
    const card = markup.indexOf("data-routines-card");
    expect(label).toBeGreaterThan(-1);
    expect(create).toBeGreaterThan(label);
    expect(card).toBeGreaterThan(create);
    expect(markup).not.toContain("<h2");
    expect(markup.slice(card)).toMatch(/^data-routines-card=""[^>]*bg-card/);
    // every row is inside the card
    expect(markup.slice(card)).toContain("Morning brief");
    expect(markup.slice(card)).toContain("Weekly digest");
    expect(markup.slice(0, card)).not.toContain("Morning brief");
  });

  it("with no routine: the quiet line is the card's row", () => {
    const markup = plainRender([]);
    const card = markup.indexOf("data-routines-card");
    expect(card).toBeGreaterThan(-1);
    expect(markup.slice(card)).toContain("data-routines-hint");
  });
});

describe("RoutinesSection", () => {
  // Owner, 2026-10-27: a bot without routines shows no section (no title, no +,
  // no dashed box), one quiet line. Asking in chat stays, not underlined, and
  // there is no "New routine" (owner, 2026-10-28).
  it("shows one quiet hint instead of the section when the bot has no routines", () => {
    const markup = render([], []);
    expect(markup).toContain("data-routines-hint");
    expect(markup).toContain("Routines are recurring tasks this Bot runs on a schedule.");
    expect(markup).toContain(">Ask it in chat</button>");
    expect(markup).toContain(" to set one up.");
    expect(markup).not.toContain("New routine");
    expect(markup).not.toContain("data-routines-new");
    expect(markup).not.toMatch(/data-routines-ask[^>]*underline/);
    expect(markup).not.toContain("No schedules yet.");
    expect(markup).not.toContain("border-dashed");
    expect(markup).not.toContain("<h2");
    expect(markup).not.toContain('aria-label="Create schedule"');
  });

  it("shows the section as before as soon as one routine exists", () => {
    const markup = render([activeRoutine], []);
    expect(markup).toContain("<h2");
    expect(markup).toContain('aria-label="Create schedule"');
    expect(markup).not.toContain("data-routines-hint");
  });

  // The "..." next to the + carries Sort by prefix for as long as a title starts
  // with [X], whether or not the banner was closed.
  // 2026-10-29: the section's "…" holds New folder (the row menu no longer
  // moves routines), so it shows whenever the person may change them.
  it("shows the section's more menu to a person who may change the routines", () => {
    expect(render([{ ...activeRoutine, name: "[Reports] Morning brief" }], [])).toContain("data-routines-section-more");
    expect(render([activeRoutine], [])).toContain("data-routines-section-more");
    expect(render([{ ...activeRoutine, canEdit: false }], [])).not.toContain("data-routines-section-more");
  });

  // The bot panel lists each routine with its name and when it runs. Pause,
  // Resume, the run logs and Delete live on the routine's own page.
  it("renders each routine's name with an on/off switch on the row", () => {
    const markup = render([activeRoutine, pausedRoutine], []);
    expect(markup).toContain("Morning brief");
    expect(markup).toContain("Weekly digest");
    expect(markup).toContain('aria-label="Pause"');
    expect(markup).toContain('aria-label="Resume"');
    expect(markup.match(/role="switch"/g)).toHaveLength(2);
    expect(markup).toContain('aria-checked="true"');
    expect(markup).toContain('aria-checked="false"');
  });

  it("disables the switch with the reason for a routine the person may not change", () => {
    const markup = render([{ ...activeRoutine, canEdit: false }], []);
    expect(markup).toMatch(/role="switch"[^>]*disabled|disabled=""[^>]*role="switch"/);
    expect(markup).toContain("Read only: you can see this routine");
  });

  it("shows when an enabled routine runs, and marks a disabled one paused", () => {
    const markup = render([activeRoutine, pausedRoutine], []);
    expect(markup).toContain("Every weekday at");
    expect(markup).not.toContain('data-routine-when="Paused"');
    expect(markup).toMatch(/title="[^"]*· Paused/);
    expect(markup).not.toContain(">Active<");
  });

  it("lists the active routine before the paused one", () => {
    const markup = render([pausedRoutine, activeRoutine], []);
    expect(markup.indexOf("Morning brief")).toBeLessThan(markup.indexOf("Weekly digest"));
  });

  it("keeps one action in the header (new schedule); the run logs move to the routine's page", () => {
    const markup = render([activeRoutine], [finishedRun]);
    expect(markup).toContain('aria-label="Create schedule"');
    expect(markup).not.toContain('aria-label="Run logs"');
    expect(markup).not.toContain("Next ");
    const source = readFileSync(new URL("./RoutinesSection.tsx", import.meta.url), "utf8");
    const page = readFileSync(new URL("./RoutinePanelPage.tsx", import.meta.url), "utf8");
    const detail = source.slice(source.indexOf("if (detail)"), source.indexOf("// No routine and nothing pending"));
    // 2026-11-06 (the owner, one pane): the routine's page is its editor; Duplicate
    // from Advanced, Delete after a confirmation, Clear run logs on the page.
    for (const needle of ["<RoutinePanelPage", "onDuplicate={(routine) => setEditing({ copyOf: routine })}"]) expect(detail).toContain(needle);
    expect(detail).not.toContain('mode={editMode}');
    for (const needle of ["RoutinePanelActions", "deleteRoutine", "confirm(", "clearRoutineRuns", "RoutineStatusRows", "RoutineRunsSection"]) expect(page).toContain(needle);
    // 2026-11-05 (#2098): a run opens in the chat, never in a sheet beside it.
    expect(detail).toContain("onOpenRun={openRun}");
    expect(source).toContain("openRoutineRun(dispatch, { runId: run.id");
    expect(source).not.toContain("RoutineRunExchange");
    // The bar includes Check routine; no Edit, the page is edited in place.
    const bar = page.slice(page.indexOf("export function RoutinePanelActions"));
    for (const needle of ["RunNowButton", "data-routine-check", "routines.disable", "routines.enable", "data-routine-delete"]) expect(bar).toContain(needle);
    expect(bar).not.toContain("botPanel.routines.edit");
    for (const needle of ["data-routine-logs", "data-routine-duplicate"]) expect(bar).not.toContain(needle);
  });

  it("does not print the viewer's name twice when they own the routine and it runs as them", () => {
    const mine = {
      ...activeRoutine,
      owner: { id: "pr_me", name: "Wren" },
      runAs: { principalId: "pr_me", name: "Wren" },
    };
    const markup = render([mine], []);
    expect(markup).toContain("Morning brief");
    expect(markup).not.toContain("data-routine-owner");
    expect(markup).not.toContain("Runs as");
  });
});

// Owner, 2026-10-08: the routine page's round back and close buttons did nothing
// (the panel's drag strip swallowed them) and did not look like the panel's
// own top bar. The header is now the panel's .content-topbar row with the
// shared CIRCLE_BUTTON, back returns to the list and close closes the panel.
describe("RoutineDetailHeader", () => {
  type El = { props: { children?: unknown; onClick?: () => void; "aria-label"?: string } };
  const buttons = (node: unknown, out: El[] = []): El[] => {
    if (Array.isArray(node)) node.forEach((n) => buttons(n, out));
    else if (node && typeof node === "object" && "props" in node) {
      const el = node as El;
      if (el.props.onClick) out.push(el);
      buttons(el.props.children, out);
    }
    return out;
  };

  it("back and close call their handlers", () => {
    const onBack = vi.fn();
    const onClose = vi.fn();
    const tree = RoutineDetailHeader({ name: "Osprey inbox", onBack, onClose });
    const found = buttons(tree);
    expect(found.map((b) => b.props["aria-label"])).toEqual(["Back", "Close"]);
    found[0]!.props.onClick!();
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    found[1]!.props.onClick!();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("uses the panel's top bar row and the shared round button", () => {
    const markup = renderToStaticMarkup(createElement(RoutineDetailHeader, { name: "Osprey inbox", onBack: vi.fn(), onClose: vi.fn() }));
    expect(markup).toContain("content-topbar");
    expect(markup).toContain(CIRCLE_BUTTON);
    expect(markup).toContain("Osprey inbox");
    expect(markup.match(new RegExp(CIRCLE_BUTTON, "g"))).toHaveLength(2);
  });

  it("is the header the detail page renders", () => {
    // 2026-11-06 (the owner, one pane): the routine's page is its editor, whose one
    // header row is the panel's < name × row (content-topbar).
    const src = readFileSync(new URL("./RoutinesSection.tsx", import.meta.url), "utf8");
    expect(src).toContain("<RoutinePanelPage");
    expect(src).not.toContain("ChevronsRight");
    const body = readFileSync(new URL("../RoutineCalendarPage.tsx-parts/EventEditorBody.tsx", import.meta.url), "utf8");
    expect(body).toContain("content-topbar h-12");
  });
});
