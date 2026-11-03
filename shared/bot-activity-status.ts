/** running: a turn is in flight; waiting: it waits for a person (an
 * approval, a question); queued: not started yet; blocked: it ended on
 * something that stops it (a routine run Flow refused, 2026-11-03), never a
 * success check. */
export type BotActivityStatus = "running" | "waiting" | "queued" | "finished" | "failed" | "stopped" | "blocked";
