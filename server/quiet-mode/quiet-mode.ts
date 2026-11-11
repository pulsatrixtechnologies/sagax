// #3480: quiet mode on the server (shared/quiet-mode.ts says what it is).
// This module keeps the two switches (per bot, and per person for all their
// bots), counts the runs it kept out of the chat, and writes the one line
// when quiet mode goes off. The effect itself is applied where the chat and
// the notifications are decided: server/index-leaves/syncRoutineRunToSource.ts
// (routine runs and wakes), server/routines/routine-report.ts (what a run
// posts), server/index-leaves/notify.ts (what rings) and
// server/turns/person-attention-relay.ts (background work).

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import {
  type BotQuietState,
  type BotQuietView,
  type PersonQuietView,
  type QuietKept,
  quietModeLanguage,
  quietModeSaid,
  quietModeSummary,
} from "../../shared/quiet-mode.ts";

interface BotRow {
  on?: boolean;
  kept?: QuietKept;
  /** Run ids already counted, newest last (a run reports more than once). */
  counted?: string[];
}

interface QuietFile {
  bots: Record<string, BotRow>;
  people: Record<string, { on: boolean }>;
}

/** Where the switches and counts are kept (a JSON file under DATA_DIR on the
 * server; memory in a test). */
export interface QuietModeStorage {
  load(): unknown;
  save(state: QuietFile): void;
}

export function quietModeFileStorage(file: string): QuietModeStorage {
  return {
    load: () => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null),
    save: (state) => {
      mkdirSync(dirname(file), { recursive: true });
      const temp = `${file}.tmp`;
      writeFileSync(temp, JSON.stringify(state));
      renameSync(temp, file);
    },
  };
}

const COUNTED_MAX = 500;

export interface QuietModeBot {
  id: string;
  /** The bot's name, for the line that says which bots are still quiet. */
  name?: string;
  hidden?: boolean;
  temporary?: boolean;
}

export interface QuietModeDeps<B extends QuietModeBot> {
  storage?: QuietModeStorage;
  bot(botId: string): B | undefined;
  bots(): readonly B[];
  /** The person a bot belongs to (its owner). */
  owner(bot: B): string;
  /** The person's language ("fr", "en", ...). */
  language(person: string): string | undefined;
  /** Write the line in the bot's main conversation. */
  line(bot: B, text: string): void;
  now?(): number;
}

const samePerson = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export class QuietMode<B extends QuietModeBot> {
  private state: QuietFile = { bots: {}, people: {} };
  private readonly deps: QuietModeDeps<B>;

  constructor(deps: QuietModeDeps<B>) {
    this.deps = deps;
    let loaded: unknown = null;
    try { loaded = deps.storage?.load() ?? null; } catch { loaded = null; }
    if (loaded && typeof loaded === "object") {
      const raw = loaded as Partial<QuietFile>;
      for (const [id, row] of Object.entries(raw.bots ?? {})) {
        if (!row || typeof row !== "object") continue;
        const kept = row.kept && typeof row.kept.runs === "number" && typeof row.kept.problems === "number" ? row.kept : undefined;
        this.state.bots[id] = {
          ...(row.on === true ? { on: true } : {}),
          ...(kept ? { kept: { runs: kept.runs, problems: kept.problems, ...(typeof kept.since === "number" ? { since: kept.since } : {}) } } : {}),
          ...(Array.isArray(row.counted) ? { counted: row.counted.filter((value) => typeof value === "string").slice(-COUNTED_MAX) } : {}),
        };
      }
      for (const [person, row] of Object.entries(raw.people ?? {})) {
        if (row?.on === true) this.state.people[person.trim().toLowerCase()] = { on: true };
      }
    }
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  /** The person's switch for all their bots. */
  personOn(person: string): boolean {
    return this.state.people[person.trim().toLowerCase()]?.on === true;
  }

  /** The bot's own switch. */
  botOn(botId: string): boolean {
    return this.state.bots[botId]?.on === true;
  }

  /** Whether this bot is quiet now: its own switch, or its person's. */
  quiet(botId: string): boolean {
    if (this.botOn(botId)) return true;
    const bot = this.deps.bot(botId);
    return Boolean(bot) && this.personOn(this.deps.owner(bot!));
  }

  kept(botId: string): QuietKept {
    const kept = this.state.bots[botId]?.kept;
    return kept ? { ...kept } : { runs: 0, problems: 0 };
  }

  view(botId: string): BotQuietState {
    const bot = this.deps.bot(botId);
    const all = Boolean(bot) && this.personOn(this.deps.owner(bot!));
    const own = this.botOn(botId);
    return { botId, bot: own, all, quiet: own || all, kept: this.kept(botId) };
  }

  /** The person's own bots, as Settings lists them. */
  personView(person: string): PersonQuietView {
    const bots = this.deps.bots().filter((bot) => !bot.hidden && !bot.temporary && samePerson(this.deps.owner(bot), person));
    return { all: this.personOn(person), bots: bots.map((bot) => this.view(bot.id)) };
  }

  /** A run of a quiet bot ended that would have posted in the chat: counted
   * once per run, for the line when quiet mode goes off. */
  keep(botId: string, runId: string, problem: boolean): boolean {
    if (!this.quiet(botId)) return false;
    const row = (this.state.bots[botId] ??= {});
    const counted = row.counted ?? [];
    if (counted.includes(runId)) return false;
    counted.push(runId);
    if (counted.length > COUNTED_MAX) counted.splice(0, counted.length - COUNTED_MAX);
    row.counted = counted;
    const kept = row.kept ?? { runs: 0, problems: 0, since: this.now() };
    row.kept = { ...kept, runs: kept.runs + 1, problems: kept.problems + (problem ? 1 : 0) };
    this.persist();
    return true;
  }

  /** Set one bot's own switch. Off with the bot no longer quiet writes the
   * line in its chat; the counts start again next time. */
  setBot(botId: string, on: boolean): BotQuietView {
    const bot = this.deps.bot(botId);
    if (!bot) return { ...this.view(botId) };
    const before = this.quiet(botId);
    const row = (this.state.bots[botId] ??= {});
    if (on) row.on = true;
    else delete row.on;
    if (!before && on) row.kept = { runs: 0, problems: 0, since: this.now() };
    const language = quietModeLanguage(this.deps.language(this.deps.owner(bot)));
    const summary = before && !this.quiet(botId) ? this.endFor(bot, language, true) : undefined;
    this.persist();
    // the line says the state after the change: still quiet through the
    // person's all-bots switch, it says so and names that switch
    const view = this.view(botId);
    return { ...view, said: quietModeSaid(on, "bot", language, { all: !on && view.all }), ...(summary ? { summary } : {}) };
  }

  /** Set the person's switch for all their bots. Each bot that stops being
   * quiet and kept something gets its line. */
  setPerson(person: string, on: boolean): PersonQuietView {
    const key = person.trim().toLowerCase();
    const own = this.deps.bots().filter((bot) => samePerson(this.deps.owner(bot), person));
    const before = new Map(own.map((bot) => [bot.id, this.quiet(bot.id)]));
    if (on) this.state.people[key] = { on: true };
    else delete this.state.people[key];
    const language = quietModeLanguage(this.deps.language(person));
    for (const bot of own) {
      const was = before.get(bot.id) === true;
      const now = this.quiet(bot.id);
      if (!was && now) (this.state.bots[bot.id] ??= {}).kept = { runs: 0, problems: 0, since: this.now() };
      else if (was && !now) this.endFor(bot, language, false);
    }
    this.persist();
    // the line says the state after the change: the bots still quiet through
    // their own switch are named
    const view = this.personView(person);
    const stillQuiet = on ? [] : view.bots.filter((row) => row.bot).map((row) => own.find((bot) => bot.id === row.botId)?.name?.trim() || row.botId);
    return { ...view, said: quietModeSaid(on, "all", language, { bots: stillQuiet }) };
  }

  /** The bot stopped being quiet: its line (always for its own switch; for
   * the all-bots switch only when it kept something), then the counts reset. */
  private endFor(bot: B, language: "fr" | "en", always: boolean): string | undefined {
    const row = (this.state.bots[bot.id] ??= {});
    const kept = row.kept ?? { runs: 0, problems: 0 };
    delete row.kept;
    delete row.counted;
    if (!always && kept.runs === 0) return undefined;
    const summary = quietModeSummary(kept, language);
    try { this.deps.line(bot, summary); } catch { /* the answer still carries it */ }
    return summary;
  }

  private persist(): void {
    if (!this.deps.storage) return;
    try { this.deps.storage.save(this.state); } catch { /* the next change tries again */ }
  }
}
