// A result that needs the person always reaches the person (2026-11-05).
//
// Production, 2026-11-05 08:47 ET: a dispatcher bot's hourly pass ended in
// a work thread another bot had opened ("@<requester> · work") with two
// items marked [HUMAIN] for the person. That turn was a peer hop: internal,
// so it marked nothing unread and rang nothing (index.ts turn.completed:
// `!internal`), and notify() drops a bot-to-bot thread's own news
// (notificationIsInterBotChatter). The requester's resume read it in its
// own hidden task. The person's conversation with the dispatcher showed
// nothing, and no card, push or follow-up came.
//
// The rule: when a bot's turn ends in a thread that is not the person's own
// conversation with that bot (a hand-off, a thread another bot opened, a
// routine run's task the routine no longer reports from, a notice the bot
// received), and its words carry a structured signal that needs the person
// (shared/person-attention.ts), one card goes into the person's own
// conversation with that bot, the conversation turns unread and the person
// is notified (desktop and phone: the notify frame feeds the push hub).
// A routine run still active reports through its own card
// (syncRoutineRunToSource), which carries the same items.
//
// Also: a routine run's task whose run already ended (a teammate's result
// resumed the bot after the run closed) is read by nobody. The bot's answer
// there is mirrored into its conversation, linked to the run's task.

import { personAttention, personAttentionText, type PersonAttention, type PersonAttentionCard } from "../../shared/person-attention.ts";
import type { WireMessage, WireTask } from "../../shared/wire.ts";

export interface AttentionBot {
  id: string;
  name: string;
  avatarUrl?: string;
  hidden?: boolean;
}

export interface AttentionRelayDeps<B extends AttentionBot> {
  task(botId: string, threadId: string): Pick<WireTask, "threadId" | "title" | "confidential" | "openedBy" | "routineRunId" | "archivedAt"> | undefined;
  messages(threadId: string): readonly WireMessage[];
  append(threadId: string, message: Omit<WireMessage, "id" | "at">): WireMessage | undefined | null | void;
  markUnread(botId: string, threadId: string): void;
  /** The person's own conversation with the bot (started when they have none). */
  conversation(bot: B, threadId: string): string | undefined;
  /** An AI client's conversation over MCP: the client reads it. */
  agentConversation(botId: string, threadId: string): boolean;
  /** The routine run this thread is the task of, active or not. */
  routineRun(threadId: string): { id: string; routineName: string; status: string } | null;
  /** A deep link to a ConnectWise ticket, when the site is known. */
  ticketUrl?(threadId: string, ticketId: number): string | undefined;
  notify(bot: B, threadId: string, title: string, body: string): void;
}

const ACTIVE_RUN = new Set(["queued", "running", "waiting"]);

/** One finished turn. `runTurn`: the routine manager settled a run with
 * this very turn (its card reports it), so the run is not "ended" here. */
export interface AttentionTurn<B extends AttentionBot> {
  bot: B;
  threadId: string;
  turnId?: string;
  ok: boolean;
  stopped?: boolean;
  runTurn?: boolean;
}

/** The bot's words of one turn in this thread, and the last message of them. */
export function turnWords(messages: readonly WireMessage[], turnId: string | undefined): { text: string; last?: WireMessage } {
  const own = messages.filter((message) => message.role === "bot" && message.kind === "text" && !message.from && !message.attention && typeof message.text === "string");
  const rows = turnId ? own.filter((message) => message.turnId === turnId) : own.slice(-1);
  const picked = rows.length ? rows : own.slice(-1);
  return { text: picked.map((message) => message.text ?? "").join("\n\n"), last: picked.at(-1) };
}

/** What happened (for tests and the log): the card's thread, or why not. */
export type AttentionRelayOutcome =
  | { posted: true; threadId: string; card: PersonAttentionCard }
  | { posted: false; reason: "failed" | "no-task" | "confidential" | "agent" | "no-signal" | "run-reports" | "own-conversation" | "no-conversation" | "already" };

export function relayPersonAttention<B extends AttentionBot>(
  input: AttentionTurn<B>,
  deps: AttentionRelayDeps<B>,
): AttentionRelayOutcome {
  const { bot, threadId } = input;
  if (!input.ok || input.stopped || bot.hidden) return { posted: false, reason: "failed" };
  const task = deps.task(bot.id, threadId);
  if (!task || task.archivedAt) return { posted: false, reason: "no-task" };
  if (task.confidential === true) return { posted: false, reason: "confidential" };
  if (deps.agentConversation(bot.id, threadId)) return { posted: false, reason: "agent" };
  const { text, last } = turnWords(deps.messages(threadId), input.turnId);
  const found = last ? personAttention(text) : undefined;
  if (!found || !last) return { posted: false, reason: "no-signal" };
  const run = deps.routineRun(threadId);
  // the routine's own card reports it (with these items)
  if (input.runTurn || (run && ACTIVE_RUN.has(run.status))) return { posted: false, reason: "run-reports" };
  const target = deps.conversation(bot, threadId);
  if (!target) return { posted: false, reason: "no-conversation" };
  if (target === threadId) return { posted: false, reason: "own-conversation" };
  if (deps.messages(target).some((message) => message.attention?.sourceMessageId === last.id)) return { posted: false, reason: "already" };
  const card = attentionCard(bot, threadId, task, last.id, found, run, deps);
  deps.append(target, {
    role: "bot", kind: "text", text: personAttentionText(card), attention: card,
    threadRef: { botId: bot.id, threadId, title: task.title },
  });
  deps.markUnread(bot.id, target);
  deps.notify(bot, target, card.kind === "question" ? `${bot.name} has a question for you` : `${bot.name} needs you`,
    card.items.map((entry) => entry.text.replace(/\*\*|__|`/g, "").replace(/\s+/g, " ")).join("\n"));
  return { posted: true, threadId: target, card };
}

export function attentionCard<B extends AttentionBot>(
  bot: B,
  threadId: string,
  task: { title?: string; openedBy?: WireTask["openedBy"] } | undefined,
  sourceMessageId: string,
  found: PersonAttention,
  run: { id: string; routineName: string } | null,
  deps: Pick<AttentionRelayDeps<B>, "ticketUrl">,
): PersonAttentionCard {
  const items = found.items.map((entry) => {
    const url = entry.ticketId ? deps.ticketUrl?.(threadId, entry.ticketId) : undefined;
    return url ? { ...entry, ticketUrl: url } : { ...entry };
  });
  const opener = task?.openedBy && task.openedBy.botId && task.openedBy.botId !== bot.id && typeof task.openedBy.name === "string"
    ? { botId: task.openedBy.botId, name: task.openedBy.name } : undefined;
  return {
    kind: found.kind, items, botId: bot.id, botName: bot.name, threadId,
    ...(task?.title ? { threadTitle: task.title } : {}),
    sourceMessageId,
    ...(opener ? { openedBy: opener } : {}),
    ...(run ? { routineRunId: run.id, routineName: run.routineName } : {}),
  };
}

/** A routine run's task the run no longer reports from: the bot's answer
 * there (a teammate's result resumed it after the run closed) is mirrored
 * into its conversation once, linked to the task. False when not such a
 * thread or nothing to say. */
export function mirrorLateRunReply<B extends AttentionBot>(
  input: AttentionTurn<B>,
  deps: AttentionRelayDeps<B>,
): boolean {
  const { bot, threadId } = input;
  if (!input.ok || input.stopped || bot.hidden || input.runTurn) return false;
  const run = deps.routineRun(threadId);
  if (!run || ACTIVE_RUN.has(run.status)) return false;
  const task = deps.task(bot.id, threadId);
  if (!task || task.confidential === true) return false;
  const { text, last } = turnWords(deps.messages(threadId), input.turnId);
  const words = text.trim();
  if (!last || !words || /^\s*NOTHING_TO_REPORT\s*$/i.test(words)) return false;
  const target = deps.conversation(bot, threadId);
  if (!target || target === threadId) return false;
  if (deps.messages(target).some((message) => message.attention?.sourceMessageId === last.id || message.lateRunReplyOf === last.id)) return false;
  deps.append(target, {
    role: "bot", kind: "text", text: words.replace(/^\s*NOTHING_TO_REPORT\s*$/gim, "").trim(), lateRunReplyOf: last.id,
    threadRef: { botId: bot.id, threadId, title: task.title || run.routineName },
  });
  deps.markUnread(bot.id, target);
  deps.notify(bot, target, `${bot.name}: ${run.routineName}`, words.slice(0, 300));
  return true;
}
