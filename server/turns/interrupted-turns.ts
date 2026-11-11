// A server stop that does not lose turns (bot quality diagnostic 2026-10-19,
// cause C): the shutdown first lets the turns in progress finish, for a
// bounded time (drainTurns), then writes down the ones still cut
// (saveInterruptedTurns); the next start resumes each of them once in its
// own conversation (takeInterruptedTurns, TURN_RESUME_PROMPT). Coordinated
// teammate work and routine runs have their own restart policies
// (server/runtime/, server/routines/routines.ts); this file is for the direct turns.
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { failedTurnCause } from "../../shared/failed-turn.ts";
import { writeFileAtomic } from "../atomic.ts";
import { outwardActions } from "./turn-outcome.ts";

export interface InterruptedTurn {
  botId: string;
  threadId: string;
  /** When the shutdown cut it (ms). */
  at: number;
  /** Who the cut turn spoke for (TurnSpeaker), carried to its resume. */
  speaker?: Record<string, unknown>;
  /** #2602: the runtime holds this turn as a root and resumes it itself;
   * kept here only so the next start can check the promise was kept. */
  runtimeHeld?: boolean;
}

/** How long after a start a turn the runtime promised to resume may stay silent. */
export const RUNTIME_RESUME_GRACE_MS = 2 * 60_000;
export { TURN_NOT_RESUMED, TURN_NOT_RESUMED_NEWER } from "../../shared/restart-words.ts";

/** #2602: whether a turn cut at `cutAt` came back: a bot answer (not an
 * activity line) after the cut and before the person's next message. */
export function turnResumedSince(messages: readonly { role?: string; kind?: string; at?: number }[], cutAt: number): boolean {
  for (const message of messages) {
    if (typeof message.at !== "number" || message.at <= cutAt) continue;
    if (message.role === "user") return false;
    if (message.role === "bot" && message.kind !== "activity") return true;
  }
  return false;
}

type CutRow = { role?: string; kind?: string; at?: number; tool?: { name?: unknown; ok?: unknown } };

/** #3217: whether a turn cut at `cutAt` came to an end the person can read:
 * an answer (turnResumedSince), or a failed-turn row saying why it stopped
 * (the runtime ended it after an outward action, the resume failed to
 * start). Nothing more is owed to such a turn. */
export function cutTurnSettled(messages: readonly CutRow[], cutAt: number): boolean {
  if (turnResumedSince(messages, cutAt)) return true;
  for (const message of messages) {
    if (typeof message.at !== "number" || message.at <= cutAt) continue;
    if (message.role === "user") return false;
    if (message.role === "bot" && message.kind === "activity" && message.tool?.ok === false
      && typeof message.tool.name === "string" && failedTurnCause(message.tool.name) !== null) return true;
  }
  return false;
}

/** What to do now with a turn cut by the last stop: wait while it is held
 * or busy, call it lost when nothing came back, else nothing. On the
 * watch's last look (`final`) a turn the runtime still holds without
 * running it is lost too: a hold that never runs is no answer. */
export function runtimeResumeVerdict(turn: InterruptedTurn, view: {
  held: boolean; busy: boolean; messages: readonly CutRow[];
}, final = false): "wait" | "resumed" | "lost" {
  if (cutTurnSettled(view.messages, turn.at)) return "resumed";
  if (view.busy) return "wait";
  if (view.held && !final) return "wait";
  return "lost";
}

/** The most steps a resume prompt names, and how long each label is. */
const RESUME_STEPS_MAX = 30;
const RESUME_STEP_CHARS = 120;
/** The longest request a resume prompt quotes. */
const RESUME_REQUEST_CHARS = 6_000;

export interface CutTurnContext {
  /** The person's words that started the cut turn. */
  request?: string;
  /** The tool steps the cut turn completed, oldest first. */
  steps: string[];
  /** Outward actions it completed (sends, posts, pushes, payments). */
  outward: string[];
}

/** #3217: what a cut chat turn was asked and already did, read from its
 * conversation: the person's line that started it (the last one at or
 * before the cut), the steps recorded after it, and the outward actions
 * among them (the runtime's own classifier, contract §5). */
export function cutTurnContext(messages: readonly CutRow[], cutAt: number): CutTurnContext {
  let start = -1;
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]! as CutRow & { text?: unknown };
    if (typeof message.at === "number" && message.at > cutAt) continue;
    if (message.role === "user" && (message.kind ?? "text") === "text" && typeof message.text === "string" && message.text.trim()) { start = index; break; }
  }
  const head = start >= 0 ? (messages[start] as { text?: string }).text!.trim() : undefined;
  const rows = messages.slice(start + 1).filter((message) => typeof message.at !== "number" || message.at <= cutAt);
  const steps: string[] = [];
  for (const row of rows as Array<CutRow & { tool?: { name?: unknown; ok?: unknown; itemId?: unknown } }>) {
    if (row.role !== "bot" || row.kind !== "activity" || !row.tool || row.tool.ok === false || row.tool.itemId === undefined) continue;
    if (typeof row.tool.name !== "string" || !row.tool.name.trim()) continue;
    const label = row.tool.name.replace(/\s+/g, " ").trim();
    steps.push(label.length > RESUME_STEP_CHARS ? `${label.slice(0, RESUME_STEP_CHARS - 1)}…` : label);
  }
  return {
    ...(head ? { request: head.length > RESUME_REQUEST_CHARS ? `${head.slice(0, RESUME_REQUEST_CHARS)}\n[...]` : head } : {}),
    steps: steps.slice(-RESUME_STEPS_MAX),
    outward: outwardActions(rows as never),
  };
}

/** #3217: the resume prompt of a cut chat turn, on any engine: the request
 * it answers (an engine whose session did not survive the restart has no
 * other copy of it) and the steps already done, so none runs twice. */
export function cutTurnResumePrompt(context: CutTurnContext, base = TURN_RESUME_PROMPT): string {
  const parts = [base];
  if (context.request) parts.push(`The person's request that turn was answering:\n${context.request}`);
  if (context.steps.length) {
    parts.push(`Steps that turn already completed (their results are in this conversation; do not run again a step that changed something): ${context.steps.join("; ")}`);
  }
  return parts.join("\n\n");
}

export type DirectResumeStep = "wait" | "done" | "relaunch" | "report";

/** #3217: what a chat turn resumed at start does next, from its verdict: a
 * lost turn is started once more, a second loss is reported in the chat. */
export function directResumeStep(verdict: "wait" | "resumed" | "lost", relaunched: boolean): DirectResumeStep {
  if (verdict === "resumed") return "done";
  if (verdict === "wait") return "wait";
  return relaunched ? "report" : "relaunch";
}

const FILE = "interrupted-turns.json";
/** A turn cut longer ago than this is not resumed: its moment has passed. */
export const INTERRUPTED_TURN_MAX_AGE_MS = 60 * 60_000;
const MAX_TURNS = 200;

/** The default drain: long enough for a tool call in flight to land, short
 * enough that drain and cleanup fit Docker's default 10 s stop grace period
 * (raise both together: SAGAX_SHUTDOWN_DRAIN_MS and stop_grace_period). 0
 * under the desktop app, whose quit must stay quick (its turns still resume). */
export function shutdownDrainMs(env: NodeJS.ProcessEnv, desktop: boolean): number {
  const raw = env.SAGAX_SHUTDOWN_DRAIN_MS?.trim();
  if (raw && /^\d+$/.test(raw)) return Math.min(Number(raw), 120_000);
  return desktop ? 0 : 5_000;
}

export const TURN_RESUME_PROMPT = "Sagax restarted while your previous turn in this conversation was working and cut it off; this turn continues it. First check what that turn already did (records written or sent, files, commits, messages) so nothing is done twice, then finish the request and answer as usual. A restart alone is not a blocker.";

/** Wait until no turn is busy, or every busy one waits on a person (an
 * approval card does not answer itself), or the time is up. Returns the
 * threads still busy. */
export async function drainTurns(input: {
  busy: () => string[];
  waitingOnPerson: (threadId: string) => boolean;
  timeoutMs: number;
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}): Promise<string[]> {
  const now = input.now ?? Date.now;
  const sleep = input.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms).unref?.()));
  const deadline = now() + Math.max(0, input.timeoutMs);
  for (;;) {
    const busy = input.busy();
    if (busy.every((threadId) => input.waitingOnPerson(threadId)) || now() >= deadline) return busy;
    await sleep(Math.min(input.pollMs ?? 250, Math.max(1, deadline - now())));
  }
}

export function saveInterruptedTurns(dataDir: string, turns: readonly InterruptedTurn[]): void {
  const path = join(dataDir, FILE);
  if (turns.length === 0) {
    rmSync(path, { force: true });
    return;
  }
  writeFileAtomic(path, JSON.stringify({ version: 1, turns: turns.slice(0, MAX_TURNS) }), { mode: 0o600 });
}

/** The turns the last shutdown cut: `resume` still recent enough to go on,
 * `stale` too old (they only get the cut line). The file is removed, so each
 * is resumed at most once. */
export function takeInterruptedTurns(dataDir: string, now = Date.now()): { resume: InterruptedTurn[]; stale: InterruptedTurn[] } {
  const path = join(dataDir, FILE);
  if (!existsSync(path)) return { resume: [], stale: [] };
  const out = readInterruptedTurns(path, now);
  rmSync(path, { force: true });
  return out;
}

function readInterruptedTurns(path: string, now: number): { resume: InterruptedTurn[]; stale: InterruptedTurn[] } {
  const none = { resume: [], stale: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    parsed = null;
  }
  const turns = (parsed as { turns?: unknown } | null)?.turns;
  if (!Array.isArray(turns)) return none;
  const seen = new Set<string>();
  const out: { resume: InterruptedTurn[]; stale: InterruptedTurn[] } = { resume: [], stale: [] };
  for (const raw of turns.slice(0, MAX_TURNS)) {
    const t = raw as Partial<InterruptedTurn> | null;
    if (!t || typeof t.botId !== "string" || typeof t.threadId !== "string" || typeof t.at !== "number") continue;
    if (seen.has(t.threadId)) continue;
    seen.add(t.threadId);
    const speaker = t.speaker && typeof t.speaker === "object" && !Array.isArray(t.speaker) ? t.speaker : undefined;
    const turn = { botId: t.botId, threadId: t.threadId, at: t.at, ...(speaker ? { speaker } : {}), ...(t.runtimeHeld === true ? { runtimeHeld: true } : {}) };
    (now - t.at > INTERRUPTED_TURN_MAX_AGE_MS || now < t.at - 60_000 ? out.stale : out.resume).push(turn);
  }
  return out;
}

/** #3217: who each cut turn the runtime holds spoke for, read without
 * taking the record (the start's resume still takes it). The runtime's own
 * rerun of such a root speaks for that person; a process that just started
 * knows nobody, and the engine gate fails closed without it. Read before
 * the runtime's first tick. */
export function heldCutTurnSpeakers(dataDir: string, now = Date.now()): Array<{ threadId: string; speaker: Record<string, unknown> }> {
  const path = join(dataDir, FILE);
  if (!existsSync(path)) return [];
  return restorableSpeakers(readInterruptedTurns(path, now).resume);
}

/** The cut turns (runtime-held, with a saved speaker) whose speaker a new process restores. */
export function restorableSpeakers(turns: readonly InterruptedTurn[]): Array<{ threadId: string; speaker: Record<string, unknown> }> {
  const out: Array<{ threadId: string; speaker: Record<string, unknown> }> = [];
  for (const turn of turns) if (turn.runtimeHeld && turn.speaker) out.push({ threadId: turn.threadId, speaker: turn.speaker });
  return out;
}
