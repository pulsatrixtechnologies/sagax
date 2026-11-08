// @ts-nocheck
/** answerRequest (#1388). Pure move from server/index.ts. */
import { cardStandingGrants } from "../exec-target.ts";
import { ANSWER_NOT_DELIVERED } from "../../shared/restart-words.ts";
export type Host = Record<string, any>;

export function createAnswerRequest(getHost: () => Host): any {
async function answerRequest(   threadId: string,   instanceId: string,   requestId: string,   behavior: "allow" | "deny" | "answer",   message?: string,   decidedFor?: { id: string; name: string },   /** "Always allow this session": the provider keeps the allow, not the app */   always?: boolean,   rememberCommand?: boolean, ) {
  const host = getHost();
  const { DATA_DIR, appendDecision } = host;

  // The engine is on the owner's computer, including a channel thread that
  // has no bot of its own. Record the decision for that worker. This server
  // does not run the tool.
  const pendingMachine = host.machineApprovals.get(requestId);
  if (pendingMachine && pendingMachine.threadId === threadId && !pendingMachine.behavior) {
    pendingMachine.behavior = behavior;
    if (message) pendingMachine.message = message;
    const open = host.store.messagesFor(threadId).find((row) => row.card?.requestId === requestId);
    if (open?.card && !open.card.answered) {
      host.store.patchMessage(threadId, open.id, { card: { ...open.card, answered: behavior, ...(message ? { answeredText: message } : {}) } });
    }
    return behavior === "allow" ? "allowed-once" : behavior === "deny" ? "rejected" : "answered";
  }
  // A member's bot on an organization server takes no session allow (the
  // engine's own suggestion could reach past the bot) and no entry in the
  // installation's saved command list (below, after the card is read). Its Always allow is an owner rule
  // for this bot (saveOwnerRuleFromCard, 2026-10-21: the program on an
  // admin's card), which the bot's owner or an admin may remove.
  // Snapshot the card BEFORE delivering the answer: a delivered answer
  // resolves the request synchronously through the fold, which consumes
  // the askMessageByRequest entry — by the time the await returns, nobody
  // remembers which tool this requestId was about.
  const thread = host.store.messagesFor(threadId);
  const cardMessageId = host.askMessageByRequest.get(`${threadId}:${requestId}`);
  // The map is an in-flight optimization and disappears on restart; the
  // durable transcript still carries the request id and its audit metadata.
  const cardMessage = cardMessageId
    ? thread.find((m) => m.id === cardMessageId)
    : thread.find((m) => m.card?.requestId === requestId);
  const card = cardMessage?.card;
  // 2026-10-27 (#1098): except for a command in the person's own sandbox
  // (`ownSandbox` on the card), which is theirs: there the session allow
  // and the saved command are offered to the owner like on a solo bot.
  const decidingBot = decidedFor ? host.store.bot(decidedFor.id) : undefined;
  if (decidingBot && !cardStandingGrants({ memberOwned: host.memberOwnedInOrg(decidingBot), ownSandbox: card?.ownSandbox === true, callerManagesHostCommands: false }).offered) {
    always = false;
    rememberCommand = false;
  }
  const remembered = rememberCommand ? host.pendingCommandRules.get(`${threadId}:${requestId}`) : undefined;
  // Cloud routing and a model change can differ from the bot's current
  // settings. The live turn owns this question, just as it owns Stop/steer.
  const instance = host.runningTurnEngines.get(threadId) ?? host.registry.get(instanceId);
  let outcome: RequestOutcome = "unavailable";
  if (instance) {
    try {
      // Only a card that offered "Always allow this session" can keep one:
      // never a guest's turn, a sandbox widening or the person's own computer.
      outcome = await instance.adapter.respondToRequest(threadId, requestId, { behavior, message, always: always && behavior === "allow" && card?.allowSession === true });
    } catch {
      outcome = "unavailable";
    }
  }
  // a remote_session_exec that does more than read: the route runs it once
  if (outcome === "allowed-once" && behavior === "allow") host.grantRemoteExecApproval(threadId, requestId);
  if (remembered && outcome === "allowed-once" && behavior === "allow" && host.store.bot(remembered.botId)) {
    // Persist only after the provider accepted this exact live request. A dead
    // card, denied request, failed delivery or process restart saves no grant.
    try {
      host.commandAllowlist.add(remembered.botId, remembered.candidate);
    } catch {
      host.store.appendMessage(threadId, { role: "bot", kind: "activity", tool: {
        name: "Command allowed once, but its allowlist rule could not be saved. Try again from the permissions menu.", ok: false
      } });
    }
  }
  // An answered question keeps its words. `request.resolved` only records
  // the behavior, so without this the card reads "answer" forever and the
  // person can no longer see what they told the bot.
  if (outcome === "answered" && behavior === "answer" && message && cardMessage) {
    const settled = host.store.messagesFor(threadId).find((m) => m.id === cardMessage.id)?.card;
    if (settled) {
      // The composer reads `answered` to drop its "answer the question"
      // placeholder: an answered question is settled even when the fold
      // has not marked it yet (or never does for this card).
      host.store.patchMessage(threadId, cardMessage.id, { card: { ...settled, answered: settled.answered ?? "answer", answeredText: message } });
    }
  }
  // The human's verdict, recorded only when it actually reached the engine:
  // `unavailable` means the action never ran, and a "user-approved" row
  // over a request nothing answered would be the audit log lying. A
  // question's `answer` is conversation, not authorization, so it is not a
  // decision either.
  if (outcome !== "unavailable" && behavior !== "answer") {
    appendDecision(DATA_DIR, {
      threadId,
      requestId,
      botId: decidedFor?.id,
      botName: decidedFor?.name,
      tool: card?.tool,
      summary: card?.subtitle,
      decision: behavior === "allow" ? "user-approved" : "user-denied",
      source: "user"
    });
  }
  if (outcome === "unavailable") {
    // The in-flight map is memory-only. After a restart the card is still on
    // the thread, so fall back to the request it carries — otherwise an
    // unreachable approval is never closed and keeps owning the composer.
    const messageId = host.askMessageByRequest.get(`${threadId}:${requestId}`);
    const thread = host.store.messagesFor(threadId);
    const existing = messageId
      ? thread.find((m) => m.id === messageId)
      : thread.find((m) => m.card?.requestId === requestId);
    const persistentQuestion = host.isPersistentQuestionCard(existing?.card);
    if (existing?.card && !existing.card.answered && !persistentQuestion) {
      host.store.patchMessage(threadId, existing.id, { card: { ...existing.card, answered: "unavailable", dismissed: true } });
    }
    if (messageId) host.askMessageByRequest.delete(`${threadId}:${requestId}`);
    // The card's own answered state gates the message too: a replayed respond
    // for a card that already settled must not read as a failed delivery —
    // nothing was lost, the earlier answer already ran.
    if (!persistentQuestion && !existing?.card?.answered) host.store.appendMessage(threadId, {
      role: "bot",
      kind: "activity",
      tool: { name: ANSWER_NOT_DELIVERED, ok: false }
    });
  }
  return outcome;

}
  return answerRequest;
}
