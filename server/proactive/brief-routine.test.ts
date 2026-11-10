// #3456 (lot 5 of #3408): the daily brief is a routine of the bot, created
// only on the person's yes. Tests first, as the issue lists them.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { nextOccurrence, RoutineManager, type RoutineManagerOptions } from "../routines/routines.ts";
import { BriefStore } from "./background-brief.ts";
import { runBrief, briefRunReason, type BriefDelivery } from "./background-brief-schedule.ts";
import { BriefRoutines, briefRoutineOf, briefSchedule, briefScheduleTime, isBriefRoutine } from "./brief-routine.ts";
import { BRIEF_ASK_DOMAIN, ProactiveAsk } from "./proactive-ask.ts";
import { ProactiveChoices } from "./proactive-choices.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "sagax-brief-routine-"));
  dirs.push(dir);
  return dir;
}

const START = Date.parse("2026-11-10T10:00:00Z");

/** A real routine manager whose `daily_brief` code check runs the brief. */
function harness(input: { briefFile?: unknown } = {}) {
  const dir = tempDir();
  let now = START;
  const briefPath = join(dir, "background-brief.json");
  if (input.briefFile !== undefined) writeFileSync(briefPath, JSON.stringify(input.briefFile));
  const store = new BriefStore(briefPath, () => now);
  const turns: string[] = [];
  const delivered: BriefDelivery[] = [];
  let reads = 0;
  const options: RoutineManagerOptions = {
    file: join(dir, "routines.json"),
    now: () => now,
    botState: () => "ready",
    createTask: () => ({ threadId: "thread-1" }),
    startTurn: async (_botId, _threadId, prompt) => { turns.push(prompt); },
    evaluateCode: async (routine) => {
      const outcome = await runBrief({ id: routine.botId, name: "Assistant", person: "person-1" }, {
        store,
        connected: () => ["Inbox"],
        fastModel: () => "fast-1",
        reads: async () => ({
          apps: () => [{ name: "Inbox", tools: ["list_messages"] }],
          read: async () => { reads += 1; return `Note ${new Date(now).toISOString().slice(0, 10)}: ${reads + 2} invoices arrived`; },
        }),
        deliver: (row) => { delivered.push(row); },
        now: () => now,
      });
      return { wake: false, reason: briefRunReason(outcome, "fr") };
    },
  };
  const manager = new RoutineManager(options);
  const briefs = new BriefRoutines({
    store,
    routines: () => ({
      list: () => manager.listRoutines(),
      create: (row, runAs) => manager.create(row, undefined, runAs ? { runAs } : undefined),
      update: (id, patch) => manager.update(id, patch),
    }),
    language: () => "fr",
    runAs: () => undefined,
  });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  /** One scheduler pass at `at`, with the code check settled. */
  const tickAt = async (at: number) => {
    now = at;
    await manager.tick();
    await settle(); await settle(); await settle();
    await manager.tick();
  };
  return { store, manager, briefs, turns, delivered, reads: () => reads, tickAt, setNow: (at: number) => { now = at; } };
}

describe("#3456: no brief without the person's yes", () => {
  it("a main bot with no saved brief settings and no routine: no brief turn and no model call", async () => {
    // an install that ran the default brief: the file is there, the main bot has no saved settings
    const h = harness({ briefFile: { version: 1, bots: { main: { suggestions: [], rejected: [], lastScheduledDay: "2026-11-09" } } } });
    const upgraded = h.briefs.upgrade([{ id: "main", main: true }]);
    expect(upgraded.created).toEqual([]);
    expect(h.manager.listRoutines()).toEqual([]);
    expect(h.store.settings("main").enabled).toBe(false);
    expect(h.briefs.view("main").enabled).toBe(false);
    expect(h.briefs.on("main")).toBe(false);
    // a whole day of scheduler passes: nothing is read, no turn starts
    for (let at = START; at < START + 24 * 60 * 60_000; at += 60 * 60_000) await h.tickAt(at);
    expect(h.reads()).toBe(0);
    expect(h.turns).toEqual([]);
    expect(h.delivered).toEqual([]);
    expect(h.manager.listRuns()).toEqual([]);
  });

  it("a fresh install owes no card; the upgrade runs once", () => {
    const h = harness();
    expect(h.briefs.upgrade([{ id: "main", main: true }])).toEqual({ created: [], owed: [] });
    expect(h.store.cardsOwed()).toEqual([]);
    expect(h.store.routinesMigrated()).toBe(true);
  });
});

describe("#3456: saved settings become the routine", () => {
  const saved = {
    version: 1,
    bots: {
      main: { settings: { enabled: true, everyHours: 4, subjects: ["Factures", "Contrats"], at: "06:30", timeZone: "America/Toronto" }, suggestions: [], rejected: [] },
      helper: { settings: { enabled: false, everyHours: 4, subjects: [], at: "09:00", timeZone: "America/Toronto" }, suggestions: [], rejected: [] },
    },
  };

  it("after the upgrade the routine exists with the same time and subjects, and runs once a day", async () => {
    const h = harness({ briefFile: saved });
    expect(h.briefs.upgrade([{ id: "main", main: true }, { id: "helper", main: false }])).toEqual({ created: ["main"], owed: [] });
    // a second start changes nothing
    expect(h.briefs.upgrade([{ id: "main", main: true }])).toEqual({ created: [], owed: [] });
    const routines = h.manager.listRoutines();
    expect(routines).toHaveLength(1);
    const routine = routines[0]!;
    expect(isBriefRoutine(routine)).toBe(true);
    expect(routine).toMatchObject({ botId: "main", enabled: true, name: "Brief du jour", schedule: { type: "cron", expression: "30 6 * * *", timeZone: "America/Toronto" } });
    expect(routine.prompt).toContain("Sujets : Factures, Contrats.");
    expect(h.briefs.view("main")).toMatchObject({ enabled: true, at: "06:30", timeZone: "America/Toronto", subjects: ["Factures", "Contrats"] });
    // the person who had turned it off keeps it off: no routine
    expect(briefRoutineOf(routines, "helper")).toBeUndefined();
    // once a day: 06:30 in Toronto is 11:30 UTC in November
    const first = nextOccurrence(routine.schedule, START, undefined)!;
    expect(new Date(first).toISOString()).toBe("2026-11-10T11:30:00.000Z");
    expect(nextOccurrence(routine.schedule, first, undefined)! - first).toBe(24 * 60 * 60_000);
    // the scheduled run reads and delivers the brief itself: no turn
    await h.tickAt(first);
    expect(h.reads()).toBe(1);
    expect(h.delivered).toHaveLength(1);
    expect(h.turns).toEqual([]);
    expect(h.manager.listRuns()[0]).toMatchObject({ status: "nothing_to_report" });
    // the rest of the day: no second run
    for (let at = first + 60 * 60_000; at < first + 23 * 60 * 60_000; at += 60 * 60_000) await h.tickAt(at);
    expect(h.reads()).toBe(1);
    await h.tickAt(first + 24 * 60 * 60_000);
    expect(h.reads()).toBe(2);
    expect(h.turns).toEqual([]);
  });

  it("paused in the routines list, the brief reads off and nothing runs; a time change on the brief moves the routine", async () => {
    const h = harness({ briefFile: saved });
    h.briefs.upgrade([{ id: "main", main: true }]);
    const routine = h.manager.listRoutines()[0]!;
    h.manager.update(routine.id, { enabled: false });
    expect(h.briefs.view("main").enabled).toBe(false);
    await h.tickAt(nextOccurrence(routine.schedule, START, undefined)!);
    expect(h.reads()).toBe(0);
    // the person moves the time on the brief's card (saved, then synced)
    const settings = h.store.saveSettings("main", { at: "07:45" });
    h.briefs.sync("main", { at: "07:45" }, settings);
    expect(h.manager.listRoutines()[0]).toMatchObject({ enabled: false, schedule: { expression: "45 7 * * *" } });
    // and turns it back on there
    h.briefs.sync("main", { enabled: true }, h.store.saveSettings("main", { enabled: true }));
    expect(h.briefs.view("main")).toMatchObject({ enabled: true, at: "07:45" });
    expect(h.manager.listRoutines()).toHaveLength(1);
  });

  it("an edit made in the routines list is kept when a page sends another change with the same time zone", () => {
    const h = harness({ briefFile: saved });
    h.briefs.upgrade([{ id: "main", main: true }]);
    const routine = h.manager.listRoutines()[0]!;
    // the person moves the routine to 07:00 on weekdays and rewrites its instructions there
    h.manager.update(routine.id, { schedule: { type: "cron", expression: "0 7 * * 1-5", timeZone: "America/Toronto" }, prompt: "Mes instructions." });
    expect(h.briefs.view("main")).toMatchObject({ at: "07:00" });
    // every page sends its zone with each change: screen context flipped on the bot page
    const patch = { screenContext: true, timeZone: "America/Toronto" };
    h.briefs.sync("main", patch, h.store.saveSettings("main", patch));
    expect(h.manager.listRoutines()[0]).toMatchObject({ schedule: { expression: "0 7 * * 1-5", timeZone: "America/Toronto" }, prompt: "Mes instructions." });
    // off, then on again from the page: still the person's routine
    const off = { enabled: false, timeZone: "America/Toronto" };
    h.briefs.sync("main", off, h.store.saveSettings("main", off));
    const on = { enabled: true, timeZone: "America/Toronto" };
    h.briefs.sync("main", on, h.store.saveSettings("main", on));
    expect(h.manager.listRoutines()[0]).toMatchObject({ enabled: true, schedule: { expression: "0 7 * * 1-5" }, prompt: "Mes instructions." });
    expect(h.briefs.view("main")).toMatchObject({ enabled: true, at: "07:00" });
    // a zone that really differs moves the routine's own time to it; new subjects rewrite the instructions
    const moved = { timeZone: "Europe/Paris" };
    h.briefs.sync("main", moved, h.store.saveSettings("main", moved));
    expect(h.manager.listRoutines()[0]).toMatchObject({ schedule: { expression: "0 7 * * 1-5", timeZone: "Europe/Paris" }, prompt: "Mes instructions." });
    const subjects = { subjects: ["Factures"], timeZone: "Europe/Paris" };
    h.briefs.sync("main", subjects, h.store.saveSettings("main", subjects));
    expect(h.manager.listRoutines()[0]!.prompt).toContain("Sujets : Factures.");
    expect(h.manager.listRoutines()[0]).toMatchObject({ schedule: { expression: "0 7 * * 1-5", timeZone: "Europe/Paris" } });
  });
});

describe("#3456: the card « Garder le brief du jour ? »", () => {
  function withAsk(h: ReturnType<typeof harness>) {
    const clock = { now: START };
    const choices = new ProactiveChoices(undefined, () => clock.now);
    const posted: string[] = [];
    const ask = new ProactiveAsk({
      choices,
      bots: () => [{ id: "main", title: "Assistant", description: "", main: true }],
      offered: async (_person, botId) => ({ ok: true, botId, domains: [] }),
      aboutMe: () => "",
      timeZone: () => "America/Toronto",
      language: () => "fr",
      postCard: ({ card }) => { posted.push(card.title); return `p${posted.length}`; },
      briefYes: (_person, botId) => { h.briefs.accept(botId, "America/Toronto"); },
      now: () => clock.now,
    });
    return { ask, choices, posted, clock };
  }

  it("a main bot that had the brief only by default owes one card; a yes creates the routine", async () => {
    const h = harness({ briefFile: { version: 1, bots: { main: { suggestions: [], rejected: [], lastScheduledDay: "2026-11-09" } } } });
    expect(h.briefs.upgrade([{ id: "main", main: true }, { id: "other", main: false }])).toEqual({ created: [], owed: ["main"] });
    expect(h.store.cardsOwed()).toEqual(["main"]);
    const a = withAsk(h);
    expect(a.ask.offerBrief({ person: "person-1", botId: "main", threadId: "t", at: h.store.settings("main").at })).toBe("posted");
    expect(a.posted).toEqual(["Garder le brief du jour ?"]);
    a.ask.answer({ id: "p1", botId: "main", choice: { person: "person-1", domain: BRIEF_ASK_DOMAIN, watches: [], others: [] } }, true);
    const routine = briefRoutineOf(h.manager.listRoutines(), "main");
    expect(routine).toMatchObject({ enabled: true, schedule: { type: "cron", expression: "0 8 * * *", timeZone: "America/Toronto" } });
    expect(h.store.saved("main")).toBe(true);
    expect(h.store.cardsOwed()).toEqual([]);
    // the yes is kept; no second card
    expect(a.choices.get("person-1").asks?.[0]).toMatchObject({ answer: "yes" });
    a.clock.now = START + 30 * 24 * 60 * 60_000;
    expect(a.ask.offerBrief({ person: "person-1", botId: "main", threadId: "t", at: "08:00" })).toBe("closed");
    expect(a.posted).toHaveLength(1);
  });

  it("\"never\" is kept: no routine, no second card", () => {
    const h = harness({ briefFile: { version: 1, bots: { main: { suggestions: [], rejected: [] } } } });
    h.briefs.upgrade([{ id: "main", main: true }]);
    const a = withAsk(h);
    a.ask.offerBrief({ person: "person-1", botId: "main", threadId: "t", at: "08:00" });
    a.ask.never({ id: "p1", choice: { person: "person-1", domain: BRIEF_ASK_DOMAIN, watches: [], others: [] } });
    expect(a.choices.get("person-1").asks?.[0]).toMatchObject({ answer: "never" });
    expect(h.manager.listRoutines()).toEqual([]);
    a.clock.now = START + 90 * 24 * 60 * 60_000;
    expect(a.ask.offerBrief({ person: "person-1", botId: "main", threadId: "t", at: "08:00" })).toBe("closed");
    expect(a.posted).toHaveLength(1);
  });
});

describe("#3456: the schedule", () => {
  it("a daily cron in the brief's zone; the days picked in the routines list are kept", () => {
    expect(briefSchedule("06:05", "Europe/Paris")).toEqual({ type: "cron", expression: "5 6 * * *", timeZone: "Europe/Paris" });
    expect(briefSchedule("07:30", "UTC", { type: "cron", expression: "0 8 * * 1-5", timeZone: "UTC" })).toEqual({ type: "cron", expression: "30 7 * * 1-5", timeZone: "UTC" });
    expect(briefScheduleTime({ type: "cron", expression: "5 6 * * *", timeZone: "Europe/Paris" })).toEqual({ at: "06:05", timeZone: "Europe/Paris" });
    expect(briefScheduleTime({ type: "cron", expression: "*/5 * * * *", timeZone: "UTC" })).toBeNull();
  });
});
