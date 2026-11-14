// @ts-nocheck
/** handleRequestResolved (#1388). Pure move from server/index.ts bus.subscribe. */
import { appendDecision } from "../decision-log.ts";
import { safetySettleRequest, takeSafetyNote } from "../safety/safety-review.ts";
import { turnWaitedOnPerson } from "../waits/waiting-on-person.ts";
export function handleRequestResolved(event: any, ctx: any, host: any): void {
  const {
    bot, speaker,
  } = ctx;
  switch (event.type) {
    case "request.resolved":
    {
      if (event.requestId) host.pendingCommandRules.delete(`${event.threadId}:${event.requestId}`);
      if (event.requestId) safetySettleRequest(event.requestId, event.behavior, event.source);
      if (event.requestId) takeSafetyNote(event.requestId);
      if (event.requestId) host.agentCardGuard.resolved(event.requestId, event.behavior, event.source);
      if (event.requestId) host.withdrawApprovalNotice(event.threadId, event.requestId, requestOutcome(event.source));
      if (event.requestId) host.settleWaitingOnPersonChips(event.threadId, event.requestId, { behavior: event.behavior, source: event.source });
      // answered (by whoever): the turn is working again, unless it settled
      const waiting = bot ?? (speaker ? host.store.bot(speaker.botId) : undefined);
      // 2026-11-08 (#2922): another card of this turn still waits on the
      // person, so the turn stays waiting-on-you (badge, await_turn). Only
      // this turn's cards (a proposal or question left by an earlier turn
      // does not hold it), never one a reviewer still decides, never the one
      // settled here (its patch comes after this event).
      const botId = bot?.id ?? speaker?.botId ?? "";
      const stillOpen = Boolean(host.agentPendingApproval?.(botId, event.threadId, { except: event.requestId, rootOnly: true })?.open?.length);
      if (stillOpen) {
        // nothing: the remaining card keeps the thread waiting
      } else if (bot && turnWaitedOnPerson(host.store.taskByThread(bot.id, event.threadId))) {
        host.store.setTaskActivity(bot.id, event.threadId, "working");
      } else if (!bot && turnWaitedOnPerson(waiting)) host.store.setActivity(waiting.id, "working");
      const messageId = event.requestId ? host.askMessageByRequest.get(`${event.threadId}:${event.requestId}`) : null;
      if (messageId) {
        const existing = host.store.messagesFor(event.threadId).find((m) => m.id === messageId);
        // 2026-10-11: a permission card nobody answered before its own
        // timeout is a decision too, so the approvals history can say
        // "expired" (GET /api/org/admin/approvals/history).
        if (event.source === "timeout" && existing?.card?.requestType === "permission" && !existing.card.answered) {
          appendDecision(host.DATA_DIR, {
            threadId: event.threadId,
            requestId: event.requestId,
            botId: waiting?.id,
            botName: waiting?.name,
            tool: existing.card.tool,
            summary: existing.card.subtitle,
            decision: "expired",
            source: "timeout"
          });
        }
        if (existing?.card && !existing.card.answered) {
          // Nobody answered this approval: the engine denied it on its own
          // timer and the turn goes on without the action. Kept for the
          // turn's result, so its requester does not read it as done.
          // A later card of that turn for the same action that was
          // answered undoes it: someone decided, and an allow ran it.
          if (existing.card.requestType === "permission") {
            if (event.source === "timeout") host.unansweredApprovals.record(event.threadId, event.turnId, existing.card.tool, existing.card.subtitle);
            else if (event.source !== "system" && event.source !== "unavailable") host.unansweredApprovals.answered(event.threadId, event.turnId, existing.card.tool, existing.card.subtitle);
          }
          if (host.shouldSettleRequestCard(existing.card, event.source)) {
            host.store.patchMessage(event.threadId, messageId, {
              card: {
                ...existing.card,
                answered: event.behavior,
                dismissed: host.isPersistentQuestionCard(existing.card) ? false : event.source !== "user" && event.source !== "timeout",
                // nobody answered in time: the pill reads Expired, not Declined
                ...(event.source === "timeout" ? { expired: true, options: [] } : {}),
                // allowed and the person saved this card's rule first (Always allow)
                ...(event.behavior === "allow" && existing.card.allowKey?.startsWith("mcp:")
                  && waiting && host.botForThread(waiting.id, event.threadId)?.alwaysAllow?.includes(existing.card.allowKey) ? { alwaysAllowed: existing.card.allowKey } : {})
              }
            });
          }
        }
        if (event.requestId) host.askMessageByRequest.delete(`${event.threadId}:${event.requestId}`);
      }
      break;
    }
  }
}

/** #4250 (S9): how a resolved request's card ended, for the signal ledger:
 * answered only when a person answered it (their own card, from the chat,
 * or a teammate's answer), expired on its timeout, retired otherwise (the
 * driver cancelled it, a rule or Full access settled it, a cap or an
 * unknown tool closed it). */
const PERSON_SOURCES: ReadonlySet<string> = new Set(["user", "chat", "own", "peer"]);
export function requestOutcome(source: unknown): "answered" | "expired" | "retired" {
  if (source === "timeout") return "expired";
  return typeof source === "string" && PERSON_SOURCES.has(source) ? "answered" : "retired";
}
