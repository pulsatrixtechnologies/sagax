// #3503: what one bot says to another bot of the same person stays between
// the two bots.
//
// "Nothing invisible" (#2901, #2915) and the relay of a result that needs the
// person (2026-11-05) copied every turn of a thread another bot opened into
// the person's own conversation, and turned a team bot's question to its
// orchestrator into a card, a Today item, a pinned item and a notification
// for the person. That exchange is not addressed to the person: it stays in
// the two bots' thread (the orchestrator's work view and the team bot's own
// chat show it), and a question asked there goes to the bot that opened the
// thread, through the hand-over's own return path (the runtime parks the
// assignment and wakes its requester with the question).
//
// What still reaches the person from such a thread is unchanged: an approval
// card, an item the bot marks for them with an explicit tag
// (shared/person-attention.ts), and a failure of the work. An AI client's
// conversation, a routine's, a thread the bot opened for itself and a thread
// a bot of another person opened keep today's rules.

import { personAttention } from "../../shared/person-attention.ts";
import type { WireMessage, WireTask } from "../../shared/wire.ts";
import { personRequestOpen } from "../approvals/waiting-card-skip.ts";

/** Whether two bots belong to the same person. */
export type SameOwner = (botId: string, otherBotId: string) => boolean;

type OpenedTask = Pick<WireTask, "openedBy" | "routineRunId" | "routineResults">;

/** A thread another bot of the same person opened for `botId` (a hand-over,
 * a pair conversation, a thread a bot opened). Never an AI client's
 * conversation, a routine run's task, a thread the bot opened for itself,
 * or one a bot of another person opened. */
export function openedByOwnBot(task: OpenedTask | undefined, botId: string, sameOwner: SameOwner | undefined): boolean {
  const opener = task?.openedBy;
  if (!task || !opener || !sameOwner) return false;
  if (opener.kind === "agent" || !opener.botId || opener.botId.startsWith("agent:") || opener.botId === botId) return false;
  if (task.routineRunId || task.routineResults === true) return false;
  return sameOwner(botId, opener.botId);
}

/** A question in words with no explicit tag for the person: the tags of
 * shared/person-attention.ts still reach the person. */
export function plainQuestion(question: string): boolean {
  return personAttention(question)?.kind !== "human";
}

/** The parked assignment and its requester, as postInputRequest sees them. */
export interface ParkedNode {
  botId: string;
  parentId?: string;
  groupId?: string;
  cards?: readonly string[];
  reply?: string;
  oneWay?: boolean;
}

/** A team bot's question at the end of a turn in a thread its requester (a
 * bot of the same person) opened: the requester reads it (the runtime wakes
 * it with the question), so the person gets no card and no notification.
 * False when nothing would carry it to a bot (a one-way notice, no reply),
 * when it waits on the person's own cards (an approval), when it is tagged
 * for the person, in a room, or when the requester is not another bot of the
 * same person. */
export function questionForRequester(node: ParkedNode, parent: { botId: string; groupId?: string } | undefined, question: string, sameOwner: SameOwner | undefined): boolean {
  if (!node.parentId || !parent || !sameOwner) return false;
  if (node.groupId || parent.groupId || node.oneWay || node.reply === "none" || node.cards?.length) return false;
  if (parent.botId === node.botId || !sameOwner(node.botId, parent.botId)) return false;
  return plainQuestion(question);
}

export interface LeftoverQuestionDeps {
  /** The conversations to read (every bot's). */
  threads(): readonly string[];
  messages(threadId: string): readonly WireMessage[];
  /** The waiting work's thread of a bot. */
  task(botId: string, threadId: string): (OpenedTask & Pick<WireTask, "archivedAt">) | undefined;
  /** The bot whose conversation `threadId` is. */
  botOfThread(threadId: string): string | undefined;
  sameOwner: SameOwner;
  /** Close it as skipped; `quiet`: the work's thread is archived or gone,
   * so no bot is told again. */
  close(threadId: string, message: WireMessage, quiet: boolean): boolean;
  /** Give the event loop back between two conversations (#3473). */
  pause(): Promise<void>;
}

/** The work thread of a person request this defect left, with whether that
 * thread is archived or gone; undefined for anything else. */
export function leftoverBotQuestion(threadId: string, message: WireMessage, deps: Pick<LeftoverQuestionDeps, "task" | "botOfThread" | "sameOwner">): { quiet: boolean } | undefined {
  if (!personRequestOpen(message)) return undefined;
  const attention = message.attention;
  if (attention) {
    // a plain question only: an explicit tag ("human") and a failure stay
    if (attention.kind !== "question" || attention.routineRunId) return undefined;
    const task = deps.task(attention.botId, attention.threadId);
    const facts = task ?? (attention.openedBy ? { openedBy: { ...attention.openedBy, at: 0 } } : undefined);
    if (!openedByOwnBot(facts, attention.botId, deps.sameOwner)) return undefined;
    return { quiet: !task || Boolean(task.archivedAt) };
  }
  const request = message.inputRequest;
  if (!request || !plainQuestion(request.question)) return undefined;
  // a one-way notice's question sits in the asking bot's own conversation:
  // nothing carries it to another bot, it stays
  if (deps.botOfThread(threadId) === request.botId) return undefined;
  const task = deps.task(request.botId, request.threadId);
  if (!openedByOwnBot(task, request.botId, deps.sameOwner)) return undefined;
  return { quiet: Boolean(task?.archivedAt) };
}

/** The receipt that keeps the upgrade's sweep to one run. */
export const BOT_QUESTION_SWEEP = { kind: "upgrade.sweep", key: "bot-to-bot-questions" } as const;

/** At the upgrade: close the questions a bot asked another bot of the same
 * person that were left waiting on the person, and only those. One
 * conversation at a time, the event loop given back between two. */
export async function sweepLeftoverBotQuestions(deps: LeftoverQuestionDeps): Promise<number> {
  let closed = 0;
  for (const threadId of deps.threads()) {
    const found: Array<{ message: WireMessage; quiet: boolean }> = [];
    for (const message of deps.messages(threadId)) {
      const leftover = leftoverBotQuestion(threadId, message, deps);
      if (leftover) found.push({ message, ...leftover });
    }
    for (const { message, quiet } of found) {
      try {
        if (deps.close(threadId, message, quiet)) closed += 1;
      } catch {
        // one row that fails to close leaves the others to close
      }
    }
    await deps.pause();
  }
  return closed;
}
