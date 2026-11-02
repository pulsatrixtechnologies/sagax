// The authorization DECISION log: one fleet-wide, append-only NDJSON file
// answering "which tool call was allowed, denied, or carded — by which
// rule, when, for which bot".
//
// The per-thread event log (harness/bus.ts) cannot answer that. It records
// that a request opened and later resolved, but the WHY — a grant waved it
// through, a guard held it, an unattended block overrode a grant that
// would otherwise have fired — exists only for a moment at the fold point
// and is gone by the time the event is on disk. So the fold writes the
// reason down here at the moment it is known, and the human-answer path
// writes a second row when a card comes back.
//
// Same discipline as the event tee: 0600 (rows name tools and command
// lines), through redactSecrets (summaries carry whatever the agent typed,
// credentials included), and fire-and-forget — an audit log must never
// take down the decision it is auditing.
//
// Layout and retention follow the usage ledger: one file per UTC month under
// <data>/decisions/YYYY-MM.ndjson, and a month file is deleted only once the
// whole month is older than the retention window (default 180 days, config
// `decisions.retentionDays` or SAGAX_DECISION_RETENTION_DAYS), so at least that
// much history is always kept. Older servers wrote one decisions.ndjson that
// rotated to .1 at 4 MB; both are still read, never written, and removed by
// the same window once their last row is older than it.
//
// Deliberately NOT covered: ask_bot peer-approval cards. They never cross
// the runtime bus (peer-approval.ts appends its cards straight to the
// store), so wiring them here would mean a second, parallel tap — a
// separate change if it earns its keep.
import { AsyncLocalStorage } from "node:async_hooks";
import { readdirSync, readFileSync } from "node:fs";
import { appendFile, mkdir, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

import type { AutoVerdictSource } from "./auto-approve.ts";
import { DATA_DIR } from "./config.ts";
import { appendLog, LogReader, registerSealedLog, sealLogLine, sealLogLines, withLogFileLock } from "./content-at-rest.ts";
import { WORKSPACE_OWNER } from "./content-keys.ts";
import { JOURNAL_GENESIS, sealLink, type JournalSealFields, type JournalSealLink } from "./journal-seal.ts";
import { redactSecrets } from "./redact.ts";
import { csvCell, monthKey } from "./usage-ledger.ts";

/** A verdict's outcome. auto-* rows came from a policy — connector grants,
 * auto-approve rules — with no card in front of a person; user-* rows
 * record what a person actually answered. */
export type DecisionKind =
  | "auto-approved"
  | "auto-denied"
  | "card-shown"
  | "user-approved"
  | "user-denied"
  | "user-undone"
  /** 2026-10-11: a permission card's own timeout passed with no answer */
  | "expired"
  | "review-would-approve"
  | "review-would-deny";

/** Who or what produced the decision. The AutoVerdictSource values carry
 * straight through from auto-approve.ts; `self` a bot's change to itself
 * that applied at its level (server/direct-apply.ts); `question` marks cards a rule may
 * never answer, `auto-fallback` a card shown after delivery failed, `routine`
 * a durable chat scheduling proposal, `skill` a staged learned-skill card,
 * `profile` a bot proposed a profile change, `model` a bot proposed a default-model
 * switch, `user` the human's answer, and
 * auto-review sources the isolated model reviewer. connector-scope rows
 * are kept for reading historical logs from older releases. */
export type DecisionSource =
  | AutoVerdictSource
  /** nobody answered an AI client's hidden-thread approval in time */
  | "expired"
  /** an approval left open when Sagax restarted: its request died with the process */
  | "restart"
  | "self"
  /** the person asked their own Primary Bot for this change now (2026-10-20) */
  | "primary-bot"
  | "question"
  | "auto-fallback"
  | "routine"
  | "skill"
  | "profile"
  /** a bot proposed an approval rule from chat (propose_rule); the card waits */
  | "rule"
  | "model"
  | "user"
  | "connector-scope"
  | "outbound"
  | "team-memory"
  | "auto-review"
  | "auto-review-shadow"
  /** the ask's own timeout (an `expired` row) */
  | "timeout"
  /** refused in a confidential thread: only its owner may answer, and could not
   * (server/confidential-threads.ts) */
  | "confidential"
  /** a member bot's command would run on the shared organization server, which
   * only an admin may use: it runs on the bot's own computer instead, or is
   * refused when it has none (server/exec-target.ts, 2026-10-22) */
  | "exec-target"
  /** a Sagax tool that does not exist (a name the model made up): refused at
   * once, never a card (#1426) */
  | "unknown-tool";

/** Who answered a card, for `source: "user"` rows: a signed-in session (its
 * id, device label, and account email or id when it has one; a portal
 * session's id is its membership grant and is never written), the owner on
 * this machine (`loopback`), or a session-less local caller on a shared
 * server (`worker`: the Slack worker, or anything else on that machine). */
export type DecisionActor =
  | { kind: "session"; sessionId: string; label: string; email?: string; userId?: string }
  | { kind: "loopback" }
  | { kind: "worker" };

export interface DecisionRow {
  at: string;
  threadId: string;
  requestId?: string;
  botId?: string;
  botName?: string;
  tool?: string;
  summary?: string;
  decision: DecisionKind;
  source: DecisionSource;
  /** which rule decided: a guard's regex source, or the granted key */
  rule?: string;
  /** `auto-review` rows: the model reviewer's reason, one short sentence */
  reason?: string;
  /** the turn ran with nobody at the keyboard when this was decided */
  unattended?: boolean;
  /** who answered, on rows a person's answer produced */
  actor?: DecisionActor;
  /** "call": that person answered by voice on a Live call, not with a tap */
  via?: "call";
  /** how the ask reached the fold: a tool call (absent) or a block parsed
   * out of model-authored output ("output", only in rows the removed
   * Computer engine wrote). Question cards only. */
  origin?: "output";
  /** 2026-10-26 (Journal, "Tester cette règle"): what a rule reads of the
   * call, kept so a rule can be replayed on it exactly (the arguments, the
   * shell line, its folder). Capped, redacted like the rest of the row, and
   * dropped with the summary in a confidential thread. */
  call?: DecisionCall;
}

export interface DecisionCall {
  mcpTool?: string;
  input?: string;
  command?: string;
  cwd?: string;
  paths?: string[];
  providerInstanceId?: string;
}

/** Longest arguments a row keeps for a replay; a longer call keeps none. */
export const DECISION_CALL_INPUT_MAX = 4_000;
const DECISION_CALL_PATHS_MAX = 20;

/** The replayable part of a call, bounded: nothing when there is nothing
 * a rule could read, and no arguments when they are too long to keep (the
 * replay then reads the summary, like an older row). */
export function decisionCall(call: { mcpTool?: string; input?: string; command?: string; cwd?: string; paths?: readonly string[]; providerInstanceId?: string } | null | undefined): DecisionCall | undefined {
  if (!call) return undefined;
  const out: DecisionCall = {};
  if (call.mcpTool) out.mcpTool = call.mcpTool.slice(0, 200);
  if (typeof call.input === "string" && call.input.length <= DECISION_CALL_INPUT_MAX) out.input = call.input;
  if (typeof call.command === "string" && call.command.length <= DECISION_CALL_INPUT_MAX) out.command = call.command;
  if (call.cwd) out.cwd = call.cwd.slice(0, 1_000);
  if (call.paths?.length) out.paths = call.paths.slice(0, DECISION_CALL_PATHS_MAX).map((path) => path.slice(0, 1_000));
  if (call.providerInstanceId) out.providerInstanceId = call.providerInstanceId.slice(0, 200);
  return out.input !== undefined || out.command !== undefined || out.paths ? out : undefined;
}

const DIR = "decisions";

// A row says what was asked (summary, arguments, shell line): sealed at rest
// under its thread's key (docs/content-encryption.md), the fields the
// readers filter on in the clear.
registerSealedLog({
  dir: join(DATA_DIR, DIR),
  scope: (record) => (typeof record.threadId === "string" && record.threadId ? { thread: record.threadId } : { owner: WORKSPACE_OWNER }),
  projection: (record) => ({ at: record.at, threadId: record.threadId, botId: record.botId, decision: record.decision, source: record.source }),
});
const LEGACY_FILE = "decisions.ndjson";
const MONTH_FILE = /^(\d{4})-(\d{2})\.ndjson$/;
const DAY_MS = 24 * 60 * 60_000;
const PRUNE_EVERY_MS = 60 * 60_000;
export const DEFAULT_DECISION_RETENTION_DAYS = 180;
export const MAX_DECISION_RETENTION_DAYS = 3650;
const writeQueues = new Map<string, Promise<void>>();
const lastPrune = new Map<string, number>();
let retentionDays: () => number = () => DEFAULT_DECISION_RETENTION_DAYS;

let confidentialThread: (threadId: string) => boolean = () => false;

/** The server binds which threads are confidential
 * (server/confidential-threads.ts): their rows are written metadata only. */
export function bindConfidentialDecisions(isConfidential: (threadId: string) => boolean): void {
  confidentialThread = isConfidential;
}

/** A row without anything a person or a bot wrote: the summary of the call,
 * the rule that matched it, how the ask reached the fold. */
export function metadataOnly<T extends Partial<DecisionRow>>(row: T): T {
  const { summary: _summary, rule: _rule, reason: _reason, origin: _origin, call: _call, ...rest } = row;
  return rest as T;
}

/** Strip every row of a thread down to its metadata (metadataOnly), in
 * place, across the month files and the legacy pair: a confidential thread
 * deleted, or made confidential after rows were written. Serialized with
 * appends. Resolves to the number of rows changed. */
export function scrubThreadDecisions(dataDir: string, threadId: string): Promise<number> {
  const previous = writeQueues.get(dataDir) ?? Promise.resolve();
  let changed = 0;
  const queued = previous.then(async () => {
    for (const file of sources(dataDir)) {
      // one rewrite at a time with the at-rest migration (server/content-at-rest.ts)
      await withLogFileLock(file, async () => {
        let text: string;
        try {
          text = readFileSync(file, "utf8");
        } catch {
          return;
        }
        let touched = false;
        const raw = text.split("\n");
        const reader = new LogReader(file);
        // one record per line, as read; a scrubbed one is written plain here and
        // the migration seals it again with its neighbours
        const lines = raw.map((line, index) => {
          if (!line) return line;
          let value: Partial<DecisionRow> | null | undefined;
          try { value = reader.at(raw, index) as Partial<DecisionRow> | null | undefined; } catch { return null; }
          if (!value || value.threadId !== threadId || (value.summary === undefined && value.rule === undefined && value.origin === undefined && value.call === undefined)) return null;
          touched = true;
          changed += 1;
          return JSON.stringify(metadataOnly(value));
        });
        if (touched) {
          // the untouched lines stay as they are, except a block's own lines,
          // which are rewritten with it (every line of a touched block opened)
          const out = rewriteScrubbed(file, raw, lines, reader);
          await writeFile(file, out.join("\n"), { mode: 0o600 });
        }
      });
    }
  }).catch(() => {
    /* never takes the delete down */
  });
  writeQueues.set(dataDir, queued);
  void queued.finally(() => {
    if (writeQueues.get(dataDir) === queued) writeQueues.delete(dataDir);
  });
  return queued.then(() => changed);
}

/** A month file with some rows scrubbed (`changed[i]`, the plain row, or
 * null to keep line i): a sealed block that holds a scrubbed row is sealed
 * again whole, every other line stays byte for byte. */
function rewriteScrubbed(file: string, raw: readonly string[], changed: ReadonlyArray<string | null>, reader: LogReader): string[] {
  const out: string[] = [];
  for (let i = 0; i < raw.length;) {
    const line = raw[i]!;
    if (!line.startsWith('{"sb":"')) { out.push(changed[i] ?? line); i++; continue; }
    // the block: up to its last line
    let end = i;
    while (end < raw.length - 1 && raw[end]!.startsWith('{"sb":"') && !raw[end]!.includes('","n":')) end++;
    const span = raw.slice(i, end + 1);
    if (!changed.slice(i, end + 1).some((value) => value !== null)) { out.push(...span); i = end + 1; continue; }
    const originals: string[] = [];
    const records: Record<string, unknown>[] = [];
    for (let k = i; k <= end; k++) {
      let original = changed[k];
      if (original === null || original === undefined) {
        try { original = reader.raw(raw, k) ?? null; } catch { original = null; }
      }
      if (original === null) continue;
      originals.push(original);
      try { records.push(JSON.parse(original) as Record<string, unknown>); } catch { records.push({}); }
    }
    out.push(...sealLogLines(file, records, originals));
    i = end + 1;
  }
  return out;
}

/** The server binds its configured window once; see decisionRetentionDays. */
export function bindDecisionRetention(provider: () => number): void {
  retentionDays = provider;
}

/** The window in force now. The admin activity log (admin-activity.ts)
 * keeps its months for the same time, so one setting covers both. */
export function boundRetentionDays(): number {
  return retentionDays();
}

/** The retention window in days: SAGAX_DECISION_RETENTION_DAYS when it is a
 * whole number in range, else the configured value, else 180. */
export function decisionRetentionDays(configured: number | undefined, env: NodeJS.ProcessEnv = process.env): number {
  const fromEnv = env.SAGAX_DECISION_RETENTION_DAYS?.trim();
  const parsed = fromEnv ? Number(fromEnv) : NaN;
  if (Number.isInteger(parsed) && parsed >= 1 && parsed <= MAX_DECISION_RETENTION_DAYS) return parsed;
  if (typeof configured === "number" && Number.isInteger(configured) && configured >= 1 && configured <= MAX_DECISION_RETENTION_DAYS) return configured;
  return DEFAULT_DECISION_RETENTION_DAYS;
}

const actorScope = new AsyncLocalStorage<{ actor: DecisionActor; via?: "call" }>();

/** Run `work` as a person's card answer: every `source: "user"` row it
 * writes names `actor` (and `via`, for an answer spoken on a Live call),
 * without each resolver having to thread it through. */
export function withDecisionActor<T>(actor: DecisionActor, work: () => T, via?: "call"): T {
  return actorScope.run(via ? { actor, via } : { actor }, work);
}

export function decisionFileFor(dataDir: string, at: Date): string {
  return join(dataDir, DIR, `${monthKey(at)}.ndjson`);
}

const CHAIN_FILE = "chain.ndjson";

export function decisionSealFields(row: Pick<DecisionRow, "at" | "botId" | "tool" | "decision" | "source">): JournalSealFields {
  return {
    at: row.at,
    botId: row.botId ?? "",
    tool: row.tool ?? "",
    outcome: row.decision,
    decider: row.source,
    source: row.source,
    ran: "",
  };
}

function chainFile(dataDir: string): string {
  return join(dataDir, DIR, CHAIN_FILE);
}

function lastChainHash(dataDir: string): string {
  try {
    const text = readFileSync(chainFile(dataDir), "utf8");
    const line = text.trim().split("\n").at(-1);
    if (!line) return JOURNAL_GENESIS;
    const hash = (JSON.parse(line) as { hash?: unknown }).hash;
    return typeof hash === "string" && /^[a-f0-9]{64}$/.test(hash) ? hash : JOURNAL_GENESIS;
  } catch {
    return JOURNAL_GENESIS;
  }
}

/** The chain sealed as each line was written. Missing file: an empty chain. */
export function readSealedChain(dataDir: string): { version: 1; genesis: string; entries: JournalSealLink[] } {
  let text = "";
  try {
    text = readFileSync(chainFile(dataDir), "utf8");
  } catch {
    return { version: 1, genesis: JOURNAL_GENESIS, entries: [] };
  }
  const entries: JournalSealLink[] = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    try {
      const value = JSON.parse(line) as JournalSealLink;
      if (typeof value.hash === "string" && typeof value.prev === "string" && typeof value.at === "string") entries.push(value);
    } catch {
      /* a torn line is not a link */
    }
  }
  return { version: 1, genesis: JOURNAL_GENESIS, entries };
}

/** Fields of the decision files as they are now, oldest first. */
export function sealedDecisionSources(dataDir: string): JournalSealFields[] {
  return sources(dataDir).flatMap((path) => readRows(path).map(decisionSealFields));
}

async function writeDecision(dataDir: string, record: DecisionRow): Promise<void> {
  const at = new Date(record.at);
  await mkdir(join(dataDir, DIR), { recursive: true, mode: 0o700 });
  const file = decisionFileFor(dataDir, at);
  const link = sealLink(lastChainHash(dataDir), decisionSealFields(record));
  await appendLog(file, sealLogLine(file, record as unknown as Record<string, unknown>) + "\n", { mode: 0o600 });
  await appendFile(chainFile(dataDir), JSON.stringify(link) + "\n", { mode: 0o600 });
  if (at.getTime() - (lastPrune.get(dataDir) ?? 0) >= PRUNE_EVERY_MS) {
    lastPrune.set(dataDir, at.getTime());
    await pruneDecisions(dataDir, retentionDays(), at);
  }
}

/** Append one decision row. Fire-and-forget, mirroring the event bus tee:
 * the fold that calls this is delivering approvals and cards, and a full
 * disk must not turn into denied tools. */
export function appendDecision(dataDir: string, row: Omit<DecisionRow, "at">): void {
  // A confidential thread's row keeps what the audit needs (ids, time,
  // tool name, decision, who) and never what was asked: no summary, no rule.
  if (confidentialThread(row.threadId)) row = metadataOnly(row);
  const scope = row.source === "user" ? actorScope.getStore() : undefined;
  const actor = row.actor ?? scope?.actor;
  const via = row.via ?? scope?.via;
  // Redact now, not when the queue drains: the row is what was true at the
  // moment of the decision.
  const record = redactSecrets({ at: new Date().toISOString(), ...row, ...(actor ? { actor } : {}), ...(via ? { via } : {}) }) as DecisionRow;
  const previous = writeQueues.get(dataDir) ?? Promise.resolve();
  // Serialize appends (and the occasional prune) per directory, so two
  // simultaneous approvals keep their decision order.
  const queued = previous
    .then(() => writeDecision(dataDir, record))
    .catch(() => {
      /* logging must never take down the fold */
    });
  writeQueues.set(dataDir, queued);
  void queued.finally(() => {
    if (writeQueues.get(dataDir) === queued) writeQueues.delete(dataDir);
  });
}

/** Test/shutdown seam: wait until every decision already queued for this
 * directory has reached disk. Normal request paths deliberately do not wait. */
export async function flushDecisionLog(dataDir: string): Promise<void> {
  await writeQueues.get(dataDir);
}

/** Delete what the window no longer covers: a month file once the first
 * instant after its month is at or before `now - days`, a legacy file once
 * its last write is. Returns the names removed. Never throws. */
export async function pruneDecisions(dataDir: string, days: number, now = new Date()): Promise<string[]> {
  const cutoff = now.getTime() - days * DAY_MS;
  const removed = await pruneMonthFiles(join(dataDir, DIR), days, now);
  for (const name of [`${LEGACY_FILE}.1`, LEGACY_FILE]) {
    try {
      if ((await stat(join(dataDir, name))).mtimeMs > cutoff) continue;
      await unlink(join(dataDir, name));
      removed.push(name);
    } catch {
      /* absent */
    }
  }
  return removed;
}

/** Delete the `YYYY-MM.ndjson` files in `dir` whose whole month is at or
 * before `now - days`. Returns the names removed. Never throws. Shared with
 * the admin activity log. */
export async function pruneMonthFiles(dir: string, days: number, now = new Date()): Promise<string[]> {
  const cutoff = now.getTime() - days * DAY_MS;
  const removed: string[] = [];
  let names: string[] = [];
  try {
    names = await readdir(dir);
  } catch {
    /* nothing written in the new layout yet */
  }
  for (const name of names) {
    const match = MONTH_FILE.exec(name);
    if (!match || Date.UTC(Number(match[1]), Number(match[2]), 1) > cutoff) continue;
    try {
      await unlink(join(dir, name));
      removed.push(name);
    } catch {
      /* already gone, or not ours to remove */
    }
  }
  return removed;
}

const isDecisionRow = (value: unknown): value is DecisionRow =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as DecisionRow).at === "string" &&
  typeof (value as DecisionRow).threadId === "string" &&
  typeof (value as DecisionRow).decision === "string" &&
  typeof (value as DecisionRow).source === "string";

function readRows(path: string, projectionOnly?: (projection: Record<string, unknown>) => boolean): DecisionRow[] {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const rows: DecisionRow[] = [];
  const lines = text.split("\n");
  // rows sealed at rest open here, a block at a time (server/content-at-rest.ts);
  // a locked key throws rather than show a shorter history, a torn line is skipped
  const reader = new LogReader(path, projectionOnly);
  for (let index = 0; index < lines.length; index++) {
    if (!lines[index]) continue;
    const value = reader.at(lines, index);
    if (isDecisionRow(value)) rows.push(value);
  }
  return rows;
}

/** Every file that may hold rows, oldest first: the legacy pair (which only
 * ever holds rows older than any month file), then the months in order. */
function sources(dataDir: string): string[] {
  let months: string[] = [];
  try {
    months = readdirSync(join(dataDir, DIR)).filter((name) => MONTH_FILE.test(name)).sort();
  } catch {
    /* no month files yet */
  }
  return [join(dataDir, `${LEGACY_FILE}.1`), join(dataDir, LEGACY_FILE), ...months.map((name) => join(dataDir, DIR, name))];
}

/** The newest `limit` rows, oldest first — the same order the inspector
 * uses for thread events. Reads month files newest first and stops once it
 * has enough, so a long history costs no more than the page asked for. */
/** `projectionOnly`: rows sealed at rest that the caller will drop by their
 * clear fields (another bot's) are not opened (server/content-at-rest.ts). */
export function readDecisions(dataDir: string, limit: number, projectionOnly?: (projection: Record<string, unknown>) => boolean): DecisionRow[] {
  const files = sources(dataDir);
  const chunks: DecisionRow[][] = [];
  let count = 0;
  for (let index = files.length - 1; index >= 0 && count < limit; index -= 1) {
    const rows = readRows(files[index]!, projectionOnly);
    chunks.unshift(rows);
    count += rows.length;
  }
  return chunks.flat().slice(-limit);
}

/** Every row whose time falls inside the range, oldest first. */
export function readDecisionRange(dataDir: string, range: { from: Date; to: Date }): DecisionRow[] {
  const from = range.from.getTime();
  const to = range.to.getTime();
  const first = monthKey(range.from);
  const last = monthKey(range.to);
  const rows: DecisionRow[] = [];
  for (const file of sources(dataDir)) {
    // Month files outside the range are skipped unread; legacy files have no month.
    const month = MONTH_FILE.exec(basename(file));
    if (month && (`${month[1]}-${month[2]}` < first || `${month[1]}-${month[2]}` > last)) continue;
    for (const row of readRows(file)) {
      const at = Date.parse(row.at);
      if (at >= from && at <= to) rows.push(row);
    }
  }
  return rows;
}

export function actorLabel(actor: DecisionActor | undefined): string {
  if (!actor) return "";
  if (actor.kind === "loopback") return "This computer";
  if (actor.kind === "worker") return "Local service";
  return actor.email ?? actor.label;
}

/** One line per decision, spreadsheet-ready. Cells go through the usage
 * CSV's formula neutralising, and every row through redaction again, so an
 * export never carries more than the log itself may. */
export function decisionsCsv(rows: DecisionRow[]): string {
  const header = ["time", "decision", "source", "bot", "tool", "summary", "rule", "unattended", "answered_by", "thread", "request"];
  const lines = [header.join(",")];
  for (const raw of rows) {
    const row = redactSecrets(raw) as DecisionRow;
    lines.push([
      row.at,
      row.decision,
      row.source,
      row.botName || row.botId || "",
      row.tool ?? "",
      row.summary ?? "",
      row.rule ?? "",
      row.unattended ? "yes" : "",
      row.via === "call" ? `${actorLabel(row.actor)} (by voice)` : actorLabel(row.actor),
      row.threadId,
      row.requestId ?? "",
    ].map(csvCell).join(","));
  }
  return lines.join("\n") + "\n";
}
