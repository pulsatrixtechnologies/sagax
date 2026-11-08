/**
 * POST /api/bots/:id/respond and /api/threads/:id/respond (#1388 B3).
 * Never imports server/index.ts.
 */
import {
  QUESTION_DISMISS_MESSAGE,
  isPersistentQuestionCard,
} from "../../shared/ask-question.ts";
import { closeDeclinedQuestion, isQuestionDecline } from "../approvals/question-decline.ts";
import { resolvePeerComms } from "../peers/peer-approval.ts";
import { personKey } from "../request-speaker.ts";
import { resolveAndSendTerminal } from "../terminal/terminal-requests.ts";
import type { BotsMessagesRouteDeps } from "./bots-messages-deps.ts";
import { PASS, type RouteContext, type RouteHandler } from "./table.ts";

function feedbackAnswer(deps: BotsMessagesRouteDeps, ctx: RouteContext, threadId: string, body: Record<string, any>): ReturnType<RouteContext["json"]> | undefined {
  const requestId = String(body.requestId ?? "");
  if (!deps.feedback?.answerCard || !requestId.startsWith("fb-")) return undefined;
  const words = String(body.message ?? body.option ?? body.text ?? "");
  const refusal = deps.cardAnswerRefusal(ctx.auth, threadId, requestId, "answer");
  if (refusal) return ctx.json(ctx.res, 403, { error: refusal });
  const answered = deps.feedback.answerCard(threadId, requestId, words, deps.actorPrincipalId?.(ctx.auth) || null);
  if (!answered) return undefined;
  return answered.ok ? ctx.json(ctx.res, 200, { ok: true }) : ctx.json(ctx.res, answered.status, { error: answered.error });
}

async function handleBotRespond(deps: BotsMessagesRouteDeps, ctx: RouteContext): Promise<typeof PASS | void> {
  const { req, res, path, method, auth, json, readBody } = ctx;
  const {
    ADMIN_APPROVAL_REQUIRED, CONFIDENTIAL_CARD_DELEGATED, adminApprovalCheck, answerRequest, answeringCardAs,
    approvalAnswerRefusal, approvalBus, botForThread, cardAnswerRefusal, cloudOwnerSession, commandRememberRefusal,
    delegatedRequest, deliverLateQuestionAnswer, isBotActCard, isConfidentialMemoryCard, requestBehavior,
    requestedTaskBot, resolveAndSendCwAction, resolveAndSendEmailDraft, resolveAndSendMeeting, resolveAndSendModel,
    resolveAndSendPhoneCallConsent, resolveAndSendProfile, resolveAndSendRoutine, resolveAndSendRule, resolveAndSendTeamSetup,
    resolveAndSendTrust, resolveImessageCard, resolveSkillRequest, routineActor, routineKeyReveal, ruleManager,
    saveOwnerRuleFromCard, sendSkillResolution, settleBotActCard, settleConfidentialMemoryCard, stepUpAnswerOf, stepUpGate,
    store, teamSetupApplyRefusal, terminalAnswerExtras, terminalFeature, terminalPrincipalId,
  } = deps;
  let m: RegExpMatchArray | null = null;

  // switch which fork of the conversation is visible (no new turn)
  m = path.match(/^\/api\/bots\/([\w-]+)\/respond$/);
  if (m && method === "POST") {
    const body = await readBody(req);
    const selected = requestedTaskBot(m[1], body.threadId);
    const bot = botForThread(selected.id, selected.threadId)!;
    const source = deps.originApprovals?.sourceFor(bot.threadId, String(body.requestId));
    if (source === false) return json(res, 409, { error: "This approval is no longer available in this conversation." });
    if (source) {
      return handleThreadRespond(deps, { ...ctx, path: `/api/threads/${source.threadId}/respond`, readBody: async () => ({ ...body, requestId: source.requestId }) });
    }
    // #2618: the Feedback bot's cards (Send / Cancel, kind, impact) are answered by its own flow
    const feedbackDone = feedbackAnswer(deps, ctx, bot.threadId, body);
    if (feedbackDone) return feedbackDone;
    const behavior = requestBehavior(body.behavior);
    const reviewedSha256 = typeof body.reviewedSha256 === "string" ? body.reviewedSha256 : undefined;
    if (!behavior) return json(res, 400, { error: "behavior must be allow, deny, or answer" });
    // The security key comes first, before any path that settles a card
    // (a bot act included): server/auth/step-up-gate.ts.
    const stepUpRefusal = stepUpGate(ruleManager(auth), bot.threadId, String(body.requestId), behavior, stepUpAnswerOf(body), body.stepUp);
    if (stepUpRefusal) return json(res, stepUpRefusal.status, stepUpRefusal.body);
    if (delegatedRequest() && store.isConfidentialThread(bot.threadId)) return json(res, 403, { error: CONFIDENTIAL_CARD_DELEGATED, code: "confidential_thread" });
    if (isConfidentialMemoryCard(bot.threadId, String(body.requestId))) {
      const settled = await settleConfidentialMemoryCard(auth, bot.threadId, String(body.requestId), behavior, body.rule === "allow" ? "allow" : undefined);
      return json(res, settled.status, settled.body);
    }
    if (isBotActCard(bot.threadId, String(body.requestId))) {
      if (body.rule !== undefined && !(body.rule === "allow" && behavior === "allow")) return json(res, 400, { error: "On this card, Always allow is the only rule." });
      const act = await settleBotActCard(auth, bot.threadId, String(body.requestId), behavior, undefined, body.rule === "allow" ? "allow" : undefined);
      return json(res, act.status, act.body);
    }
    const adminCheck = adminApprovalCheck(auth, bot.threadId, String(body.requestId));
    if (adminCheck === "refused") return json(res, 403, ADMIN_APPROVAL_REQUIRED);
    if (adminCheck && (body.always === true || body.rememberCommand === true)) return json(res, 400, { error: "On this card, Always allow keeps a rule for this bot; a session allow or a saved command is not offered." });
    const ownerRefusal = adminCheck ? null : approvalAnswerRefusal(auth, bot.threadId, String(body.requestId));
    if (ownerRefusal) return json(res, 403, { error: ownerRefusal });
    const refusal = cardAnswerRefusal(auth, bot.threadId, String(body.requestId), behavior);
    if (refusal) return json(res, 403, { error: refusal });
    if (body.rememberCommand === true) {
      const refusal = commandRememberRefusal(auth, bot.threadId, String(body.requestId), behavior);
      if (refusal) return json(res, 403, { error: refusal });
    }
    const ruleRefusal = saveOwnerRuleFromCard(auth, bot.threadId, String(body.requestId), body.rule, behavior, body.ruleScope);
    if (ruleRefusal) return json(res, ruleRefusal.status, { error: ruleRefusal.error });
    return await answeringCardAs(auth, bot.threadId, String(body.requestId), async () => {
      if (resolveAndSendTrust(res, bot.threadId, String(body.requestId), behavior)) return;
      if (await resolveAndSendCwAction(res, auth, bot.threadId, String(body.requestId), behavior)) return;
      if (await resolveAndSendEmailDraft(res, auth, bot.threadId, String(body.requestId), behavior)) return;
      if (await resolveImessageCard(res, bot.threadId, String(body.requestId), behavior)) return;
      if (await resolveAndSendTeamSetup(res, {
        botId: bot.id, threadId: bot.threadId, requestId: String(body.requestId), behavior,
      }, teamSetupApplyRefusal(auth, req))) return;
      if (resolveAndSendRoutine(res, {
        botId: bot.id,
        botName: bot.name,
        threadId: bot.threadId,
        requestId: String(body.requestId),
        behavior,
        ...routineActor(auth),
      }, auth.kind === "session" && cloudOwnerSession(auth), routineKeyReveal(auth))) return;
      if (resolveAndSendProfile(res, {
        botId: bot.id,
        botName: bot.name,
        threadId: bot.threadId,
        requestId: String(body.requestId),
        behavior,
      })) return;
      if (resolveAndSendModel(res, {
        botId: bot.id,
        botName: bot.name,
        threadId: bot.threadId,
        requestId: String(body.requestId),
        behavior,
      })) return;
      if (resolveAndSendRule(res, {
        botId: bot.id,
        botName: bot.name,
        threadId: bot.threadId,
        requestId: String(body.requestId),
        behavior,
        personId: auth.kind === "session" ? personKey(auth.session) : undefined,
      })) return;
      if (await resolveAndSendMeeting(res, auth, bot.threadId, String(body.requestId), behavior)) return;
      if (resolveAndSendPhoneCallConsent(res, auth, bot.threadId, String(body.requestId), behavior)) return;
      const terminalCardBot = store.messagesFor(bot.threadId).find(
        (message: any) => message.card?.requestId === String(body.requestId) && message.card.terminalRequest,
      );
      if (terminalCardBot?.card?.terminalRequest) {
        const principalId = terminalPrincipalId(auth);
        if (!principalId) return json(res, 401, { error: "Sign in to open a terminal." });
        if (await resolveAndSendTerminal(res, terminalFeature.requests, {
          threadId: bot.threadId,
          requestId: String(body.requestId),
          behavior,
          principalId,
          ...terminalAnswerExtras(body),
        })) return;
      }
      if (sendSkillResolution(res, resolveSkillRequest({
        botId: bot.id,
        botName: bot.name,
        threadId: bot.threadId,
        requestId: String(body.requestId),
        behavior,
        reviewedSha256,
      }))) return;
      // peer-approval intercept: harness-native cards carry a requestId
      // that lives in peer-approval's pending map. Resolve them here so
      // the provider adapter never sees a request it didn't raise.
      if (store.messagesFor(bot.threadId).some((message: any) => message.card?.requestId === String(body.requestId)) &&
        resolvePeerComms(approvalBus, String(body.requestId), behavior)) {
        return json(res, 200, { ok: true, outcome: behavior === "allow" ? "allowed-once" : "rejected" });
      }
      const requestId = String(body.requestId);
      const pending = store.messagesFor(bot.threadId).find((message: any) => message.card?.requestId === requestId);
      if (isPersistentQuestionCard(pending?.card) && (body.dismiss === true || body.message === QUESTION_DISMISS_MESSAGE)) {
        if (!pending?.card) return json(res, 404, { error: "this question is no longer available" });
        if (pending.card.answered !== "answer" || pending.card.dismissed) {
          return json(res, 409, { error: "answer this question before dismissing it" });
        }
        store.patchMessage(bot.threadId, pending.id, { card: { ...pending.card, dismissed: true } });
        return json(res, 200, { ok: true, dismissed: true });
      }
      // #2633/#2634: a declined question is told in the person's language,
      // and never becomes a message of theirs once its turn is over.
      const declined = isQuestionDecline(body, pending?.card);
      const message = declined ? (deps.questionDeclinedText?.(auth) ?? body.message) : body.message;
      const outcome = await answerRequest(bot.threadId, bot.modelSelection.instanceId, requestId, behavior, message, { id: bot.id, name: bot.name }, body.always === true, body.rememberCommand === true);
      if (outcome === "unavailable" && declined && pending) {
        const closed = closeDeclinedQuestion(store, bot.threadId, pending.id);
        return json(res, closed.status, closed.body);
      }
      if (outcome === "unavailable" && isPersistentQuestionCard(pending?.card) && behavior === "answer") {
        if (!pending) return json(res, 404, { error: "this question is no longer available" });
        const answer = typeof body.message === "string" ? body.message.trim() : "";
        if (!answer) return json(res, 400, { error: "a question answer is required" });
        try {
          const reply = await deliverLateQuestionAnswer(auth, bot.threadId, requestId, answer, pending, bot);
          return json(res, 200, { ok: true, outcome: "answered", late: true, ...(reply.queued ? { queued: true } : {}) });
        } catch (error) {
          return json(res, 409, { error: error instanceof Error ? error.message : "the late answer could not be queued" });
        }
      }
      return json(res, 200, { ok: true, outcome });
    });
  }
  return PASS;
}

async function handleThreadRespond(deps: BotsMessagesRouteDeps, ctx: RouteContext): Promise<typeof PASS | void> {
  const { req, res, path, method, auth, json, readBody } = ctx;
  const {
    ADMIN_APPROVAL_REQUIRED, CONFIDENTIAL_CARD_DELEGATED, adminApprovalCheck, answerRequest, answeringCardAs,
    approvalAnswerRefusal, approvalBus, botForThread, cardAnswerRefusal, cloudOwnerSession, commandRememberRefusal,
    delegatedRequest, deliverLateQuestionAnswer, isBotActCard, isConfidentialMemoryCard, requestBehavior,
    resolveAndSendCwAction, resolveAndSendEmailDraft, resolveAndSendMeeting, resolveAndSendModel, resolveAndSendPhoneCallConsent,
    resolveAndSendProfile, resolveAndSendRoutine, resolveAndSendRule, resolveAndSendTeamSetup, resolveAndSendTrust,
    resolveImessageCard, resolveSkillRequest, routineActor, routineKeyReveal, ruleManager, saveOwnerRuleFromCard,
    sendSkillResolution, settleBotActCard, settleConfidentialMemoryCard, stepUpAnswerOf, stepUpGate, store,
    teamSetupApplyRefusal, terminalAnswerExtras, terminalFeature, terminalPrincipalId,
  } = deps;
  let m: RegExpMatchArray | null = null;

  // Answer by THREAD, so a request raised inside a room can be answered
  // too: a member's turn runs on the room's thread, and the bot that
  // owns the pending request is the one currently speaking there.
  m = path.match(/^\/api\/threads\/([\w-]+)\/respond$/);
  if (m && method === "POST") {
    const threadId = m[1];
    const body = await readBody(req);
    const source = deps.originApprovals?.sourceFor(threadId, String(body.requestId));
    if (source === false) return json(res, 409, { error: "This approval is no longer available in this conversation." });
    if (source) {
      return handleThreadRespond(deps, { ...ctx, path: `/api/threads/${source.threadId}/respond`, readBody: async () => ({ ...body, requestId: source.requestId }) });
    }
    // #2618: the Feedback bot's cards (Send / Cancel, kind, impact) are answered by its own flow
    const feedbackDone = feedbackAnswer(deps, ctx, threadId, body);
    if (feedbackDone) return feedbackDone;
    const behavior = requestBehavior(body.behavior);
    const reviewedSha256 = typeof body.reviewedSha256 === "string" ? body.reviewedSha256 : undefined;
    if (!behavior) return json(res, 400, { error: "behavior must be allow, deny, or answer" });
    const requestId = String(body.requestId);
    const stepUpRefusal = stepUpGate(ruleManager(auth), threadId, requestId, behavior, stepUpAnswerOf(body), body.stepUp);
    if (stepUpRefusal) return json(res, stepUpRefusal.status, stepUpRefusal.body);
    // only the person, in Sagax, answers a card in a confidential thread:
    // never a bot acting for them, never an AI client
    if (delegatedRequest() && store.isConfidentialThread(threadId)) return json(res, 403, { error: CONFIDENTIAL_CARD_DELEGATED, code: "confidential_thread" });
    if (isConfidentialMemoryCard(threadId, requestId)) {
      const settled = await settleConfidentialMemoryCard(auth, threadId, requestId, behavior, body.rule === "allow" ? "allow" : undefined);
      return json(res, settled.status, settled.body);
    }
    if (isBotActCard(threadId, requestId)) {
      if (body.rule !== undefined && !(body.rule === "allow" && behavior === "allow")) return json(res, 400, { error: "On this card, Always allow is the only rule." });
      const act = await settleBotActCard(auth, threadId, requestId, behavior, undefined, body.rule === "allow" ? "allow" : undefined);
      return json(res, act.status, act.body);
    }
    const adminCheck = adminApprovalCheck(auth, threadId, requestId);
    if (adminCheck === "refused") return json(res, 403, ADMIN_APPROVAL_REQUIRED);
    if (adminCheck && (body.always === true || body.rememberCommand === true)) return json(res, 400, { error: "On this card, Always allow keeps a rule for this bot; a session allow or a saved command is not offered." });
    const ownerRefusal = adminCheck ? null : approvalAnswerRefusal(auth, threadId, requestId);
    if (ownerRefusal) return json(res, 403, { error: ownerRefusal });
    const refusal = cardAnswerRefusal(auth, threadId, requestId, behavior);
    if (refusal) return json(res, 403, { error: refusal });
    if (body.rememberCommand === true) {
      const refusal = commandRememberRefusal(auth, threadId, requestId, behavior);
      if (refusal) return json(res, 403, { error: refusal });
    }
    const ruleRefusal = saveOwnerRuleFromCard(auth, threadId, requestId, body.rule, behavior, body.ruleScope);
    if (ruleRefusal) return json(res, ruleRefusal.status, { error: ruleRefusal.error });
    return await answeringCardAs(auth, threadId, requestId, async () => {
      if (resolveAndSendTrust(res, threadId, requestId, behavior)) return;
      if (await resolveAndSendCwAction(res, auth, threadId, requestId, behavior)) return;
      if (await resolveAndSendEmailDraft(res, auth, threadId, requestId, behavior)) return;
      if (await resolveImessageCard(res, threadId, requestId, behavior)) return;
      const skillCard = store.messagesFor(threadId).find(
        (message: any) => message.card?.requestId === requestId && message.card.skillRequest,
      );
      if (skillCard?.card?.skillRequest) {
        const skillBotId = skillCard.from?.botId ?? store.botByThread(threadId)?.id;
        if (!skillBotId) return json(res, 400, { error: "this skill request has no valid owner" });
        const skillOwner = store.bot(skillBotId);
        if (sendSkillResolution(res, resolveSkillRequest({
          botId: skillBotId,
          botName: skillOwner?.name,
          threadId,
          requestId,
          behavior,
          reviewedSha256,
        }))) return;
      }
      if (await resolveAndSendMeeting(res, auth, threadId, requestId, behavior)) return;
      if (resolveAndSendPhoneCallConsent(res, auth, threadId, requestId, behavior)) return;
      const terminalCard = store.messagesFor(threadId).find(
        (message: any) => message.card?.requestId === requestId && message.card.terminalRequest,
      );
      if (terminalCard?.card?.terminalRequest) {
        const principalId = terminalPrincipalId(auth);
        if (!principalId) return json(res, 401, { error: "Sign in to open a terminal." });
        if (await resolveAndSendTerminal(res, terminalFeature.requests, {
          threadId,
          requestId,
          behavior,
          principalId,
          ...terminalAnswerExtras(body),
        })) return;
      }
      const routineCard = store.messagesFor(threadId).find(
        (message: any) => message.card?.requestId === requestId && message.card.routineRequest,
      );
      if (routineCard?.card?.routineRequest) {
        // Derive the owner from the conversation, not from the executable
        // payload being authorized. Room cards carry their trusted sender;
        // one-to-one tasks resolve through the store's thread ownership.
        const routineBotId = routineCard.from?.botId ?? store.botByThread(threadId)?.id;
        if (!routineBotId) return json(res, 400, { error: "this routine request has no valid owner" });
        const routineOwner = store.bot(routineBotId);
        if (resolveAndSendRoutine(res, {
          botId: routineBotId,
          botName: routineOwner?.name,
          threadId,
          requestId,
          behavior,
          ...routineActor(auth),
        }, auth.kind === "session" && cloudOwnerSession(auth), routineKeyReveal(auth))) return;
      }
      const setupCard = store.messagesFor(threadId).find((message: any) => message.card?.requestId === requestId && message.card.teamSetupRequest);
      if (setupCard) {
        const setupBotId = setupCard.from?.botId ?? store.botByThread(threadId)?.id;
        if (!setupBotId) return json(res, 400, { error: "This team setup has no valid owner" });
        if (await resolveAndSendTeamSetup(res, { botId: setupBotId, threadId, requestId, behavior }, teamSetupApplyRefusal(auth, req))) return;
      }
      const profileCard = store.messagesFor(threadId).find(
        (message: any) => message.card?.requestId === requestId && message.card.profileRequest,
      );
      if (profileCard?.card?.profileRequest) {
        const profileBotId = profileCard.from?.botId ?? store.botByThread(threadId)?.id;
        if (!profileBotId) return json(res, 400, { error: "this profile request has no valid owner" });
        const profileOwner = store.bot(profileBotId);
        if (resolveAndSendProfile(res, {
          botId: profileBotId,
          botName: profileOwner?.name,
          threadId,
          requestId,
          behavior,
        })) return;
      }
      const modelCard = store.messagesFor(threadId).find(
        (message: any) => message.card?.requestId === requestId && message.card.modelRequest,
      );
      if (modelCard?.card?.modelRequest) {
        const modelBotId = modelCard.from?.botId ?? store.botByThread(threadId)?.id;
        if (!modelBotId) return json(res, 400, { error: "this model request has no valid owner" });
        const modelOwner = store.bot(modelBotId);
        if (resolveAndSendModel(res, {
          botId: modelBotId,
          botName: modelOwner?.name,
          threadId,
          requestId,
          behavior,
        })) return;
      }
      const ruleCard = store.messagesFor(threadId).find(
        (message: any) => message.card?.requestId === requestId && message.card.ruleRequest,
      );
      if (ruleCard?.card?.ruleRequest) {
        const ruleBotId = ruleCard.from?.botId ?? store.botByThread(threadId)?.id;
        if (!ruleBotId) return json(res, 400, { error: "this approval-rule request has no valid owner" });
        const ruleOwner = store.bot(ruleBotId);
        if (resolveAndSendRule(res, {
          botId: ruleBotId,
          botName: ruleOwner?.name,
          threadId,
          requestId,
          behavior,
          personId: auth.kind === "session" ? personKey(auth.session) : undefined,
        })) return;
      }
      // peer-approval intercept (see /api/bots/:id/respond above). A peer card
      // belongs to the bus rather than to a speaker, so resolve it before we go
      // looking for one — a room between turns has no speaker to find.
      if (store.messagesFor(threadId).some((message: any) => message.card?.requestId === requestId) &&
        resolvePeerComms(approvalBus, requestId, behavior)) {
        return json(res, 200, { ok: true, outcome: behavior === "allow" ? "allowed-once" : "rejected" });
      }
      const group = store.groupByThread(threadId);
      // busyBotId is in-memory only, so an approval that outlives its turn — or
      // the process — leaves a durable card with no speaker behind it. Fall back
      // to the member that raised it, and answer even when that member is gone:
      // answerRequest closes an unreachable card, and a pending approval owns
      // the composer, so a dead end here locks the room for good.
      const pending = store.messagesFor(threadId).find((message: any) => message.card?.requestId === requestId);
      if (isPersistentQuestionCard(pending?.card) && (body.dismiss === true || body.message === QUESTION_DISMISS_MESSAGE)) {
        if (!pending?.card) return json(res, 404, { error: "this question is no longer available" });
        if (pending.card.answered !== "answer" || pending.card.dismissed) {
          return json(res, 409, { error: "answer this question before dismissing it" });
        }
        store.patchMessage(threadId, pending.id, { card: { ...pending.card, dismissed: true } });
        return json(res, 200, { ok: true, dismissed: true });
      }
      const persistentQuestion = isPersistentQuestionCard(pending?.card);
      const owner = group
        ? persistentQuestion
          ? (pending?.from ? store.bot(pending.from.botId) : undefined)
          : (group.busyBotId ? store.bot(group.busyBotId) : undefined) ??
            (pending?.from ? store.bot(pending.from.botId) : undefined)
        : store.botByThread(threadId);
      // A surviving question belongs to its original asker, never a later speaker.
      if (group && persistentQuestion && !owner) {
        return json(res, 409, { error: "the bot that asked this question is no longer available" });
      }
      if (!owner && !pending) return json(res, 404, { error: "nothing is waiting on an answer in this conversation" });
      const requestOwner = owner ? botForThread(owner.id, threadId) : null;
      // #2633/#2634: a declined question is told in the person's language,
      // and never becomes a message of theirs once its turn is over.
      const declined = isQuestionDecline(body, pending?.card);
      const message = declined ? (deps.questionDeclinedText?.(auth) ?? body.message) : body.message;
      const outcome = await answerRequest(threadId, requestOwner?.modelSelection.instanceId ?? "", requestId, behavior, message, owner ? { id: owner.id, name: owner.name } : undefined, body.always === true, body.rememberCommand === true);
      if (outcome === "unavailable" && declined && pending) {
        const closed = closeDeclinedQuestion(store, threadId, pending.id);
        return json(res, closed.status, closed.body);
      }
      if (outcome === "unavailable" && isPersistentQuestionCard(pending?.card) && behavior === "answer") {
        if (!pending?.card) return json(res, 404, { error: "this question is no longer available" });
        const answer = typeof body.message === "string" ? body.message.trim() : "";
        if (!answer) return json(res, 400, { error: "a question answer is required" });
        if (!owner) return json(res, 409, { error: "the bot that asked this question is no longer available" });
        try {
          const reply = await deliverLateQuestionAnswer(auth, threadId, requestId, answer, pending, owner);
          return json(res, 200, { ok: true, outcome: "answered", late: true, ...(reply.queued ? { queued: true } : {}) });
        } catch (error) {
          return json(res, 409, { error: error instanceof Error ? error.message : "the late answer could not be queued" });
        }
      }
      return json(res, 200, { ok: true, outcome });
    });
  }
  return PASS;
}

export function createBotsMessagesBotRespondRoutes(deps: BotsMessagesRouteDeps): RouteHandler {
  return (ctx) => handleBotRespond(deps, ctx);
}

export function createBotsMessagesThreadRespondRoutes(deps: BotsMessagesRouteDeps): RouteHandler {
  return (ctx) => handleThreadRespond(deps, ctx);
}
