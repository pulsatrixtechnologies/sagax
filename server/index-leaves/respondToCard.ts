// @ts-nocheck
/** respondToCard (#1388). Pure move from server/index.ts. */
import { resolvePeerComms } from "../peers/peer-approval.ts";
export type Host = Record<string, any>;

export function createRespondToCard(getHost: () => Host): any {
async function respondToCard(input: {   auth: RequestAuth;   threadId: string;   requestId: string;   behavior: "allow" | "deny" | "answer";   message?: string;   /** The Live call a spoken answer was given on: a late answer's line carries it. */   callId?: string; }) {
  const host = getHost();

  const { auth, behavior, message, callId } = input;
  const source = host.originApprovals.sourceFor(input.threadId, input.requestId);
  if (source === false) return { ok: false, status: 409, error: "This approval is no longer available in this conversation." };
  const threadId = source ? source.threadId : input.threadId;
  const requestId = source ? source.requestId : input.requestId;
  // A call outlives the request that started it: the session must still be valid.
  if (auth.kind === "session" && !host.sessions.isLive(auth.session.id)) {
    return { ok: false, status: 401, error: "The session that started this call has ended." };
  }
  // A spoken Allow carries no security key: a card that needs one (a bot
  // act included) is answered on screen or on the phone, never by voice.
  if (host.stepUpGate(host.ruleManager(auth), threadId, requestId, behavior, {}, undefined)) {
    return { ok: false, status: 403, error: "This approval needs your security key. Approve it on screen." };
  }
  if (host.isBotActCard(threadId, requestId)) {
    const act = await host.settleBotActCard(auth, threadId, requestId, behavior, "call");
    if (act.status >= 400) {
      const error = typeof act.body.error === "string" ? act.body.error : "The request is no longer open.";
      return { ok: false, status: act.status, error };
    }
    return { ok: true };
  }
  const refusal = host.cardAnswerRefusal(auth, threadId, requestId, behavior);
  if (refusal) return { ok: false, status: 403, error: refusal };
  // Security review 2026-10-19 (pre-existing): a spoken answer meets the
  // same answerer rules as the screen: an admin's card for an admin, any
  // other card for the person who answers it.
  const liveAdminCheck = host.adminApprovalCheck(auth, threadId, requestId);
  if (liveAdminCheck === "refused") return { ok: false, status: 403, error: host.ADMIN_APPROVAL_REQUIRED.error };
  const liveOwnerRefusal = liveAdminCheck ? null : host.approvalAnswerRefusal(auth, threadId, requestId);
  if (liveOwnerRefusal) return { ok: false, status: 403, error: liveOwnerRefusal };
  const bot = host.store.botByThread(threadId);
  if (!bot) return { ok: false, status: 404, error: "The chat is gone." };
  const cardMessage = host.store.messagesFor(threadId).find((candidate) => candidate.card?.requestId === requestId);
  const card = cardMessage?.card;
  // Refused before anything runs: answerRequest would close a proposal it
  // cannot deliver as "unavailable", and would add a false "not run" line to
  // a card someone settled on screen a moment ago.
  const refused = host.liveDecisionRefusal(card);
  if (refused) return { ok: false, status: 409, error: refused };
  let result: CardRespondResult = { ok: true };
  await host.answeringCardAs(auth, threadId, requestId, async () => {
    // 2026-10-27 (#1098): a proposal (routine, profile, default model, team
    // setup, a meeting) decided by voice goes to its own resolver, as the
    // screen's /respond route sends it (a key it needs was asked above)
    if (card && host.liveProposal(card) && behavior !== "answer") {
      result = await host.resolveLiveProposal(auth, bot, threadId, requestId, behavior);
      return;
    }
    // peer-approval intercept, as the route: only a card on this thread
    if (card && resolvePeerComms(host.approvalBus, requestId, behavior)) return;
    if (card?.terminalRequest) {
      const principalId = host.terminalPrincipalId(auth);
      if (!principalId) {
        result = { ok: false, status: 401, error: "Sign in to open a terminal." };
        return;
      }
      const settled = await host.terminalFeature.requests.resolve({ threadId, requestId, behavior, principalId });
      if (!settled.claimed) {
        result = { ok: false, status: 409, error: "The request is no longer open." };
        return;
      }
      if ("status" in settled && settled.status) {
        result = { ok: false, status: settled.status, error: settled.error };
        return;
      }
      return;
    }
    const outcome = await host.answerRequest(
      threadId, host.botForThread(bot.id, threadId)?.modelSelection.instanceId ?? "", requestId, behavior, message,
      { id: bot.id, name: bot.name },
    );
    if (outcome === "unavailable" && host.isPersistentQuestionCard(card) && behavior === "answer" && cardMessage) {
      const answer = message?.trim() ?? "";
      if (!answer) {
        result = { ok: false, status: 400, error: "A question answer is required." };
      } else if (auth.kind === "session" && !host.sessions.isLive(auth.session.id)) {
        result = { ok: false, status: 401, error: "The session that started this call has ended." };
      } else {
        try {
          await host.deliverLateQuestionAnswer(auth, threadId, requestId, answer, cardMessage, bot, "call", callId);
        } catch (error) {
          result = { ok: false, status: 409, error: error instanceof Error ? error.message : "The late answer could not be queued." };
        }
      }
    } else if (outcome === "unavailable") {
      result = { ok: false, status: 409, error: "The request is no longer open." };
    } else if (behavior === "answer" && outcome !== "answered") {
      result = { ok: false, status: 409, error: "The provider did not accept that answer. Try an offered option." };
    }
  }, "call");
  return result;

}
  return respondToCard;
}
