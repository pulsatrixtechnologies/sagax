// #3456 (lot 5 of #3408, owner's decision 2: "a routine, on your yes"): the
// daily brief is a routine of the bot, created only when the person says yes.
//
// - The routine is an ordinary one: listed in the bot's routines, paused,
//   edited or deleted there like any other. Its code pre-check
//   (`{kind: "code", check: "daily_brief"}`, routine-precheck.ts) reads and
//   delivers the brief itself (background-brief-schedule.ts `runBrief`) and
//   never starts a turn: no model call.
// - Its schedule is a daily cron at the brief's time, in the brief's own time
//   zone; its instructions name the person's subjects.
// - Nothing is on because of a default or a stored mode. A bot without a
//   routine has no brief, and no daily suggestions ride on it.
// - The upgrade, once: saved brief settings that were on become that
//   routine (same time, same subjects); a main bot that had the brief only
//   by default stops and owes its person one card « Garder le brief du
//   jour ? », posted through the ask ledger and its bounds
//   (proactive-ask.ts `offerBrief`).
import type { Routine, RoutineInput } from "../routines/routines.ts";
import { BRIEF_DEFAULT_AT, type BriefSettings, type BriefStore } from "./background-brief.ts";

export const BRIEF_ROUTINE_CHECK = "daily_brief" as const;

export type BriefLanguage = "fr" | "en";

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
/** One five-field cron expression whose minute and hour are plain numbers. */
const DAILY_CRON = /^(\d{1,2}) (\d{1,2}) (\S+ \S+ \S+)$/;

export function isBriefRoutine(routine: Pick<Routine, "precheck">): boolean {
  const precheck = routine.precheck as { kind?: string; check?: string } | undefined;
  return precheck?.kind === "code" && precheck.check === BRIEF_ROUTINE_CHECK;
}

/** The bot's brief routine, when it has one. */
export function briefRoutineOf(routines: readonly Routine[], botId: string): Routine | undefined {
  return routines.find((routine) => routine.botId === botId && isBriefRoutine(routine));
}

/** The brief's schedule: every day at `at`, in `timeZone`. `previous` keeps
 * the days the person picked in the routines list (a weekday cron). */
export function briefSchedule(at: string, timeZone: string, previous?: Routine["schedule"]): { type: "cron"; expression: string; timeZone: string } {
  const [hour, minute] = (HHMM.test(at) ? at : BRIEF_DEFAULT_AT).split(":").map(Number) as [number, number];
  const days = previous?.type === "cron" ? DAILY_CRON.exec(previous.expression.trim())?.[3] : undefined;
  return { type: "cron", expression: `${minute} ${hour} ${days ?? "* * *"}`, timeZone };
}

/** The time and zone a brief routine runs at, read back from its schedule
 * (the person may have moved it in the routines list). */
export function briefScheduleTime(schedule: Routine["schedule"]): { at: string; timeZone: string } | null {
  if (schedule.type !== "cron") return null;
  const match = DAILY_CRON.exec(schedule.expression.trim());
  if (!match) return null;
  const minute = Number(match[1]);
  const hour = Number(match[2]);
  if (minute > 59 || hour > 23) return null;
  return { at: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`, timeZone: schedule.timeZone };
}

export function briefRoutineName(language: BriefLanguage): string {
  return language === "fr" ? "Brief du jour" : "Today's brief";
}

/** The routine's instructions: what the brief does, with the person's
 * subjects. The scheduled run never reads them as a turn (the code check
 * does the brief); a person's Run now does. */
export function briefRoutinePrompt(subjects: readonly string[], language: BriefLanguage): string {
  const listed = subjects.map((subject) => subject.trim()).filter(Boolean);
  if (language === "fr") {
    const base = "Brief du jour : lis mes apps connectées, en lecture seulement, et envoie-moi ce qui est nouveau, chaque point avec sa source datée. N'envoie rien, ne change rien.";
    return listed.length ? `${base}\nSujets : ${listed.join(", ")}.` : base;
  }
  const base = "Today's brief: read my connected apps, read only, and send me what is new, each point with its dated source. Send nothing, change nothing.";
  return listed.length ? `${base}\nSubjects: ${listed.join(", ")}.` : base;
}

/** The time of day in the person's words. */
function clockWords(at: string, language: BriefLanguage): string {
  const [hour, minute] = at.split(":");
  return language === "fr" ? `${Number(hour)} h ${minute}` : at;
}

/** The card « Garder le brief du jour ? »: what changed, what the yes does. */
export function briefCard(at: string, language: BriefLanguage): { title: string; subtitle: string; options: [string, string] } {
  const clock = clockWords(HHMM.test(at) ? at : BRIEF_DEFAULT_AT, language);
  if (language === "fr") {
    return {
      title: "Garder le brief du jour ?",
      subtitle: `Le brief du jour était actif par défaut, sans que tu l'aies choisi : je l'ai arrêté. Si tu dis oui, je te l'envoie chaque jour à ${clock}, comme une de mes routines, que tu peux mettre en pause, modifier ou supprimer.`,
      options: ["Oui", "Pas maintenant"],
    };
  }
  return {
    title: "Keep today's brief?",
    subtitle: `Today's brief was on by default, without you choosing it: I stopped it. If you say yes, I send it to you every day at ${clock}, as one of my routines, which you can pause, edit or delete.`,
    options: ["Yes", "Not now"],
  };
}

/** What the brief routines need of the routine manager. */
export interface BriefRoutineManager {
  list(): readonly Routine[];
  create(input: RoutineInput, runAs?: string): Routine;
  update(id: string, patch: Partial<RoutineInput>): Routine | null;
}

export interface BriefRoutineDeps {
  store: BriefStore;
  routines(): BriefRoutineManager | null;
  language(botId: string): BriefLanguage;
  /** The person the routine runs as (an organization server), if any. */
  runAs(botId: string): string | undefined;
}

/** One bot as the upgrade reads it. */
export interface BriefUpgradeBot {
  id: string;
  /** The person's main bot. */
  main: boolean;
}

export class BriefRoutines {
  private readonly deps: BriefRoutineDeps;

  constructor(deps: BriefRoutineDeps) {
    this.deps = deps;
  }

  of(botId: string): Routine | undefined {
    const manager = this.deps.routines();
    return manager ? briefRoutineOf(manager.list(), botId) : undefined;
  }

  /** Whether the brief runs for this bot: its routine exists and is on. */
  on(botId: string): boolean {
    return this.of(botId)?.enabled === true;
  }

  /** The settings as the person's pages show them: on only with the
   * routine on, at the routine's time. */
  view(botId: string): BriefSettings {
    const settings = this.deps.store.settings(botId);
    const routine = this.of(botId);
    const time = routine ? briefScheduleTime(routine.schedule) : null;
    return { ...settings, enabled: routine?.enabled === true, ...time };
  }

  /** The person's yes: the routine exists and is on. A new routine takes
   * the brief's time and subjects; an existing one keeps what the person set
   * in the routines list (its time, days and instructions) and moves only
   * what `patch` really changes. Returns it, or null without a routine
   * manager. */
  ensure(botId: string, settings: BriefSettings = this.deps.store.settings(botId), patch: Partial<BriefSettings> = {}): Routine | null {
    const manager = this.deps.routines();
    if (!manager) return null;
    const language = this.deps.language(botId);
    const existing = briefRoutineOf(manager.list(), botId);
    if (existing) return manager.update(existing.id, { enabled: true, ...this.changes(existing, patch, settings, language) });
    return manager.create({
      name: briefRoutineName(language),
      prompt: briefRoutinePrompt(settings.subjects, language),
      botId,
      enabled: true,
      schedule: briefSchedule(settings.at, settings.timeZone),
      precheck: { kind: "code", check: BRIEF_ROUTINE_CHECK },
      overlap: "skip",
      // the brief posts itself; a run never adds a second message
      postResults: false,
    }, this.deps.runAs(botId));
  }

  /** The person changed the brief on its card (on, off, time, subjects):
   * the routine follows. Off pauses it; it is never deleted from here. Every
   * page sends its time zone with each change, so the schedule moves only
   * when the time is in the patch or the zone differs from the routine's,
   * and the instructions only when the subjects are in the patch. */
  sync(botId: string, patch: Partial<BriefSettings>, settings: BriefSettings): void {
    const manager = this.deps.routines();
    if (!manager) return;
    if (patch.enabled === true) {
      this.ensure(botId, settings, patch);
      return;
    }
    const existing = briefRoutineOf(manager.list(), botId);
    if (!existing) return;
    if (patch.enabled === false) {
      manager.update(existing.id, { enabled: false });
      return;
    }
    const changes = this.changes(existing, patch, settings, this.deps.language(botId));
    if (Object.keys(changes).length) manager.update(existing.id, changes);
  }

  /** What `patch` really changes on an existing routine. The time is the
   * routine's own (the person may have moved it in the routines list) unless
   * the patch sets one. */
  private changes(existing: Routine, patch: Partial<BriefSettings>, settings: BriefSettings, language: BriefLanguage): Partial<RoutineInput> {
    const own = briefScheduleTime(existing.schedule);
    const ownZone = existing.schedule.type === "cron" ? existing.schedule.timeZone : undefined;
    const zoneMoved = patch.timeZone !== undefined && patch.timeZone !== ownZone;
    const changes: Partial<RoutineInput> = {};
    if (patch.at !== undefined || zoneMoved) {
      const at = patch.at ?? own?.at ?? settings.at;
      const timeZone = patch.timeZone ?? ownZone ?? settings.timeZone;
      changes.schedule = briefSchedule(at, timeZone, existing.schedule);
    }
    if (patch.subjects !== undefined) changes.prompt = briefRoutinePrompt(settings.subjects, language);
    return changes;
  }

  /** The card's yes: the routine, and the brief saved as the person's
   * choice (in their time zone when they had never set one). */
  accept(botId: string, timeZone?: string): Routine | null {
    const store = this.deps.store;
    const settings = store.saveSettings(botId, { enabled: true, ...(!store.saved(botId) && timeZone ? { timeZone } : {}) });
    store.setCardOwed(botId, false);
    return this.ensure(botId, settings);
  }

  /** The upgrade, once: saved settings that were on become the routine;
   * a main bot that had the brief only by default owes one card. A fresh
   * install (no brief file) owes nothing. */
  upgrade(bots: readonly BriefUpgradeBot[]): { created: string[]; owed: string[] } {
    const store = this.deps.store;
    const created: string[] = [];
    const owed: string[] = [];
    if (store.routinesMigrated() || !this.deps.routines()) return { created, owed };
    let failed = false;
    for (const bot of bots) {
      if (store.saved(bot.id)) {
        const settings = store.settings(bot.id);
        if (!settings.enabled || this.of(bot.id)) continue;
        try {
          if (this.ensure(bot.id, settings)) created.push(bot.id);
        } catch {
          // the routines could not be written now: the next start tries again
          failed = true;
        }
        continue;
      }
      if (bot.main && store.existed && !store.cardsOwed().includes(bot.id)) {
        store.setCardOwed(bot.id, true);
        owed.push(bot.id);
      }
    }
    if (!failed) store.markRoutinesMigrated();
    return { created, owed };
  }
}
