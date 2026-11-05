// Background threads (unified chat, 2026-11-05).
//
// A bot has one conversation with its person, as in the reference design's
// unified chat. The machinery that works behind it opens threads of its own:
// a routine's run, a teammate's hand-off ("@Scout · work"), a thread a bot
// opens on itself or on a peer (start_thread, run_with_engine), an AI
// client's conversation over MCP (send_prompt). Those are background
// threads: never rows in the person's thread list, reached from the card
// that reports them, or from the list's "Show background" filter. The
// server archives them once they are finished and idle
// (server/threads/background-sweep.ts); nothing is deleted.
//
// One rule, read by the server (the sweep), the desktop (sidebar and the
// header picker) and the phone (CompanionCore BotTask.isBackground, the same
// cases). Pure: no store, no clock.

/** The thread fields the rule reads (WireTask and TaskRecord alike). */
export interface BackgroundTaskFacts {
  routineRunId?: unknown;
  routineResults?: unknown;
  hidden?: unknown;
  openedBy?: { botId?: string; kind?: string } | null;
  /** A person wrote here from an app (server-derived from TaskRecord.askedAt). */
  personWrote?: unknown;
}

/** Where a background thread comes from. */
export type BackgroundOrigin =
  /** A routine's detached execution (reported by its run card). */
  | "routine-run"
  /** An automatic "<routine> · Results" thread from before reports moved to the conversation. */
  | "routine-results"
  /** A person's AI client over MCP (send_prompt, sagax_thread), or #291's hidden conversation. */
  | "ai-client"
  /** A teammate's hand-off: a "work" or "pair" conversation another bot drives. */
  | "handoff"
  /** A thread a bot opened itself (start_thread on itself or a peer, run_with_engine). */
  | "bot-opened";

/** Why a thread is in the background, or null for one of the person's own
 * conversations. A thread a bot opened stays the person's once they wrote in
 * it themselves (personWrote), except an AI client's: the client writes as
 * the person there, so its lines never make the thread theirs. */
export function backgroundOrigin(task: BackgroundTaskFacts): BackgroundOrigin | null {
  if (task.routineRunId) return "routine-run";
  if (task.routineResults === true) return "routine-results";
  if (task.hidden === true) return "ai-client";
  const opener = task.openedBy;
  if (!opener) return null;
  if (opener.kind === "agent") return "ai-client";
  if (task.personWrote === true) return null;
  return opener.kind === "work" || opener.kind === "pair" ? "handoff" : "bot-opened";
}

export function isBackgroundThread(task: BackgroundTaskFacts): boolean {
  return backgroundOrigin(task) !== null;
}

/** The threads a person's thread list shows: their own conversations, plus
 * the one on screen (opened from a card or a link), unless it is a routine
 * run, whose home stays its run card. */
export function personThreads<T extends BackgroundTaskFacts & { threadId: string }>(tasks: readonly T[], openThreadId?: string): T[] {
  return tasks.filter((task) => !task.routineRunId && (task.threadId === openThreadId || !isBackgroundThread(task)));
}

/** The "Show background" filter: every background thread except routine
 * runs, whose home is the run history and the run card. */
export function backgroundThreads<T extends BackgroundTaskFacts & { threadId: string }>(tasks: readonly T[]): T[] {
  return tasks.filter((task) => {
    const origin = backgroundOrigin(task);
    return origin !== null && origin !== "routine-run";
  });
}
