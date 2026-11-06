// The bot panel's Upcoming card (#2125, as Grok Bot): a clock before each
// routine, a paused one says only "Paused" (its switch off, the schedule in
// the tooltip), and "Show more" after five rows.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { setLocale } from "@/lib/i18n";
import type { Routine } from "@/lib/routines";
import { RoutineList } from "./RoutineList";

const routine = (id: string, enabled: boolean): Routine => ({
  id, botId: "bot-1", name: `Routine ${id}`, prompt: "p", enabled, target: "bot",
  schedule: { type: "cron", expression: "3 4 * * *", timeZone: "America/Toronto" },
  nextRunAt: enabled ? Date.now() + 3_600_000 : undefined, createdAt: 1, updatedAt: 1,
} as unknown as Routine);

const render = (routines: Routine[]) => renderToStaticMarkup(createElement(RoutineList, {
  routines, viewerPrincipalId: null, runs: [], onOpen: () => {}, onToggle: () => {}, grouped: true, leadingClock: true, collapseAfter: 5,
}));

afterEach(() => setLocale("en"));

describe("Upcoming card in the bot panel", () => {
  it("says Paused under a paused routine, with its switch off, and keeps the schedule in the tooltip", () => {
    const html = render([routine("a", false)]);
    expect(html).toContain('data-routine-when="Paused"');
    expect(html).toMatch(/data-routine-when="Paused" title="[^"]*4:03/);
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
  });
});
