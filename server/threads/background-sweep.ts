// The background sweep (unified chat, 2026-11-05).
//
// Background threads (shared/background-threads.ts: routine runs, teammate
// hand-offs, threads a bot opened, an AI client's conversations) pile up by
// the hundred: a busy bot made one per run, per webhook mail, per send_prompt
// call. Each was kept open forever. This sweep archives the ones that are
// finished and idle, the way the person would with Archive: nothing is
// deleted, every one stays reachable from its card, its link and the list's
// "Show background" filter, and a person writing in one brings it back
// (start-turn-prepare-claim.ts). Never a thread the person wrote in, never one
// at work, waiting on someone, pinned, confidential or on screen.
//
// planBackgroundSweep is pure; server/index.ts runs it at boot and on a timer.
import { backgroundOrigin, type BackgroundOrigin } from "../../shared/background-threads.ts";

/** server/index.ts tags a run's thread opened ahead of its run with this. */
export const RESERVED_RUN_PREFIX = "prewarm:";

export interface SweepTask {
  threadId: string;
  createdAt: number;
  updatedAt?: number;
  archivedAt?: number;
  pinned?: boolean;
  confidential?: true;
  busy?: boolean;
  activity?: string;
  routineRunId?: string;
  routineResults?: true;
  hidden?: true;
  openedBy?: { botId?: string; kind?: string };
  askedAt?: number;
}

export interface SweepBot {
  id: string;
  /** The bot's selected thread: on someone's screen, never swept. */
  threadId: string;
  tasks: readonly SweepTask[];
}

export interface SweepDeps {
  now: number;
  /** How long a background thread stays untouched before it is archived. */
  idleMs: number;
  /** A turn, a queued hand-off, an active run or a teammate wait holds it. */
  held(botId: string, threadId: string): boolean;
  /** A person wrote a line here from an app (never an AI client's line, a
   * teammate's, a routine's or a relayed one). Read from the transcript. */
  personWroteIn(threadId: string): boolean;
}

export interface SweepEntry {
  botId: string;
  threadId: string;
  origin: BackgroundOrigin;
}

/** The background threads to archive now. */
export function planBackgroundSweep(bots: readonly SweepBot[], deps: SweepDeps): SweepEntry[] {
  const out: SweepEntry[] = [];
  for (const bot of bots) {
    for (const task of bot.tasks) {
      // An AI client writes as the person (askedAt), so only the transcript
      // tells; anywhere else askedAt is the person's own write.
      const origin = backgroundOrigin({ ...task, personWrote: task.askedAt !== undefined && task.openedBy?.kind !== "agent" ? true : undefined });
      if (!origin) continue;
      if (task.archivedAt !== undefined || task.pinned === true || task.confidential === true) continue;
      if (task.threadId === bot.threadId) continue;
      if (task.busy || task.activity === "working" || task.activity === "waiting-on-you") continue;
      // a run's thread opened ahead of its run (thread-prewarm) is the run's to settle
      if (task.routineRunId?.startsWith(RESERVED_RUN_PREFIX)) continue;
      const touched = task.updatedAt ?? task.createdAt;
      if (!Number.isFinite(touched) || deps.now - touched < deps.idleMs) continue;
      if (deps.held(bot.id, task.threadId)) continue;
      // A run the person continued is no run any more (its tag is cleared), so
      // its transcript is only read for the threads that can hold their lines.
      if (origin !== "routine-run" && deps.personWroteIn(task.threadId)) continue;
      out.push({ botId: bot.id, threadId: task.threadId, origin });
    }
  }
  return out;
}

/** Counts by origin, for the one log line (never ids or titles). */
export function sweepSummary(entries: readonly SweepEntry[]): string {
  const counts = new Map<BackgroundOrigin, number>();
  for (const entry of entries) counts.set(entry.origin, (counts.get(entry.origin) ?? 0) + 1);
  return [...counts].map(([origin, count]) => `${origin} ${count}`).join(", ") || "none";
}

/** The idle delay: SAGAX_BACKGROUND_ARCHIVE_IDLE_MIN minutes, 30 by default,
 * at least 1. */
export function backgroundIdleMs(env: NodeJS.ProcessEnv = process.env): number {
  const minutes = Number(env.SAGAX_BACKGROUND_ARCHIVE_IDLE_MIN);
  return (Number.isFinite(minutes) && minutes >= 1 ? minutes : 30) * 60_000;
}
