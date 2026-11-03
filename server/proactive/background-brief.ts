// A background brief the person turns on for their own bot.
//
// One pass only reads. It does not send, change anything, or open a
// browser. The person chooses how often it may run. It uses their fast
// model, never a larger one by default. A number in a suggestion must name
// the piece it came from and that piece's date. A suggestion they rejected
// is not proposed again. A fact they keep is stamped for them alone
// (server/memory/memory-audience.ts), so it does not leave into a room.

import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { writeFileAtomic } from "../atomic.ts";
import { localClock, validTimeZone } from "../../shared/reach-me.ts";
import { memoryMayShow, type MemoryReaders } from "../memory/memory-audience.ts";
import { memoryEntry } from "../workspace/workspace.ts";

export const BRIEF_MIN_HOURS = 1;
export const BRIEF_MAX_HOURS = 168;
export const BRIEF_READERS: MemoryReaders = { kind: "person" };
/** The time the brief runs each day when the person has not chosen one. */
export const BRIEF_DEFAULT_AT = "08:00";
/** A brief the server missed (it was off at that time) still runs within
 * this many minutes after the chosen time, never later in the day. */
export const BRIEF_CATCH_UP_MINUTES = 180;
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** The server's own time zone, the default until the person picks one. */
export function serverTimeZone(): string {
  try {
    const zone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    return zone && validTimeZone(zone) ? zone : "UTC";
  } catch {
    return "UTC";
  }
}

const READ_TOOL = /^(?:read|list|search|get|find|fetch|lookup|count|view)(?:[_\s-]|$)/i;
const REFUSED_TOOL = /send|write|edit|delete|remove|post|put|patch|create|update|browser|navigate|browse|bash|shell|exec|pay|purchase|publish|computer/i;
const NUMBER = /\d+(?:[.,]\d+)?/g;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export interface BriefPiece {
  /** The message, file or connected item the words came from. */
  piece: string;
  /** The date that piece carries, YYYY-MM-DD. */
  asOf: string;
  text: string;
}

export interface BriefSettings {
  enabled: boolean;
  everyHours: number;
  subjects: string[];
  /** The time of day the brief runs on its own, HH:MM, in `timeZone`. */
  at: string;
  /** IANA time zone of `at` (America/Toronto). */
  timeZone: string;
}

export interface BriefSuggestion {
  id: string;
  text: string;
  sources: BriefPiece[];
  costUsd: number;
  model: string;
  status: "pending" | "rejected" | "kept";
  identity: string;
  at: number;
}

export interface BriefPassInput {
  tools: readonly string[];
  pieces: readonly BriefPiece[];
  /** What this pass cost, shown to the person. Required. */
  costUsd: number;
  /** The bot's fast model. Absent: the pass does not run. */
  fastModel?: string | null;
  now?: number;
}

export type BriefPassResult =
  | { ok: true; model: string; costUsd: number; suggestions: Array<Omit<BriefSuggestion, "id" | "status" | "at">> }
  | { ok: false; error: string };

const pieceSchema = z.object({
  piece: z.string().min(1).max(200),
  asOf: z.string().regex(DAY),
  text: z.string().min(1).max(2_000),
});

const suggestionSchema = z.object({
  id: z.string().min(1).max(80),
  text: z.string().min(1).max(500),
  sources: z.array(pieceSchema).max(8),
  costUsd: z.number().nonnegative(),
  model: z.string().min(1).max(200),
  status: z.enum(["pending", "rejected", "kept"]),
  identity: z.string().min(1).max(500),
  at: z.number(),
});

const settingsSchema = z.object({
  enabled: z.boolean(),
  everyHours: z.number().int().min(BRIEF_MIN_HOURS).max(BRIEF_MAX_HOURS),
  subjects: z.array(z.string().min(1).max(120)).max(12),
  // files written before 2026-10-29 have no time: the default one
  at: z.string().regex(HHMM).optional(),
  timeZone: z.string().min(1).max(64).optional(),
});

const botSchema = z.object({
  // absent: the person never saved a choice, the default applies (on for
  // a Primary Bot, `defaultEnabled`)
  settings: settingsSchema.optional(),
  suggestions: z.array(suggestionSchema).max(80),
  rejected: z.array(z.string().min(1).max(500)).max(200),
  /** The local day (YYYY-MM-DD in the person's zone) the timer last ran. */
  lastScheduledDay: z.string().regex(DAY).optional(),
  /** When the last pass ran, found something or not. */
  lastPassAt: z.number().optional(),
});

const fileSchema = z.object({ version: z.literal(1), bots: z.record(z.string(), botSchema) });
type FileShape = z.infer<typeof fileSchema>;

export function briefToolAllowed(tool: string): boolean {
  const name = tool.trim();
  if (!name || REFUSED_TOOL.test(name)) return false;
  return READ_TOOL.test(name);
}

export function briefIdentity(text: string): string {
  return text.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase().replace(/\.$/, "");
}

function cited(text: string, sources: readonly BriefPiece[]): boolean {
  if (!sources.length || sources.some((source) => !source.piece.trim() || !DAY.test(source.asOf))) return false;
  const numbers = text.match(NUMBER) ?? [];
  return numbers.every((number) => sources.some((source) => source.text.includes(number)));
}

const DATE_IN_TEXT = /\b(\d{4}-\d{2}-\d{2})\b/;

/** A read's text becomes a piece only when it carries a real day. A number
 * with no dated piece is not a piece. */
export function datedBriefPiece(app: string, tool: string, text: string): BriefPiece | null {
  const body = text.replace(/\s+/g, " ").trim();
  const asOf = body.match(DATE_IN_TEXT)?.[1];
  if (!asOf || !app.trim() || !tool.trim() || !body) return null;
  return { piece: `${app.trim()} / ${tool.trim()}`.slice(0, 200), asOf, text: body.slice(0, 2_000) };
}

export interface BriefApp {
  name: string;
  tools: readonly string[];
}

export interface BriefAppCall {
  /** Apps already connected. Empty: nothing to read. */
  apps(): readonly BriefApp[];
  /** One read. Null when the app did not answer. The caller must not send. */
  read(app: string, tool: string): Promise<string | null>;
}

/** Read tools only. A send, a change and the browser are not called. */
export function briefReadTools(tools: readonly string[]): string[] {
  return tools.filter((tool) => briefToolAllowed(tool)).slice(0, 2);
}

/** Reads the connected apps. No app: an empty queue. A number without a
 * dated piece is left out. */
export async function readConnectedBrief(call: BriefAppCall, input: { costUsd: number; fastModel?: string | null }, rejected: readonly string[] = []): Promise<BriefPassResult & { apps: number; notice?: "no_apps" }> {
  const apps = call.apps();
  if (!apps.length) return { ok: true, model: input.fastModel?.trim() ?? "", costUsd: 0, suggestions: [], apps: 0, notice: "no_apps" };
  const pieces: BriefPiece[] = [];
  const tools: string[] = [];
  for (const app of apps) {
    for (const tool of briefReadTools(app.tools)) {
      const text = await call.read(app.name, tool);
      const piece = text ? datedBriefPiece(app.name, tool, text) : null;
      if (!piece) continue;
      tools.push(tool);
      pieces.push(piece);
    }
  }
  if (!pieces.length) return { ok: true, model: input.fastModel?.trim() ?? "", costUsd: 0, suggestions: [], apps: apps.length };
  const pass = runBriefPass({ tools, pieces, costUsd: input.costUsd, fastModel: input.fastModel }, rejected);
  return pass.ok ? { ...pass, apps: apps.length } : { ...pass, apps: apps.length };
}

/** One read-only pass. Writes, sends and the browser refuse the whole pass.
 * A suggestion whose numbers are not in a dated piece is dropped. A text
 * the person already rejected is not returned. */
export function runBriefPass(input: BriefPassInput, rejected: readonly string[] = []): BriefPassResult {
  if (!input.tools.length || input.tools.some((tool) => !briefToolAllowed(tool))) {
    return { ok: false, error: "This pass only reads. It does not send, change anything, or open a browser." };
  }
  if (!Number.isFinite(input.costUsd) || input.costUsd < 0) return { ok: false, error: "The pass needs its cost." };
  const model = input.fastModel?.trim();
  if (!model) return { ok: false, error: "This pass uses the fast model. None is set for this bot." };
  const blocked = new Set(rejected);
  const suggestions = input.pieces.flatMap((piece) => {
    const text = piece.text.replace(/\s+/g, " ").trim().slice(0, 500);
    if (!cited(text, [piece])) return [];
    const identity = briefIdentity(text);
    if (!identity || blocked.has(identity)) return [];
    return [{ text, sources: [{ piece: piece.piece.trim().slice(0, 200), asOf: piece.asOf, text: piece.text.slice(0, 2_000) }], costUsd: input.costUsd, model, identity }];
  });
  return { ok: true, model, costUsd: input.costUsd, suggestions };
}

/** A kept suggestion as a memory line for the person alone. A room must not see it. */
export function keptMemoryLine(text: string, now: Date = new Date()): string {
  const line = memoryEntry(text, { source: "background brief", now, readers: BRIEF_READERS });
  if (memoryMayShow(BRIEF_READERS, { kind: "room", id: "any" })) throw new Error("a brief fact must not enter a room");
  return line;
}

export function cleanBriefSettings(input: Partial<BriefSettings> | undefined, previous?: BriefSettings): BriefSettings {
  const every = Number(input?.everyHours);
  const subjects = (input?.subjects ?? previous?.subjects ?? [])
    .map((subject) => subject.replace(/\s+/g, " ").trim().slice(0, 120))
    .filter(Boolean)
    .slice(0, 12);
  const at = typeof input?.at === "string" && HHMM.test(input.at) ? input.at : previous?.at ?? BRIEF_DEFAULT_AT;
  const zone = typeof input?.timeZone === "string" ? input.timeZone.trim() : "";
  return {
    // a change of time alone keeps the brief on or off as it was
    enabled: typeof input?.enabled === "boolean" ? input.enabled : previous?.enabled ?? false,
    everyHours: Number.isInteger(every) && every >= BRIEF_MIN_HOURS && every <= BRIEF_MAX_HOURS ? every : previous?.everyHours ?? 4,
    subjects,
    at,
    timeZone: zone && validTimeZone(zone) ? zone : previous?.timeZone ?? serverTimeZone(),
  };
}

/** The local day, YYYY-MM-DD, at `atMs` in `timeZone`. */
export function localDay(atMs: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(atMs));
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${read("year")}-${read("month")}-${read("day")}`;
}

/** Whether the daily time has come: today, at or after `at`, within the
 * catch-up window, and not run yet today. */
export function briefTimeCame(settings: Pick<BriefSettings, "enabled" | "at" | "timeZone">, lastDay: string | undefined, now: number): boolean {
  if (!settings.enabled || !HHMM.test(settings.at) || !validTimeZone(settings.timeZone)) return false;
  const clock = localClock(now, settings.timeZone);
  const at = Number(settings.at.slice(0, 2)) * 60 + Number(settings.at.slice(3, 5));
  if (clock.minute < at || clock.minute >= at + BRIEF_CATCH_UP_MINUTES) return false;
  return localDay(now, settings.timeZone) !== lastDay;
}

type BotRow = z.infer<typeof botSchema>;

const emptyBot = (): BotRow => ({
  suggestions: [],
  rejected: [],
});

export interface BriefStoreOptions {
  /** Whether the brief is on for a bot whose person never chose: on for a
   * Primary Bot (2026-10-29). Absent: off. */
  defaultEnabled?: (botId: string) => boolean;
}

export class BriefStore {
  private data: FileShape = { version: 1, bots: {} };
  private readonly file: string;
  private readonly now: () => number;
  private readonly defaultEnabled: (botId: string) => boolean;

  constructor(file: string, now: () => number = Date.now, options: BriefStoreOptions = {}) {
    this.file = file;
    this.now = now;
    this.defaultEnabled = options.defaultEnabled ?? (() => false);
    try {
      this.data = fileSchema.parse(JSON.parse(readFileSync(file, "utf8")));
    } catch {
      // missing or unreadable: start empty, do not invent suggestions
    }
  }

  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileAtomic(this.file, JSON.stringify(this.data), { mode: 0o600 });
  }

  private bot(botId: string): BotRow {
    return this.data.bots[botId] ?? emptyBot();
  }

  /** The settings in force: the person's own, else the default. */
  settings(botId: string): BriefSettings {
    const saved = this.bot(botId).settings;
    if (saved) return cleanBriefSettings(saved, { enabled: saved.enabled, everyHours: saved.everyHours, subjects: saved.subjects, at: saved.at ?? BRIEF_DEFAULT_AT, timeZone: saved.timeZone ?? serverTimeZone() });
    return { enabled: this.defaultEnabled(botId), everyHours: 4, subjects: [], at: BRIEF_DEFAULT_AT, timeZone: serverTimeZone() };
  }

  view(botId: string): { settings: BriefSettings; suggestions: BriefSuggestion[]; costUsd: number; lastPassAt?: number } {
    const row = this.bot(botId);
    const pending = row.suggestions.filter((item) => item.status === "pending");
    const costUsd = pending.reduce((sum, item) => sum + item.costUsd, 0);
    return { settings: this.settings(botId), suggestions: row.suggestions, costUsd, ...(row.lastPassAt ? { lastPassAt: row.lastPassAt } : {}) };
  }

  saveSettings(botId: string, patch: Partial<BriefSettings>): BriefSettings {
    const row = this.bot(botId);
    row.settings = cleanBriefSettings(patch, this.settings(botId));
    this.data.bots[botId] = row;
    this.save();
    return row.settings as BriefSettings;
  }

  /** Due when the person enabled it and the last pass is older than their cadence. */
  due(botId: string, now = this.now()): boolean {
    const row = this.bot(botId);
    const settings = this.settings(botId);
    if (!settings.enabled) return false;
    const last = row.lastPassAt ?? row.suggestions.reduce((max, item) => Math.max(max, item.at), 0);
    if (!last) return true;
    return now - last >= settings.everyHours * 3_600_000;
  }

  /** The timer's question: the person's daily time came and it has not run today. */
  scheduledDue(botId: string, now = this.now()): boolean {
    return briefTimeCame(this.settings(botId), this.bot(botId).lastScheduledDay, now);
  }

  /** The timer took today's run (before it reads, so a slow pass never runs twice). */
  markScheduled(botId: string, now = this.now()): void {
    const row = this.bot(botId);
    row.lastScheduledDay = localDay(now, this.settings(botId).timeZone);
    this.data.bots[botId] = row;
    this.save();
  }

  /** A pass ran (with or without anything new). */
  markPass(botId: string, now = this.now()): void {
    const row = this.bot(botId);
    row.lastPassAt = now;
    this.data.bots[botId] = row;
    this.save();
  }

  recordPass(botId: string, pass: Extract<BriefPassResult, { ok: true }>): BriefSuggestion[] {
    const row = this.bot(botId);
    const added: BriefSuggestion[] = [];
    for (const suggestion of pass.suggestions) {
      if (row.rejected.includes(suggestion.identity)) continue;
      if (row.suggestions.some((item) => item.identity === suggestion.identity)) continue;
      const saved: BriefSuggestion = { ...suggestion, id: `brief_${randomUUID()}`, status: "pending", at: this.now() };
      row.suggestions.push(saved);
      added.push(saved);
    }
    row.suggestions = row.suggestions.slice(-80);
    row.lastPassAt = this.now();
    this.data.bots[botId] = row;
    this.save();
    return added;
  }

  reject(botId: string, id: string): BriefSuggestion | null {
    const row = this.bot(botId);
    const item = row.suggestions.find((candidate) => candidate.id === id && candidate.status === "pending");
    if (!item) return null;
    item.status = "rejected";
    if (!row.rejected.includes(item.identity)) row.rejected.push(item.identity);
    row.rejected = row.rejected.slice(-200);
    this.data.bots[botId] = row;
    this.save();
    return item;
  }

  takePending(botId: string, id: string): BriefSuggestion | null {
    const row = this.bot(botId);
    const item = row.suggestions.find((candidate) => candidate.id === id && candidate.status === "pending");
    if (!item) return null;
    item.status = "kept";
    this.data.bots[botId] = row;
    this.save();
    return item;
  }
}
