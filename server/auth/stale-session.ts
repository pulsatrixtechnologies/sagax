// A thread's engine session that is not worth resuming (2026-10-20).
//
// Production, 2026-10-20 16:13 UTC: "Hello Nova" resumed a 6.4 MB Claude
// session whose last turn, 15 hours earlier, had stopped on a pending
// `gh auth login -w`. The model picked that work back up (a cloud computer
// woken, three commands) and the API took 7.2 s before its first thought on
// that much context. A session left alone for hours, or grown past a size,
// is not resumed: Sagax folds the thread (server/index.ts
// compactConversation) and the next turn starts a new engine session from
// the summary and the latest turns, so the bot still knows what was said.
//
// Pure: the server supplies the times and sizes. Tests: stale-session.test.ts.

/** Hours of quiet after which a thread's engine session is not resumed. */
export const DEFAULT_STALE_SESSION_HOURS = 6;

/** Size on disk of a saved engine session (Claude's session file) past
 * which it is not resumed. Measured 2026-10-20 (bench, real Claude CLI):
 * see AGENTS.md, "Stale engine sessions and small talk". */
export const DEFAULT_STALE_SESSION_BYTES = 2_000_000;

/** Quiet time before the size check applies: the provider's prompt cache
 * has expired (Claude's is one hour on Sagax's sessions, `ephemeral_1h` in
 * the usage frames), so a resume re-reads the whole session uncached. An
 * active task keeps its session however large. */
export const DEFAULT_STALE_SESSION_COLD_MINUTES = 60;

export type StaleSessionReason = "idle" | "size";

const HOUR_MS = 3_600_000;

/** A positive finite setting, 0 to turn the check off, else the default. */
function setting(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

/** Why the engine session of a thread should not be resumed, or null.
 * - idle: the thread's last message is older than `hours` (default 6, 0 off).
 * - size: quiet for more than `coldMinutes` (default 60) and the engine
 *   reports a saved session larger than `maxBytes` (default 2 MB, about the
 *   largest 10% of Claude sessions on the maintainer's Mac; 0 off). Engines that report
 *   no size are judged on time only. */
export function staleSessionReason(input: {
  now: number;
  /** When the thread's last message before this turn was written. */
  lastActivityAt?: number;
  /** The engine's saved session on disk, when it can tell; read only when
   * the thread has been quiet long enough for the size to matter. */
  sessionBytes?: number | (() => number | undefined);
  hours?: number;
  maxBytes?: number;
  coldMinutes?: number;
}): StaleSessionReason | null {
  const hours = setting(input.hours, DEFAULT_STALE_SESSION_HOURS);
  const maxBytes = setting(input.maxBytes, DEFAULT_STALE_SESSION_BYTES);
  const coldMs = setting(input.coldMinutes, DEFAULT_STALE_SESSION_COLD_MINUTES) * 60_000;
  const quietMs = typeof input.lastActivityAt === "number" && Number.isFinite(input.lastActivityAt) ? input.now - input.lastActivityAt : undefined;
  if (quietMs === undefined) return null;
  if (hours > 0 && quietMs > hours * HOUR_MS) return "idle";
  if (maxBytes > 0 && quietMs > coldMs) {
    const bytes = typeof input.sessionBytes === "function" ? input.sessionBytes() : input.sessionBytes;
    if (typeof bytes === "number" && bytes > maxBytes) return "size";
  }
  return null;
}
