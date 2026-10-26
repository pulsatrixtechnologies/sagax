// A server stop that does not lose turns (bot quality diagnostic 2026-10-19,
// cause C): the shutdown first lets the turns in progress finish, for a
// bounded time (drainTurns), then writes down the ones still cut
// (saveInterruptedTurns); the next start resumes each of them once in its
// own conversation (takeInterruptedTurns, TURN_RESUME_PROMPT). Coordinated
// teammate work and routine runs have their own restart policies
// (server/runtime/, server/routines.ts); this file is for the direct turns.
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { writeFileAtomic } from "./atomic.ts";

export interface InterruptedTurn {
  botId: string;
  threadId: string;
  /** When the shutdown cut it (ms). */
  at: number;
  /** Who the cut turn spoke for (TurnSpeaker), carried to its resume. */
  speaker?: Record<string, unknown>;
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
  const none = { resume: [], stale: [] };
  if (!existsSync(path)) return none;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    parsed = null;
  }
  rmSync(path, { force: true });
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
    const turn = { botId: t.botId, threadId: t.threadId, at: t.at, ...(speaker ? { speaker } : {}) };
    (now - t.at > INTERRUPTED_TURN_MAX_AGE_MS || now < t.at - 60_000 ? out.stale : out.resume).push(turn);
  }
  return out;
}
