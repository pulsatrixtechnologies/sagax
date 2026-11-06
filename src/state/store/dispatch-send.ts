import type { Action, Bot } from "./model";
import { currentTaskBot } from "./model";
import { api } from "./api";
import { readableError } from "@/lib/plain-error";
import { singleStreamTurnField } from "@/lib/thread-preferences";
import { noteNewChatTopic } from "@/lib/fresh-topic";
import { beginLocalSend, claimInFlightSend, finishSend } from "@/lib/send-cancel";
import { restoreComposerDraft } from "@/lib/drafts";
import { answerResponse, dismissResponse } from "@/lib/card-answer";
import { t } from "@/lib/i18n";
import { voiceCallId } from "@/lib/call";
import { devPodsTurnField } from "@/components/dev-pods/prefs";
import { teamMemorySettled } from "@/lib/team-memory-settled";
import { proactiveProposalAccepts } from "../../../shared/proactive-proposal";
import { reviewedSkillSha256, skillRequestBehavior } from "../../../shared/skill-request";
import { terminalRequestBehavior } from "../../../shared/terminal-request";
import { meetingRequestBehavior } from "../../../shared/meeting-request";
import { phoneCallConsentBehavior } from "../../../shared/phone-call-consent";
import type { DispatchEnv } from "./dispatch-types";

/** The fresh topic creations a message waits on (makeFreshTopic). */
const freshTopicsSent = new WeakSet<Promise<string>>();

export function dispatchSendEffects(action: Action, env: DispatchEnv): void {
  const {
    rawDispatch, stateRef, showError, botPatchQueue, threadPages, freshTopicsCreating, navigation,
    cardTarget, persistCard, waitForExecutionSettings, dispatch, executionBotsBeforeAction,
    quizBeforeSend, freshSendBefore, botBeforeSend, leafBeforeEdit,
  } = env;
  // The fresh topic of a bot made on the server (src/lib/fresh-topic.ts):
  // at New topic (createFreshTopic) or with the first message, once. `sent`
  // marks a creation a message waits on.
  const makeFreshTopic = (botId: string, sent: boolean): Promise<string> => {
    const pending = freshTopicsCreating.get(botId);
    if (pending) {
      if (sent) freshTopicsSent.add(pending);
      return pending;
    }
    // asked for (New chat), not put there by coming back
    const askedNewChat = stateRef.current.freshTopic[botId]?.auto === false;
    const covered = stateRef.current.freshTopic[botId]?.threadId;
    const revision = (navigation.get(botId) ?? 0) + 1;
    navigation.set(botId, revision);
    const creating: Promise<string> = botPatchQueue.flush(botId)
      .then(() => api<{ bot: Bot; task?: { threadId?: string } }>(`/api/bots/${botId}/tasks`, { method: "POST", body: JSON.stringify({ stream: true }) }))
      .then((r) => {
        const created = r?.task?.threadId ?? r?.bot?.threadId;
        if (!r?.bot || !created) throw new Error(t("stream.freshFailed"));
        // Back pressed while New topic was being made, nothing sent: the
        // person is on the topic they went back to, the empty one goes.
        const draft = stateRef.current.freshTopic[botId];
        if (!freshTopicsSent.has(creating) && created !== covered && (!draft || draft.threadId !== covered)) {
          dispatch({ type: "deleteTask", botId, threadId: created });
          return created;
        }
        if (Array.isArray(r.bot.messages)) threadPages.set(r.bot.threadId, { messages: r.bot.messages, hasMore: r.bot.hasMore, activeLeafId: r.bot.activeLeafId, at: Date.now() });
        // New chat: the topic opens on its own, never under the
        // earlier ones drawn back above it (src/lib/fresh-topic.ts).
        if (askedNewChat) noteNewChatTopic(created);
        if (navigation.get(botId) === revision) dispatch({ type: "taskSwitched", bot: r.bot });
        rawDispatch({ type: "freshTopic", botId, threadId: null });
        return created;
      })
      .finally(() => freshTopicsCreating.delete(botId));
    if (sent) freshTopicsSent.add(creating);
    freshTopicsCreating.set(botId, creating);
    return creating;
  };
  switch (action.type) {
        case "createFreshTopic": {
          // Only an asked-for New topic still drawn: a return after a while
          // stays a draft until the person writes (src/lib/fresh-topic.ts).
          if (stateRef.current.freshTopic[action.botId]?.auto !== false) break;
          // A failure leaves the draft: the first message makes it then.
          makeFreshTopic(action.botId, false).catch(() => {});
          break;
        }
        case "send": {
          // persist through the existing card route so an older server that
          // does not auto-dismiss still hides the quiz on this client
          if (quizBeforeSend) persistCard(action.botId, quizBeforeSend.id, { dismissed: true });
          // The first message of a fresh topic (src/lib/fresh-topic.ts): the
          // server creates the topic now unless New topic already did, then
          // the message goes there.
          if (freshSendBefore) {
            const { replyToId: _reply, ...rest } = action;
            // A second message typed while the topic is being made waits
            // for it and goes there too: one topic, never two.
            const creating = makeFreshTopic(action.botId, true);
            creating
              .then((threadId) => dispatch({ ...rest, threadId }))
              .catch((error) => {
                showError(error);
                action.onError?.();
              });
            break;
          }
          const threadId =
            action.threadId ?? stateRef.current.bots.find((bot) => bot.id === action.botId)?.threadId;
          const sendId = action.sendId ?? crypto.randomUUID();
          beginLocalSend(sendId);
          // words typed to a bot that is on a voice call are a call turn too:
          // its answer is read aloud like the rest of the call
          const liveCallId = voiceCallId(action.botId);
          const voiceCall = action.voiceCall ?? (liveCallId ? { callId: liveCallId } : undefined);
          // on a call, words said or typed while the bot works join its turn
          const busyMode = voiceCall ? undefined : action.busyMode;
          void waitForExecutionSettings(botBeforeSend ? [botBeforeSend] : [], threadId)
            .then(() => {
              if (!claimInFlightSend(sendId)) {
                if (threadId) rawDispatch({ type: "optimisticMessageRemoved", threadId, sendId });
                restoreComposerDraft(`bot:${action.botId}:${threadId ?? ""}`, { text: action.text, attachments: [] });
                return null;
              }
              return api(`/api/bots/${action.botId}/messages`, {
                method: "POST",
                body: JSON.stringify({ text: action.text, replyToId: action.replyToId, threadId, sendId, ...(action.mode === "goal" ? { mode: "goal" } : {}), ...(voiceCall ? { voiceCall } : {}), ...(busyMode === "auto" ? { routeWhileBusy: true } : busyMode ? { busyMode } : {}), ...(action.dataContext ? { dataContext: action.dataContext } : {}), ...(typeof action.perspicaxRole === "string" ? { perspicaxRole: action.perspicaxRole } : {}), ...devPodsTurnField(), ...singleStreamTurnField() }),
              });
            })
            .then((body) => {
              if (body === null) return;
              action.onSent?.();
              if (body?.message && typeof body.threadId === "string") {
                rawDispatch({ type: "messageAdded", threadId: body.threadId, message: body.message });
              }
              if (
                body?.queued &&
                typeof body.threadId === "string" &&
                typeof body.queueId === "string"
              ) {
                rawDispatch({
                  type: "optimisticMessageRemoved",
                  threadId: body.threadId,
                  sendId,
                });
                rawDispatch({
                  type: "pendingQueued",
                  threadId: body.threadId,
                  queueId: body.queueId,
                  text: action.text,
                  reason: body.reason === "capacity" || body.reason === "group-turn" ? body.reason : undefined,
                });
              }
            })
            .catch((error) => {
              if (threadId) {
                rawDispatch({ type: "optimisticMessageRemoved", threadId, sendId });
              }
              showError(error);
              action.onError?.();
            })
            .finally(() => finishSend(sendId));
          break;
        }
        case "stopParallelTask":
          api(`/api/bots/${action.botId}/parallel/${action.threadId}/stop`, { method: "POST", body: "{}" }).catch(showError);
          break;
        case "editMessage": {
          const threadId =
            action.threadId ?? stateRef.current.bots.find((bot) => bot.id === action.botId)?.threadId;
          const sendId = action.sendId ?? crypto.randomUUID();
          void waitForExecutionSettings(executionBotsBeforeAction, threadId)
            .then(() => api(`/api/bots/${action.botId}/messages/${action.messageId}/edit`, {
              method: "POST",
              body: JSON.stringify({ text: action.text.trim(), threadId, sendId, ...devPodsTurnField(), ...singleStreamTurnField() }),
            }))
            .then((body) => {
              // the POST may beat its SSE frames; fold the fork either way
              if (body?.message && threadId) {
                rawDispatch({ type: "messageAdded", threadId, message: body.message });
              }
            })
            .catch((error) => {
              if (threadId) {
                rawDispatch({ type: "optimisticMessageRemoved", threadId, sendId, restoreLeafId: leafBeforeEdit });
              }
              showError(error);
            });
          break;
        }
        case "switchBranch":
          api(`/api/bots/${action.botId}/active-branch`, {
            method: "POST",
            body: JSON.stringify({ messageId: action.messageId, threadId: action.threadId }),
          }).catch(showError);
          break;
        case "decideRequest": {
          const respond = () =>
            api(`/api/threads/${action.threadId}/respond`, {
              method: "POST",
              body: JSON.stringify({
                requestId: action.requestId,
                behavior: action.behavior,
                message: action.message,
                reviewedSha256: action.reviewedSha256,
                always: action.always,
                rememberCommand: action.rememberCommand,
                rule: action.rule,
                ...(action.ruleScope ? { ruleScope: action.ruleScope } : {}),
              }),
            });
          void waitForExecutionSettings(executionBotsBeforeAction, action.threadId)
            .then(async () => {
              if (action.alwaysAllow) {
                const bot = stateRef.current.bots.find((candidate) => candidate.id === action.alwaysAllow?.botId);
                // a bot-to-bot conversation (even one left out of tasks) keeps
                // its grant on that thread, never the whole bot
                const owner = bot?.tasks?.some((task) => task.threadId === action.threadId)
                  || bot?.waitingApprovals?.some((row) => row.threadId === action.threadId);
                const next = [...new Set([...(bot ? currentTaskBot(bot, action.threadId).alwaysAllow ?? [] : []), action.alwaysAllow.key])];
                // Save the grant BEFORE releasing the bot: it may ask again
                // within milliseconds. A failed preference save must still
                // let this one response through, but the person should see it.
                try {
                  await api(owner ? `/api/bots/${action.alwaysAllow.botId}/always-allow` : `/api/bots/${action.alwaysAllow.botId}`, {
                    method: owner ? "POST" : "PATCH",
                    body: JSON.stringify(owner ? { threadId: action.threadId, allowKey: action.alwaysAllow.key } : { alwaysAllow: next }),
                  });
                } catch (error) {
                  showError(error);
                }
              }
              const response = await respond();
              if (response?.settlementPending && typeof response.message === "string") {
                showError(new Error(response.message));
              }
            })
            .catch((error) => {
              // settled already, elsewhere: the card shows the real outcome
              const settled = teamMemorySettled(error);
              if (settled) {
                rawDispatch({ type: "cardSettled", threadId: action.threadId, requestId: action.requestId, patch: settled.card });
                showError(settled.text);
                action.onError?.(settled.text);
                return;
              }
              // A settings flush failure deliberately stops the response;
              // otherwise it could resume work under a stale approval level.
              showError(error);
              action.onError?.(readableError(error));
            });
          break;
        }
        case "answerCard": {
          const { host, card, inRoom } = cardTarget(action);
          // 2026-10-30: a proactive proposal answers on its own route: yes
          // starts the bot's wake, no closes the card; never a typed message
          if (card?.proactiveProposal && !inRoom) {
            api(`/api/bots/${action.botId}/proactive/${card.proactiveProposal.id}`, {
              method: "POST",
              body: JSON.stringify({ accept: proactiveProposalAccepts(card, action.answer) }),
            }).catch(showError);
            break;
          }
          void waitForExecutionSettings(executionBotsBeforeAction, action.threadId)
            .then(() => {
              if (card?.requestId && host) {
                // allow/deny for a permission, the chosen text for a question
                // — decided from the card, never from the label (see
                // card-answer.ts). By THREAD, so a card raised inside a room
                // answers the same way a 1:1 one does.
                const response = card.skillRequest
                  ? { behavior: skillRequestBehavior(action.answer) }
                  : card.terminalRequest
                    ? { behavior: terminalRequestBehavior(action.answer) }
                    : card.meetingRequest
                      ? { behavior: meetingRequestBehavior(action.answer) }
                      : card.phoneCallConsent
                        ? { behavior: phoneCallConsentBehavior(action.answer) }
                        : answerResponse(card, action.answer);
                return api(`/api/threads/${action.threadId ?? host.threadId}/respond`, {
                  method: "POST",
                  body: JSON.stringify({
                    requestId: card.requestId,
                    ...response,
                    reviewedSha256: response.behavior === "allow" && card.skillRequest
                      ? reviewedSkillSha256(card.skillRequest)
                      : undefined,
                    ...(card.terminalRequest && response.behavior === "allow" && action.terminalDestination
                      ? { terminalDestination: action.terminalDestination }
                      : {}),
                  }),
                });
              }
              if (inRoom) return;
              persistCard(action.botId, action.messageId, { answered: action.answer, dismissed: true });
              return api(`/api/bots/${action.botId}/messages`, {
                method: "POST",
                body: JSON.stringify({ text: action.answer, threadId: action.threadId }),
              });
            })
            .catch((error) => {
              // settled already, elsewhere: the card shows the real outcome
              const settled = teamMemorySettled(error);
              const threadId = action.threadId ?? host?.threadId;
              if (settled && card?.requestId && threadId) {
                rawDispatch({ type: "cardSettled", threadId, requestId: card.requestId, patch: settled.card });
                showError(settled.text);
                return;
              }
              showError(error);
            });
          break;
        }
        case "dismissCard": {
          const { host, card, inRoom } = cardTarget(action);
          if (card?.requestId && host) {
            // a question is DECLINED rather than denied — the broker refuses
            // a deny on one (see card-answer.ts)
            api(`/api/threads/${action.threadId ?? host.threadId}/respond`, {
              method: "POST",
              body: JSON.stringify({ requestId: card.requestId, ...dismissResponse(card) }),
            }).catch(() => {});
          } else if (!inRoom) {
            persistCard(action.botId, action.messageId, { dismissed: true });
          }
          break;
        }
  }
}
