// The bot panel's Upcoming card (#2125 / #2174, as the reference app): a clock before
// each routine, the folder as a `[Category]` title prefix, a paused one says
// only "Paused" (its switch off, the schedule in the tooltip), and "Show more"
// after five rows.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { setLocale } from "@/lib/i18n";
import type { Routine } from "@/lib/routines";
import { RoutineList, routinePanelTitle } from "./RoutineList";

const routine = (id: string, enabled: boolean, folder?: string, nextRunAt?: number): Routine => ({
  id, botId: "bot-1", name: `Routine ${id}`, prompt: "p", enabled, target: "bot",
  ...(folder ? { folder } : {}),
  schedule: { type: "cron", expression: "3 4 * * *", timeZone: "America/Toronto" },
  nextRunAt: nextRunAt ?? (enabled ? Date.now() + 3_600_000 : undefined), createdAt: 1, updatedAt: 1,
} as unknown as Routine);

const render = (routines: Routine[]) => renderToStaticMarkup(createElement(RoutineList, {
  routines, viewerPrincipalId: null, runs: [], onOpen: () => {}, onToggle: () => {}, grouped: true, leadingClock: true, collapseAfter: 5,
}));

afterEach(() => setLocale("en"));

describe("routinePanelTitle", () => {
  it("prefixes the folder in brackets and skips a name that already has it", () => {
    expect(routinePanelTitle({ name: "Nightly check", folder: "Home lab" })).toBe("[Home lab] Nightly check");
    expect(routinePanelTitle({ name: "[Home lab] Nightly check", folder: "Home lab" })).toBe("[Home lab] Nightly check");
    expect(routinePanelTitle({ name: "Morning brief" })).toBe("Morning brief");
  });
});

describe("Upcoming card in the bot panel", () => {
  it("says Paused under a paused routine, with its switch off, and keeps the schedule in the tooltip", () => {
    const html = render([routine("a", false)]);
    expect(html).toContain('data-routine-when="Paused"');
    expect(html).toMatch(/data-routine-when="Paused"[^>]*title="[^"]*4:03/);
    expect(html).toContain('aria-checked="false"');
    // one "Paused", never a second line under it
    expect(html.match(/>Paused</g)).toHaveLength(1);
    setLocale("fr");
    expect(render([routine("a", false)])).toContain('data-routine-when="En pause"');
  });

  it("keeps the schedule for an active routine and shows more after five", () => {
    const html = render(["a", "b", "c", "d", "e", "f"].map((id) => routine(id, true)));
    expect(html).not.toContain('data-routine-when="Paused"');
    expect(html.match(/data-routine-row[ =>]/g)).toHaveLength(5);
    expect(html).toContain("Show more");
    expect(html).toContain('data-routines-show-more="more"');
  });

  it("hides Show more when there are five or fewer routines", () => {
    const html = render(["a", "b", "c", "d", "e"].map((id) => routine(id, true)));
    expect(html.match(/data-routine-row[ =>]/g)).toHaveLength(5);
    expect(html).not.toContain("Show more");
    expect(html).not.toContain("data-routines-show-more");
  });

  it("prefixes the category on the title", () => {
    const html = render([routine("a", true, "Home lab"), routine("b", true, "Security")]);
    expect(html).toContain("[Home lab] Routine a");
    expect(html).toContain("[Security] Routine b");
  });

  it("lists active routines before paused ones", () => {
    const soon = routine("soon", true, "Brief", Date.now() + 1_000);
    const later = routine("later", true, "Brief", Date.now() + 10_000);
    const paused = routine("paused", false, "Social");
    const html = render([paused, later, soon]);
    const soonAt = html.indexOf("Routine soon");
    const laterAt = html.indexOf("Routine later");
    const pausedAt = html.indexOf("Routine paused");
    expect(soonAt).toBeGreaterThan(-1);
    expect(soonAt).toBeLessThan(laterAt);
    expect(laterAt).toBeLessThan(pausedAt);
  });
});
