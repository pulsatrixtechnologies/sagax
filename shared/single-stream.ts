// Single stream (thread mode off): one continuous conversation per bot.
//
// With Settings > Appearance > Show threads off, the person sees one
// conversation per bot, like Grok Bot. "New topic" does not hide what came
// before: it starts a fresh engine context (a new thread on the server) and
// the app draws a divider in the same stream. Each thread of that stream is a
// "segment". The data model is the existing threads: nothing is moved or
// copied, so turning threads back on shows the same segments as threads
// again (docs/single-stream-orchestration.md).
//
// Pure: the server (digest, recall_topic) and the clients (the merged
// transcript) share this one rule for what belongs to a person's stream.

/** The thread fields the stream rule reads (WireTask and TaskRecord alike). */
export interface StreamTaskFacts {
  threadId: string;
  createdAt: number;
  routineRunId?: unknown;
  routineResults?: unknown;
  hidden?: unknown;
  confidential?: unknown;
  openedBy?: unknown;
  parallelOf?: unknown;
}

/** Whether a thread is a segment of its bot's stream: a conversation a person
 * had with the bot. Never a routine run, an AI client's hidden conversation
 * (#291), a confidential thread (#683, kept to itself), a thread a bot opened
 * (a job or a pair conversation, reached by its own link) or a parallel task
 * (its card and result already sit in the conversation that asked). */
export function isStreamSegment(task: StreamTaskFacts): boolean {
  // nor an automatic routine results thread (2026-10-22, JC: "everything
  // should be unified in a single chat page")
  return !task.routineRunId && task.routineResults !== true && task.hidden !== true && task.confidential !== true && !task.openedBy && !task.parallelOf;
}

/** A bot's stream segments, oldest first (the order the person reads). The
 * caller passes the threads this viewer may see (narrowBotForViewer on an
 * organization server), so a shared bot gives each person their own stream. */
export function streamSegments<T extends StreamTaskFacts>(tasks: readonly T[] | undefined): T[] {
  return (tasks ?? []).filter(isStreamSegment).sort((a, b) => a.createdAt - b.createdAt || a.threadId.localeCompare(b.threadId));
}

/** The segments drawn before `threadId` in the stream, oldest first. Empty
 * when the thread is not a segment (a confidential or hidden thread is shown
 * alone, as before). */
export function earlierSegments<T extends StreamTaskFacts>(tasks: readonly T[] | undefined, threadId: string): T[] {
  const segments = streamSegments(tasks);
  const at = segments.findIndex((task) => task.threadId === threadId);
  return at < 0 ? [] : segments.slice(0, at);
}

/** The segment a send goes to: the newest one. A deep link to an older
 * segment scrolls the stream there; the composer still writes at the end. */
export function latestSegment<T extends StreamTaskFacts>(tasks: readonly T[] | undefined): T | undefined {
  return streamSegments(tasks).at(-1);
}
