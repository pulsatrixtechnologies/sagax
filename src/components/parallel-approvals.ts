// Approvals asked by the parallel tasks of the open conversation
// (shared/parallel-tasks.ts). A parallel task runs in its own thread and its
// approval cards live there, but the person is reading the conversation the
// task answers: its pending approvals join that conversation's approval box
// (the stepper), each naming the task it belongs to, and the answer goes to
// the task's own thread.
//
// 2026-10-19: the same for a conversation another bot opened on this one
// (WireBot.waitingApprovals, server/inter-bot-approvals.ts). It is never
// listed, so its cards were nowhere the person could find them while the
// bot stayed busy (its model locked). They join the box too, naming the bot
// that asked.
import { useEffect, useState } from "react";

import { api, type Bot } from "@/state/store";
import { pendingApprovals, type Pending } from "./PendingApproval";

/** The parallel tasks of `threadId` that wait for the person. */
export function waitingParallelTasks(bot: Pick<Bot, "tasks"> | undefined, threadId: string | undefined) {
  if (!bot || !threadId) return [];
  return (bot.tasks ?? []).filter((task) => task.parallelOf?.threadId === threadId
    && task.parallelOf.reportedAt === undefined && task.activity === "waiting-on-you");
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
export function approvalSources(bot: Pick<Bot, "tasks" | "threadId" | "waitingApprovals"> | undefined): { threadId: string; title?: string; askedBy?: string; stamp: number | string }[] {
  if (!bot) return [];
  const parallel = waitingParallelTasks(bot, bot.threadId).map((task) => ({ threadId: task.threadId, title: task.title, stamp: task.updatedAt ?? 0 }));
  const seen = new Set([bot.threadId, ...parallel.map((row) => row.threadId)]);
  const interBot = (bot.waitingApprovals ?? []).filter((row) => !seen.has(row.threadId))
    .map((row) => ({ threadId: row.threadId, askedBy: row.openedByName?.trim() || "", stamp: row.updatedAt ?? 0 }));
  return [...parallel, ...interBot];
}

export function useParallelApprovals(bot: Bot | undefined): Pending[] {
  const waiting = approvalSources(bot);
  const key = waiting.map((task) => `${task.threadId}:${task.stamp}`).join("|");
  const [found, setFound] = useState<{ key: string; pendings: Pending[] }>({ key: "", pendings: [] });
  useEffect(() => {
    if (!key) return;
    let live = true;
    // one conversation that cannot be read never hides the others' cards
    void Promise.allSettled(waiting.map(async (task) => {
      const page = await api(`/api/threads/${task.threadId}/messages?limit=60`) as { messages?: Parameters<typeof pendingApprovals>[0] };
      const messages = page.messages ?? [];
      return task.askedBy !== undefined ? interBotPendings(messages, { threadId: task.threadId, openedByName: task.askedBy }) : parallelPendings(messages, { threadId: task.threadId, title: task.title ?? "" });
    })).then((lists) => {
      if (live) setFound({ key, pendings: lists.flatMap((list) => list.status === "fulfilled" ? list.value : []) });
    }).catch(() => {});
    return () => {
      live = false;
    };
    // `waiting` is derived from `key`'s inputs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return key && found.key === key ? found.pendings : [];
}
