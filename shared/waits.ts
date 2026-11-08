/** What a wait (wait_until) can wait for. */
export const WAIT_KINDS = ["url_contains", "url_missing", "file_exists", "file_missing", "file_changed", "process_running", "process_gone", "bot_idle", "time_reached"] as const;
export type WaitKind = (typeof WAIT_KINDS)[number];
/** How long a wait lasts unless it fires first, in hours. */
export const WAIT_HOURS = { default: 24, max: 168 } as const;
/** A time_reached wait (#2645): the soonest it may fire, and how long past its time it stays open if its chat is busy. */
export const WAIT_TIME = { minAheadMs: 60_000, graceMs: 60 * 60_000 } as const;
