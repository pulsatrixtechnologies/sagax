// #4151 (the owner, 2026-11-13, as the reference): the bot panel's routine
// rows have two lines (name, schedule). The last run is told by the clock's
// colour: grey when it went fine or never ran, red when it failed, orange when
// it completed with problems. Its words (result, how long ago, the short
// detail) are the clock's tooltip and accessible name; the third line is gone.
// The routines page (no leadingClock) keeps its last-run line.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { setLocale } from "@/lib/i18n";
import type { Routine, RoutineRun } from "@/lib/routines";
import { RoutineList, routineClockLabel, routineClockTone } from "./RoutineList";

const NOW = Date.now();
const H = 3_600_000;

const routine = (id: string): Routine => ({
  id, botId: "bot-1", name: `Routine ${id}`, prompt: "p", enabled: true, target: "bot",
  schedule: { type: "cron", expression: "3 4 * * *", timeZone: "America/Toronto" },
  nextRunAt: NOW + H, createdAt: 1, updatedAt: 1,
} as unknown as Routine);

const run = (routineId: string, extra: Partial<RoutineRun>): RoutineRun => ({
  id: `run-${routineId}`, routineId, routineName: routineId, target: "bot", botId: "bot-1", runOn: "maus",
  scheduledFor: NOW - 2 * H, createdAt: NOW - 2 * H, startedAt: NOW - 2 * H, finishedAt: NOW - 2 * H + 60_000, manual: false, status: "completed",
  ...extra,
} as RoutineRun);

const runs = [
  run("fine", { output: "Three messages to read." }),
  run("failed", { status: "failed", error: "The connector did not answer." }),
  run("problems", { problems: "Two machines did not answer.", output: "Two machines did not answer." }),
];

const render = (leadingClock: boolean) => renderToStaticMarkup(createElement(RoutineList, {
  routines: ["fine", "failed", "problems", "never"].map(routine), viewerPrincipalId: null, runs,
  onOpen: () => {}, onToggle: () => {}, grouped: true, leadingClock, collapseAfter: 5,
}));

function clockOf(html: string, id: string): string {
  const row = html.slice(html.indexOf(`data-routine-id="${id}"`));
  const clock = row.match(/<span data-routine-clock="[^"]*"[^>]*>[\s\S]*?<\/span>/)?.[0];
  expect(clock, `clock of ${id}`).toBeTruthy();
  return clock!;
}

afterEach(() => setLocale("en"));

describe("routineClockTone", () => {
  it("is grey when fine or never run, red when failed, orange with problems", () => {
    expect(routineClockTone(undefined)).toBe("neutral");
    expect(routineClockTone(runs[0])).toBe("neutral");
    expect(routineClockTone(runs[1])).toBe("danger");
    expect(routineClockTone(run("x", { status: "missed" }))).toBe("danger");
    expect(routineClockTone(runs[2])).toBe("warning");
  });
});

describe("bot panel routine rows: the last run as the clock's colour", () => {
  it("colours each clock from the state tokens and drops the third line", () => {
    const html = render(true);
    expect(clockOf(html, "fine")).toContain('data-routine-clock="neutral"');
    expect(clockOf(html, "fine")).toContain("text-ink-tertiary");
    expect(clockOf(html, "failed")).toContain('data-routine-clock="danger"');
    expect(clockOf(html, "failed")).toContain("text-danger");
    expect(clockOf(html, "problems")).toContain('data-routine-clock="warning"');
    expect(clockOf(html, "problems")).toContain("text-warning");
    expect(clockOf(html, "never")).toContain('data-routine-clock="neutral"');
    expect(html).not.toContain("data-routine-last-run");
  });

  it("gives the clock the former line's words as its tooltip and accessible name", () => {
    const html = render(true);
    const failed = clockOf(html, "failed");
    const label = routineClockLabel(runs[1]);
    expect(label).toMatch(/^Latest: Failed · .+ · The connector did not answer\.$/);
    expect(failed).toContain('role="img"');
    expect(failed).toContain(`aria-label="${label}"`);
    expect(failed).toContain(`title="${label}"`);
    expect(clockOf(html, "problems")).toMatch(/aria-label="Latest: Completed with problems · /);
    // nothing to say for a routine that never ran: the clock is decoration
    const never = clockOf(html, "never");
    expect(never).toContain('aria-hidden="true"');
    expect(never).not.toContain("aria-label");
    setLocale("fr");
    expect(routineClockLabel(runs[1])).toMatch(/^Dernière : /);
  });

  it("keeps the last-run line on the routines page", () => {
    const html = render(false);
    expect(html).toContain('data-routine-last-run="failed"');
    expect(html).not.toContain("data-routine-clock");
  });
});
