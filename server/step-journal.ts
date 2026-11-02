// Content-free step journal (V9): one JSONL line per tool item.completed,
// with no arguments and no result body. Used to classify step outcomes
// (card, guard, missing_file, shell_exit, policy, transient, upstream,
// invalid_args) without retaining sensitive content.
//
// Layout: DATA_DIR/journal/steps-YYYY-MM.jsonl, 0600, fire-and-forget.
// Rotation: a month file is deleted once the whole month is older than
// 14 days (same rule as decision-log pruneMonthFiles, with the steps- prefix).
import { appendFile, mkdir, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";

import { monthKey } from "./usage-ledger.ts";

/** Outcome class for a tool step, derived from ok + short motifs only. */
export type StepClass =
  | "ok"
  | "card"
  | "guard"
  | "missing_file"
  | "shell_exit"
  | "policy"
  | "transient"
  | "upstream"
  | "invalid_args"
  | "error";

export interface StepJournalRow {
  ts: string;
  botId: string;
  threadId: string;
  runId?: string;
  routineName?: string;
  tool: string;
  ok: boolean;
  class: StepClass;
  code?: string;
  ms?: number;
}

export const STEP_JOURNAL_RETENTION_DAYS = 14;
const DIR = "journal";
const FILE_PREFIX = "steps-";
const MONTH_FILE = /^steps-(\d{4})-(\d{2})\.jsonl$/;
const DAY_MS = 86_400_000;

/** Motifs that map a short tool output / status into a class. Never match
 * on arguments or full content: only short status phrases and codes. */
const CLASS_MOTIFS: Array<{ class: StepClass; re: RegExp; code?: string }> = [
  { class: "card", re: /not applied at once|confirmation card|card-shown|applied:\s*false.*card/i, code: "card" },
  { class: "guard", re: /safety_blocked|misuse|guardrail|auto.?computer|routines may not|computer selection/i, code: "guard" },
  { class: "missing_file", re: /no such file|exists:\s*false|ENOENT/i, code: "missing_file" },
  { class: "shell_exit", re: /\[exit\s+\d+\]|exit code\s+\d+|UNTRUSTED/i, code: "shell_exit" },
  { class: "policy", re: /platform_exfiltration|policy|managed_policy|forbidden:|not permitted/i, code: "policy" },
  { class: "transient", re: /rate.?limit|timeout|temporar|try again|ECONNRESET|ETIMEDOUT|connection closed|connection refused/i, code: "transient" },
  { class: "upstream", re: /upstream_error|API token invalid|401|403 Forbidden|502|503|provider/i, code: "upstream" },
  { class: "invalid_args", re: /params_invalid|invalid.?arg|needs? (a |an |the )?[a-z_]+|malformed|zod/i, code: "invalid_args" },
];

/** Classify a tool result from ok + a short status snippet (never args). */
export function classifyStep(input: { ok: boolean; output?: string; code?: string }): { class: StepClass; code?: string } {
  if (input.ok && !input.code) return { class: "ok" };
  const hay = `${input.code ?? ""} ${input.output ?? ""}`.slice(0, 500);
  for (const motif of CLASS_MOTIFS) {
    if (motif.re.test(hay)) return { class: motif.class, code: input.code ?? motif.code };
  }
  if (input.ok) return { class: "ok" };
  return { class: "error", code: input.code };
}

function filePath(dataDir: string, at: Date): string {
  return join(dataDir, DIR, `${FILE_PREFIX}${monthKey(at)}.jsonl`);
}

/** Strip anything that could be content: keep only the row's schema fields. */
export function sanitizeStepRow(row: StepJournalRow): StepJournalRow {
  const clean: StepJournalRow = {
    ts: String(row.ts).slice(0, 40),
    botId: String(row.botId).slice(0, 128),
    threadId: String(row.threadId).slice(0, 128),
    tool: String(row.tool).slice(0, 160),
    ok: Boolean(row.ok),
    class: row.class,
  };
  if (row.runId) clean.runId = String(row.runId).slice(0, 128);
  if (row.routineName) clean.routineName = String(row.routineName).slice(0, 160);
  if (row.code) clean.code = String(row.code).slice(0, 80);
  if (typeof row.ms === "number" && Number.isFinite(row.ms) && row.ms >= 0) clean.ms = Math.min(Math.trunc(row.ms), 86_400_000);
  return clean;
}

const writeQueues = new Map<string, Promise<void>>();

/** Delete `steps-YYYY-MM.jsonl` files whose whole month is older than `days`. */
export async function pruneStepJournal(dataDir: string, days = STEP_JOURNAL_RETENTION_DAYS, now = new Date()): Promise<string[]> {
  const cutoff = now.getTime() - days * DAY_MS;
  const dir = join(dataDir, DIR);
  const removed: string[] = [];
  let names: string[] = [];
  try {
    names = await readdir(dir);
  } catch {
    return removed;
  }
  for (const name of names) {
    const match = MONTH_FILE.exec(name);
    if (!match || Date.UTC(Number(match[1]), Number(match[2]), 1) > cutoff) continue;
    try {
      await unlink(join(dir, name));
      removed.push(name);
    } catch {
      /* already gone */
    }
  }
  return removed;
}

/** Append one content-free step line. Never throws; never awaits on the caller. */
export function appendStep(dataDir: string, row: StepJournalRow, now = new Date()): void {
  const clean = sanitizeStepRow(row);
  const path = filePath(dataDir, now);
  const line = `${JSON.stringify(clean)}\n`;
  const prev = writeQueues.get(dataDir) ?? Promise.resolve();
  const next = prev
    .then(async () => {
      await mkdir(join(dataDir, DIR), { recursive: true, mode: 0o700 });
      await appendFile(path, line, { mode: 0o600 });
      await pruneStepJournal(dataDir, STEP_JOURNAL_RETENTION_DAYS, now);
    })
    .catch(() => {
      /* fire-and-forget: a journal must never take down the turn */
    })
    .finally(() => {
      if (writeQueues.get(dataDir) === next) writeQueues.delete(dataDir);
    });
  writeQueues.set(dataDir, next);
}

/** Await pending writes (tests). */
export async function flushStepJournal(dataDir?: string): Promise<void> {
  if (dataDir) {
    await (writeQueues.get(dataDir) ?? Promise.resolve());
    return;
  }
  await Promise.all(writeQueues.values());
}

/** Build a row from a runtime tool completion (title + ok + short output). */
export function stepFromToolEvent(input: {
  botId: string;
  threadId: string;
  tool: string;
  ok: boolean;
  output?: string;
  runId?: string;
  routineName?: string;
  ms?: number;
  at?: Date;
}): StepJournalRow {
  const classified = classifyStep({ ok: input.ok, output: input.output });
  return sanitizeStepRow({
    ts: (input.at ?? new Date()).toISOString(),
    botId: input.botId,
    threadId: input.threadId,
    tool: input.tool || "tool",
    ok: input.ok,
    class: classified.class,
    ...(classified.code ? { code: classified.code } : {}),
    ...(input.runId ? { runId: input.runId } : {}),
    ...(input.routineName ? { routineName: input.routineName } : {}),
    ...(typeof input.ms === "number" ? { ms: input.ms } : {}),
  });
}
