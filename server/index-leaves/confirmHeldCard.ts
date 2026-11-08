// @ts-nocheck
/** confirmHeldCard (#1388). Pure move from server/index.ts. */
import { randomUUID } from "node:crypto";
import { wholeCallDigest } from "../approvals/owner-approval.ts";
import { openSafetyHold } from "../safety/safety-review.ts";
import { HELD_NOTE } from "../approvals/auto-approve.ts";
export type Host = Record<string, any>;

export function createConfirmHeldCard(getHost: () => Host): any {
async function confirmHeldCard(request: { threadId?: string; botId?: string; tool?: string; summary: string; allowKey?: string; fingerprint?: string; toolInput?: string; ruleDescription?: string; toolHints?: { product: string; productId: string } }) {
  const host = getHost();
  const { DATA_DIR, appendDecision, deliverableNotification } = host;

  const threadId = request.threadId;
  if (!threadId) return "deny";
  const bot = (request.botId ? host.store.bot(request.botId) : undefined) ?? host.store.botByThread(threadId);
  const summary = request.summary.replace(/\s+/g, " ").trim().slice(0, 500);
  // 2026-10-19 ("Toujours permettre" on every card): Always allow keeps
  // this exact held action (its fingerprint) for this bot; kept, it passes
  // and the journal names the rule
  // #2091: a held action without a fingerprint keeps the digest of its summary
  const fingerprint = request.fingerprint ?? wholeCallDigest(summary || request.tool || "action");
  const candidate = { tool: `safety:${request.tool ?? "action"}`, scope: { action: fingerprint }, description: request.ruleDescription ?? (summary || "This exact action") };
  const kept = bot ? host.keptCardRule(bot, threadId, candidate, host.autoAnswerStepUp(bot, threadId, { tool: request.tool ?? "action", summary })) : undefined;
  if (bot && kept) {
    appendDecision(DATA_DIR, { threadId, requestId: `safety-rule-${randomUUID()}`, botId: bot.id, botName: bot.name, tool: request.tool ?? "action", summary, decision: "auto-approved", source: "owner-rule", rule: kept.id });
    return "allow";
  }
  // QA 0.8.67 G5: the hold belongs to this conversation's turn; when the
  // turn ends (turn.completed) it is retired and the card marked expired.
  const held = openSafetyHold(undefined, { threadId, ...(bot?.id ? { botId: bot.id } : {}) });
  // never reached at Full (safety-review.ts reads the turn's level);
  // full-access: safety-confirm
  const message = host.store.appendMessage(threadId, {
    role: "bot",
    kind: "options",
    card: {
      title: "Approval needed",
      subtitle: summary || "This action needs approval",
      options: ["Allow", "Deny"],
      requestId: held.requestId,
      ...(request.tool ? { tool: request.tool } : {}),
      ...(request.toolInput ? { toolInput: request.toolInput } : {}),
      ...(request.toolHints ? { toolHints: request.toolHints } : {}),
      ...(request.allowKey ? { allowKey: request.allowKey } : {}),
      held: HELD_NOTE["approval.held.native"],
      heldCode: "approval.held.native",
      ...(bot ? { ownerRule: { ...candidate, from: "hold" as const } } : {})
    }
  });
  const holdNeedsKey = Boolean(bot && host.autoAnswerStepUp(bot, threadId, { tool: request.tool ?? "action", summary }).length);
  if (bot) host.notify(deliverableNotification("approval", bot, threadId, summary, {
    ...(bot.avatarUrl ? { avatarUrl: bot.avatarUrl } : {}),
    requestId: held.requestId,
    ...(holdNeedsKey ? { needsKey: true } : {})
  }));
  const answer = await held.answer;
  if (answer === "timeout") {
    const stale = host.store.messagesFor(threadId).find((row) => row.id === message.id);
    if (stale?.card && !stale.card.answered) {
      host.store.patchMessage(threadId, message.id, {
        card: { ...stale.card, answered: "unavailable", dismissed: true, expired: true, options: [] }
      });
    }
  }
  return answer;

}
  return confirmHeldCard;
}
