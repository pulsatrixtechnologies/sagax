// A bot's main thread is the person's one conversation with it: the newest
// segment of their stream (shared/single-stream.ts, THE rule, shared with the
// desktop and the phone). A routine without a thread of its own reports
// there, a peer's ask, a webhook's news and a call's turns land there, and
// the app opens the bot there (WireBot.mainThreadId, worked out only here,
// never by a client), so the one conversation a person sees is where
// everything lands. Nothing when the person has no conversation yet (one is
// started for them then).
//
// Before 2026-10-28 this was "the open thread the person last wrote in"
// (askedAt) while the desktop opened the newest segment: two rules, and a
// routine could report into a topic the person was not looking at.
import { conversationThreadId, type StreamTaskFacts } from "../../shared/single-stream.ts";

interface MainThreadCandidate extends Omit<StreamTaskFacts, "createdAt"> {
  threadId: string;
  createdAt: number;
  askedAt?: number;
  archivedAt?: number;
  routineRunId?: string;
  routineResults?: true;
  confidential?: true;
}

/** The oldest open thread, else the oldest archived one. A routine run is
 * never a conversation. Before askedAt this was every bot's main thread, and
 * v0.1.98 to v0.1.107 saved it on routines as if a person had chosen it. */
export function oldestThread(tasks: readonly MainThreadCandidate[]): string | undefined {
  const visible = tasks.filter((task) => !task.routineRunId && task.routineResults !== true && task.confidential !== true);
  const open = visible.filter((task) => task.archivedAt === undefined);
  return (open.length ? open : visible).reduce<MainThreadCandidate | undefined>(
    (oldest, task) => (!oldest || task.createdAt < oldest.createdAt ? task : oldest), undefined,
  )?.threadId;
}

/** Whether `threadId` is a thread v0.1.98 to v0.1.107 may have saved on a
 * routine as the oldest one: a conversation no open thread is older than.
 * Archived since counts: those versions kept reporting into it, and today's
 * oldest open thread is then another. */
export function wasOldestThread(tasks: readonly MainThreadCandidate[], threadId: string): boolean {
  const saved = tasks.find((task) => task.threadId === threadId && !task.routineRunId);
  return saved !== undefined && !tasks.some((task) => !task.routineRunId && task.archivedAt === undefined && task.createdAt < saved.createdAt);
}

/** The person's one conversation with the bot (shared/single-stream.ts):
 * the newest open segment. `selectedId` is ignored since 2026-10-28 (kept
 * for callers): the selection follows the conversation, never the reverse. */
export function mainThread(tasks: readonly MainThreadCandidate[], _selectedId?: string): string | undefined {
  return conversationThreadId(tasks);
}
