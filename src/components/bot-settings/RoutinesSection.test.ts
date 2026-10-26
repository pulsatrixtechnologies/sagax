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

const bot: Bot = {
  id: "bot-1",
  threadId: "thread-1",
  name: "Scout",
  title: "Scout",
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

describe("RoutinesSection", () => {
  it("shows an empty state when the bot has no routines", () => {
    const markup = render([], []);
    expect(markup).toContain("No schedules yet.");
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
    expect(markup).toContain('data-routine-when="Paused"');
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
    const detail = source.slice(source.indexOf("if (detail)"), source.indexOf("return <div className=\"flex flex-col gap-3\">"));
    for (const needle of ["RunNowButton", "botPanel.routines.pause", "botPanel.routines.edit", "data-routine-logs", "section: \"logs\"", "deleteRoutine"]) expect(detail).toContain(needle);
  });

  it("does not print the viewer's name twice when they own the routine and it runs as them", () => {
    const mine = {
      ...activeRoutine,
      owner: { id: "pr_me", name: "Jean-Christophe Proulx" },
      runAs: { principalId: "pr_me", name: "Jean-Christophe Proulx" },
    };
    const markup = render([mine], []);
    expect(markup).toContain("Morning brief");
    expect(markup).not.toContain("data-routine-owner");
    expect(markup).not.toContain("Runs as");
  });
});

// JC, 2026-10-08: the routine page's round back and close buttons did nothing
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
    const tree = RoutineDetailHeader({ name: "Dispatch matin TN", onBack, onClose });
    const found = buttons(tree);
    expect(found.map((b) => b.props["aria-label"])).toEqual(["Back", "Close"]);
    found[0]!.props.onClick!();
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    found[1]!.props.onClick!();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("uses the panel's top bar row and the shared round button", () => {
    const markup = renderToStaticMarkup(createElement(RoutineDetailHeader, { name: "Dispatch matin TN", onBack: vi.fn(), onClose: vi.fn() }));
    expect(markup).toContain("content-topbar");
    expect(markup).toContain(CIRCLE_BUTTON);
    expect(markup).toContain("Dispatch matin TN");
    expect(markup.match(new RegExp(CIRCLE_BUTTON, "g"))).toHaveLength(2);
  });

  it("is the header the detail page renders", () => {
    const src = readFileSync(new URL("./RoutinesSection.tsx", import.meta.url), "utf8");
    expect(src).toContain("<RoutineDetailHeader");
    expect(src).not.toContain("ChevronsRight");
  });
});
