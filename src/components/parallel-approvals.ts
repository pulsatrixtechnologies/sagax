// Approvals asked by the parallel tasks of the open conversation
// (shared/parallel-tasks.ts). A parallel task runs in its own thread and its
// approval cards live there, but the person is reading the conversation the
// task answers: its pending approvals join that conversation's approval box
// (the stepper), each naming the task it belongs to, and the answer goes to
// the task's own thread.
//
// 2026-10-19: the same for a conversation another bot opened on this one
// (WireBot.waitingApprovals, server/approvals/inter-bot-approvals.ts). It is never
// listed, so its cards were nowhere the person could find them while the
// bot stayed busy (its model locked). They join the box too, naming the bot
// that asked.
//
// #1145 (2026-10-26): with threads hidden ("One conversation"), the person
// never leaves the one conversation. The parallel tasks of every segment of
// the stream join it, not only the open segment's.
//
// #2082 (2026-11-05): their QUESTIONS do not. A question pinned above the
// composer sat over the thread of the conversation on screen. It lives
// inline in the conversation that asked it (the task's own thread, the
// run's view); here only the task's card (waiting, Review) and the sidebar
// dot point to it.
import { useEffect, useState } from "react";

import type { Bot } from "@/state/store";
import { isStreamSegment } from "@/lib/single-stream";
import { threadHeadPage } from "@/lib/thread-head-page";
import { pendingApprovals, type Pending } from "./PendingApproval";

/** The parallel tasks of `threadId` that wait for the person. With `stream`
 * (threads hidden), those of every segment of the bot's one conversation. */
export function waitingParallelTasks(bot: Pick<Bot, "tasks"> | undefined, threadId: string | undefined, stream = false) {
  if (!bot || !threadId) return [];
  const sources = new Set([threadId]);
  if (stream) for (const task of bot.tasks ?? []) if (isStreamSegment(task)) sources.add(task.threadId);
  return (bot.tasks ?? []).filter((task) => task.parallelOf !== undefined && sources.has(task.parallelOf.threadId)
    && task.parallelOf.reportedAt === undefined && task.activity === "waiting-on-you");
}

/** The bot's routine runs (their hidden execution tasks) waiting on the person. */
export function routineRunsWaiting(bot: Pick<Bot, "tasks"> | undefined) {
  return (bot?.tasks ?? []).filter((task) => Boolean(task.routineRunId) && task.activity === "waiting-on-you");
}

/** #1145: with threads hidden, a parallel task asked from the one
 * conversation gets no row of its own: its approvals and questions join
 * that conversation, and its answer is posted there. */
export function parallelTaskInStream(bot: Pick<Bot, "tasks">, task: { parallelOf?: { threadId: string } }): boolean {
  const source = task.parallelOf ? (bot.tasks ?? []).find((candidate) => candidate.threadId === task.parallelOf!.threadId) : undefined;
  return Boolean(source && isStreamSegment(source));
}

/** Tag a parallel task's open approvals with that task. */
export function parallelPendings(messages: Parameters<typeof pendingApprovals>[0], task: { threadId: string; title: string }): Pending[] {
  return pendingApprovals(messages).map((pending) => ({ ...pending, threadId: task.threadId, parallelTitle: task.title }));
}

/** Tag a bot-to-bot conversation's open approvals with the bot that asked. */
export function interBotPendings(messages: Parameters<typeof pendingApprovals>[0], row: { threadId: string; openedByName?: string }): Pending[] {
  return pendingApprovals(messages).map((pending) => ({ ...pending, threadId: row.threadId, askedBy: row.openedByName?.trim() || "" }));
}

/** The conversations whose cards join the open one's box: its parallel
 * tasks, then the bot's bot-to-bot conversations waiting on the person
 * (never the open conversation itself). */
export function approvalSources(bot: Pick<Bot, "tasks" | "threadId" | "waitingApprovals"> | undefined, stream = false): { threadId: string; title?: string; askedBy?: string; stamp: number | string }[] {
  if (!bot) return [];
  const parallel = waitingParallelTasks(bot, bot.threadId, stream).map((task) => ({ threadId: task.threadId, title: task.title, stamp: task.updatedAt ?? 0 }));
  const seen = new Set([bot.threadId, ...parallel.map((row) => row.threadId)]);
  // 2026-11-04: a routine run's hidden task that waits on the person (an
  // approval or a question its turn raised): its cards join the bot's
  // conversation, where the run's line sits, named by the run's title. They
  // were only on the phone (its dock reads every waiting task).
  const runs = routineRunsWaiting(bot).filter((task) => !seen.has(task.threadId))
    .map((task) => ({ threadId: task.threadId, title: task.title, stamp: task.updatedAt ?? 0 }));
  for (const row of runs) seen.add(row.threadId);
  const interBot = (bot.waitingApprovals ?? []).filter((row) => !seen.has(row.threadId))
    .map((row) => ({ threadId: row.threadId, askedBy: row.openedByName?.trim() || "", stamp: row.updatedAt ?? 0 }));
  return [...parallel, ...runs, ...interBot];
}

/** #2901: drop the source cards whose answerable copy already sits in the
 * bot's chat (server/approvals/origin-approvals.ts). #2915: only a copy in
 * the conversation on screen (`shown`: the open thread, or every segment of
 * the one stream): a copy in another conversation leaves its source here. */
export function withoutMirrored(pendings: Pending[], shown: Iterable<string | undefined>): Pending[] {
  const here = new Set([...shown].filter((threadId): threadId is string => Boolean(threadId)));
  return pendings.filter((pending) => {
    const copy = pending.message.card?.approvalDestination?.threadId;
    return !copy || !here.has(copy);
  });
}

/** #2915: the threads on screen with the open conversation. */
export function shownThreads(bot: Pick<Bot, "tasks" | "threadId"> | undefined, stream = false): string[] {
  if (!bot?.threadId) return [];
  return stream ? [bot.threadId, ...(bot.tasks ?? []).filter((task) => isStreamSegment(task)).map((task) => task.threadId)] : [bot.threadId];
}

export function useParallelApprovals(bot: Bot | undefined, stream = false): Pending[] {
  return useParallelCards(bot, stream).pendings;
}

/** The approvals of the conversations whose cards join the open one
 * (approvalSources). Never their questions (#2082). */
export function useParallelCards(bot: Bot | undefined, stream = false): { pendings: Pending[] } {
  const waiting = approvalSources(bot, stream);
  const key = `${shownThreads(bot, stream).join(",")}#${waiting.map((task) => `${task.threadId}:${task.stamp}`).join("|")}`;
  const [found, setFound] = useState<{ key: string; pendings: Pending[] }>({ key: "", pendings: [] });
  useEffect(() => {
    if (!waiting.length) return;
    let live = true;
    // one conversation that cannot be read never hides the others' cards
    void Promise.allSettled(waiting.map(async (task) => {
      // #4187: one request per change, shared with the card's inline questions
      const page = await threadHeadPage(task.threadId, task.stamp);
      const messages = page.messages ?? [];
      const pendings = task.askedBy !== undefined ? interBotPendings(messages, { threadId: task.threadId, openedByName: task.askedBy }) : parallelPendings(messages, { threadId: task.threadId, title: task.title ?? "" });
      return pendings;
    })).then((lists) => {
      const done = lists.flatMap((list) => list.status === "fulfilled" ? [list.value] : []);
      // #2901: a card already mirrored into the bot's chat (approvalDestination)
      // is answered there; listing its source too would ask twice.
      if (live) setFound({ key, pendings: withoutMirrored(done.flat(), shownThreads(bot, stream)) });
    }).catch(() => {});
    return () => {
      live = false;
    };
    // `waiting` is derived from `key`'s inputs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return waiting.length && found.key === key ? { pendings: found.pendings } : { pendings: [] };
}
