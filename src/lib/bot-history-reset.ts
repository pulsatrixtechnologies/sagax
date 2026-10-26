// "Reset the history" of a bot (2026-10-21, parity with Grok Bot): the
// conversation starts again from nothing while the bot keeps its memory,
// files, routines, skills and settings. Nothing is deleted: a new
// conversation opens, then every open conversation of the person with that
// bot goes to the archive, where it can still be read or brought back.
// Routine runs, confidential conversations, an AI client's hidden thread
// and a bot-to-bot thread are left as they are: the person never sees those
// as their history, and archiving a work thread would drop the teammate's
// next message on a new thread (store.workThread).
import type { Bot } from "@/state/store";
import { taskHiddenFromSidebar } from "./bot-unread";
import { isConfidentialTask } from "./confidential-thread";

/** Enough of a thread to decide whether a reset archives it. */
type ResetTask = {
  threadId: string;
  archivedAt?: number;
  confidential?: unknown;
  routineRunId?: string;
  hidden?: true;
  openedBy?: { botId?: string };
};

/** The open conversations a reset archives. Pure. */
export function historyResetThreads(bot: Pick<Bot, "id" | "tasks" | "threadId">): string[] {
  const tasks: readonly ResetTask[] = bot.tasks ?? [{ threadId: bot.threadId }];
  return tasks
    .filter((task) => task.archivedAt === undefined && !isConfidentialTask(task) && !taskHiddenFromSidebar(task, bot.id))
    .map((task) => task.threadId);
}
