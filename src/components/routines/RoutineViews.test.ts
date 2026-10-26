import { Children, createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Routine, RoutineRun } from "@/lib/routines";
import { RoutineList } from "./RoutineList";
import { RoutineLogs } from "./RoutineLogs";
import { latestRoutineRun, routineNextLabel } from "@/lib/routine-display";

const routine: Routine = {
  id: "brief", name: "Morning brief", prompt: "Report progress", target: "bot", botId: "scout", runOn: "maus", enabled: true,
  schedule: { type: "interval", everyMinutes: 60, anchorAt: 1 }, durationMinutes: 30, nextRunAt: 3_600_000, createdAt: 1, updatedAt: 1,
};
const run: RoutineRun = { id: "run", routineId: routine.id, routineName: routine.name, target: "bot", botId: routine.botId, runOn: "maus", scheduledFor: 100, createdAt: 100, status: "completed", manual: false, output: "Brief prepared." };

function list(props: Partial<Parameters<typeof RoutineList>[0]> = {}) {
  return renderToStaticMarkup(createElement(RoutineList, { routines: [routine], runs: [run], onOpen: vi.fn(), onLogs: vi.fn(), ...props }));
}
function logs(props: Partial<Parameters<typeof RoutineLogs>[0]> = {}) {
  return renderToStaticMarkup(createElement(RoutineLogs, { runs: [run], bots: [], status: "all", onStatusChange: vi.fn(), onClearRoutine: vi.fn(), onOpen: vi.fn(), ...props }));
}

afterEach(() => vi.useRealTimers());

// A row shows the name, when it runs, and a pause switch. Active is the
// switch. Latest results, skips and failure streaks stay in the detail
// and in the run logs.
describe("routine list", () => {
  it("shows each routine's name, when it runs and a pause switch, nothing more", () => {
    const markup = list({ routines: [{ ...routine, skippedRuns: 3, lastSkippedAt: 100, failureStreak: 2 }] });
    expect(markup).toContain("Morning brief");
    expect(markup).toContain('data-routine-when="Every hour"');
    expect(markup).not.toContain(">Active<");
    expect(markup).toContain('aria-label="Pause"');
    expect(markup).not.toContain("Brief prepared.");
    expect(markup).not.toContain("Scheduled occurrences skipped while busy");
  });

  it("names the automatic second start in a run's label", () => {
    expect(logs({ runs: [{ ...run, retried: "stalled" }] })).toContain("Retried after the engine stalled · Completed");
    expect(logs({ runs: [{ ...run, status: "failed", retried: "restarted", error: "Sagax restarted while this routine was running" }] }))
      .toContain("Retried after Sagax restarted · Failed");
    expect(logs({ runs: [{ ...run, status: "queued", retried: "usage_limit", attention: "Waiting for the engine's usage limit to reset" }] }))
      .toContain(">Queued<");
  });

  it("retains visible records during a failed refresh", () => {
    const markup = list({ error: true });
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("Retrying…");
    expect(markup).toContain("Morning brief");
  });

  it("does not show the empty state before hydration or on transport failure", () => {
    expect(list({ routines: [], runs: [], loading: true })).toContain("Loading routines…");
    expect(list({ routines: [], runs: [], loading: true })).not.toContain("No schedules yet.");
    expect(list({ routines: [], runs: [], error: true })).not.toContain("No schedules yet.");
    expect(list({ routines: [], runs: [] })).toContain("No schedules yet.");
  });

  it("calls a consumed one-shot finished rather than paused", () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const markup = list({ routines: [{ ...routine, schedule: { type: "once", at: 10 }, enabled: false, nextRunAt: null }], runs: [{ ...run, status: "failed", error: "Provider disconnected." }] });
    expect(markup).toContain("Finished schedule");
    expect(markup).not.toContain(">Paused<");
    expect(markup).not.toContain("· Paused");
    expect(markup).toContain('aria-label="Resume"');
  });

  it("never advertises a stale next timestamp for a paused routine", () => {
    expect(routineNextLabel({ ...routine, enabled: false })).toBe("Paused");
    const paused = list({ routines: [{ ...routine, enabled: false }] });
    expect(paused).toContain("Every hour · Paused");
    expect(paused).not.toContain("Next Jan");
  });

  it("lists enabled routines first, then by next run and name", () => {
    const later = { ...routine, id: "later", name: "Later brief", nextRunAt: 7_200_000 };
    const paused = { ...routine, id: "paused", name: "A paused brief", enabled: false };
    const markup = list({ routines: [paused, later, routine] });
    const order = ["Morning brief", "Later brief", "A paused brief"].map((name) => markup.indexOf(name));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("chooses a new pending run ahead of an older run that finished later", () => {
    const pending = { ...run, id: "new", createdAt: 200, scheduledFor: 200, status: "waiting" as const, attention: "Waiting for delegated work to finish" };
    expect(latestRoutineRun(routine.id, [{ ...run, finishedAt: 300 }, pending])).toBe(pending);
  });
});

describe("central routine logs", () => {
  it("keeps deleted-routine receipts and distinguishes all run outcomes", () => {
    const statuses = ["queued", "running", "waiting", "completed", "failed", "missed", "cancelled"] as const;
    const markup = logs({ runs: statuses.map((status, index) => ({ ...run, id: `run-${status}`, routineId: `removed-${index}`, routineName: `Routine ${status}`, status })) });
    for (const status of statuses) expect(markup).toContain(`Open Routine ${status} run:`);
    expect(markup).toContain("Bot unavailable");
    expect(markup).toContain("Recent saved runs");
  });

  it("filters failed and missed runs together through the shared Problems view", () => {
    const fine = { ...run, id: "fine", routineName: "Fine brief" };
    const broken = { ...run, id: "broken", routineName: "Broken report", status: "failed" as const, error: "Provider crashed" };
    const stale = { ...run, id: "stale", routineName: "Stale digest", status: "missed" as const };
    const problems = logs({ runs: [fine, broken, stale], status: "problems" });
    expect(problems).toContain("Broken report");
    expect(problems).toContain("Stale digest");
    expect(problems).not.toContain("Fine brief");
    expect(problems).toContain('<option value="problems" selected="">Problems</option>');
    const everything = logs({ runs: [fine, broken, stale] });
    for (const name of ["Fine brief", "Broken report", "Stale digest"]) expect(everything).toContain(name);
  });

  it("marks unseen problem runs with a dot that clears once they are read", () => {
    const unseen = { ...run, id: "unseen", routineName: "Unseen crash", status: "failed" as const, error: "Provider crashed" };
    const seen = { ...unseen, id: "seen", routineName: "Seen crash", seenAt: 500 };
    const markup = logs({ runs: [unseen, seen] });
    expect(markup.match(/title="Unseen failure"/g)).toHaveLength(1);
    expect(logs({ runs: [unseen, seen], status: "problems" }).match(/title="Unseen failure"/g)).toHaveLength(1);
    expect(markup).toContain('aria-label="Open Unseen crash run: Failed · Unseen failure"');
    expect(markup).toContain('aria-label="Open Seen crash run: Failed"');
  });

  it("reports status changes to its parent instead of keeping private filter state", () => {
    const onStatusChange = vi.fn();
    let select: { onChange?: (event: { target: { value: string } }) => void } | undefined;
    function visit(node: ReactNode) {
      Children.forEach(node, (child) => {
        if (!isValidElement<{ onChange?: (event: { target: { value: string } }) => void; children?: ReactNode }>(child)) return;
        if (child.type === "select") select = child.props;
        visit(child.props.children);
      });
    }
    function Capture() {
      visit(RoutineLogs({ runs: [], bots: [], status: "all", onStatusChange, onClearRoutine: vi.fn(), onOpen: vi.fn() }));
      return null;
    }
    renderToStaticMarkup(createElement(Capture));
    select!.onChange!({ target: { value: "problems" } });
    expect(onStatusChange).toHaveBeenCalledExactlyOnceWith("problems");
  });

  it("offers Clear logs next to the filters only when a clear handler is given, and asks before clearing", () => {
    expect(logs()).not.toContain("Clear logs");
    const markup = logs({ onClearLogs: vi.fn() });
    expect(markup).toContain(">Clear logs</button>");
    expect(markup).not.toContain("Clear run logs?");
    expect(logs({ runs: [], onClearLogs: vi.fn() })).toMatch(/<button[^>]*disabled=""[^>]*>Clear logs<\/button>/);
  });

  it("lands on only the requested routine's history", () => {
    const markup = logs({ routineId: "brief", runs: [run, { ...run, id: "other", routineId: "other", routineName: "Private other routine" }] });
    expect(markup).toContain("Open Morning brief run: Completed");
    expect(markup).not.toContain("Private other routine");
    expect(markup).toContain("Show all routines");
  });

  it("does not confuse delegated waiting with an approval request", () => {
    const markup = logs({ runs: [{ ...run, status: "waiting", attention: "Waiting for delegated work to finish" }] });
    expect(markup).toContain("Open Morning brief run: Waiting");
    expect(markup).toContain("Waiting for delegated work to finish");
    expect(markup).not.toContain("Needs your input");
  });

  it("keeps a team-goal block distinct from successful scheduler completion", () => {
    const markup = logs({ runs: [{ ...run, status: "completed", goalStatus: "blocked" }] });
    expect(markup).toContain("Open Morning brief run: Blocked");
  });

  it("provides distinct initial-loading, failure, and empty states", () => {
    expect(logs({ runs: [], loading: true })).toContain("Loading routines…");
    expect(logs({ runs: [], loading: true })).not.toContain("No runs recorded yet");
    expect(logs({ runs: [], error: true })).toContain('role="alert"');
    expect(logs({ runs: [] })).toContain("No runs recorded yet");
  });
});
