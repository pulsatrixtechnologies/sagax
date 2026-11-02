// Async side-effect dispatch for StoreProvider (#1383). Handlers stay under 400 lines.
import { startTransition } from "react";
import type { Action, AppState, Bot, BotAnnouncement, Group, Message, OptionCardData, TaskUpdatePatch } from "./model";
import type { Routine } from "@/lib/routines";
import {
  applyFolderOwner,
  folderOwnerPath,
  openOnboardingCard,
  sendsToFreshTopic,
  pinBotThreadAction,
  dataSheetFromResponse,
  dataTablesFromResponse,
  currentTaskBot,
  threadsReadOnScreen,
  peopleDmReadTarget,
  PERSON_THREADS_HEADER,
} from "./model";
import { MESSAGE_PAGE_SIZE, api, createBotWithRole, persistTaskApproval, requestConfirmedBotDeletion } from "./api";
import { shouldSuppressDeployOutageError } from "@/lib/deploy-reconnect";
import { readableError } from "@/lib/plain-error";
import { approvalModeFor, botApprovalSetting } from "../../../shared/approval-mode";
import { stepUpApprovals } from "@/lib/step-up-client";
import { singleStreamTurnField } from "@/lib/thread-preferences";
import { beginLocalSend, claimInFlightSend, finishSend } from "@/lib/send-cancel";
import { restoreComposerDraft } from "@/lib/drafts";
import { answerResponse, dismissResponse } from "@/lib/card-answer";
import { makeConfidentialBody } from "@/lib/confidential-thread";
import { createAnswerErrorMessage, recoverCreatedRoutineAfterLostAnswer } from "@/lib/routine-save-recovery";
import { DATA_ROUTES, withDataThread } from "../../../shared/data-surface";
import { ROUTINE_CONVERSATION_HEADER } from "../../../shared/wire";
import { t } from "@/lib/i18n";
import { voiceCallId } from "@/lib/call";
import { devPodsTurnField } from "@/components/dev-pods/prefs";
import { teamMemorySettled } from "@/lib/team-memory-settled";
import { proactiveProposalAccepts } from "../../../shared/proactive-proposal";
import { reviewedSkillSha256, skillRequestBehavior } from "../../../shared/skill-request";
import { terminalRequestBehavior } from "../../../shared/terminal-request";
import { meetingRequestBehavior } from "../../../shared/meeting-request";
import { onNudgeSent } from "@/lib/desktop-nudge";
import type { BotUpdatePatch } from "../bot-patch-queue";

export interface StoreDispatchCtx {
  stateRef: { current: AppState };
  rawDispatch: (action: Action) => void;
  botPatchQueue: {
    enqueue: (botId: string, patch: BotUpdatePatch, current: BotAnnouncement) => void;
    flush: (botId: string) => Promise<BotAnnouncement | null | undefined>;
    cancel: (botId: string) => void;
  };
  threadPages: {
    get: (threadId: string) => { messages: Message[]; hasMore?: boolean; activeLeafId?: string | null } | undefined;
    set: (threadId: string, page: { messages: Message[]; hasMore?: boolean; activeLeafId?: string | null; at: number }) => void;
    delete: (threadId: string) => void;
  };
  withTaskWrites: (bot: BotAnnouncement) => BotAnnouncement;
  showThreadsRef: { current: boolean };
  taskWrites: Map<string, { botId: string; updatesDefault: boolean; promise: Promise<BotAnnouncement>; execution: Promise<unknown>; patch: TaskUpdatePatch }>;
}

type DispatchShared = {
  selectionRevision: number;
  creatingBot: boolean;
};

type DispatchEnv = StoreDispatchCtx & {
  navigation: Map<string, number>;
  freshTopicsCreating: Map<string, Promise<string>>;
  shared: DispatchShared;
  olderPagesInFlight: Set<string>;
  showError: (e: unknown) => void;
  cardTarget: (action: { botId: string; messageId: string; groupId?: string }) => {
    host: (Bot | Group) | undefined;
    card: OptionCardData | undefined;
    inRoom: boolean;
  };
  persistCard: (botId: string, messageId: string, patch: Partial<OptionCardData>) => void;
  waitForExecutionSettings: (expectedBots: Bot[], threadId?: string) => Promise<void>;
  persistTaskPatch: (botId: string, threadId: string, patch: TaskUpdatePatch) => void;
  dispatch: (action: Action) => void;
  executionBotsBeforeAction: Bot[];
  quizBeforeSend: ReturnType<typeof openOnboardingCard> | undefined;
  freshSendBefore: boolean;
  botBeforeUpdate: Bot | undefined;
  botBeforeSend: Bot | undefined;
  leafBeforeEdit: string | null;
};

function dispatchRoutinesEffects(action: Action, env: DispatchEnv): void {
  const {
    rawDispatch, stateRef, showError, olderPagesInFlight, waitForExecutionSettings,
    executionBotsBeforeAction,
  } = env;
  switch (action.type) {
        case "loadOlderMessages": {
          // The reducer's flag is for the UI; this set is the guard, because
          // `stateRef` still holds the state from before this dispatch.
          if (olderPagesInFlight.has(action.threadId)) break;
          olderPagesInFlight.add(action.threadId);
          const current = stateRef.current;
          const owner = [...current.bots, ...current.groups].find((candidate) => candidate.threadId === action.threadId);
          const before = owner?.messages[0]?.id;
          // The transcript this page is being asked about. `loadOlderMessages`
          // does not move it, so the value here is the one the reducer will
          // compare against when the answer lands.
          const generation = current.transcriptGeneration[action.threadId] ?? 0;
          // Nothing to page back from: the reducer's loading flag would never
          // be cleared by a response that is not coming.
          if (!before) {
            olderPagesInFlight.delete(action.threadId);
            rawDispatch({ type: "olderMessages", threadId: action.threadId, generation, messages: [], hasMore: false });
            break;
          }
          api<{ messages: Message[]; hasMore?: boolean }>(
            `/api/threads/${action.threadId}/messages?limit=${MESSAGE_PAGE_SIZE}&before=${encodeURIComponent(before)}`,
          )
            .finally(() => olderPagesInFlight.delete(action.threadId))
            .then((page) => rawDispatch({
              type: "olderMessages",
              threadId: action.threadId,
              generation,
              messages: page.messages ?? [],
              hasMore: Boolean(page.hasMore),
            }))
            .catch((error) => {
              // Clear the flag on the way out, or the pill stays disabled for
              // the rest of the session after one failed page.
              rawDispatch({ type: "olderMessages", threadId: action.threadId, generation, messages: [], hasMore: true });
              showError(error);
            });
          break;
        }
        case "notice":
          if (action.notice) setTimeout(() => rawDispatch({ type: "notice", notice: null }), 6000);
          break;
        case "createRoutine": {
          // #1753: /loop and other createRoutine callers share the #1522
          // lost-answer guard so a proxy cut never shows a raw status or
          // invites a duplicate create.
          const knownRoutineIds = new Set(stateRef.current.routines.map((routine) => routine.id));
          const wanted = { name: action.input.name, botId: action.input.botId, target: action.input.target };
          void api("/api/routines", { method: "POST", body: JSON.stringify(action.input) })
            .catch(async (error) => {
              const created = await recoverCreatedRoutineAfterLostAnswer(
                error,
                knownRoutineIds,
                wanted,
                () => api("/api/routines") as Promise<{ routines?: Routine[] }>,
              );
              if (created) {
                rawDispatch({ type: "routinePatched", routine: created });
                return;
              }
              showError(createAnswerErrorMessage(error, t("routineCalendar.saveAnswerLost")));
            });
          break;
        }
        case "updateRoutine": {
          // Switched on or off while its bot's conversation is open: that
          // conversation gets the "Disabled · 1 routine" line (the server
          // checks the routine is that bot's and the thread the person's).
          const open = stateRef.current.bots.find((candidate) => candidate.id === stateRef.current.selectedId);
          const conversation = action.patch.enabled !== undefined && open?.threadId ? open.threadId : null;
          api(`/api/routines/${action.routineId}`, {
            method: "PATCH",
            body: JSON.stringify(action.patch),
            ...(conversation ? { headers: { "content-type": "application/json", [PERSON_THREADS_HEADER]: "1", [ROUTINE_CONVERSATION_HEADER]: conversation } } : {}),
          }).catch(showError);
          break;
        }
        case "deleteRoutine":
          api(`/api/routines/${action.routineId}`, { method: "DELETE" }).catch(showError);
          break;
        case "runRoutine":
          void waitForExecutionSettings(executionBotsBeforeAction)
            .then(() => api(`/api/routines/${action.routineId}/run`, { method: "POST" }))
            .then(({ run }) => action.onStarted?.(run))
            .catch((error) => {
              if (action.onError) action.onError(error);
              else showError(error);
            })
            .finally(() => action.onSettled?.());
          break;
        case "cancelRoutineRun":
          api(`/api/routine-runs/${action.runId}/cancel`, { method: "POST" }).catch(showError);
          break;
        // The Data tab's sheet. The panel runs and cancels SQL itself (it
        // owns the request to abort); those answer through the server's
        // `data` frame (the whole sheet), so every window sees the same
        // cards. A panel-local onError keeps a server without the surface
        // from raising the app-wide error line.
        case "loadDataSheet":
          api(withDataThread(DATA_ROUTES.sheet(action.botId), action.threadId))
            .then((body) => rawDispatch({ type: "dataSheet", sheet: dataSheetFromResponse(body, action.botId), tables: dataTablesFromResponse(body), ...(action.threadId ? { threadId: action.threadId } : {}) }))
            .catch((error) => (action.onError ?? showError)(readableError(error)));
          break;
        case "markRoutineRunSeen":
          api(`/api/routine-runs/${action.runId}/seen`, { method: "POST" }).catch(showError);
          break;
        case "markAllRoutineRunsSeen":
          api("/api/routine-runs/seen-all", { method: "POST" }).catch(showError);
          break;
        case "clearRoutineRuns":
          api("/api/routine-runs", { method: "DELETE" })
            .then(({ removed }) => rawDispatch({ type: "routineRunsRemoved", ids: Array.isArray(removed) ? removed : [] }))
            .catch(showError);
          break;
        case "cancelQueued":
          void api(`/api/bots/${action.botId}/queue/${action.queueId}`, { method: "DELETE", body: JSON.stringify({ threadId: action.threadId }) })
            .then(() => {
              rawDispatch(action);
              action.onCancelled?.();
            })
            .catch(showError);
          break;
        case "steerQueued":
          void api(`/api/bots/${action.botId}/queue/${action.queueId}/steer`, { method: "POST", body: JSON.stringify({ threadId: action.threadId }) })
            .then((body) => {
              if (body?.steered === true && Array.isArray(body.messages) && typeof body.threadId === "string") {
                for (const message of body.messages) {
                  rawDispatch({ type: "messageAdded", threadId: body.threadId, message });
                }
                for (const queueId of body.queueIds ?? []) {
                  rawDispatch({ type: "consumePendingQueued", threadId: body.threadId, queueId });
                }
              }
              action.onSettled?.();
            })
            .catch((error) => {
              showError(error);
              action.onError?.();
            });
          break;
        case "cancelGroupQueued":
          void api(`/api/groups/${action.groupId}/queue/${action.queueId}`, { method: "DELETE" })
            .then(() => {
              rawDispatch(action);
              action.onCancelled?.();
            })
            .catch(showError);
          break;
        case "steerGroupQueued":
          void api(`/api/groups/${action.groupId}/queue/${action.queueId}/steer`, {
            method: "POST",
            body: JSON.stringify({ threadId: action.threadId }),
          })
            .then((body) => {
              if (body?.steered === true && Array.isArray(body.messages) && typeof body.threadId === "string") {
                for (const message of body.messages) {
                  rawDispatch({ type: "messageAdded", threadId: body.threadId, message });
                }
                for (const queueId of body.queueIds ?? []) {
                  rawDispatch({ type: "consumePendingQueued", threadId: body.threadId, queueId });
                }
              }
              action.onSettled?.();
            })
            .catch((error) => {
              showError(error);
              action.onError?.();
            });
          break;
  }
}

function dispatchSendEffects(action: Action, env: DispatchEnv): void {
  const {
    rawDispatch, stateRef, showError, botPatchQueue, threadPages, freshTopicsCreating, navigation,
    cardTarget, persistCard, waitForExecutionSettings, dispatch, executionBotsBeforeAction,
    quizBeforeSend, freshSendBefore, botBeforeSend, leafBeforeEdit,
  } = env;
  switch (action.type) {
        case "send": {
          // persist through the existing card route so an older server that
          // does not auto-dismiss still hides the quiz on this client
          if (quizBeforeSend) persistCard(action.botId, quizBeforeSend.id, { dismissed: true });
          // The first message of a fresh topic (src/lib/fresh-topic.ts): the
          // server creates the topic now, then the message goes there. No
          // empty topic is ever made ahead of it.
          if (freshSendBefore) {
            const { replyToId: _reply, ...rest } = action;
            // A second message typed while the topic is being made waits
            // for it and goes there too: one topic, never two.
            let creating = freshTopicsCreating.get(action.botId);
            if (!creating) {
              const revision = (navigation.get(action.botId) ?? 0) + 1;
              navigation.set(action.botId, revision);
              creating = botPatchQueue.flush(action.botId)
                .then(() => api<{ bot: Bot; task?: { threadId?: string } }>(`/api/bots/${action.botId}/tasks`, { method: "POST", body: JSON.stringify({ stream: true }) }))
                .then((r) => {
                  const created = r?.task?.threadId ?? r?.bot?.threadId;
                  if (!r?.bot || !created) throw new Error(t("stream.freshFailed"));
                  if (Array.isArray(r.bot.messages)) threadPages.set(r.bot.threadId, { messages: r.bot.messages, hasMore: r.bot.hasMore, activeLeafId: r.bot.activeLeafId, at: Date.now() });
                  if (navigation.get(action.botId) === revision) dispatch({ type: "taskSwitched", bot: r.bot });
                  rawDispatch({ type: "freshTopic", botId: action.botId, threadId: null });
                  return created;
                })
                .finally(() => freshTopicsCreating.delete(action.botId));
              freshTopicsCreating.set(action.botId, creating);
            }
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
                body: JSON.stringify({ text: action.text, replyToId: action.replyToId, threadId, sendId, ...(action.mode === "goal" ? { mode: "goal" } : {}), ...(voiceCall ? { voiceCall } : {}), ...(busyMode === "auto" ? { routeWhileBusy: true } : busyMode ? { busyMode } : {}), ...(action.dataContext ? { dataContext: action.dataContext } : {}), ...devPodsTurnField(), ...singleStreamTurnField() }),
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

function dispatchBotsEffects(action: Action, env: DispatchEnv): void {
  const {
    rawDispatch, stateRef, showError, botPatchQueue, waitForExecutionSettings, executionBotsBeforeAction,
  } = env;
  switch (action.type) {
        case "newBot": {
          // The picker can close/remount before React paints pending state.
          if (env.shared.creatingBot) break;
          env.shared.creatingBot = true;
          rawDispatch({ type: "botCreationPending", on: true });
          void createBotWithRole(action.role, api, action.visibility, action.section, action.settings)
            .then(({ bot, profileError }) => {
              rawDispatch({ type: "botAdded", bot, preserveSelection: action.preserveSelection });
              action.onCreated?.(bot);
              if (profileError) {
                showError(t("newBot.profileFailed", { error: profileError }));
                rawDispatch({ type: "toggleSettings", open: true, section: "soul" });
              }
            })
            .catch((error) => {
              if (action.onError) action.onError(readableError(error));
              else showError(error);
            })
            .finally(() => {
              env.shared.creatingBot = false;
              rawDispatch({ type: "botCreationPending", on: false });
            });
          break;
        }
        case "duplicateBot": {
          const source = stateRef.current.bots.find((b) => b.id === action.botId);
          if (!source) break;
          const duplicateProfile = {
            name: `${source.name} copy`,
            title: source.title,
            description: source.description,
            soul: source.soul,
            notifications: source.notifications,
            modelSelection: source.modelSelection,
            computer: source.computer,
            cloudBackend: source.cloudBackend,
            autoStartVps: source.autoStartVps,
            avatarUrl: source.avatarUrl,
            avatarCrop: source.avatarCrop,
            avatarZoom: source.avatarZoom,
            avatarFocusX: source.avatarFocusX,
            avatarFocusY: source.avatarFocusY,
            // a private bot's copy stays private; anything else is the default
            ...(source.teamMemorySharing !== undefined && source.teamMemorySharing !== "shared" ? { teamMemorySharing: "private" as const } : {}),
          };
          // A copy of a restricted bot is restricted from its first moment.
          api("/api/bots", {
            method: "POST",
            body: JSON.stringify({
              ...(source.visibility && source.visibility !== "everyone" ? { visibility: source.visibility } : {}),
              ...(Object.hasOwn(source, "toolScope") ? { settings: { toolScope: source.toolScope } } : {}),
            }),
          })
            .then(({ bot }) =>
              api(`/api/bots/${bot.id}`, {
                method: "PATCH",
                // JSON.stringify omits undefined optional fields while preserving
                // an explicit null avatar clear, so duplication mirrors the source.
                body: JSON.stringify(duplicateProfile),
              }).then(({ bot: patched }) =>
                rawDispatch({ type: "botAdded", bot: { ...bot, ...patched, messages: bot.messages } }),
              ),
            )
            .catch(showError);
          break;
        }
        case "deleteBot":
          rawDispatch({ type: "botDeletionPending", botId: action.botId, on: true });
          void requestConfirmedBotDeletion(
            action.botId,
            async (botId) => {
              // Preserve edits when lifecycle guards refuse deletion, while
              // preventing an older debounced PATCH from landing after a
              // successful DELETE.
              await botPatchQueue.flush(botId);
              return api(`/api/bots/${botId}`, { method: "DELETE" });
            },
            (botId) => {
              botPatchQueue.cancel(botId);
              rawDispatch({ type: "deleteBot", botId });
            },
          )
            .catch(showError)
            .finally(() => rawDispatch({ type: "botDeletionPending", botId: action.botId, on: false }));
          break;
        case "markUnread":
          api(`/api/bots/${action.botId}`, { method: "PATCH", body: JSON.stringify({ unread: true }) }).catch(
            () => {},
          );
          break;
        case "select": {
          const id = action.id;
          const bot = stateRef.current.bots.find((b) => b.id === id);
          const group = stateRef.current.groups.find((g) => g.id === id);
          if (bot?.unread) {
            api(`/api/bots/${id}/read`, { method: "POST", body: JSON.stringify({ threadId: bot.threadId }) }).catch(() => {});
            // threads hidden: the one conversation's other unread threads too
            for (const threadId of threadsReadOnScreen(bot, bot.threadId).slice(1)) {
              api(`/api/bots/${id}/read`, { method: "POST", body: JSON.stringify({ threadId }) }).catch(() => {});
            }
          } else if (group?.peopleDm) {
            // per thread: the one open, or the whole conversation when only
            // the conversation itself was marked unread
            const read = peopleDmReadTarget(group);
            if (read) api(`/api/groups/${id}/read`, { method: "POST", body: JSON.stringify(read) }).catch(() => {});
          } else if (group?.unread) {
            api(`/api/groups/${id}/read`, { method: "POST" }).catch(() => {});
          }
          break;
        }
        case "createGroup":
          api(`/api/groups`, {
            method: "POST",
            body: JSON.stringify({
              memberIds: action.memberIds,
              ...(action.humanIds?.length ? { humanIds: action.humanIds } : {}),
              name: action.name,
              section: action.section,
              ...(window.ogb?.remoteClient?.active
                ? { setup: { bulletin: "", defaultResponder: { kind: "mentions" } } }
                : {}),
            }),
          })
            .then(({ group }) => {
              rawDispatch({ type: "groupPatched", group });
              rawDispatch({ type: "select", id: group.id });
            })
            .catch(showError);
          break;
        case "openPeopleDm":
          api(`/api/people-dms`, { method: "POST", body: JSON.stringify({ principalId: action.principalId }) })
            .then(({ group }) => {
              rawDispatch({ type: "groupPatched", group });
              rawDispatch({ type: "select", id: group.id });
            })
            .catch(showError);
          break;
        case "nudgePerson":
          api(`/api/nudges`, { method: "POST", body: JSON.stringify({ principalId: action.principalId, ...(action.threadId ? { threadId: action.threadId } : {}) }) })
            .then((sent) => onNudgeSent(sent))
            .catch(showError);
          break;
        case "nudgeGroup":
          api(`/api/nudges`, { method: "POST", body: JSON.stringify({ groupId: action.groupId }) })
            .then((sent) => onNudgeSent(sent))
            .catch(showError);
          break;
        case "sendGroup": {
          const threadId =
            action.threadId ?? stateRef.current.groups.find((group) => group.id === action.groupId)?.threadId;
          const sendId = action.sendId ?? crypto.randomUUID();
          void waitForExecutionSettings(executionBotsBeforeAction)
            .then(() => api(`/api/groups/${action.groupId}/messages`, {
              method: "POST",
              body: JSON.stringify({
                text: action.text,
                replyToId: action.replyToId,
                threadId,
                sendId,
                mode: action.mode ?? "chat",
              }),
            }))
            .then((body) => {
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
                });
              }
            })
            .catch((error) => {
              if (threadId) {
                rawDispatch({ type: "optimisticMessageRemoved", threadId, sendId });
              }
              showError(error);
              action.onError?.();
            });
          break;
        }
        case "patchGroup":
          api(`/api/groups/${action.groupId}`, {
            method: "PATCH",
            body: JSON.stringify(action.patch),
          }).catch(showError);
          break;
        case "deleteGroup":
          api(`/api/groups/${action.groupId}`, { method: "DELETE" }).catch(showError);
          break;
        case "leaveGroup":
          // the group leaves this client once the server took them out; their
          // other devices get "group.left"
          api(`/api/groups/${action.groupId}/leave`, { method: "POST" })
            .then(() => rawDispatch({ type: "groupDeleted", groupId: action.groupId }))
            .catch(showError);
          break;
  }
}

function dispatchTasksEffects(action: Action, env: DispatchEnv): void {
  const {
    rawDispatch, stateRef, showError, botPatchQueue, threadPages, withTaskWrites, navigation,
    persistTaskPatch, dispatch, botBeforeUpdate,
  } = env;
  switch (action.type) {
        case "setModel":
          if (action.threadId) {
            persistTaskPatch(action.botId, action.threadId, {
              modelSelection: action.selection,
              ...(action.updateBotDefault ? { updateBotDefault: true } : {}),
            });
            break;
          }
          if (botBeforeUpdate) {
            botPatchQueue.enqueue(
              action.botId,
              { modelSelection: action.selection, threadId: botBeforeUpdate.switchingTo ?? botBeforeUpdate.threadId },
              botBeforeUpdate,
            );
          }
          break;
        case "updateTask":
          persistTaskPatch(action.botId, action.threadId, action.patch);
          break;
        case "makeTaskConfidential":
          void api<{ bot?: BotAnnouncement }>(`/api/bots/${action.botId}/tasks/${action.threadId}`, {
            method: "PATCH",
            body: JSON.stringify(makeConfidentialBody()),
          }).then((result) => {
            if (result?.bot) rawDispatch({ type: "botPatched", bot: withTaskWrites(result.bot) });
            rawDispatch({ type: "taskMadeConfidential", botId: action.botId, threadId: action.threadId });
            action.onDone?.();
          }).catch((error: unknown) => {
            if (action.onError) action.onError(readableError(error));
            else showError(error);
          });
          break;
        case "refreshTaskPermissions": {
          const bot = stateRef.current.bots.find((candidate) => candidate.id === action.botId);
          const task = bot?.tasks?.find((candidate) => candidate.threadId === action.threadId);
          if (!bot || !task) {
            showError(new Error("That thread is no longer available"));
            break;
          }
          // the bot's own setting, never the open conversation's level
          const mode = botApprovalSetting(bot);
          const current = approvalModeFor(currentTaskBot(bot, action.threadId));
          const acknowledgeLocalAuto = action.acknowledgeLocalAuto === true;
          // Full, Custom, and leaving Custom stay on the private desktop
          // channel. Ask, Edits, and Auto can use the thread settings route.
          const needsDesktop = mode === "full" || mode === "custom" || current === "custom";
          // #1674: without the private channel (the desktop app on a remote
          // server, a browser), Full comes back through the thread route:
          // an organization server grants it to the bot's owner, any other
          // says why. Custom stays on the desktop channel.
          const bridge = window.ogb?.approvals;
          const refreshed = needsDesktop && (bridge || mode === "custom" || current === "custom")
            ? bridge
              ? stepUpApprovals(bridge)!.setMode(action.botId, mode, {
                threadId: action.threadId, threadOnly: true, refreshPermissions: true, acknowledgeLocalAuto,
              })
              : Promise.reject(new Error("Custom approval, and leaving it, are set in the Sagax desktop app on the computer that runs this server"))
            : api<{ bot: BotAnnouncement }>(`/api/bots/${action.botId}/tasks/${action.threadId}`, {
              method: "PATCH",
              body: JSON.stringify({ refreshPermissions: true, ...(acknowledgeLocalAuto ? { acknowledgeLocalAuto: true } : {}) }),
            }).then((result) => result.bot);
          void refreshed.then((updated) => {
            if (updated) rawDispatch({ type: "botPatched", bot: withTaskWrites(updated) });
          }).catch(showError);
          break;
        }
        case "followBotModel":
          void api<{ bot: BotAnnouncement }>(`/api/bots/${action.botId}/threads/follow-model`, { method: "POST", body: "{}" })
            .then(({ bot }) => rawDispatch({ type: "botPatched", bot: withTaskWrites(bot) }))
            .catch(showError);
          break;
        case "createProject":
          api(`${folderOwnerPath(action)}/projects`, { method: "POST", body: JSON.stringify({ name: action.name, emoji: action.emoji }) })
            .then((answer) => {
              applyFolderOwner(dispatch, action, answer);
              action.onCreated?.(answer.project);
            }).catch((error) => { showError(error); action.onError?.(readableError(error)); });
          break;
        case "updateProject":
          api(`${folderOwnerPath(action)}/projects/${action.projectId}`, { method: "PATCH", body: JSON.stringify(action.patch) })
            .then((answer) => { applyFolderOwner(dispatch, action, answer); action.onSaved?.(); })
            .catch((error) => { showError(error); action.onError?.(readableError(error)); });
          break;
        case "deleteProject":
          api(`${folderOwnerPath(action)}/projects/${action.projectId}`, { method: "DELETE" })
            .then((answer) => { applyFolderOwner(dispatch, action, answer); action.onDeleted?.(); })
            .catch((error) => { showError(error); action.onError?.(readableError(error)); });
          break;
        case "reorderProjects":
          api(`${folderOwnerPath(action)}/projects/order`, { method: "PATCH", body: JSON.stringify({ projectIds: action.projectIds }) })
            .then((answer) => { applyFolderOwner(dispatch, action, answer); action.onSaved?.(); })
            .catch((error) => { showError(error); action.onError?.(readableError(error)); });
          break;
        case "interrupt": {
          const interruptBody = {
            ...(action.threadId ? { threadId: action.threadId } : {}),
            ...(action.expectedUtteranceId ? { expectedUtteranceId: action.expectedUtteranceId } : {}),
          };
          api(`/api/bots/${action.botId}/interrupt`, {
            method: "POST",
            body: Object.keys(interruptBody).length ? JSON.stringify(interruptBody) : undefined,
          }).catch((error) => {
            showError(error);
            action.onError?.();
          });
          break;
        }
        // tasks: the server answers with the bot AND the live transcript,
        // because switching changes which conversation is on screen
        case "newTask":
        case "switchTask": {
          // Opening a task from a notification or the sidebar reads THAT
          // thread, once the switch is under way: the server announces it
          // (the "bot" frame reads Bot.switchingTo) and taskSwitched marks it
          // here. Never before: a switch that fails (a thread deleted
          // meanwhile) leaves the thread it was on, and its unread, as they were.
          const revision = (navigation.get(action.botId) ?? 0) + 1;
          navigation.set(action.botId, revision);
          const selectedAtStart = env.shared.selectionRevision;
          const ready = action.type === "newTask"
            ? botPatchQueue.flush(action.botId)
            : Promise.resolve();
          // A new task's thread is empty, so only the switch needs a page.
          void ready.then(() => api<{ bot: Bot }>(action.type === "newTask"
            ? `/api/bots/${action.botId}/tasks`
            : `/api/bots/${action.botId}/tasks/${action.threadId}${action.whole ? "" : `?messages=${MESSAGE_PAGE_SIZE}`}`, { method: "POST", body: JSON.stringify(action.type === "newTask" ? { projectId: action.projectId, cwd: action.cwd, ...(action.confidential !== undefined ? { confidential: action.confidential } : {}), ...(action.stream ?? singleStreamTurnField().singleStream ? { stream: true } : {}) } : {}) }))
            .then((r) => {
              if (action.type === "newTask") action.onCreated?.();
              if (!r?.bot || navigation.get(action.botId) !== revision) return;
              const selectsAfterCreation = action.type === "newTask" && action.cwd !== undefined;
              if (selectsAfterCreation && env.shared.selectionRevision !== selectedAtStart) return;
              if (Array.isArray(r.bot.messages)) threadPages.set(r.bot.threadId, { messages: r.bot.messages, hasMore: r.bot.hasMore, activeLeafId: r.bot.activeLeafId, at: Date.now() });
              dispatch({ type: "taskSwitched", bot: r.bot });
              if (selectsAfterCreation) rawDispatch({ type: "select", id: action.botId });
            })
            .catch((error) => {
              // The latest switch, failed, leaves the thread it was on on screen.
              if (action.type === "switchTask" && navigation.get(action.botId) === revision) {
                rawDispatch({ type: "switchTaskFailed", botId: action.botId, threadId: action.threadId });
              }
              if (action.type === "newTask" && action.onError) action.onError(readableError(error));
              else showError(error);
            });
          break;
        }
        case "renameTask":
          api(`/api/bots/${action.botId}/tasks/${action.threadId}`, {
            method: "PATCH",
            body: JSON.stringify({ title: action.title }),
          }).catch(showError);
          break;
        case "regenerateTaskTitle":
          api(`/api/bots/${action.botId}/tasks/${action.threadId}/title`, { method: "POST" })
            .then(() => action.onSettled?.(true))
            .catch((error) => { showError(error); action.onSettled?.(false); });
          break;
        case "deleteTask":
          threadPages.delete(action.threadId);
          api<{ bot?: BotAnnouncement }>(`/api/bots/${action.botId}/tasks/${action.threadId}`, { method: "DELETE" })
            .then((r) => r?.bot && dispatch({ type: "botPatched", bot: r.bot }))
            .catch(showError);
          break;
        // Channel tasks mirror bot tasks, but hydrate the whole channel so
        // switching atomically replaces its transcript, folder and pin.
        case "newGroupTask":
          api<{ group?: Partial<Group> & { id: string } }>(`/api/groups/${action.groupId}/tasks`, { method: "POST", body: JSON.stringify(action.projectId ? { projectId: action.projectId } : {}) })
            .then((r) => r?.group && dispatch({ type: "groupPatched", group: r.group }))
            .catch(showError);
          break;
        case "switchGroupTask":
          api<{ group?: Partial<Group> & { id: string } }>(`/api/groups/${action.groupId}/tasks/${action.threadId}?messages=${MESSAGE_PAGE_SIZE}`, { method: "POST" })
            .then((r) => {
              if (!r?.group) return;
              dispatch({ type: "groupPatched", group: r.group });
              // A person conversation: opening an unread thread reads it,
              // for this person only (server/people-dms.ts).
              const read = peopleDmReadTarget(r.group);
              if (read) api(`/api/groups/${action.groupId}/read`, { method: "POST", body: JSON.stringify(read) }).catch(() => {});
            })
            .catch(showError);
          break;
        case "updateGroupTask":
          api(`/api/groups/${action.groupId}/tasks/${action.threadId}`, {
            method: "PATCH",
            body: JSON.stringify(action.patch),
          }).catch(showError);
          break;
        case "renameGroupTask":
          api(`/api/groups/${action.groupId}/tasks/${action.threadId}`, {
            method: "PATCH",
            body: JSON.stringify({ title: action.title }),
          }).catch(showError);
          break;
        case "pinGroupTask":
          // title is echoed so an older server rewrites the same title
          // instead of blanking a pin-only body into "Untitled".
          api(`/api/groups/${action.groupId}/tasks/${action.threadId}`, {
            method: "PATCH",
            body: JSON.stringify({ pinned: action.pinned, title: action.title }),
          }).catch(showError);
          break;
        case "setConversationTurnLimit":
          api(action.dm ? `/api/groups/${action.groupId}` : `/api/groups/${action.groupId}/tasks/${action.threadId}`, {
            method: "PATCH",
            body: JSON.stringify({ turnTimeoutMinutes: action.minutes }),
          }).catch(showError);
          break;
        case "deleteGroupTask":
          api<{ group?: Partial<Group> & { id: string } }>(`/api/groups/${action.groupId}/tasks/${action.threadId}`, { method: "DELETE" })
            .then((r) => r?.group && dispatch({ type: "groupPatched", group: r.group }))
            .catch(showError);
          break;
        case "interruptGroup":
          api(`/api/groups/${action.groupId}/interrupt`, {
            method: "POST",
            body: action.threadId ? JSON.stringify({ threadId: action.threadId }) : undefined,
          }).catch((error) => {
            showError(error);
            action.onError?.();
          });
          break;
        case "updateBot": {
          if (botBeforeUpdate) {
            botPatchQueue.enqueue(action.botId, action.patch, botBeforeUpdate);
          }
          break;
        }
        default:
          break;
  }
}

export function createStoreDispatch(ctx: StoreDispatchCtx): (action: Action) => void {
  const { rawDispatch, stateRef, threadPages, botPatchQueue, taskWrites, withTaskWrites } = ctx;
    const navigation = new Map<string, number>();
    // The fresh topics being made, per bot (the first message's send).
    const freshTopicsCreating = new Map<string, Promise<string>>();
    const shared: DispatchShared = { selectionRevision: 0, creatingBot: false };
    const olderPagesInFlight = new Set<string>();
    const showError = (e: unknown) => {
      // A short deploy restart: keep the transcript, show Reconnecting, no toast.
      const snap = stateRef.current;
      if (
        shouldSuppressDeployOutageError({
          failure: e,
          everConnected: snap.everConnected,
          connected: snap.connected,
          disconnectedAt: snap.disconnectedAt,
        })
      ) {
        return;
      }
      rawDispatch({ type: "error", message: readableError(e) });
    };
    /** Where a card action's message lives, and the card on it. A card asked
     * inside a room belongs to the room's list, never to one member's. */
    const cardTarget = (action: { botId: string; messageId: string; groupId?: string }) => {
      const host = action.groupId
        ? stateRef.current.groups.find((g) => g.id === action.groupId)
        : stateRef.current.bots.find((b) => b.id === action.botId);
      return { host, card: host?.messages.find((m) => m.id === action.messageId)?.card, inRoom: !!action.groupId };
    };
    // fire-and-forget card persistence; the route is optional server-side
    const persistCard = (botId: string, messageId: string, patch: Partial<OptionCardData>) => {
      fetch(`/api/bots/${botId}/cards/${messageId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      }).catch(() => {});
    };

    const waitForExecutionSettings = async (expectedBots: Bot[], threadId?: string) => {
      // Capture this send's task save before waiting on slower profile saves.
      // Reconciliation may clear a failed lane meanwhile; that must not turn
      // an already-waiting send into work under reverted settings.
      const taskWrite = threadId ? taskWrites.get(threadId)?.execution : undefined;
      const defaultWrites = [...taskWrites.values()].filter((write) => write.updatesDefault && expectedBots.some((bot) => bot.id === write.botId));
      await Promise.all([taskWrite, ...defaultWrites.map((write) => write.execution), ...expectedBots.map(async (expected) => {
        const persisted = await botPatchQueue.flush(expected.id);
        if (!persisted) return;
        const expectedSelection = expected.modelSelection;
        if (
          approvalModeFor(persisted) !== approvalModeFor(expected) ||
          (persisted.memoryEnabled !== false) !== (expected.memoryEnabled !== false) ||
          persisted.modelSelection.instanceId !== expectedSelection.instanceId ||
          persisted.modelSelection.model !== expectedSelection.model ||
          persisted.modelSelection.effort !== expectedSelection.effort ||
          persisted.modelSelection.variant !== expectedSelection.variant
        ) {
          throw new Error("The approval level, memory setting, or model could not be saved, so this work was not started");
        }
      })]);
      if (threadId) await taskWrites.get(threadId)?.execution;
    };

    const persistTaskPatch = (botId: string, threadId: string, patch: TaskUpdatePatch) => {
      const previous = taskWrites.get(threadId);
      // A quick tab switch may queue two default changes on different threads.
      // Keep their order, and don't let a group send race either pending save.
      const defaults = patch.updateBotDefault || patch.approvalMode !== undefined
        ? [...taskWrites.values()].filter((write) => write.botId === botId) : [];
      const promise = Promise.all([previous?.promise, ...defaults.map((write) => write.promise)].map((save) => save?.catch(() => {})))
        .then(async () => {
          return persistTaskApproval(botId, threadId, patch, stepUpApprovals(window.ogb?.approvals));
        });
      // Later edits still get saved after an earlier failure, but a send
      // awaiting this batch must observe every rejected setting in it. A
      // successful folder move is not confirmation of a failed model change.
      const execution = Promise.all([previous?.execution, promise]);
      void execution.catch(() => {}); // handled by the write and send paths
      const pending = { botId, updatesDefault: Boolean(patch.updateBotDefault || previous?.updatesDefault), patch: { ...previous?.patch, ...patch }, promise, execution };
      taskWrites.set(threadId, pending);
      void pending.promise.then((bot) => {
        if (taskWrites.get(threadId) !== pending) return;
        taskWrites.delete(threadId);
        if (bot) rawDispatch({ type: "botPatched", bot: withTaskWrites(bot) });
      }).catch((error) => {
        showError(error);
        // Block sends until authoritative settings have been restored. Do
        // not clear the failed write if reconciliation also fails or a newer
        // write supersedes it: those settings are still unconfirmed.
        if (taskWrites.get(threadId) === pending) {
          pending.patch = {};
          void api(`/api/bots?messages=${MESSAGE_PAGE_SIZE}`).then(({ bots }) => {
            if (taskWrites.get(threadId) !== pending) return;
            const bot = bots.find((candidate: Bot) => candidate.id === botId);
            if (bot) {
              rawDispatch({ type: "botPatched", bot: withTaskWrites(bot) });
              taskWrites.delete(threadId);
            }
          }).catch(() => {});
        }
      });
    };

    /** Resolve every bot whose execution context belongs to this thread. A
     * direct chat may name an inactive task, while a channel request belongs
     * to every member that could be selected to run it. Capture the result
     * before the optimistic reducer runs so approval/model writes cannot race
     * a response that resumes (or starts) work. */
    const executionBotsForThread = (threadId: string): Bot[] => {
      const snapshot = stateRef.current;
      const botIds = new Set<string>();
      for (const bot of snapshot.bots) {
        if (bot.threadId === threadId || bot.tasks?.some((task) => task.threadId === threadId)) {
          botIds.add(bot.id);
        }
      }
      for (const group of snapshot.groups) {
        if (group.threadId === threadId || group.tasks?.some((task) => task.threadId === threadId)) {
          for (const memberId of group.memberIds) botIds.add(memberId);
        }
      }
      return snapshot.bots.filter((bot) => botIds.has(bot.id));
    };

    
  const env: DispatchEnv = {
    ...ctx,
    navigation,
    freshTopicsCreating,
    shared,
    olderPagesInFlight,
    showError,
    cardTarget,
    persistCard,
    waitForExecutionSettings,
    persistTaskPatch,
    dispatch: (action) => wrapped(action),
    executionBotsBeforeAction: [],
    quizBeforeSend: undefined,
    freshSendBefore: false,
    botBeforeUpdate: undefined,
    botBeforeSend: undefined,
    leafBeforeEdit: null,
  };

  function wrapped(action: Action): void {
      // Deferred folder creation may select its bot only while it is still
      // the latest navigation intent, even if the person went away and back.
      if (["select", "newTask", "switchTask", "newGroupTask", "switchGroupTask", "showChat", "showRoutines", "showTeamMap", "showCode", "showApprovals", "showRemoteSessions", "showAchievements"].includes(action.type)) shared.selectionRevision++;
      // Pin before any await or optimistic state change, including legacy
      // callers such as keyboard shortcuts and voice controls.
      action = pinBotThreadAction(action, stateRef.current.bots);
      if (action.type === "taskSwitched") action = { ...action, bot: withTaskWrites(action.bot) as Bot };
      if (action.type === "botPatched") action = { ...action, bot: withTaskWrites(action.bot) };
      // One identity drives the optimistic row, HTTP retry protection, and
      // canonical SSE reconciliation. Callers may omit it; the store may not.
      if ((action.type === "send" || action.type === "sendGroup" || action.type === "editMessage") && !action.sendId) {
        action = { ...action, sendId: crypto.randomUUID() };
      }
      const botBeforeUpdate =
        action.type === "updateBot" || action.type === "setModel"
          ? stateRef.current.bots.find((candidate) => candidate.id === action.botId)
          : undefined;
      const botBeforeSend =
        action.type === "send"
          ? stateRef.current.bots.find((candidate) => candidate.id === action.botId)
          : undefined;
      // the branch an edit replaces on screen, restored if the edit fails
      const leafBeforeEdit =
        action.type === "editMessage"
          ? stateRef.current.bots.find((candidate) => candidate.id === action.botId)?.activeLeafId ?? null
          : null;
      const executionBotsBeforeAction = (() => {
        if (action.type === "editMessage" || action.type === "answerCard") {
          const bot = stateRef.current.bots.find((candidate) => candidate.id === action.botId);
          return bot ? [bot] : [];
        }
        if (action.type === "decideRequest") {
          const bots = executionBotsForThread(action.threadId);
          if (!action.alwaysAllow || bots.some((bot) => bot.id === action.alwaysAllow?.botId)) {
            return bots;
          }
          const grantBot = stateRef.current.bots.find((bot) => bot.id === action.alwaysAllow?.botId);
          return grantBot ? [...bots, grantBot] : bots;
        }
        if (action.type === "sendGroup") {
          const memberIds = stateRef.current.groups.find((group) => group.id === action.groupId)?.memberIds ?? [];
          return stateRef.current.bots.filter((candidate) => memberIds.includes(candidate.id));
        }
        if (action.type === "runRoutine") {
          const routine = stateRef.current.routines.find((candidate) => candidate.id === action.routineId);
          if (!routine) return [];
          const ids = new Set([routine.botId]);
          if (routine.target === "room-goal" && routine.groupId) {
            const group = stateRef.current.groups.find((candidate) => candidate.id === routine.groupId);
            for (const memberId of group?.memberIds ?? []) ids.add(memberId);
          }
          return stateRef.current.bots.filter((candidate) => ids.has(candidate.id));
        }
        return [];
      })();
      // Read before the reducer runs: the send lands in a fresh topic.
      const freshSendBefore = action.type === "send" && sendsToFreshTopic(stateRef.current, action);
      const quizBeforeSend = (() => {
        if (action.type !== "send") return undefined;
        return botBeforeSend ? openOnboardingCard(botBeforeSend) : undefined;
      })();
      // A queued message is still real until the server confirms deletion.
      // Bot deletion is also server-authoritative: lifecycle guards may reject
      // it, and hiding the row first strands the computer the person must
      // remove. All other actions keep their existing optimistic behavior.
      if (action.type === "switchTask") {
        const switching = action;
        const leaving = stateRef.current.bots.find((candidate) => candidate.id === switching.botId);
        // The thread left behind, as it stands, for a switch back to it.
        if (leaving && leaving.threadId !== switching.threadId && !leaving.switchingTo && !leaving.awaitingThreadSnapshot && leaving.messages.length) {
          threadPages.set(leaving.threadId, { messages: leaving.messages, hasMore: leaving.hasMore, activeLeafId: leaving.activeLeafId, at: Date.now() });
        }
        const cached = switching.whole ? undefined : threadPages.get(switching.threadId);
        // The switch itself lands at once: the live frames and the read marks
        // read Bot.switchingTo from the latest state. Drawing the cached page
        // is a transition, so the click stays responsive while it renders.
        rawDispatch(switching);
        if (cached) startTransition(() => rawDispatch({ type: "previewThread", botId: switching.botId, threadId: switching.threadId, page: cached }));
      } else if (
        action.type !== "cancelQueued" &&
        action.type !== "cancelGroupQueued" &&
        action.type !== "deleteBot"
      ) rawDispatch(action);

    env.executionBotsBeforeAction = executionBotsBeforeAction;
    env.quizBeforeSend = quizBeforeSend;
    env.freshSendBefore = freshSendBefore;
    env.botBeforeUpdate = botBeforeUpdate;
    env.botBeforeSend = botBeforeSend;
    env.leafBeforeEdit = leafBeforeEdit;
    dispatchRoutinesEffects(action, env);
    dispatchSendEffects(action, env);
    dispatchBotsEffects(action, env);
    dispatchTasksEffects(action, env);
  }
  return wrapped;
}
