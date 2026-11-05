// Where a bot's conversation lives while threads are hidden
// (Settings > Appearance > Threads off).
//
// With threads off there is one visible conversation per bot. An extra,
// untouched thread (made by an older build's New picker, another device, or
// a teammate) must never strand the person: the sidebar row, the New picker
// and the chat header all lead back to the latest conversation with content.
import type { Bot, Task } from "@/state/store";
import { isEarlierSegment, streamHomeThread } from "@/lib/single-stream";
import { freshTopicLanding, onScreenBot } from "@/lib/fresh-topic";
import { threadRecency } from "./SidebarThreadRow";

type HomeBot = Pick<Bot, "threadId" | "tasks"> & { messages?: Bot["messages"] };

/** A thread nobody has written in yet: the server's newest-message stamp is
 * still its birth, and it is not running, waiting or unread. A missing stamp
 * (older server, half-loaded row) is unknown, never treated as empty. */
export function isUntouchedThread(task: Task, bot?: HomeBot): boolean {
  if (task.busy || task.activity === "working" || task.activity === "waiting-on-you" || task.unread || task.waitingForTeammates) return false;
  if (bot && task.threadId === bot.threadId && (bot.messages?.length ?? 0) > 0) return false;
  return typeof task.updatedAt === "number" && task.updatedAt <= task.createdAt;
}

/** The newest conversation that has content, routine runs excluded. */
export function latestConversation(bot: HomeBot): string | undefined {
  let best: Task | undefined;
  for (const task of bot.tasks ?? []) {
    if (task.routineRunId || isUntouchedThread(task, bot)) continue;
    if (!best || threadRecency(task) > threadRecency(best)) best = task;
  }
  return best?.threadId;
}

/** With threads off: the conversation the header's "back" link offers when
 * the open thread is not the latest one with content. */
export function threadsOffReturnTarget(bot: HomeBot): string | undefined {
  // The single stream: its newest segment is where the conversation is.
  const home = streamHomeThread(bot.tasks, bot.threadId);
  if (home) return home !== bot.threadId ? home : undefined;
  const latest = latestConversation(bot);
  return latest && latest !== bot.threadId ? latest : undefined;
}

/** With threads off: where the bot row (and the New picker) should land.
 * Undefined keeps the last selected conversation; a thread id means the
 * open one is an untouched extra and the person goes back to their chat. */
export function threadsOffOpenTarget(bot: HomeBot): string | undefined {
  // An older segment of the stream is drawn above the newest one: open there.
  if (isEarlierSegment(bot.tasks, bot.threadId, bot.threadId)) return streamHomeThread(bot.tasks, bot.threadId);
  const current = bot.tasks?.find((task) => task.threadId === bot.threadId);
  if (current && !isUntouchedThread(current, bot)) return undefined;
  return threadsOffReturnTarget(bot);
}

type OpenAction =
  | { type: "select"; id: string }
  | { type: "switchTask"; botId: string; threadId: string }
  | { type: "freshTopic"; botId: string; threadId: string | null; auto?: boolean; keepAsked?: boolean };

/** The actions that open a bot's conversation the way its sidebar row does.
 * Threads on: the last selected thread. Threads off: the same, unless that
 * thread is an untouched extra, then the latest conversation. Never creates
 * a thread. */
export function openBotConversationActions(bot: HomeBot & { id: string }, showThreads: boolean): OpenAction[] {
  const select: OpenAction = { type: "select", id: bot.id };
  if (showThreads) return [select];
  const target = threadsOffOpenTarget(bot);
  const opened: OpenAction[] = target ? [select, { type: "switchTask", botId: bot.id, threadId: target }] : [select];
  // Coming back after a while lands on a fresh topic (src/lib/fresh-topic.ts);
  // opening the bot already on screen keeps what it shows.
  if (onScreenBot() === bot.id) return opened;
  const landing = freshTopicLanding(bot, target ?? bot.threadId, { now: Date.now() });
  return [...opened, landing.fresh
    ? { type: "freshTopic", botId: bot.id, threadId: target ?? bot.threadId, auto: true }
    : { type: "freshTopic", botId: bot.id, threadId: null, keepAsked: true }];
}
