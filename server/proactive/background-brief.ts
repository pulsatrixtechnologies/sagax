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
  /** #2699: the person let the bot see which app and window are in front
   * on this computer (server/proactive/screen-context.ts). Off by default. */
  screenContext: boolean;
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
  /** #2694: the person's last feedback on this item or its card. */
  feedback?: BriefFeedback;
}

/** #2694: feedback on a brief item or a suggestion card. `down` drops this
 * item, `less` lowers its topic, `never` blocks it for good, `up` raises its
 * topic. It applies at the next pass and goes to the person's memory. */
export const BRIEF_FEEDBACK = ["up", "down", "less", "never"] as const;
export type BriefFeedback = typeof BRIEF_FEEDBACK[number];

export function isBriefFeedback(value: unknown): value is BriefFeedback {
  return typeof value === "string" && (BRIEF_FEEDBACK as readonly string[]).includes(value);
}

/** The kind of thing an item is about: the app its first piece came from
 * (pieces read "App, tool words" since #2693, older ones "App / tool"). */
export function briefTopic(item: Pick<BriefSuggestion, "sources">): string {
  const piece = item.sources[0]?.piece ?? "";
  const app = piece.split(/,| \/ /)[0]?.trim().toLowerCase().slice(0, 80);
  return app || "general";
}

/** #2694: a topic's feedback. Counts fade with time (see decayTopic), so a
 * "less" or a thumbs-down softens instead of muting a topic for good.
 * `at` is when the counts were last brought to date; `blocked` is the
 * person's "never" on a whole topic (a wake kind), lifted by a thumbs-up. */
export interface TopicFeedback { up: number; down: number; less: number; at?: number; blocked?: boolean }

/** Half-life of a feedback vote: after two weeks it weighs half. */
export const TOPIC_HALF_LIFE_MS = 14 * 24 * 60 * 60 * 1000;

/** The counts brought to `now`: each vote halves every TOPIC_HALF_LIFE_MS.
 * A row without `at` (written before decay) counts from `now`. */
export function decayTopic(row: TopicFeedback, now: number): TopicFeedback {
  const at = row.at ?? now;
  const age = Math.max(0, now - at);
  const factor = Math.pow(0.5, age / TOPIC_HALF_LIFE_MS);
  const round = (value: number) => Math.round(value * factor * 1000) / 1000;
  return { up: round(row.up), down: round(row.down), less: round(row.less), at: now, ...(row.blocked ? { blocked: true } : {}) };
}

/** A topic's weight: up raises it, down lowers it, less lowers it twice. */
export function topicScore(row: TopicFeedback | undefined, now?: number): number {
  if (!row) return 0;
  const live = now === undefined ? row : decayTopic(row, now);
  return live.up - live.down - 2 * live.less;
}

/** At or under this, a topic is not proposed any more (until it fades). */
export const TOPIC_MUTED_AT = -4;

/** A "less" still counts while it weighs at least this much (about two weeks). */
const LESS_ACTIVE_AT = 0.5;

/** Whether a topic is muted now: blocked by "never", or voted down past
 * TOPIC_MUTED_AT and not yet faded back. */
export function topicMuted(row: TopicFeedback | undefined, now: number): boolean {
  if (!row) return false;
  if (row.blocked) return true;
  return topicScore(row, now) <= TOPIC_MUTED_AT;
}

/** The suggestions a pass keeps, ranked by topic: a muted topic is dropped,
 * a topic the person asked less of keeps one item a pass, the rest goes
 * from the most liked topic down. Votes fade with time (decayTopic). */
export function rankByFeedback<T extends Pick<BriefSuggestion, "sources">>(items: readonly T[], topics: Readonly<Record<string, TopicFeedback>>, now = Date.now()): T[] {
  const perTopic = new Map<string, number>();
  const kept: Array<{ item: T; score: number; index: number }> = [];
  items.forEach((item, index) => {
    const topic = briefTopic(item);
    const stored = topics[topic];
    const row = stored ? decayTopic(stored, now) : undefined;
    const score = topicScore(row);
    if (row?.blocked || score <= TOPIC_MUTED_AT) return;
    const seen = perTopic.get(topic) ?? 0;
    if (row && row.less >= LESS_ACTIVE_AT && seen >= 1) return;
    perTopic.set(topic, seen + 1);
    kept.push({ item, score, index });
  });
  return kept.sort((a, b) => b.score - a.score || a.index - b.index).map((row) => row.item);
}

/** One vote on a topic, the stored row first brought to date. "never" blocks
 * the topic only when `blockOnNever` (a wake kind; a brief item's "never"
 * blocks that one item instead); "up" lifts a block. */
export function voteTopic(stored: TopicFeedback | undefined, choice: BriefFeedback, now: number, blockOnNever = false): TopicFeedback {
  const row = decayTopic(stored ?? { up: 0, down: 0, less: 0 }, now);
  if (choice === "never") {
    if (blockOnNever) row.blocked = true;
  } else {
    row[choice] += 1;
  }
  if (choice === "up") delete row.blocked;
  return row;
}

/** The memory line a feedback leaves, in the person's language. */
export function feedbackMemoryText(choice: BriefFeedback, text: string, topic: string, language: "fr" | "en"): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const quote = flat.length > 120 ? `${flat.slice(0, 119).trimEnd()}…` : flat;
  if (language === "fr") {
    const what = { up: "aime ce genre de suggestion", down: "n'a pas trouvé utile", less: "veut moins de suggestions de ce genre", never: "ne veut plus jamais cette suggestion" }[choice];
    return `Suggestions proactives : la personne ${what} (${topic}) : « ${quote} ».`;
  }
  const what = { up: "likes this kind of suggestion", down: "did not find this useful", less: "wants fewer suggestions like this", never: "never wants this suggestion again" }[choice];
  return `Proactive suggestions: the person ${what} (${topic}): "${quote}".`;
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
  feedback: z.enum(BRIEF_FEEDBACK).optional(),
});

const topicSchema = z.object({ up: z.number().nonnegative(), down: z.number().nonnegative(), less: z.number().nonnegative(), at: z.number().optional(), blocked: z.boolean().optional() });

const settingsSchema = z.object({
  enabled: z.boolean(),
  everyHours: z.number().int().min(BRIEF_MIN_HOURS).max(BRIEF_MAX_HOURS),
  subjects: z.array(z.string().min(1).max(120)).max(12),
  // files written before 2026-10-29 have no time: the default one
  at: z.string().regex(HHMM).optional(),
  timeZone: z.string().min(1).max(64).optional(),
  screenContext: z.boolean().optional(),
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
  /** #2694: the person's feedback per topic (briefTopic). */
  topics: z.record(z.string(), topicSchema).optional(),
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

/** #2693: a day, alone or at the head of a full ISO timestamp
 * ("2026-11-08T14:00:00Z" counts: `\b` stops at the "T"). */
const DATE_IN_TEXT = /(?<!\d)(\d{4}-\d{2}-\d{2})(?=$|[^\d])/;

/** "list_messages" or "listMessages" as words: "list messages". */
export function toolWords(tool: string): string {
  return tool.trim().replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_\-.]+/g, " ").replace(/\s+/g, " ").toLowerCase().trim();
}

const GIST_FIELDS = ["subject", "title", "summary", "name", "description", "text", "body", "message"] as const;
const GIST_LISTS = ["items", "messages", "results", "value", "data", "events", "records", "entries"] as const;
const GIST_MAX = 160;

function firstRecord(value: unknown, depth = 0): Record<string, unknown> | null {
  if (depth > 3 || value === null || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = firstRecord(entry, depth + 1);
      if (found) return found;
    }
    return null;
  }
  const record = value as Record<string, unknown>;
  if (GIST_FIELDS.some((field) => typeof record[field] === "string" && (record[field] as string).trim())) return record;
  for (const key of GIST_LISTS) {
    const found = firstRecord(record[key], depth + 1);
    if (found) return found;
  }
  return null;
}

function clipGist(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > GIST_MAX ? `${flat.slice(0, GIST_MAX - 1).trimEnd()}…` : flat;
}

/** #2693: what a read says, in the person's words rather than the tool's
 * output: the subject or title of the first record of a JSON answer, else
 * the first sentence of a text answer, without braces, quotes or keys. Never
 * calls a model. "" when nothing readable is left. */
export function briefGist(raw: string): string {
  const body = raw.trim();
  if (/^[[{]/.test(body)) {
    try {
      const record = firstRecord(JSON.parse(body));
      const field = record ? GIST_FIELDS.find((key) => typeof record[key] === "string" && (record[key] as string).trim()) : undefined;
      if (record && field) return clipGist(String(record[field]));
    } catch {
      // not JSON after all: read it as text below
    }
  }
  const text = body
    .replace(/"[A-Za-z_][\w.-]*"\s*:/g, " ")
    .replace(/[{}[\]"]+/g, " ")
    .replace(/\s*,\s*(?=,|$)/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const sentence = text.split(/(?<=[.!?])\s+|\n/)[0] ?? "";
  return clipGist(sentence.replace(/^[,:;\s]+|[,:;\s]+$/g, ""));
}

/** #2693: a suggestion as one concrete action the person can say yes to. */
export function suggestionAction(item: Pick<BriefSuggestion, "text" | "sources">, language: "fr" | "en"): string {
  const gist = item.text.replace(/[.\s]+$/, "");
  const app = item.sources[0]?.piece.split(",")[0]?.trim();
  if (language === "fr") return app ? `Faire le suivi de « ${gist} » dans ${app}` : `Faire le suivi de « ${gist} »`;
  return app ? `Follow up on "${gist}" in ${app}` : `Follow up on "${gist}"`;
}

/** A read's text becomes a piece only when it carries a real day. A number
 * with no dated piece is not a piece. */
export function datedBriefPiece(app: string, tool: string, text: string): BriefPiece | null {
  const body = text.replace(/\s+/g, " ").trim();
  const asOf = body.match(DATE_IN_TEXT)?.[1];
  if (!asOf || !app.trim() || !tool.trim() || !body) return null;
  return { piece: `${app.trim()}, ${toolWords(tool)}`.slice(0, 200), asOf, text: body.slice(0, 2_000) };
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
    // #2693: the point is what the read says, not the tool's raw answer
    const text = briefGist(piece.text);
    if (!text || !cited(text, [piece])) return [];
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
    screenContext: typeof input?.screenContext === "boolean" ? input.screenContext : previous?.screenContext ?? false,
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
    if (saved) return cleanBriefSettings(saved, { enabled: saved.enabled, everyHours: saved.everyHours, subjects: saved.subjects, at: saved.at ?? BRIEF_DEFAULT_AT, timeZone: saved.timeZone ?? serverTimeZone(), screenContext: saved.screenContext ?? false });
    return { enabled: this.defaultEnabled(botId), everyHours: 4, subjects: [], at: BRIEF_DEFAULT_AT, timeZone: serverTimeZone(), screenContext: false };
  }

  /** #2699: the bots whose person turned screen context on. */
  screenContextBots(): string[] {
    return Object.entries(this.data.bots).filter(([, row]) => row.settings?.screenContext === true).map(([botId]) => botId);
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
    for (const suggestion of rankByFeedback(pass.suggestions, row.topics ?? {}, this.now())) {
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

  /** #2694: the person's feedback on one item, answered or not. */
  feedback(botId: string, id: string, choice: BriefFeedback): { item: BriefSuggestion; topic: string } | null {
    const row = this.bot(botId);
    const item = row.suggestions.find((candidate) => candidate.id === id);
    if (!item) return null;
    const topic = briefTopic(item);
    const topics = row.topics ?? {};
    topics[topic] = voteTopic(topics[topic], choice, this.now());
    row.topics = topics;
    item.feedback = choice;
    if ((choice === "down" || choice === "never" || choice === "less") && item.status === "pending") item.status = "rejected";
    if (choice === "never" && !row.rejected.includes(item.identity)) {
      row.rejected.push(item.identity);
      row.rejected = row.rejected.slice(-200);
    }
    this.data.bots[botId] = row;
    this.save();
    return { item, topic };
  }

  topics(botId: string): Record<string, TopicFeedback> {
    return { ...this.bot(botId).topics };
  }

  /** #2694: feedback on a whole wake kind ("heartbeat", "mail", "calendar",
   * "attention", ...), from a wake's message or a Today card. "never" blocks
   * the kind until a thumbs-up; the other votes fade like brief topics. */
  topicFeedback(botId: string, topic: string, choice: BriefFeedback): TopicFeedback {
    const row = this.bot(botId);
    const topics = row.topics ?? {};
    const key = `wake:${topic.trim().toLowerCase().slice(0, 60)}`;
    topics[key] = voteTopic(topics[key], choice, this.now(), true);
    row.topics = topics;
    this.data.bots[botId] = row;
    this.save();
    return { ...topics[key]! };
  }

  /** #2694: whether a wake kind is muted by the person's feedback now. */
  wakeMuted(botId: string, topic: string): boolean {
    const row = this.data.bots[botId];
    if (!row?.topics) return false;
    return topicMuted(row.topics[`wake:${topic.trim().toLowerCase().slice(0, 60)}`], this.now());
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
