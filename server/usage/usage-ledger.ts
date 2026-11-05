// The USAGE ledger: one row per settled turn, append-only, month by month
// under <data>/usage/, so "what did this workspace spend, by bot, by model,
// by person, by day" is answerable after a restart and exportable for an
// invoice. The per-task tally (store.ts addTaskUsage) is a running total
// that lives and dies with the task; this is the durable record.
//
// Same discipline as the decision log: 0600 files, serialized appends per
// directory, fire-and-forget. Bookkeeping must never fail the turn it is
// booking. Rows carry who asked and what it cost, never message text.
import { readFileSync } from "node:fs";
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { ACCESS_VIAS, type AccessVia } from "../engines/engine-credentials.ts";
import type { CostSource } from "../models/model-prices.ts";
import { billableFor, type PriceList } from "./prices.ts";

/** Who asked for the turn. A person is named by the email they signed in
 * with when the server knows it (email sign-in), else by their device
 * label; `owner` is the machine itself (loopback, the desktop app). */
export type UsageTrigger =
  /** Slice 7: `principalId` names the person on an organization server
   * (no email there). */
  | { kind: "user"; email?: string; label?: string; principalId?: string }
  | { kind: "owner" }
  /** Slice 7: `runAsPrincipalId` is the person the run acted as. */
  | { kind: "routine"; routineId?: string; label?: string; runAsPrincipalId?: string }
  | { kind: "bot"; botId?: string };

/** One model's share of a turn that mixed several (the main model plus its
 * sub-agents). `inputTokens` is fresh input only; cache reads and writes are
 * separate, so the row's `input` is their sum. */
export interface UsageModelShare {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  cacheWriteTokens?: number;
  costUsd: number | null;
}

export interface UsageRow {
  at: string;
  botId: string;
  botName: string;
  threadId: string;
  instanceId: string;
  driverKind: string;
  /** The turn's main model; `models` carries the whole split. */
  model: string;
  /** The turn's usage per model, when the engine reported one. Absent on
   * rows written before, and for engines that run a single model. */
  models?: UsageModelShare[];
  input: number;
  output: number;
  cachedInput?: number;
  /** Bytes of the system prompt the driver was handed, split at the
   * volatile boundary: stable bytes ride the cacheable prefix, volatile
   * bytes are re-delivered in the turn that changed them. Present only
   * when the server assembled a split prompt for the turn. */
  promptBytes?: { stable: number; volatile: number };
  /** What the turn cost. As the engine reported it (real on a metered key,
   * an equivalent on a subscription), or, for an engine that reports tokens
   * but no price, estimated from list prices (server/models/model-prices.ts) or the
   * operator's own. Null when neither applies: an unpriced model. */
  costUsd: number | null;
  /** Where costUsd came from. Absent on rows written before estimates
   * existed, which read as reported when they carry a cost. */
  costSource?: CostSource;
  /** 2026-10-08: how long the turn ran, from its start to its settle (ms);
   * absent on rows written before, and when the start was not seen. */
  durationMs?: number;
  trigger: UsageTrigger;
  /** Slice 7: the bot owner when the turn settled (organization server). */
  ownerPrincipalId?: string;
  /** Slice 7: the credentials the turn ran with (organization server).
   * `speaker-key` (2026-10-01): the key of the person who spoke, not the
   * owner's. */
  access?: AccessVia;
  /** 2026-10-01: whose credentials paid (organization server): the person
   * who spoke, or the bot's owner (their own turn, the bot's routines);
   * absent when the organization's key paid. */
  payerPrincipalId?: string;
}

export type UsageGroupBy = "bot" | "model" | "user" | "day" | "engine" | "routine";
export const USAGE_GROUPINGS: readonly UsageGroupBy[] = ["bot", "model", "user", "day", "engine", "routine"];

export interface UsageGroup {
  key: string;
  label: string;
  turns: number;
  input: number;
  output: number;
  cachedInput: number;
  /** Sum of the rows with a cost, reported or estimated; null when none had one. */
  costUsd: number | null;
  /** The part of costUsd that is an estimate; null when none of it is. */
  estimatedUsd: number | null;
  /** Rows in this group with no cost at all (an unpriced model). */
  unpriced: number;
  /** What the operator charges for the group, from the price list; null
   * without a list or when nothing in the group is priced. */
  billableUsd: number | null;
}

export interface UsageSummary {
  groups: UsageGroup[];
  total: UsageGroup;
}

const DIR = "usage";
const MAX_RANGE_DAYS = 366;
const DAY_MS = 24 * 60 * 60_000;
const writeQueues = new Map<string, Promise<void>>();

const clean = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
const finiteOrNull = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;

const promptBytesOf = (value: unknown): { stable: number; volatile: number } | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as { stable?: unknown; volatile?: unknown };
  return typeof record.stable === "number" && typeof record.volatile === "number"
    ? { stable: clean(record.stable), volatile: clean(record.volatile) }
    : null;
};

/** The UTC month a row belongs to, `YYYY-MM`: the name of its month file.
 * The decision, admin-activity and decider logs use the same layout. */
export function monthKey(at: Date): string {
  return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function usageFileFor(dataDir: string, at: Date): string {
  return join(dataDir, DIR, `${monthKey(at)}.jsonl`);
}

/** Identifies one row: a thread runs one turn at a time, so a bot cannot
 * settle two turns on the same thread in the same millisecond. Lets the
 * spend cap tell a booked row it already counted from memory apart from the
 * same row read back from the file. */
export function usageRowKey(row: Pick<UsageRow, "at" | "threadId" | "botId">): string {
  return `${row.at}|${row.threadId}|${row.botId}`;
}

/** Append one settled turn. Fire-and-forget (see the module comment): the
 * returned promise never rejects, and says whether the row reached disk. */
export function appendUsage(dataDir: string, row: Omit<UsageRow, "at"> & { at?: string }): Promise<boolean> {
  const { promptBytes: rawPromptBytes, ...rest } = row;
  const promptBytes = promptBytesOf(rawPromptBytes);
  const record: UsageRow = {
    ...rest,
    at: row.at ?? new Date().toISOString(),
    input: clean(row.input),
    output: clean(row.output),
    ...(typeof row.cachedInput === "number" ? { cachedInput: clean(row.cachedInput) } : {}),
    ...(promptBytes ? { promptBytes } : {}),
    costUsd: finiteOrNull(row.costUsd),
  };
  // A cost is labelled with where it came from; an unpriced row carries no label.
  if (record.costUsd === null) delete record.costSource;
  else record.costSource = row.costSource === "estimated" ? "estimated" : "reported";
  const previous = writeQueues.get(dataDir) ?? Promise.resolve();
  const attempt = previous.then(() => write(dataDir, record));
  const queued = attempt.then(
    () => undefined,
    () => {
      /* bookkeeping must never take down the turn */
    },
  );
  writeQueues.set(dataDir, queued);
  void queued.finally(() => {
    if (writeQueues.get(dataDir) === queued) writeQueues.delete(dataDir);
  });
  return attempt.then(() => true, () => false);
}

async function write(dataDir: string, record: UsageRow): Promise<void> {
  await mkdir(join(dataDir, DIR), { recursive: true, mode: 0o700 });
  await appendFile(usageFileFor(dataDir, new Date(record.at)), JSON.stringify(record) + "\n", { mode: 0o600 });
}

/** Test/shutdown seam: wait until everything queued for this directory is on disk. */
export async function flushUsageLedger(dataDir: string): Promise<void> {
  await writeQueues.get(dataDir);
}

const isTrigger = (value: unknown): value is UsageTrigger =>
  typeof value === "object" && value !== null && typeof (value as UsageTrigger).kind === "string";

const isModelShare = (value: unknown): value is UsageModelShare => {
  if (typeof value !== "object" || value === null) return false;
  const m = value as UsageModelShare;
  const count = (n: unknown) => n === undefined || (typeof n === "number" && Number.isFinite(n));
  return typeof m.model === "string" && m.model !== "" && count(m.inputTokens) && m.inputTokens !== undefined && count(m.outputTokens) && m.outputTokens !== undefined &&
    count(m.cachedInputTokens) && count(m.cacheWriteTokens) && (m.costUsd === null || typeof m.costUsd === "number");
};

/** The row's valid per-model split, or null for a row without one (old rows,
 * single-model engines, or a split that does not read). */
export function modelSharesOf(row: Pick<UsageRow, "models">): UsageModelShare[] | null {
  const { models } = row;
  return Array.isArray(models) && models.length > 0 && models.every(isModelShare) ? models : null;
}

const isUsageRow = (value: unknown): value is UsageRow =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as UsageRow).at === "string" &&
  typeof (value as UsageRow).botId === "string" &&
  typeof (value as UsageRow).model === "string" &&
  typeof (value as UsageRow).input === "number" &&
  typeof (value as UsageRow).output === "number" &&
  isTrigger((value as UsageRow).trigger);

function monthsBetween(from: Date, to: Date): string[] {
  const keys: string[] = [];
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
  while (cursor.getTime() <= to.getTime()) {
    keys.push(monthKey(cursor));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return keys;
}

/** Every row whose time falls inside the range, oldest first. */
export function readUsage(dataDir: string, range: { from: Date; to: Date }): UsageRow[] {
  const rows: UsageRow[] = [];
  const from = range.from.getTime();
  const to = range.to.getTime();
  for (const key of monthsBetween(range.from, range.to)) {
    let text: string;
    try {
      text = readFileSync(join(dataDir, DIR, `${key}.jsonl`), "utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n")) {
      if (!line) continue;
      try {
        const value: unknown = JSON.parse(line);
        if (!isUsageRow(value)) continue;
        const at = Date.parse(value.at);
        if (at >= from && at <= to) rows.push(value);
      } catch {
        /* a line torn mid-write: skip the fragment, keep the rest */
      }
    }
  }
  return rows;
}

/** A date range from query strings: `YYYY-MM-DD` each, `to` inclusive to
 * the end of its day (UTC). Defaults to the current month to date. Null
 * for anything malformed, reversed, or longer than a year. */
export function parseUsageRange(from: string | null | undefined, to: string | null | undefined, now = new Date()): { from: Date; to: Date } | null {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/;
  const parse = (value: string, endOfDay: boolean): Date | null => {
    const match = day.exec(value);
    if (!match) return null;
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0));
    // Reject 2026-02-31 style rollovers.
    return date.getUTCMonth() === Number(match[2]) - 1 && date.getUTCDate() === Number(match[3]) ? date : null;
  };
  const start = from ? parse(from, false) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = to ? parse(to, true) : now;
  if (!start || !end || start.getTime() > end.getTime()) return null;
  if (end.getTime() - start.getTime() > MAX_RANGE_DAYS * DAY_MS) return null;
  return { from: start, to: end };
}

/** A stable key and a display label for who asked. Labels for the
 * non-person kinds are English fallbacks; the app localizes by key. */
export function triggerKey(trigger: UsageTrigger): string {
  switch (trigger.kind) {
    case "user":
      if (trigger.principalId) return `principal:${trigger.principalId}`;
      return `user:${(trigger.email ?? trigger.label ?? "").toLowerCase() || "unknown"}`;
    case "owner":
      return "owner";
    case "routine":
      return `routine:${trigger.routineId ?? trigger.label ?? "unknown"}`;
    default:
      return "bot";
  }
}

export function triggerLabel(trigger: UsageTrigger): string {
  switch (trigger.kind) {
    case "user":
      return trigger.email ?? trigger.label ?? "Signed-in user";
    case "owner":
      return "This computer";
    case "routine":
      return `Routine: ${trigger.label ?? trigger.routineId ?? "unknown"}`;
    default:
      return "Bot to bot";
  }
}

function modelGroup(row: Pick<UsageRow, "driverKind" | "model">): { key: string; label: string } {
  return { key: `model:${row.driverKind}/${row.model}`, label: row.model };
}

/** The row as the models it mixed: one pseudo row per model, each with that
 * model's own tokens and cost. A row without a split is itself. */
function rowsByModel(row: UsageRow): UsageRow[] {
  const shares = modelSharesOf(row);
  if (!shares) return [row];
  return shares.map((share) => {
    const cached = clean(share.cachedInputTokens);
    const { models: _split, ...rest } = row;
    return {
      ...rest,
      model: share.model,
      input: clean(share.inputTokens) + cached + clean(share.cacheWriteTokens),
      output: clean(share.outputTokens),
      cachedInput: cached,
      costUsd: share.costUsd,
    };
  });
}

function groupOf(row: UsageRow, groupBy: UsageGroupBy): { key: string; label: string } {
  switch (groupBy) {
    case "bot":
      return { key: `bot:${row.botId}`, label: row.botName || row.botId };
    case "model":
      return modelGroup(row);
    case "user":
      return { key: triggerKey(row.trigger), label: triggerLabel(row.trigger) };
    case "day":
      return { key: `day:${row.at.slice(0, 10)}`, label: row.at.slice(0, 10) };
    case "routine":
      // Turns a routine started are grouped by routine; everything else
      // (people, the owner, other bots) shares one "manual" bucket.
      return row.trigger.kind === "routine"
        ? { key: triggerKey(row.trigger), label: row.trigger.label ?? row.trigger.routineId ?? "unknown" }
        : { key: "manual", label: "Not from a routine" };
    default:
      return { key: `engine:${row.driverKind}`, label: row.driverKind };
  }
}

function emptyGroup(key: string, label: string): UsageGroup {
  return { key, label, turns: 0, input: 0, output: 0, cachedInput: 0, costUsd: null, estimatedUsd: null, unpriced: 0, billableUsd: null };
}

/** Where a row's cost came from, for rows old and new; null when it has none. */
export function costSourceOf(row: Pick<UsageRow, "costUsd" | "costSource">): CostSource | null {
  if (finiteOrNull(row.costUsd) === null) return null;
  return row.costSource === "estimated" ? "estimated" : "reported";
}

function add(group: UsageGroup, row: UsageRow, prices: PriceList | null): void {
  group.turns += 1;
  group.input += clean(row.input);
  group.output += clean(row.output);
  group.cachedInput += clean(row.cachedInput);
  const cost = finiteOrNull(row.costUsd);
  if (cost === null) group.unpriced += 1;
  else {
    group.costUsd = (group.costUsd ?? 0) + cost;
    if (costSourceOf(row) === "estimated") group.estimatedUsd = (group.estimatedUsd ?? 0) + cost;
  }
  const billable = prices ? billableFor(row, prices) : null;
  if (billable !== null) group.billableUsd = (group.billableUsd ?? 0) + billable;
}

/** Totals per group, money first then volume; days stay chronological. */
export function summarizeUsage(rows: UsageRow[], groupBy: UsageGroupBy, prices: PriceList | null = null): UsageSummary {
  const groups = new Map<string, UsageGroup>();
  const total = emptyGroup("total", "total");
  for (const row of rows) {
    // By model, a turn that mixed several counts in each one's group, with
    // that model's own tokens and cost; the total still counts the row once.
    for (const part of groupBy === "model" ? rowsByModel(row) : [row]) {
      const { key, label } = groupOf(part, groupBy);
      let group = groups.get(key);
      if (!group) {
        group = emptyGroup(key, label);
        groups.set(key, group);
      }
      add(group, part, prices);
    }
    add(total, row, prices);
  }
  const ordered = [...groups.values()];
  if (groupBy === "day") ordered.sort((a, b) => a.key.localeCompare(b.key));
  else {
    ordered.sort((a, b) => {
      const costA = a.costUsd ?? Number.NEGATIVE_INFINITY;
      const costB = b.costUsd ?? Number.NEGATIVE_INFINITY;
      return costB - costA || b.input + b.output - (a.input + a.output);
    });
  }
  return { groups: ordered, total };
}

/** Who reads their own usage (GET /api/usage?mine=1, 2026-10-14). The
 * operator on their own machine, or a session that is not a person's (a
 * paired device of the owner), owns every turn no signed-in person asked
 * for; a person owns the turns they asked for and the routines run as them. */
export type UsageViewer = { kind: "operator" } | { kind: "person"; principalId?: string; email?: string };

export function usageRowsFor(rows: UsageRow[], viewer: UsageViewer): UsageRow[] {
  if (viewer.kind === "operator") {
    return rows.filter((row) => row.trigger.kind !== "user" && !(row.trigger.kind === "routine" && row.trigger.runAsPrincipalId));
  }
  const email = viewer.email?.trim().toLowerCase();
  return rows.filter(({ trigger }) => {
    if (trigger.kind === "user") {
      return Boolean((viewer.principalId && trigger.principalId === viewer.principalId) || (email && trigger.email?.toLowerCase() === email));
    }
    return trigger.kind === "routine" && Boolean(viewer.principalId) && trigger.runAsPrincipalId === viewer.principalId;
  });
}

export function csvCell(value: string | number | null): string {
  if (value === null) return "";
  const text = String(value);
  // A leading formula character is neutralised so a spreadsheet never
  // executes a bot name or an email address.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

/** One line per turn, spreadsheet-ready; a billable column when a price list is given. */
export function usageCsv(rows: UsageRow[], prices: PriceList | null = null): string {
  // The models column appears only when a row carries a split, so an export
  // of older rows keeps exactly its columns.
  const withSplit = rows.some((row) => modelSharesOf(row));
  const header = ["time", "bot", "model", "engine", "triggered_by", "input_tokens", "output_tokens", "cached_input_tokens", "cost_usd", "cost_source", ...(prices ? ["billable_usd"] : []), "thread", ...(withSplit ? ["models"] : [])];
  const lines = [header.join(",")];
  for (const row of rows) {
    lines.push([
      row.at,
      row.botName || row.botId,
      row.model,
      row.driverKind,
      triggerLabel(row.trigger),
      clean(row.input),
      clean(row.output),
      clean(row.cachedInput),
      finiteOrNull(row.costUsd),
      costSourceOf(row),
      ...(prices ? [billableFor(row, prices)] : []),
      row.threadId,
      ...(withSplit ? [modelSharesOf(row) ? JSON.stringify(modelSharesOf(row)) : null] : []),
    ].map(csvCell).join(","));
  }
  return lines.join("\n") + "\n";
}

// ── slice 7: the organization admin usage (server/org/org-admin-routes.ts) ──

/** The longest range the organization admin usage answers, in days. */
export const ORG_USAGE_MAX_DAYS = 92;
export const ORG_USAGE_DEFAULT_DAYS = 30;
export const ORG_USAGE_MAX_ROWS = 20_000;

/** `from` and `to` as `YYYY-MM-DD` (UTC, `to` inclusive). Defaults to the
 * last 30 days ending today; null when malformed, reversed or longer than 92
 * days. */
export function parseOrgUsageRange(from: string | null | undefined, to: string | null | undefined, now = new Date()): { from: Date; to: Date; fromDay: string; toDay: string } | null {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = (date: Date) => date.toISOString().slice(0, 10);
  const toDay = to ?? day(today);
  const fromDay = from ?? day(new Date(Date.parse(`${toDay}T00:00:00.000Z`) - (ORG_USAGE_DEFAULT_DAYS - 1) * DAY_MS));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDay) || !/^\d{4}-\d{2}-\d{2}$/.test(toDay)) return null;
  const parsed = parseUsageRange(fromDay, toDay, now);
  if (!parsed) return null;
  const days = Math.round((Date.parse(`${toDay}T00:00:00.000Z`) - Date.parse(`${fromDay}T00:00:00.000Z`)) / DAY_MS) + 1;
  if (days > ORG_USAGE_MAX_DAYS) return null;
  return { ...parsed, fromDay, toDay };
}

export type OrgUsageSpeaker =
  | { kind: "person"; principalId: string }
  | { kind: "routine"; routineId: string; runAsPrincipalId: string | null }
  | { kind: "bot"; botId: string }
  | { kind: "unattributed" };

export type OrgUsageAccessSplit = Record<AccessVia | "unknown", number>;

export interface OrgUsageAggregate {
  day: string;
  botId: string;
  botName: string;
  /** 2026-10-08: the engine instance the turns ran on (the ledger row's
   * instanceId), null when the row did not know it. */
  engine: string | null;
  ownerPrincipalId: string | null;
  speaker: OrgUsageSpeaker;
  turns: number;
  input: number;
  output: number;
  cachedInput: number;
  costUsd: number | null;
  estimatedUsd: number | null;
  access: OrgUsageAccessSplit;
}

/** Who spoke for one row: a person by principal id, a routine with its
 * runAs, another bot, or nobody known (a row from before principals, the
 * machine itself). */
export function orgUsageSpeaker(row: Pick<UsageRow, "trigger">): OrgUsageSpeaker {
  const trigger = row.trigger;
  if (trigger.kind === "user" && trigger.principalId) return { kind: "person", principalId: trigger.principalId };
  if (trigger.kind === "routine" && trigger.routineId) return { kind: "routine", routineId: trigger.routineId, runAsPrincipalId: trigger.runAsPrincipalId ?? null };
  if (trigger.kind === "bot" && trigger.botId) return { kind: "bot", botId: trigger.botId };
  return { kind: "unattributed" };
}

function speakerKey(speaker: OrgUsageSpeaker): string {
  switch (speaker.kind) {
    case "person": return `p:${speaker.principalId}`;
    case "routine": return `r:${speaker.routineId}:${speaker.runAsPrincipalId ?? ""}`;
    case "bot": return `b:${speaker.botId}`;
    default: return "u";
  }
}

const ACCESS_KINDS = new Set<string>(ACCESS_VIAS);

/** Rows grouped by (UTC day, bot, speaker), filtered by `visible` (the
 * caller's reach), oldest day first, at most `max` groups. */
export function aggregateOrgUsage(
  rows: readonly UsageRow[],
  visible: (input: { speaker: OrgUsageSpeaker; ownerPrincipalId: string | null }) => boolean,
  max = ORG_USAGE_MAX_ROWS,
): { rows: OrgUsageAggregate[]; truncated: boolean } {
  const groups = new Map<string, OrgUsageAggregate>();
  let truncated = false;
  for (const row of rows) {
    const speaker = orgUsageSpeaker(row);
    const ownerPrincipalId = typeof row.ownerPrincipalId === "string" && row.ownerPrincipalId ? row.ownerPrincipalId : null;
    if (!visible({ speaker, ownerPrincipalId })) continue;
    const day = row.at.slice(0, 10);
    const engine = typeof row.instanceId === "string" && row.instanceId && row.instanceId !== "unknown" ? row.instanceId : null;
    const key = `${day}|${row.botId}|${speakerKey(speaker)}|${engine ?? ""}`;
    let group = groups.get(key);
    if (!group) {
      if (groups.size >= max) {
        truncated = true;
        continue;
      }
      group = {
        day, botId: row.botId, botName: row.botName || row.botId, engine, ownerPrincipalId, speaker,
        turns: 0, input: 0, output: 0, cachedInput: 0, costUsd: null, estimatedUsd: null,
        access: { subscription: 0, "owner-key": 0, "speaker-key": 0, "org-key": 0, server: 0, unknown: 0 },
      };
      groups.set(key, group);
    }
    if (!group.ownerPrincipalId && ownerPrincipalId) group.ownerPrincipalId = ownerPrincipalId;
    if (row.botName) group.botName = row.botName;
    group.turns += 1;
    group.input += clean(row.input);
    group.output += clean(row.output);
    group.cachedInput += clean(row.cachedInput);
    const cost = finiteOrNull(row.costUsd);
    if (cost !== null) {
      group.costUsd = (group.costUsd ?? 0) + cost;
      if (costSourceOf(row) === "estimated") group.estimatedUsd = (group.estimatedUsd ?? 0) + cost;
    }
    const via = typeof row.access === "string" && ACCESS_KINDS.has(row.access) ? row.access : "unknown";
    group.access[via] += 1;
  }
  const ordered = [...groups.values()].sort((a, b) => a.day.localeCompare(b.day) || a.botName.localeCompare(b.botName) || a.botId.localeCompare(b.botId));
  return { rows: ordered, truncated };
}
