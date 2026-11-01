/** running: a turn is in flight; waiting: it waits for a person (an
 * approval, a question); queued: not started yet. */
export type BotActivityStatus = "running" | "waiting" | "queued" | "finished" | "failed" | "stopped";
