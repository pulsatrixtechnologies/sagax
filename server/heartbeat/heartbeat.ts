// Per-bot heartbeat (#2692): HEARTBEAT.md at the root of a bot's workspace is
// a checklist the person and the bot both edit. Every beat, the deterministic
// probes run first (a page, a file, a process, a time of day: the same probes
// as wait_until, server/waits/wait-probes.ts). The model is woken only when a
// probe finds a gap, and the run lands in the bot's main chat (unified chat,
// never a separate thread). An empty checklist does nothing. Notes (lines no
// probe understands) never wake the model on their own: with only notes, a
// beat costs nothing; in a mixed list they ride along as context when a probe
// finds a gap (#2820).
//
// #4250 (S5 `one-probe-engine`, step b): the lines are the pre-check of a
// routine. A bot whose checklist has a line to check has one routine
// « Checklist » (code check `heartbeat`, its interval the `every:` line), listed,
// paused and edited like any routine; the routine scheduler beats, there is
// no heartbeat timer any more. The check runs the probes and starts the run
// only on a new gap, with the gaps and the notes as the run's data.

import { mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { writeFileAtomic } from "../atomic.ts";
import type { RoutinePrecheckVerdict } from "../routines/routine-precheck.ts";
import type { Routine, RoutineInput } from "../routines/routines.ts";
import { DATA_DIR } from "../config.ts";
import { noteAtRestWrite, readAtRestTextSync } from "../encryption/content-at-rest.ts";
import {
  expandHome,
  fetchPageText,
  fileChanged,
  fileStamp,
  listProcesses,
  readProbe,
  type FileStamp,
  type ProbeReaders,
  type ProcessEntry,
} from "../waits/wait-probes.ts";

export const HEARTBEAT_PATH = "HEARTBEAT.md";
export const HEARTBEAT_DEFAULT_EVERY_MS = 30 * 60_000;
export const HEARTBEAT_MIN_EVERY_MS = 5 * 60_000;
export const HEARTBEAT_MAX_EVERY_MS = 24 * 60 * 60_000;
/** A checklist past this many lines is cut: a beat stays cheap. */
export const HEARTBEAT_MAX_ITEMS = 40;

export type HeartbeatProbe =
  | { kind: "page"; url: string; text: string; want: "contains" | "missing" }
  | { kind: "file"; path: string; want: "exists" | "missing" | "changed" }
  | { kind: "process"; name: string; want: "running" | "gone" }
  | { kind: "at"; hour: number; minute: number; task: string };

export interface HeartbeatItem {
  /** The line as written, trimmed: the key the state remembers. */
  line: string;
  probe: HeartbeatProbe;
}

export interface HeartbeatChecklist {
  everyMs: number;
  items: HeartbeatItem[];
  /** Lines no probe understands: context for the model, never probed. */
  notes: string[];
}

const QUOTED = String.raw`"([^"]+)"|'([^']+)'|“([^”]+)”`;
const PAGE = new RegExp(String.raw`^page\s+(\S+)\s+(contains|missing)\s+(?:${QUOTED})\s*$`, "i");
const FILE = /^file\s+(.+?)\s+(exists|missing|changed)\s*$/i;
const PROCESS = /^process\s+(.+?)\s+(running|gone)\s*$/i;
const AT = /^at\s+([01]?\d|2[0-3])[:h]([0-5]\d)\s+(.+)$/i;
const EVERY = /^every\s*:?\s*(\d+)\s*(m|min|minutes?|h|hours?)\s*$/i;

function parseItem(body: string): HeartbeatProbe | null {
  const page = PAGE.exec(body);
  if (page) {
    const text = page[3] ?? page[4] ?? page[5] ?? "";
    if (/^https?:\/\//i.test(page[1]) && text.trim()) {
      return { kind: "page", url: page[1], text: text.trim(), want: page[2].toLowerCase() as "contains" | "missing" };
    }
    return null;
  }
  const file = FILE.exec(body);
  if (file) return { kind: "file", path: unquote(file[1]), want: file[2].toLowerCase() as "exists" | "missing" | "changed" };
  const proc = PROCESS.exec(body);
  if (proc) return { kind: "process", name: unquote(proc[1]), want: proc[2].toLowerCase() as "running" | "gone" };
  const at = AT.exec(body);
  if (at) return { kind: "at", hour: Number(at[1]), minute: Number(at[2]), task: at[3].trim() };
  return null;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  return /^(["'`]).*\1$/.test(trimmed) ? trimmed.slice(1, -1) : trimmed;
}

/** Pure: HEARTBEAT.md as text to a checklist. Headings, blank lines, HTML
 * comments and checked boxes (`- [x]`) are skipped. */
export function parseHeartbeat(text: string): HeartbeatChecklist {
  const items: HeartbeatItem[] = [];
  const notes: string[] = [];
  let everyMs = HEARTBEAT_DEFAULT_EVERY_MS;
  const stripped = text.replace(/<!--[\s\S]*?-->/g, "");
  for (const raw of stripped.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith(">")) continue;
    const every = EVERY.exec(line.replace(/^[-*]\s+/, ""));
    if (every) {
      const amount = Number(every[1]);
      const ms = amount * (every[2].toLowerCase().startsWith("h") ? 3_600_000 : 60_000);
      everyMs = Math.min(HEARTBEAT_MAX_EVERY_MS, Math.max(HEARTBEAT_MIN_EVERY_MS, ms));
      continue;
    }
    const bullet = /^(?:[-*+]|\d+[.)])\s+(?:\[( |x|X)\]\s+)?(.*)$/.exec(line);
    if (!bullet) continue;
    if (bullet[1] === "x" || bullet[1] === "X") continue;
    const body = bullet[2].trim();
    if (!body) continue;
    if (items.length + notes.length >= HEARTBEAT_MAX_ITEMS) break;
    const probe = parseItem(body);
    if (probe) items.push({ line: body, probe });
    else notes.push(body);
  }
  return { everyMs, items, notes };
}

export function heartbeatEmpty(list: HeartbeatChecklist): boolean {
  return list.items.length === 0 && list.notes.length === 0;
}

export interface HeartbeatBotState {
  lastBeatAt: number;
  /** Lines whose probe was in gap at the last beat: a gap wakes the model once, on its way in. */
  gaps: string[];
  stamps: Record<string, FileStamp | null>;
  /** `at` lines: the local day (YYYY-MM-DD) each was last handed to the model. */
  atDone: Record<string, string>;
}

/** The readers of the one probe reader (wait-probes.ts `ProbeReaders`). */
export type HeartbeatProbes = ProbeReaders;

export interface HeartbeatGap {
  line: string;
  detail: string;
}

function localDay(at: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

/** Runs every probe once and says which lines are in gap now, which gaps are
 * new since the last beat (only those wake the model) and the next state. */
export async function evaluateHeartbeat(
  list: HeartbeatChecklist,
  previous: HeartbeatBotState | undefined,
  probes: HeartbeatProbes,
  now: number,
): Promise<{ fresh: HeartbeatGap[]; state: HeartbeatBotState }> {
  const before = previous ?? { lastBeatAt: 0, gaps: [], stamps: {}, atDone: {} };
  const state: HeartbeatBotState = { lastBeatAt: now, gaps: [], stamps: {}, atDone: {} };
  const fresh: HeartbeatGap[] = [];
  // one reader for every line (wait-probes.ts readProbe), the program list read once a beat
  let processes: Promise<ProcessEntry[]> | undefined;
  const readers: HeartbeatProbes = { ...probes, processes: () => (processes ??= probes.processes()) };
  const today = localDay(new Date(now));
  for (const { line, probe } of list.items) {
    let gap: string | null = null;
    let event = false;
    switch (probe.kind) {
      case "page": {
        const read = await readProbe({ kind: "page", url: probe.url, text: probe.text }, readers);
        if (read.kind !== "page") break;
        if (!read.ok) gap = `${probe.url} did not answer (${read.page.error || "unreachable"})`;
        else if (probe.want === "contains" && !read.says) gap = `${probe.url} no longer says "${probe.text}"`;
        else if (probe.want === "missing" && read.says) gap = `${probe.url} now says "${probe.text}"`;
        break;
      }
      case "file": {
        const read = await readProbe({ kind: "file", path: probe.path }, readers);
        const stamp = read.kind === "file" ? read.stamp : null;
        if (probe.want === "exists" && !stamp) gap = `${probe.path} is missing`;
        else if (probe.want === "missing" && stamp) gap = `${probe.path} exists`;
        else if (probe.want === "changed") {
          state.stamps[line] = stamp;
          event = true;
          if (line in before.stamps && fileChanged(before.stamps[line] ?? null, stamp)) gap = `${probe.path} changed`;
        }
        break;
      }
      case "process": {
        const read = await readProbe({ kind: "process", name: probe.name }, readers);
        if (read.kind !== "process" || !read.listed) gap = "the process list could not be read";
        else if (probe.want === "running" && !read.running) gap = `${probe.name} is not running`;
        else if (probe.want === "gone" && read.running) gap = `${probe.name} is still running`;
        break;
      }
      case "at": {
        event = true;
        const due = new Date(now);
        due.setHours(probe.hour, probe.minute, 0, 0);
        const done = before.atDone[line];
        if (done) state.atDone[line] = done;
        if (now >= due.getTime() && done !== today) {
          gap = `it is past ${String(probe.hour).padStart(2, "0")}:${String(probe.minute).padStart(2, "0")}: ${probe.task}`;
          state.atDone[line] = today;
        }
        break;
      }
    }
    if (!gap) continue;
    if (event) {
      fresh.push({ line, detail: gap });
      continue;
    }
    state.gaps.push(line);
    if (!before.gaps.includes(line)) fresh.push({ line, detail: gap });
  }
  return { fresh, state };
}

/** The gaps and the notes, as the data the routine's run reads. */
export function heartbeatNote(fresh: readonly HeartbeatGap[], notes: readonly string[]): string {
  const lines = [
    `Your ${HEARTBEAT_PATH} checklist found ${fresh.length === 1 ? "a gap" : `${fresh.length} gaps`}:`,
    ...fresh.map((gap) => `- ${gap.detail} (checklist: ${gap.line})`),
  ];
  if (notes.length) lines.push("", "Notes from the checklist:", ...notes.map((note) => `- ${note}`));
  return lines.join("\n");
}

/** #4250: the routines' code check that beats a bot's checklist. */
export const HEARTBEAT_CHECK = "heartbeat" as const;

export type HeartbeatLanguage = "fr" | "en";

export function heartbeatRoutineName(language: HeartbeatLanguage): string {
  return language === "fr" ? "Liste de contrôle" : "Checklist";
}

/** The routine's instructions; the gaps reach the run as its data. */
export function heartbeatRoutinePrompt(): string {
  return `[Heartbeat] Your ${HEARTBEAT_PATH} checklist found a gap (what it found is below). Handle what you can now and tell the person in this chat what you did or what they need to do. Keep it short. You can edit ${HEARTBEAT_PATH} with docs_update when an item is done or no longer needed.`;
}

export function isHeartbeatRoutine(routine: Pick<Routine, "precheck">): boolean {
  const precheck = routine.precheck as { kind?: string; check?: string } | undefined;
  return precheck?.kind === "code" && precheck.check === HEARTBEAT_CHECK;
}

function heartbeatSchedule(everyMs: number, now: number): { type: "interval"; everyMinutes: number; anchorAt: number } {
  return { type: "interval", everyMinutes: Math.min(1_440, Math.max(5, Math.round(everyMs / 60_000))), anchorAt: now };
}

/** What the checklist routines need of the routine manager. */
export interface HeartbeatRoutineManager {
  list(): readonly Routine[];
  create(input: RoutineInput, runAs?: string): Routine;
  update(id: string, patch: Partial<RoutineInput>): Routine | null;
}

export interface HeartbeatDeps {
  /** Bots that can beat: visible, with a main chat. */
  bots(): Array<{ id: string; name: string }>;
  /** HEARTBEAT.md as text, "" when the bot has none. */
  read(botId: string): string;
  routines(): HeartbeatRoutineManager | null;
  /** The person the routine runs as (an organization server), if any. */
  runAs?(botId: string): string | undefined;
  language?(botId: string): HeartbeatLanguage;
  /** #2694: the person said "never" to heartbeat wakes, or voted them down
   * past the mute line (votes fade): the bot is not woken. */
  muted?(botId: string): boolean;
  /** Set or clear that mute (Settings' switch clears it when turned on). */
  setMuted?(botId: string, muted: boolean): void;
  probes?: Partial<HeartbeatProbes>;
  file?: string;
  now?: () => number;
}

/** How often the checklists are read again for a routine to make or move
 * (an edit outside the journal, by a shell in the bot's folder). */
export const HEARTBEAT_SYNC_MS = 60 * 60_000;

export class HeartbeatManager {
  private readonly deps: HeartbeatDeps;
  private readonly file: string;
  private readonly now: () => number;
  private readonly probes: HeartbeatProbes;
  private state: Record<string, HeartbeatBotState> = {};
  private syncedAt = Number.NEGATIVE_INFINITY;

  constructor(deps: HeartbeatDeps) {
    this.deps = deps;
    this.file = deps.file ?? join(DATA_DIR, "heartbeat.json");
    this.now = deps.now ?? Date.now;
    this.probes = {
      page: (url) => fetchPageText(url),
      stamp: (path) => fileStamp(expandHome(path, homedir())),
      processes: () => listProcesses(),
      ...deps.probes,
    };
    try {
      let raw: string;
      try {
        raw = readAtRestTextSync(this.file);
      } catch {
        raw = readFileSync(this.file, "utf8");
      }
      const parsed = JSON.parse(raw) as { version?: number; bots?: Record<string, HeartbeatBotState> };
      if (parsed && parsed.version === 1 && parsed.bots && typeof parsed.bots === "object") this.state = parsed.bots;
    } catch {
      this.state = {};
    }
  }

  stateOf(botId: string): HeartbeatBotState | undefined {
    return this.state[botId];
  }

  private list(botId: string): HeartbeatChecklist {
    try {
      return parseHeartbeat(this.deps.read(botId));
    } catch {
      return parseHeartbeat("");
    }
  }

  /** The bot's checklist routine, when it has one. */
  routineOf(botId: string): Routine | undefined {
    return this.deps.routines()?.list().find((routine) => routine.botId === botId && isHeartbeatRoutine(routine));
  }

  /** A checklist with a line to check has its routine, at its interval. A
   * routine is never made for notes alone (they never wake the model), and
   * never deleted or turned on from here: the person pauses it in the list. */
  sync(botId: string): Routine | null {
    const manager = this.deps.routines();
    if (!manager || !this.deps.bots().some((bot) => bot.id === botId)) return null;
    const list = this.list(botId);
    const existing = this.routineOf(botId);
    if (!list.items.length) return existing ?? null;
    const schedule = heartbeatSchedule(list.everyMs, this.now());
    if (existing) {
      const every = existing.schedule.type === "interval" ? existing.schedule.everyMinutes : undefined;
      return every === schedule.everyMinutes ? existing : manager.update(existing.id, { schedule });
    }
    return manager.create({
      name: heartbeatRoutineName(this.deps.language?.(botId) ?? "en"),
      prompt: heartbeatRoutinePrompt(),
      botId,
      enabled: true,
      schedule,
      precheck: { kind: "code", check: HEARTBEAT_CHECK },
      overlap: "skip",
    }, this.deps.runAs?.(botId));
  }

  /** #4250: the checklist's one switch, the one Settings shows: its
   * routine on (the routines list pauses the same routine) and no mute
   * left by the person's votes. undefined: HEARTBEAT.md is empty. */
  on(botId: string): boolean | undefined {
    const list = this.list(botId);
    if (heartbeatEmpty(list)) return undefined;
    const routine = this.routineOf(botId);
    return (routine ? routine.enabled !== false : true) && !this.deps.muted?.(botId);
  }

  /** Settings' switch: on clears the mute and turns the routine on (made
   * when the checklist has a line to check); off pauses the routine. With
   * no routine (notes only, or no routine manager) the mute is the switch. */
  setOn(botId: string, on: boolean): boolean | undefined {
    if (on) this.deps.setMuted?.(botId, false);
    const routine = on ? this.sync(botId) ?? undefined : this.routineOf(botId);
    if (routine) {
      if (routine.enabled !== on) this.deps.routines()?.update(routine.id, { enabled: on });
    } else if (!on) this.deps.setMuted?.(botId, true);
    return this.on(botId);
  }

  /** Every bot (at start, and within the hour on a pass the server already
   * makes); drops the state of a bot that is gone. */
  syncAll(): void {
    this.syncedAt = this.now();
    const live = new Set<string>();
    for (const bot of this.deps.bots()) {
      live.add(bot.id);
      try {
        this.sync(bot.id);
      } catch {
        // the next pass tries again
      }
    }
    let changed = false;
    for (const id of Object.keys(this.state)) {
      if (!live.has(id)) {
        delete this.state[id];
        changed = true;
      }
    }
    if (changed) this.save();
  }

  /** syncAll once the hour is up. */
  syncDue(): void {
    if (this.now() - this.syncedAt >= HEARTBEAT_SYNC_MS) this.syncAll();
  }

  /** #4250: the routine's code check: the probes of the checklist, the run
   * only on a new gap. */
  async check(routine: Pick<Routine, "botId">): Promise<RoutinePrecheckVerdict> {
    const botId = routine.botId;
    const list = this.list(botId);
    if (heartbeatEmpty(list) || !list.items.length) {
      if (this.state[botId]) {
        delete this.state[botId];
        this.save();
      }
      return { wake: false, reason: `${HEARTBEAT_PATH} has no line to check` };
    }
    if (this.deps.muted?.(botId)) return { wake: false, reason: "You muted the checklist's alerts" };
    const { fresh, state } = await evaluateHeartbeat(list, this.state[botId], this.probes, this.now());
    this.state[botId] = state;
    this.save();
    // #2820: only a probe in gap wakes the model; notes are context, never a trigger
    if (!fresh.length) return { wake: false, reason: "Every line of the checklist is met" };
    return { wake: true, note: heartbeatNote(fresh, list.notes) };
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileAtomic(this.file, JSON.stringify({ version: 1, bots: this.state }, null, 2), { mode: 0o600 });
      noteAtRestWrite(this.file);
    } catch {
      // the next beat writes again
    }
  }
}
