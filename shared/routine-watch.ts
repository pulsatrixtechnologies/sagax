// Routines that run when something changes (2026-10-26).
//
// A routine's pre-check can watch a file or a folder of the bot's own
// workspace, the output of a command run where the bot works, or the result
// of a read-only MCP tool called with fixed arguments. The scheduler checks it
// on each due occurrence, without any model turn; the run's turn starts only
// when the result changed (or when a condition on it holds). The server
// validates and runs it (server/routines/routine-precheck.ts, server/routines/routine-watch.ts);
// this module holds the shapes and the limits the screens show.

export type RoutineWatchSource =
  /** A file or a folder, relative to the bot's own folder: names, sizes and
   * modification times (never the contents). */
  | { type: "files"; path: string; recursive?: boolean }
  /** A shell line run in the bot's folder, where the bot itself works. */
  | { type: "command"; command: string }
  /** A read-only MCP tool with fixed arguments: one of the bot's MCP
   * servers (`server__tool`) or a Perspicax read tool. */
  | { type: "tool"; tool: string; args?: Record<string, unknown> };

export type RoutineWatchSourceType = RoutineWatchSource["type"];

export const ROUTINE_WATCH_OPS = ["eq", "ne", "gt", "gte", "lt", "lte", "contains", "exists"] as const;
export type RoutineWatchOp = (typeof ROUTINE_WATCH_OPS)[number];

export type RoutineWatchCondition =
  /** A value inside the JSON result (`$.items[0].priority`, `count`,
   * `items.length`). For a file watch: `exists`, `count` and `bytes`. */
  | { test: "json_path"; path: string; op: RoutineWatchOp; value?: string | number | boolean }
  /** The text of the result contains (or, negated, lacks) this text. */
  | { test: "contains"; text: string; negate?: boolean }
  /** A command's exit code. */
  | { test: "exit_code"; op: "eq" | "ne"; value: number };

/** Restrict the comparison to items of a JSON result: the array at `items`
 * (the result itself when absent), each named by its `key` field (default
 * `id`), compared on `fields` only (every field when absent). The run then
 * says which items are new, changed or gone. */
export interface RoutineWatchTrack {
  items?: string;
  key?: string;
  fields?: string[];
}

export interface RoutineWatchPrecheck {
  kind: "watch";
  source: RoutineWatchSource;
  /** `change` (default): wake when the result changed, and the condition
   * holds when there is one. `match`: wake on every check where the
   * condition holds, changed or not. */
  wakeOn?: "change" | "match";
  condition?: RoutineWatchCondition;
  track?: RoutineWatchTrack;
  /** The first check: `baseline` (default) records the result without
   * waking; `wake` runs the turn once with the whole result. */
  firstRun?: "baseline" | "wake";
  /** Where the bot works on a cloud computer that is asleep: `skip`
   * (default) checks only while it is awake, `wake` starts it for the
   * check. */
  whenAsleep?: "skip" | "wake";
}

/** The bounds of one check. Each is enforced on the server. */
export const ROUTINE_WATCH_LIMITS = {
  /** Two checks of one routine are at least this far apart, whatever the
   * schedule says (a cron line every minute checks every 5 minutes). */
  minIntervalMinutes: 5,
  /** One check, all included (a command, a tool call, a folder walk). It
   * runs beside the scheduler, never inside its pass. */
  timeoutMs: 15_000,
  /** Output read from a command or a tool; the rest is not read. */
  maxOutputBytes: 256 * 1024,
  /** Entries walked in a folder, and how deep. */
  maxFiles: 5_000,
  maxDepth: 8,
  /** Kept on disk per routine for the next comparison. */
  maxStateBytes: 64 * 1024,
  maxItems: 500,
  /** The note the woken run reads. */
  maxNoteChars: 4_000,
  commandMaxChars: 2_000,
  argsMaxChars: 4_000,
  pathMaxChars: 500,
} as const;

/** Folders never walked: version control and package caches. */
export const ROUTINE_WATCH_SKIPPED_DIRS: readonly string[] = [".git", "node_modules"];

export function isRoutineWatch(value: unknown): value is RoutineWatchPrecheck {
  return Boolean(value) && typeof value === "object" && (value as { kind?: unknown }).kind === "watch";
}
