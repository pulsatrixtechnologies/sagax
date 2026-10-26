// Approvals waiting in a bot-to-bot conversation (2026-10-19).
//
// A conversation another bot opened on this one (a "pair" or "work" thread,
// or an agent ask kept hidden) is never shown to the person
// (src/lib/bot-unread.ts), yet a card in it waits for the bot's owner. The
// person saw the bot busy (its model locked) and no card anywhere. The wire
// bot now names these conversations (WireBot.waitingApprovals) so the app
// can bring their cards into the conversation the person has open, the way
// a parallel task's cards are (src/components/parallel-approvals.ts).
import type { WireWaitingApproval } from "../shared/wire.ts";

export interface InterBotTask {
  threadId: string;
  activity?: string;
  routineRunId?: string;
  closedBy?: unknown;
  updatedAt?: number;
  openedBy?: { botId?: string; name?: string; kind?: string };
}

/** The bot-to-bot conversations of `botId` waiting on the person, oldest
 * first. `mayAnswer` keeps the ones whose cards this viewer answers (their
 * owner): on an organization server, never someone else's. */
export function interBotWaiting(
  botId: string,
  tasks: readonly InterBotTask[] | undefined,
  mayAnswer: (task: InterBotTask) => boolean = () => true,
): WireWaitingApproval[] {
  const out: WireWaitingApproval[] = [];
  for (const task of tasks ?? []) {
    const opener = task.openedBy?.botId;
    if (!opener || opener === botId) continue;
    if (task.activity !== "waiting-on-you" || task.routineRunId || task.closedBy) continue;
    if (!mayAnswer(task)) continue;
    const name = typeof task.openedBy?.name === "string" ? task.openedBy.name.trim().slice(0, 120) : "";
    out.push({
      threadId: task.threadId,
      ...(name ? { openedByName: name } : {}),
      ...(task.openedBy?.kind === "work" || task.openedBy?.kind === "pair" ? { kind: task.openedBy.kind } : {}),
      ...(typeof task.updatedAt === "number" ? { updatedAt: task.updatedAt } : {}),
    });
  }
  return out.sort((a, b) => (a.updatedAt ?? 0) - (b.updatedAt ?? 0)).slice(0, 20);
}
