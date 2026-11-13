// @vitest-environment happy-dom
// #4202 (the owner, 2026-11-13, as the reference's list): a routine row has
// ONE line under its name: "Paused" when the routine is off, else its schedule
// or trigger in words ("Runs on change" for a change trigger). Never both, for
// every kind of routine, in every list this one component draws. The trigger
// of a paused routine stays in the line's tooltip.
// Point 2: while a routine runs, the bot panel row has no "Running · just
// now" line; its clock glyph becomes the app's spinner (reduced motion
// respected), "Running" and since when in its tooltip and accessible name.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { setLocale } from "@/lib/i18n";
import type { Routine, RoutineRun } from "@/lib/routines";
import { RoutineList } from "./RoutineList";

const NOW = Date.now();
const H = 3_600_000;

const KINDS = {
  cron: { schedule: { type: "cron", expression: "3 4 * * *", timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }, words: /Every day around 4:03/ },
  interval: { schedule: { type: "interval", everyMinutes: 60 }, words: /Every hour/ },
  webhook: { schedule: { type: "webhook" }, words: /webhook/i },
  mail: { schedule: { type: "event", source: "email" }, words: /mail/i },
  change: { schedule: { type: "cron", expression: "3 4 * * *", timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }, precheck: { kind: "watch", source: "files" }, words: /^Runs on change$/m },
} as const;

const routine = (kind: keyof typeof KINDS, enabled: boolean): Routine => ({
  id: `${kind}-${enabled ? "on" : "off"}`, botId: "bot-1", name: `Routine ${kind}`, prompt: "p", enabled, target: "bot",
  schedule: KINDS[kind].schedule, ...("precheck" in KINDS[kind] ? { precheck: KINDS[kind].precheck } : {}),
  nextRunAt: enabled && KINDS[kind].schedule.type !== "webhook" && KINDS[kind].schedule.type !== "event" ? NOW + H : null, createdAt: 1, updatedAt: 1,
} as unknown as Routine);

const all = (Object.keys(KINDS) as (keyof typeof KINDS)[]).flatMap((kind) => [routine(kind, true), routine(kind, false)]);

const render = (props: Record<string, unknown>, runs: RoutineRun[] = []) => {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(createElement(RoutineList, { routines: all, viewerPrincipalId: null, runs, onOpen: () => {}, onToggle: () => {}, ...props }));
  return host;
};

const VARIANTS = {
  panel: { grouped: true, toggle: false, leadingClock: true, onOpenRunning: () => {} },
  list: { grouped: true, onOpenRunning: () => {} },
  folder: { showBot: true, bots: [{ id: "bot-1", name: "Helper" }] },
};

afterEach(() => setLocale("en"));

describe("a routine row has one line under its name (#4202)", () => {
  for (const [variant, props] of Object.entries(VARIANTS)) {
    it(`${variant}: Paused when off, else the schedule or trigger, never both`, () => {
      const host = render(props);
      for (const kind of Object.keys(KINDS) as (keyof typeof KINDS)[]) {
        for (const enabled of [true, false]) {
          const row = host.querySelector(`[data-routine-id="${kind}-${enabled ? "on" : "off"}"]`) as HTMLElement;
          const lines = row.querySelectorAll("[data-routine-title] ~ span");
          expect(lines.length, `${variant} ${kind} ${enabled}`).toBe(1);
          const line = lines[0] as HTMLElement;
          const text = line.textContent!.replace(/^Helper · /, "").replace(/ · Next: .*$/, "");
          if (enabled) {
            expect(text, `${variant} ${kind}`).toMatch(KINDS[kind].words);
            expect(text).not.toContain("Paused");
          } else {
            expect(text, `${variant} ${kind}`).toBe("Paused");
            // the trigger stays readable in the tooltip
            expect(line.getAttribute("title"), `${variant} ${kind} tooltip`).toMatch(KINDS[kind].words);
          }
          expect(row.textContent).not.toMatch(/Paused.*Runs on change|Runs on change.*Paused/);
        }
      }
    });
  }

  it("says it in French too", () => {
    setLocale("fr");
    const host = render(VARIANTS.panel);
    expect(host.querySelector('[data-routine-id="change-off"] [data-routine-when]')?.textContent).toBe("En pause");
    expect(host.querySelectorAll('[data-routine-id="change-off"] [data-routine-title] ~ span')).toHaveLength(1);
  });

  it("a routine that paused itself says why on that same line", () => {
    const paused = { ...routine("change", false), autoPaused: { at: 1, failures: 5, runId: "r" } } as Routine;
    const host = render({ ...VARIANTS.list, routines: [paused] });
    const lines = host.querySelectorAll("[data-routine-title] ~ span");
    expect(lines).toHaveLength(1);
    expect(lines[0]!.textContent).toBe("Paused after 5 failures in a row");
    expect(lines[0]!.getAttribute("title")).toMatch(/Runs on change/);
  });
});

describe("a running routine in the bot panel: the clock turns into the spinner (#4202 point 2)", () => {
  const running = { id: "run-1", routineId: "cron-on", routineName: "r", target: "bot", botId: "bot-1", runOn: "maus", scheduledFor: NOW, createdAt: NOW, startedAt: NOW, manual: false, status: "running" } as RoutineRun;

  it("draws the spinner at the clock's place, no Running line", () => {
    const host = render(VARIANTS.panel, [running]);
    const row = host.querySelector('[data-routine-id="cron-on"]') as HTMLElement;
    expect(row.querySelector("[data-routine-running]")).toBeNull();
    expect(row.querySelectorAll("[data-routine-title] ~ span")).toHaveLength(1);
    const glyph = row.querySelector("[data-routine-clock]") as HTMLElement;
    expect(glyph.getAttribute("data-routine-clock")).toBe("running");
    expect(glyph.className).toContain("size-5");
    const svg = glyph.querySelector("svg")!;
    expect(svg.getAttribute("class")).toContain("animate-spin");
    expect(svg.getAttribute("class")).toContain("motion-reduce:animate-none");
    expect(svg.getAttribute("width")).toBe("16");
    expect(glyph.getAttribute("role")).toBe("img");
    expect(glyph.getAttribute("aria-label")).toBe("Running · just now");
    expect(glyph.getAttribute("title")).toBe("Running · just now");
    // the other rows keep their clock
    expect(host.querySelector('[data-routine-id="interval-on"] [data-routine-clock]')?.getAttribute("data-routine-clock")).toBe("neutral");
  });

  it("gives the clock back with its result colour when the run ends", () => {
    const host = render(VARIANTS.panel, [{ ...running, status: "failed", finishedAt: NOW, error: "No answer." }]);
    expect(host.querySelector('[data-routine-id="cron-on"] [data-routine-clock]')?.getAttribute("data-routine-clock")).toBe("danger");
  });
});
