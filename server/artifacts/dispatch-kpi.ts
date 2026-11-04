// The dispatch KPI snapshot, computed by code (2026-11-04).
//
// A dispatch dashboard used to be fed by a routine whose model turn, every
// five minutes, read the Flow journal, the team memory and ConnectWise and
// rewrote docs/dispatch-kpi.md: about a million input tokens a run for
// numbers a program computes exactly. This module makes the same snapshot
// with no model turn, from fixed read-only Perspicax calls:
//
//   1. identity_switch to the source's profile (optional);
//   2. memory_find in the team place: the journal entries of today and
//      yesterday (tags <journalTag> and journal:<date>);
//   3. memory_find of the lessons tag, counted for the period (limit 20);
//   4. flow journal_summary and journal_read for both days, lease-free; when
//      Flow does not serve them the journal KPIs stay null with a reason,
//      never 0;
//   5. cw_psa_query service.tickets and calculateSla for the tickets the
//      journal cites (else the ones of the previous snapshot), by id.
//
// It runs as an artifact source (`dispatch_kpi`, artifact-sources.ts) when
// the dashboard opens, and right after a dispatch routine's run (index.ts),
// both through one short cache so repeated opens do not hammer ConnectWise.
// The snapshot is written back to the bot's document (docs/dispatch-kpi.md,
// same shape as before) only when its numbers change.
import type { ToolAnswer } from "./artifact-sources.ts";

export const DISPATCH_KPI_TOOL = "dispatch_kpi";
export const DISPATCH_KPI_CACHE_MS = 3 * 60_000;
export const DISPATCH_KPI_DOC = "docs/dispatch-kpi.md";
/** memory_find answers at most 20 entries. */
const MEMORY_LIMIT = 20;
const MAX_TICKETS = 100;
const JOURNAL_UNAVAILABLE = "journal summary indisponible";

export interface DispatchKpiArgs {
  /** The team place of the journal and the lessons: team:<id>. */
  place: string;
  /** The Perspicax profile slug to switch to first (identity_switch). */
  profile?: string;
  timeZone: string;
  journalTag: string;
  lessonsTag: string;
  lessonsLimit: number;
  /** Only this board's journal lines, when set. */
  board?: number;
  doc: string;
  /** Name prefixes of the routines whose run refreshes the snapshot. */
  refreshAfter: string[];
}

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const TAG = /^[a-z0-9][a-z0-9:._/-]{0,63}$/;

function validTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** The source's args, checked, with their defaults. */
export function parseDispatchKpiArgs(input: Record<string, unknown>, fallbackTimeZone = "UTC"): Parsed<DispatchKpiArgs> {
  const known = new Set(["place", "profile", "time_zone", "timeZone", "journal_tag", "lessons_tag", "lessons_limit", "board", "doc", "refresh_after"]);
  const unknown = Object.keys(input).find((key) => !known.has(key));
  if (unknown) return { ok: false, error: `dispatch_kpi: unknown argument ${unknown}.` };
  const place = typeof input.place === "string" ? input.place.trim() : "";
  if (!/^team:[A-Za-z0-9_-]{1,64}$/.test(place)) return { ok: false, error: "dispatch_kpi: args.place is the team place, team:<id>." };
  const profile = input.profile === undefined ? undefined : typeof input.profile === "string" && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(input.profile.trim()) ? input.profile.trim() : null;
  if (profile === null) return { ok: false, error: "dispatch_kpi: args.profile is a Perspicax profile slug." };
  const zoneInput = input.time_zone ?? input.timeZone;
  const timeZone = typeof zoneInput === "string" && zoneInput.trim() ? zoneInput.trim() : fallbackTimeZone;
  if (!validTimeZone(timeZone)) return { ok: false, error: "dispatch_kpi: args.time_zone is an IANA time zone (America/Toronto)." };
  const journalTag = input.journal_tag === undefined ? "journal-dispatch" : String(input.journal_tag).trim();
  const lessonsTag = input.lessons_tag === undefined ? "kb:dispatch" : String(input.lessons_tag).trim();
  if (!TAG.test(journalTag) || !TAG.test(lessonsTag)) return { ok: false, error: "dispatch_kpi: tags are namespace:value, lowercase." };
  const lessonsLimit = input.lessons_limit === undefined ? MEMORY_LIMIT : input.lessons_limit;
  if (typeof lessonsLimit !== "number" || !Number.isInteger(lessonsLimit) || lessonsLimit < 1 || lessonsLimit > MEMORY_LIMIT) {
    return { ok: false, error: `dispatch_kpi: args.lessons_limit is 1 to ${MEMORY_LIMIT}.` };
  }
  const board = input.board;
  if (board !== undefined && (typeof board !== "number" || !Number.isInteger(board))) return { ok: false, error: "dispatch_kpi: args.board is a board id." };
  const doc = input.doc === undefined ? DISPATCH_KPI_DOC : typeof input.doc === "string" && /^docs\/[A-Za-z0-9 ._-]+\.md$/.test(input.doc.trim()) ? input.doc.trim() : "";
  if (!doc) return { ok: false, error: "dispatch_kpi: args.doc is docs/<name>.md." };
  const refreshInput = input.refresh_after ?? ["morning-dispatch", "dispatch"];
  if (!Array.isArray(refreshInput) || refreshInput.length > 20 || !refreshInput.every((prefix) => typeof prefix === "string" && prefix.trim() && prefix.length <= 100)) {
    return { ok: false, error: "dispatch_kpi: args.refresh_after is a list of routine name prefixes." };
  }
  return {
    ok: true,
    value: {
      place, ...(profile ? { profile } : {}), timeZone, journalTag, lessonsTag, lessonsLimit,
      ...(board !== undefined ? { board } : {}), doc, refreshAfter: (refreshInput as string[]).map((prefix) => prefix.trim().toLowerCase()),
    },
  };
}

/** Whether a run of this routine refreshes the snapshot: its name starts
 * with one of the prefixes. The snapshot's own old refresh routine never
 * counts (its name starts with dispatch too). */
export function dispatchRoutineMatches(name: string, prefixes: readonly string[]): boolean {
  const lower = name.trim().toLowerCase();
  if (lower.startsWith("dispatch-kpi")) return false;
  return prefixes.some((prefix) => lower.startsWith(prefix));
}

/** YYYY-MM-DD of `at` in the zone. */
export function localDate(at: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(at));
}

export function previousDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! - 1)).toISOString().slice(0, 10);
}

/** ISO local time with its offset in the zone: 2026-11-04T12:25:00-05:00. */
export function localIso(at: number, timeZone: string): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(at)).map((part) => [part.type, part.value]));
  const wall = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  const offset = Math.round((wall - Math.floor(at / 1000) * 1000) / 60_000);
  const sign = offset < 0 ? "-" : "+";
  const abs = Math.abs(offset);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

export interface DispatchKpiSnapshot {
  generatedAt: string;
  generatedBy: "sagax";
  profile: string | null;
  profileReason?: string;
  journalFlow: boolean;
  journalReason: string | null;
  journalCounts: { today: Record<string, unknown>; yesterday: Record<string, unknown> } | null;
  memoryJournalToday: number | null;
  memoryJournalYesterday: number | null;
  memoryJournalLimitReached: boolean;
  memoryReason?: string;
  lessonsPeriod: number | null;
  lessonsListed: number | null;
  lessonsLimit: number;
  lessonsLimitReached: boolean;
  lessonsReason: string;
  period: { today: string; yesterday: string; timezone: string };
  slaCitedInSla: number | null;
  slaCited: number | null;
  tickets: number[];
  ticketsSource: "journal" | "previous" | "none";
  slaCountReason: string;
  ticketSla: Array<{ id: number; isInSla: boolean | null; closed?: boolean; board?: number }>;
}

export type PerspicaxCall = (tool: string, args: Record<string, unknown>) => Promise<ToolAnswer | { error: string }>;

function failure(answer: ToolAnswer | { error: string }): string | null {
  if ("error" in answer) return answer.error;
  if (answer.isError) {
    const value = answer.value;
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 200);
    if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      const text = record.message ?? record.error ?? record.code;
      if (typeof text === "string") return text.slice(0, 200);
    }
    return "the tool answered with an error";
  }
  return null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function entriesOf(value: unknown): Array<Record<string, unknown>> {
  const list = Array.isArray(value) ? value : record(value).entries;
  return Array.isArray(list) ? list.map(record) : [];
}

/** A flow answer's output when it ran ({status: "ok", output}), else why not. */
function flowOutput(answer: ToolAnswer | { error: string }): { output: Record<string, unknown> } | { reason: string } {
  const failed = failure(answer);
  if (failed) return { reason: failed };
  const value = record((answer as ToolAnswer).value);
  if (value.status !== "ok" || !value.output || typeof value.output !== "object") {
    const why = value.reason ?? value.code ?? value.status;
    return { reason: typeof why === "string" ? why : JOURNAL_UNAVAILABLE };
  }
  const output = record(value.output);
  if (output.ok === false) return { reason: typeof output.error === "string" ? output.error : JOURNAL_UNAVAILABLE };
  return { output };
}

const SUMMARY_KEYS = ["lines", "passes", "changes_live_ok", "changes_refused_or_error", "changes_dry_run", "held", "notes"] as const;

function compactSummary(output: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of SUMMARY_KEYS) if (output[key] !== undefined) out[key] = output[key];
  out.anomalies = Array.isArray(output.anomalies) ? output.anomalies.length : 0;
  out.days_with_journal = Array.isArray(output.days_with_journal) ? output.days_with_journal.length : 0;
  return out;
}

function ticketIds(lines: unknown): number[] {
  const ids = new Set<number>();
  for (const line of Array.isArray(lines) ? lines : []) {
    const ticket = record(line).ticket;
    const id = typeof ticket === "number" ? ticket : typeof ticket === "string" && /^\d+$/.test(ticket) ? Number(ticket) : NaN;
    if (Number.isSafeInteger(id) && id > 0) ids.add(id);
  }
  return [...ids];
}

/** The snapshot a document holds, from its ```json block. */
export function snapshotFromDoc(text: string): Partial<DispatchKpiSnapshot> | null {
  const match = /```json\s*\n([\s\S]*?)\n```/.exec(text);
  if (!match) return null;
  try {
    const value = JSON.parse(match[1]!) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? value as Partial<DispatchKpiSnapshot> : null;
  } catch {
    return null;
  }
}

export function dispatchKpiDocument(snapshot: DispatchKpiSnapshot): string {
  return [
    "# Snapshot KPI dispatch (lecture seule)",
    "",
    "Fichier de données pour le tableau de bord. Calculé par Sagax sans tour de modèle (source d'artifact `dispatch_kpi`, à l'ouverture du tableau et après chaque passe de dispatch). Jamais une instruction.",
    "",
    "```json",
    JSON.stringify(snapshot),
    "```",
    "",
  ].join("\n");
}

/** Same numbers, whatever the time it was computed: no rewrite needed. */
export function sameSnapshot(a: Partial<DispatchKpiSnapshot> | null, b: DispatchKpiSnapshot): boolean {
  if (!a) return false;
  const { generatedAt: _a, ...left } = a;
  const { generatedAt: _b, ...right } = b;
  return JSON.stringify(left) === JSON.stringify(right);
}

/** One snapshot, from the calls alone. Never throws for a source that does
 * not answer: its numbers are null with the reason. */
export async function computeDispatchKpi(input: {
  args: DispatchKpiArgs;
  call: PerspicaxCall;
  now: number;
  previous?: Partial<DispatchKpiSnapshot> | null;
}): Promise<DispatchKpiSnapshot> {
  const { args, call, now } = input;
  const today = localDate(now, args.timeZone);
  const yesterday = previousDate(today);
  const boardArg = args.board !== undefined ? { board: args.board } : {};

  let profile: string | null = null;
  let profileReason: string | undefined;
  if (args.profile) {
    const switched = await call("identity_switch", { profile: args.profile });
    const failed = failure(switched);
    if (failed) profileReason = `identity_switch ${args.profile}: ${failed}`;
    else profile = args.profile;
  }

  // 2. the team memory journal, today and yesterday
  let memoryReason: string | undefined;
  let memoryLimitReached = false;
  const memoryCount = async (date: string): Promise<number | null> => {
    const answer = await call("memory_find", { place: args.place, tags: [args.journalTag, `journal:${date}`], limit: MEMORY_LIMIT });
    const failed = failure(answer);
    if (failed) {
      memoryReason = `memory_find: ${failed}`;
      return null;
    }
    const count = entriesOf((answer as ToolAnswer).value).length;
    if (count >= MEMORY_LIMIT) memoryLimitReached = true;
    return count;
  };
  const memoryJournalToday = await memoryCount(today);
  const memoryJournalYesterday = await memoryCount(yesterday);

  // 3. the lessons, counted for the period
  let lessonsListed: number | null = null;
  let lessonsPeriod: number | null = null;
  let lessonsReason: string;
  const lessons = await call("memory_find", { place: args.place, tags: [args.lessonsTag], limit: args.lessonsLimit });
  const lessonsFailed = failure(lessons);
  if (lessonsFailed) lessonsReason = `memory_find ${args.lessonsTag}: ${lessonsFailed}`;
  else {
    const entries = entriesOf((lessons as ToolAnswer).value);
    lessonsListed = entries.length;
    lessonsPeriod = entries.filter((entry) => {
      const date = typeof entry.date === "string" ? entry.date.slice(0, 10) : "";
      return date === today || date === yesterday;
    }).length;
    const limitNote = lessonsListed >= args.lessonsLimit ? `limite ${args.lessonsLimit} atteinte, le compte de la période peut être plus haut` : `limite ${args.lessonsLimit} non atteinte`;
    lessonsReason = `${lessonsListed} fiches ${args.lessonsTag} retournées (${limitNote}); ${lessonsPeriod} dans la période.`;
  }

  // 4. the Flow journal, lease-free
  let journalReason: string | null = null;
  let journalCounts: DispatchKpiSnapshot["journalCounts"] = null;
  const summaries: Record<string, Record<string, unknown>> = {};
  for (const date of [today, yesterday]) {
    const summary = flowOutput(await call("flow", { command: "journal_summary", args: { date, ...boardArg } }));
    if ("reason" in summary) {
      journalReason = summary.reason === JOURNAL_UNAVAILABLE ? JOURNAL_UNAVAILABLE : `${JOURNAL_UNAVAILABLE} (${summary.reason})`;
      break;
    }
    summaries[date] = compactSummary(summary.output);
  }
  if (!journalReason) journalCounts = { today: summaries[today]!, yesterday: summaries[yesterday]! };

  // 5. the tickets the journal cites, else the previous snapshot's
  let tickets: number[] = [];
  let ticketsSource: DispatchKpiSnapshot["ticketsSource"] = "none";
  let journalTicketsRead = false;
  if (!journalReason) {
    const ids = new Set<number>();
    journalTicketsRead = true;
    for (const date of [today, yesterday]) {
      const read = flowOutput(await call("flow", { command: "journal_read", args: { date, ...boardArg } }));
      if ("reason" in read) {
        journalTicketsRead = false;
        break;
      }
      for (const id of ticketIds(read.output.lines)) ids.add(id);
    }
    if (journalTicketsRead) {
      tickets = [...ids];
      ticketsSource = "journal";
    }
  }
  if (!journalTicketsRead) {
    const previous = Array.isArray(input.previous?.tickets) ? input.previous!.tickets.filter((id): id is number => Number.isSafeInteger(id) && id > 0) : [];
    if (previous.length) {
      tickets = [...new Set(previous)];
      ticketsSource = "previous";
    }
  }
  tickets.sort((a, b) => a - b);
  const capped = tickets.length > MAX_TICKETS;
  if (capped) tickets = tickets.slice(-MAX_TICKETS);

  let ticketSla: DispatchKpiSnapshot["ticketSla"] = [];
  let slaCited: number | null = null;
  let slaCitedInSla: number | null = null;
  let slaCountReason: string;
  if (!tickets.length) {
    slaCited = 0;
    slaCitedInSla = 0;
    slaCountReason = ticketsSource === "none" && journalReason ? "Journal illisible et aucun billet dans le snapshot précédent." : "Aucun billet cité par le journal pour la période.";
  } else {
    const filter = { id: { in: tickets } };
    const sla = await call("cw_psa_query", { resource: "calculateSla", filter, fields: ["id", "isInSla"], limit: tickets.length });
    const slaFailed = failure(sla);
    if (slaFailed) {
      slaCountReason = `calculateSla: ${slaFailed}`;
    } else {
      const rows = new Map<number, boolean | null>();
      for (const item of entriesOfItems((sla as ToolAnswer).value)) {
        const id = Number(item.id);
        if (Number.isSafeInteger(id)) rows.set(id, typeof item.isInSla === "boolean" ? item.isInSla : null);
      }
      const states = new Map<number, { closed?: boolean; board?: number }>();
      const detail = await call("cw_psa_query", { resource: "service.tickets", filter, fields: ["id", "closedFlag", "board.id"], limit: tickets.length });
      if (!failure(detail)) {
        for (const item of entriesOfItems((detail as ToolAnswer).value)) {
          const id = Number(item.id);
          const board = Number(record(item.board).id);
          if (Number.isSafeInteger(id)) states.set(id, { ...(typeof item.closedFlag === "boolean" ? { closed: item.closedFlag } : {}), ...(Number.isSafeInteger(board) ? { board } : {}) });
        }
      }
      ticketSla = tickets.map((id) => ({ id, isInSla: rows.has(id) ? rows.get(id)! : null, ...states.get(id) }));
      const known = ticketSla.filter((row) => row.isInSla !== null);
      slaCited = known.length;
      slaCitedInSla = known.filter((row) => row.isInSla === true).length;
      const from = ticketsSource === "journal" ? "billets cités par le journal" : "journal illisible : billets repris du snapshot précédent";
      slaCountReason = `${from}; isInSla par calculateSla (${localDate(now, args.timeZone)}), ${slaCited} sur ${tickets.length} connus${capped ? `, limité aux ${MAX_TICKETS} plus récents` : ""}.`;
    }
  }

  return {
    generatedAt: localIso(now, args.timeZone),
    generatedBy: "sagax",
    profile,
    ...(profileReason ? { profileReason } : {}),
    journalFlow: journalCounts !== null,
    journalReason,
    journalCounts,
    memoryJournalToday,
    memoryJournalYesterday,
    memoryJournalLimitReached: memoryLimitReached,
    ...(memoryReason ? { memoryReason } : {}),
    lessonsPeriod,
    lessonsListed,
    lessonsLimit: args.lessonsLimit,
    lessonsLimitReached: lessonsListed !== null && lessonsListed >= args.lessonsLimit,
    lessonsReason,
    period: { today, yesterday, timezone: args.timeZone },
    slaCitedInSla,
    slaCited,
    tickets,
    ticketsSource,
    slaCountReason,
    ticketSla,
  };
}

function entriesOfItems(value: unknown): Array<Record<string, unknown>> {
  const items = Array.isArray(value) ? value : record(value).items;
  return Array.isArray(items) ? items.map(record) : [];
}

export interface DispatchKpiServiceDeps {
  /** Runs `work` in one Perspicax session of the bot, in the person's name. */
  session<T>(input: { botId: string; principalId: string; key: string }, work: (call: PerspicaxCall) => Promise<T>): Promise<T | { error: string }>;
  readDoc(botId: string, path: string): string;
  writeDoc(botId: string, path: string, text: string): void;
  now?: () => number;
  cacheMs?: number;
  log?: (line: string) => void;
}

export interface DispatchKpiService {
  /** The snapshot, from the cache when it is fresh (force: always new). */
  snapshot(input: { botId: string; principalId: string; args: DispatchKpiArgs; force?: boolean }): Promise<{ ok: true; value: DispatchKpiSnapshot } | { ok: false; error: string }>;
}

export function createDispatchKpiService(deps: DispatchKpiServiceDeps): DispatchKpiService {
  const now = deps.now ?? Date.now;
  const cacheMs = deps.cacheMs ?? DISPATCH_KPI_CACHE_MS;
  const cache = new Map<string, { at: number; value: DispatchKpiSnapshot }>();
  const running = new Map<string, Promise<{ ok: true; value: DispatchKpiSnapshot } | { ok: false; error: string }>>();

  return {
    snapshot({ botId, principalId, args, force }) {
      const key = JSON.stringify([botId, principalId, args]);
      const cached = cache.get(key);
      if (!force && cached && now() - cached.at < cacheMs) return Promise.resolve({ ok: true, value: cached.value });
      const inFlight = running.get(key);
      if (inFlight) return inFlight;
      const work = (async () => {
        let previousText = "";
        try {
          previousText = deps.readDoc(botId, args.doc);
        } catch {
          previousText = "";
        }
        const previous = previousText ? snapshotFromDoc(previousText) : null;
        const at = now();
        const result = await deps.session({ botId, principalId, key: `dispatch-kpi-${botId}` }, (call) => computeDispatchKpi({ args, call, now: at, previous }));
        if ("error" in result) return { ok: false as const, error: result.error };
        cache.set(key, { at, value: result });
        if (!sameSnapshot(previous, result)) {
          try {
            deps.writeDoc(botId, args.doc, dispatchKpiDocument(result));
          } catch (error) {
            deps.log?.(`[dispatch-kpi] ${args.doc} not written: ${error instanceof Error ? error.message : "error"}`);
          }
        }
        return { ok: true as const, value: result };
      })().finally(() => running.delete(key));
      running.set(key, work);
      return work;
    },
  };
}
