// @ts-nocheck
/** proposalPersistence (#1388). Pure move from server/index.ts. */
import { safetyIsArmed } from "../safety/safety-review.ts";
export type Host = Record<string, any>;

export function createProposalPersistence(getHost: () => Host): any {
function proposalPersistence(botId: string, threadId: string, opensCard = true) {
  const host = getHost();
  const { DATA_DIR, appendDecision } = host;

  if (!host.store.bot(botId)) {
    return { ok: false as const, status: 403, error: "unknown sender" };
  }
  if (!host.connectorThread(botId, threadId)) {
    return { ok: false as const, status: 403, error: "source conversation does not belong to sender" };
  }
  if (!opensCard || host.fullAccessForSource(botId, threadId)) return { ok: true as const };
  // Only cards on the visible branch can be acted on from the composer.
  // Abandoned branches must not permanently consume the proposal quota.
  // Routine, profile, default-model and team-setup proposals
  // share one budget per bot per thread, so one thread cannot pile up 8 of each.
  const openRequests = host.store.activePath(threadId).filter(
    (message) =>
      (message.card?.routineRequest?.botId === botId || message.card?.profileRequest?.botId === botId || message.card?.modelRequest?.botId === botId || message.card?.teamSetupRequest?.botId === botId) &&
      !message.card.answered &&
      !message.card.dismissed && !message.card.expired,
  );
  // server/proposal-budget.ts: past the budget the oldest waiting cards are
  // replaced, never one under a safety hold nor a team setup card (#1059).
  const plan = host.proposalReplacements(openRequests.map((message) => ({
    message,
    held: Boolean(message.card?.requestId && safetyIsArmed(message.card.requestId)),
    teamSetup: Boolean(message.card?.teamSetupRequest)
  })));
  if (!plan.ok) return { ok: false as const, status: 429, error: plan.error };
  for (const { message } of plan.replace) {
    host.store.patchMessage(threadId, message.id, { card: { ...message.card!, answered: "deny", expired: true, options: [], held: "Replaced by a newer proposal. Nothing was applied." } });
    appendDecision(DATA_DIR, { threadId, requestId: message.card!.requestId ?? message.id, botId, tool: "proposal", summary: message.card!.title ?? "proposal", decision: "auto-denied", source: "expired" });
  }
  return { ok: true as const };

}
  return proposalPersistence;
}
