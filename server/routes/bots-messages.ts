/**
 * Bot messaging HTTP routes (#1388 wave 3 B3): browser live/action and
 * /api/bots/:id/messages(/guarded), queue, parallel stop, steer, compact,
 * edit, respond (bot and thread), interrupt.
 *
 * Registered in ROUTES after the auth gate. Never imports server/index.ts.
 * Heavy turn runners are injected as deps.
 */
import { randomUUID } from "node:crypto";

import type { BusySendRequest } from "../../shared/parallel-tasks.ts";
import type { ResolvedSender } from "../../shared/wire.ts";
import type { SteerOutcome } from "../contracts.ts";
import type { TurnSpeaker } from "../engine-access.ts";
import type { ReplyTarget } from "../replies.ts";
import type { RequestAuth } from "../request-auth.ts";
import type { Message } from "../store.ts";
import type { UsageTrigger } from "../usage-ledger.ts";
import { PASS, type RouteHandler } from "./table.ts";

import { approvalModeFor } from "../../shared/approval-mode.ts";
import {
  QUESTION_DISMISS_MESSAGE,
  isPersistentQuestionCard,
} from "../../shared/ask-question.ts";
import { promptWithDataContext } from "../../shared/data-context.ts";
import { isBusySendRequest } from "../../shared/parallel-tasks.ts";
import { isStopIntent } from "../../shared/stop-intent.ts";
import {
  masterySendFacts,
  modelFamily,
} from "../achievements-mastery.ts";
import { achievementSendEvents } from "../achievements.ts";
import { admit } from "../admission.ts";
import {
  classifyWithoutSteer,
  orchestratedSteerText,
} from "../busy-routing.ts";
import {
  prepareWidgetPress,
  reopenCancelledPress,
} from "../chat-widgets.ts";
import { claudeActivityEvents } from "../claude-activity.ts";
import {
  cloudGuestSendRefusal,
  cloudThreadRefusal,
} from "../cloud-thread-refusal.ts";
import {
  DATA_DIR,
  builtInBrowserEnabled,
} from "../config.ts";
import { parseDataContext } from "../data-context.ts";
import { parseDevPods } from "../dev-pods-prompt.ts";
import {
  typedCommandForTurn,
  unavailableCommandError,
} from "../harness-commands.ts";
import { recordHeldSteer } from "../held-steers.ts";
import { introAdvance } from "../intro-tour.ts";
import { spokenLineFields } from "../live-call-record.ts";
import { cancelledChatFollowup } from "../message-db.ts";
import { misuseRefusal } from "../misuse-guardrails.ts";
import { ORG_FULL_ACCESS_DISABLED } from "../org/org-full-access.ts";
import { resolvePeerComms } from "../peer-approval.ts";
import { promptWithReply } from "../replies.ts";
import {
  personKey,
  speakerFor,
} from "../request-speaker.ts";
import { SAFE_POINT_NOTE } from "../safe-point-preempt.ts";
import { safetyHttpRefusal } from "../safety-review.ts";
import {
  acceptedSendMatch,
  parseSendId,
  sendFingerprint,
} from "../send-idempotency.ts";
import {
  soloGoalCommand,
  soloGoalLine,
} from "../solo-goal.ts";
import { assertWithinBudget } from "../spend.ts";
import {
  cancelSteeredMessage,
  holdSteeredQueue,
  queueSteeredMessage,
  queuedSteeredMessage,
  restoreHeldSteeredQueue,
  settleHeldSteeredQueue,
} from "../steer-queue.ts";
import { resolveAndSendTerminal } from "../terminal-requests.ts";
import { extractTurnImages } from "../turn-images.ts";
import {
  pinVoiceInterrupt,
  voiceFullDuplexEnabled,
  withoutDuplexMarks,
} from "../voice-call-duplex.ts";
import {
  parseVoiceCallMeta,
  voiceCallSteerPrompt,
} from "../voice-call-prompt.ts";
import { parseVoiceClientTiming } from "../voice-timing.ts";

/** Injected closures from index.ts. Pure move; host locals stay loosely typed. */
export type BotsMessagesRouteDeps = Record<string, any>;

interface AutoRouteContext {
  replyTo?: Message;
  sendId?: string;
  sender?: ResolvedSender;
  trigger?: UsageTrigger;
  speaker?: TurnSpeaker;
  principalId?: string;
  auth?: RequestAuth;
}

export function createBotsMessagesRoutes(deps: BotsMessagesRouteDeps): RouteHandler {
  return async ({ req, res, url, path, method, auth, json, readBody }) => {
    if (!(path.startsWith("/api/bots/") || /^\/api\/threads\/[\w-]+\/respond$/.test(path))) {
      return PASS;
    }

    const {
      ADMIN_APPROVAL_REQUIRED, CONFIDENTIAL_CARD_DELEGATED, DESKTOP_MANAGED, DUPLEX_JOIN_RUNNING_TURN, HOSTED_WORKSPACE, IDENTITY,
      achievementCallStarts, activeGroupTurnForBot, actorPrincipalId, adminApprovalCheck, answerRequest, answeringCardAs,
      appendSoloGoalRow, approvalAnswerRefusal, approvalBus, autoRoutableThread, botAtThreadCapacity, botForThread,
      browserIntegration, browserLive, busyClassifyEngine, cancelDirectTurnDispatch, cancelGroupTurnOperations, cardAnswerRefusal,
      cfg, clearUnattended, closeCutToolRows, closeOpenApprovals, cloudOwnerSession, commandRememberRefusal,
      computerSelectionTurns, confirmStop, currentBrowserSession, delegatedRequest, deliverLateQuestionAnswer, devPodsThreads,
      directTurnDispatchClaims, drainQueuedSends, engineReference, enginesRead, finishUntilRuns, guardedSendSchema,
      handoffs, harnessCommandSource, harnessCommandSpeaker, harnessCommands, isBotActCard, isConfidentialMemoryCard,
      isInternalTurn, liveTurnByThread, liveVoiceUtteranceByThread, masteryThreadModel, messageSender, misuseActor,
      noteStreamSend, orgAdminCaller, orgFullAccessPolicy, orgJoinsRunningTurn, ownPageContext, parksBehindCoordination,
      phoneSecretSubmissions, policyModelRefusal, preemptAtSafePoint, recordAchievements, recordMastery, refreshUnsetModelSelections,
      registry, requestBehavior, requestedTaskBot, requirePinnedClientThread, resolveAndSendCwAction, resolveAndSendEmailDraft,
      resolveAndSendMeeting, resolveAndSendPhoneCallConsent, resolveAndSendModel, resolveAndSendProfile, resolveAndSendRoutine, resolveAndSendRule, resolveAndSendTeamSetup,
      resolveAndSendTrust, resolveImessageCard, resolveReplyTarget, resolveSkillRequest, revokeInternalCapabilitiesForThread, routableSteers,
      routeThreadId, routineActor, routineKeyReveal, routines, ruleManager, runningRequestText,
      runningTurnInstance, saveOwnerRuleFromCard, scopedThreadViewer, sendSequencer, sendSkillResolution, sessions,
      settleBotActCard, settleConfidentialMemoryCard, soloGoalReceipts, soloGoals, startDuplexCallTurn, startOrQueueDirectMessage,
      startParallelTask, startTurn, stepUpAnswerOf, stepUpGate, stopDirectThreadByPerson, stopParallelTask,
      stoppingThreads, store, teamSetupApplyRefusal, terminalAnswerExtras, terminalFeature, terminalPrincipalId,
      threadBusy, turnSelection, usageTriggerFor, videoGenerations, viewerBotLevel, voiceCalls,
      voiceLatency, widgetPressesInFlight, workspaceAccess,
    } = deps;

    let m: RegExpMatchArray | null = null;

    const liveBrowserMatch = /^\/api\/bots\/([\w-]+)\/browser\/(live|action)$/.exec(path);
    if (liveBrowserMatch) {
      res.setHeader("cache-control", "no-store");
      const bot = store.bot(liveBrowserMatch[1]);
      if (!bot) return json(res, 404, { error: "no such bot" });
      // Anyone who can use the bot watches its session. A stranger learns
      // nothing about whether the bot exists. Installing the engine is a
      // separate admin route.
      if (viewerBotLevel(auth, bot) === null && !auth.scopes.includes("admin") && !orgAdminCaller(auth)) {
        return json(res, 404, { error: "no such bot" });
      }
      if (!builtInBrowserEnabled(cfg) || bot.browser === false) {
        return json(res, 409, { error: "Enable this bot's browser in its profile first." });
      }
      const browser = await browserIntegration(bot.id, bot.browserProfile);
      if (!browser) return json(res, 503, { error: "Install the browser engine first." });
      // Browser discovery may have awaited while the portal became unavailable
      // and closed this owner's streams. Do not open a late replacement on
      // the earlier authorization; once registered, exact-owner close covers it.
      if (HOSTED_WORKSPACE && auth.kind === "session") {
        const failure = workspaceAccess
          ? await workspaceAccess.authorize(req, auth)
          : { status: 503, error: "Workspace sign-in is unavailable." };
        if (failure) return json(res, failure.status, { error: failure.error });
      }
      const owner = auth.kind === "session" ? auth.session.id : "local-owner";
      const isCurrent = () => {
        const current = store.bot(bot.id);
        return !!current && current.browser !== false && builtInBrowserEnabled(cfg)
          && currentBrowserSession(current.id, current.browserProfile) === browser.session
          && (auth.kind !== "session" || sessions.isLive(auth.session.id));
      };
      if (method === "GET" && liveBrowserMatch[2] === "live") {
        req.socket.setTimeout(0);
        const preview = url.searchParams.get("preview") === "1";
        return await browserLive.open({ botId: bot.id, session: browser.session, spec: browser.spec, owner, isCurrent, res, preview });
      }
      if (method === "POST" && liveBrowserMatch[2] === "action") {
        const body = await readBody(req, 32_768);
        if (!isCurrent()) return json(res, 409, { error: "This browser session changed. Reopen the browser panel." });
        if (typeof body?.viewerId !== "string") return json(res, 400, { error: "A live browser connection is required." });
        if (body.type === "restart" && store.bots.some((candidate: any) => candidate.busy &&
            currentBrowserSession(candidate.id, candidate.browserProfile) === browser.session)) {
          return json(res, 409, { error: "Stop every bot using this profile before restarting its browser." });
        }
        return json(res, 200, await browserLive.action({ viewerId: body.viewerId, botId: bot.id, owner, body }));
      }
      return json(res, 405, { error: "method not allowed" });
    }

    m = path.match(/^\/api\/bots\/([\w-]+)\/messages(?:\/(guarded))?$/);
    if (m && method === "POST") {
      const guarded = m[2] === "guarded";
      const body = await readBody(req);
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return json(res, 400, { error: "body must be a JSON object" });
      }
      // A press on a widget (`widgetAction`) is a person's own tap in one of
      // this workspace's clients: a relay has no widget to press. A client
      // that writes the field as null on an ordinary send means no press.
      const pressed = body.widgetAction !== undefined && body.widgetAction !== null;
      if (guarded && pressed) return json(res, 400, { error: "guarded sends cannot answer a widget" });
      // External interfaces must opt into a distinct route: an older server
      // returns 404 rather than silently ignoring safety preconditions.
      const guardedBody = guarded ? guardedSendSchema.safeParse(body) : null;
      if (guardedBody && !guardedBody.success) {
        const onBehalfOfInvalid = guardedBody.error.issues.some((issue: any) => issue.path[0] === "onBehalfOf");
        return json(res, 400, { error: onBehalfOfInvalid
          ? "onBehalfOf must name the person with an email address, a name, or both"
          : "guarded sends require threadId, sendId, text and expectedActiveLeafId" });
      }
      // A press sends no words of its own: the server writes them from the
      // stored widget below, once the task and the sendId are known.
      const typed = pressed ? "" : String(body.text ?? "").trim();
      if (!pressed && !typed) return json(res, 400, { error: "text required" });
      // words said on a voice call: the turn gets the phone-call instruction
      const parsedVoiceCall = parseVoiceCallMeta(body.voiceCall);
      if (parsedVoiceCall && "error" in parsedVoiceCall) return json(res, 400, { error: parsedVoiceCall.error });
      // Server duplex off: the page's duplex and speculative marks are
      // dropped, so the turn takes the pre-0.5.0 steer path and its prompt
      // never mentions a duplex opener.
      const sentVoiceCall = parsedVoiceCall && !voiceFullDuplexEnabled()
        ? withoutDuplexMarks(parsedVoiceCall)
        : parsedVoiceCall;
      const bot = store.bot(m[1]);
      if (!bot) return json(res, 404, { error: "no such bot" });
      requirePinnedClientThread(auth, req, bot.id, body.threadId);
      // on someone's behalf: the thread it would stop is resolved first, and
      // a confidential one is not there (routeThreadId)
      if (delegatedRequest()) routeThreadId(bot, body.threadId);
      if (body.threadId !== undefined && (typeof body.threadId !== "string" || !/^[\w-]+$/.test(body.threadId))) {
        return json(res, 400, { error: "threadId must be a task id" });
      }
      // A retry carries its original task. That lets us return the canonical
      // receipt after a task switch, while a genuinely new send still has to
      // target the task that is active now. On an organization server: the
      // sender's own thread, started for them on their first message.
      const threadId = routeThreadId(bot, body.threadId);
      const notYours = cloudGuestSendRefusal(auth, threadId);
      if (notYours) return json(res, 403, { error: notYours });
      // While the thread is on a live call, every send to it is a call turn,
      // marked or not (typed words, a retry, an old page): server state,
      // not only the page's mark (server/voice-call-session.ts).
      const voiceCall = guarded ? sentVoiceCall : voiceCalls.markFor(threadId, sentVoiceCall);
      // A goal for this one bot. A team channel keeps its own /goal.
      const solo = !guarded && !voiceCall && !pressed
        ? soloGoalCommand(typed, body.mode === "goal" ? "goal" : undefined)
        : { kind: "none" as const };
      if (solo.kind === "status" || solo.kind === "stop") {
        // a retry of the same send answers with the row it already wrote
        const receiptKey = typeof body.sendId === "string" && body.sendId ? `${threadId}:${body.sendId}` : null;
        const earlier = receiptKey ? soloGoalReceipts.get(receiptKey) : undefined;
        if (earlier) return json(res, 200, { ok: true, threadId, message: earlier });
        if (solo.kind === "stop") {
          soloGoals.stop(threadId);
          if (threadBusy(bot.id, threadId)) await stopDirectThreadByPerson(bot.id, threadId);
        }
        const message = appendSoloGoalRow(threadId, soloGoalLine(soloGoals.get(threadId)));
        if (receiptKey) {
          soloGoalReceipts.set(receiptKey, message);
          if (soloGoalReceipts.size > 500) soloGoalReceipts.delete(soloGoalReceipts.keys().next().value!);
        }
        return json(res, 200, { ok: true, threadId, message });
      }
      // #1372: the person's message is the goal they typed, nothing more.
      // The instruction rides the system prompt while the goal works.
      const postedText = solo.kind === "start" ? solo.goal : typed;
      // An engine command the chat cannot run is refused before it is
      // recorded (server/harness-commands.ts). /goal is Sagax's own.
      if (solo.kind !== "start" && typed.startsWith("/")) {
        const command = await typedCommandForTurn(extractTurnImages(typed).text, harnessCommandSource(bot, threadId, { speaker: harnessCommandSpeaker(auth) }), harnessCommands);
        if (command.kind === "unavailable") return json(res, 409, unavailableCommandError(command));
      }
      // Who this message is from, for the ledger. It is captured here and
      // travels with the message: into the turn it starts, or into the queue
      // until it drains. A message steered into someone else's running turn
      // books nothing — that turn stays with whoever started it. A guarded
      // relay (the Slack worker, which already holds admin scope to reach
      // this route) names the person it acts for.
      const onBehalfOf = guardedBody?.data?.onBehalfOf;
      const trigger: UsageTrigger = onBehalfOf
        ? { kind: "user", ...(onBehalfOf.email ? { email: onBehalfOf.email } : {}), ...(onBehalfOf.name ? { label: onBehalfOf.name } : {}) }
        : usageTriggerFor(auth);
      // The send is acknowledged before the turn starts, so a workspace at its
      // spend limit is refused here, where the person can see it.
      try {
        assertWithinBudget(cfg, DATA_DIR);
      } catch (error) {
        return json(res, 409, { error: error instanceof Error ? error.message : String(error), code: "spend_cap" });
      }
      if (!store.taskByThread(bot.id, threadId)) {
        return json(res, 409, { error: "the bot switched tasks before it could receive the message" });
      }
      let sendId = parseSendId(body.sendId);
      // One spoken utterance is delivered once: a second send of it (a retry
      // with a new send id) answers with the first one's receipt.
      if (voiceCall?.utteranceId && sendId) {
        const claim = voiceCalls.claimUtterance(threadId, voiceCall.callId, voiceCall.utteranceId, sendId);
        if (!claim.first) sendId = claim.sendId;
        else voiceLatency.received(threadId, voiceCall.utteranceId, parseVoiceClientTiming((body.voiceCall as Record<string, unknown> | undefined)?.timing));
      }
      // The press becomes an ordinary message that replies to its widget:
      // the label, then one line per field. Nothing is written yet.
      const press = pressed ? prepareWidgetPress(store, threadId, body.widgetAction, sendId) : null;
      if (press && !press.ok) return json(res, press.status, { error: press.error });
      // An in-app destination (open_page, open_routine, open_run) was opened
      // on the device: record the press as the person's message, marked done,
      // and run no turn. The model reads it on its next turn as already done
      // (server/replies.ts transcriptText); it is never asked to do it.
      if (press?.ok && press.device) {
        const earlier = sendId ? store.messagesFor(threadId).find((m: Message) => m.role === "user" && m.sendId === sendId) : undefined;
        if (earlier) return json(res, 200, { ok: true, threadId, message: earlier, device: true });
        const message = store.appendMessage(threadId, {
          role: "user", kind: "text", text: press.text, replyToId: press.messageId,
          deviceAction: { type: press.device.type }, ...(sendId ? { sendId } : {}), sender: messageSender(auth),
        });
        return json(res, 202, { ok: true, threadId, message, device: true });
      }
      // A pick on the new bot's intro cards stays in that guided conversation.
      // Any other text falls through and the turn runs as usual.
      const intro = !guarded && !pressed && !voiceCall ? introAdvance(store.messagesFor(threadId), typed) : null;
      if (intro) {
        const message = store.appendMessage(threadId, { role: "user", kind: "text", text: typed, ...(sendId ? { sendId } : {}) });
        if (intro.kind === "card") store.appendMessage(threadId, { role: "bot", kind: "options", card: intro.card });
        else store.appendMessage(threadId, { role: "bot", kind: "text", text: intro.text });
        return json(res, 202, { ok: true, threadId, message });
      }
      const text = press ? press.text : postedText;
      const target = resolveReplyTarget(threadId, press ? press.messageId : body.replyToId);
      // Only here is a reply known to be a press: a copy of the widget row
      // says so to whatever composes the prompt (server/replies.ts). A typed
      // reply to the same row carries no such mark, whatever its words.
      const replyTo: ReplyTarget | undefined = press && target ? { ...target, widgetPress: { label: press.label, action: press.action } } : target;
      const pressKey = press?.settles ? `${threadId}:${press.messageId}` : undefined;
      if (pressKey && widgetPressesInFlight.has(pressKey) && !(sendId && widgetPressesInFlight.get(pressKey) === sendId)) {
        return json(res, 409, { error: "That answer is already on its way." });
      }
      // A Data context is put in front of the words the model gets, and a
      // press is read by its first line (server/replies.ts): it carries none.
      const dataContext = press ? undefined : ownPageContext(parseDataContext(body.dataContext), bot.id, auth);
      // the coding view is on for the device that sent this (server/dev-pods-prompt.ts)
      devPodsThreads.note(threadId, parseDevPods(body.devPods));
      // Single stream (server/single-stream.ts): a client showing one
      // continuous conversation (threads off) marks this thread a stream
      // segment; a client showing threads clears the mark. A client that says
      // nothing (an older build, the phone, a relay) leaves it as it is.
      if (typeof body.singleStream === "boolean" && !guardedBody) noteStreamSend(bot.id, threadId, body.singleStream);
      // What a send to a busy conversation does (shared/parallel-tasks.ts):
      // join the running turn (steer, the default), run as its own task in
      // parallel, or wait for the running turn (after).
      if (body.busyMode !== undefined && !isBusySendRequest(body.busyMode)) {
        return json(res, 400, { error: "busyMode must be auto, steer, parallel or after" });
      }
      // On a call, words said while the bot works always join its turn: a
      // phone has no "run this in parallel" (and no chooser asks).
      // Auto (what the apps ask since 2026-10-18, `routeWhileBusy: true`, a
      // field an older server ignores, or busyMode "auto"): the bot
      // orchestrates (server/busy-routing.ts). A send that names no mode (the
      // API, an older build) keeps joining the running turn.
      // #1372: a new goal waits for the running turn, so the turn that takes
      // it up carries the goal's instruction in its system prompt.
      const busyMode: BusySendRequest = guardedBody || voiceCall ? "steer"
        : solo.kind === "start" ? "after"
          : (body.busyMode ?? (body.routeWhileBusy === true ? "auto" : "steer"));
      const messageSpeaker = speakerFor(auth);
      const postedActor = misuseActor(messageSpeaker.origin === "person" ? messageSpeaker.principalId : undefined, messageSpeaker.origin);
      const messageMisuse = misuseRefusal(text, { ...postedActor, surface: "message", botId: bot.id, threadId });
      if (messageMisuse) return json(res, messageMisuse.status, { error: messageMisuse.message, code: messageMisuse.code });
      const postedSafety = safetyHttpRefusal({ text, surface: "message", triage: postedActor.triage, ...(postedActor.principalId ? { principalId: postedActor.principalId } : {}), botId: bot.id, threadId });
      if (postedSafety) return json(res, postedSafety.status, { error: postedSafety.message, code: postedSafety.code });
      // "stop", "arrête", "attends", "wait" alone while this thread works:
      // the same stop as POST /interrupt for this thread
      // (shared/stop-intent.ts), never words steered into the turn it asks
      // to end. 2026-10-28: the person's words stay in the conversation and
      // the bot answers them with one "Stopped" line; calls the stop cut
      // short say so on their own rows.
      if (!pressed && !voiceCall && threadBusy(bot.id, threadId) && isStopIntent(text)) {
        const sendKey = parseSendId(body.sendId);
        const earlier = sendKey ? store.messagesFor(threadId).find((m: any) => m.role === "user" && m.sendId === sendKey) : undefined;
        if (earlier) return json(res, 200, { ok: true, threadId, stopped: true, message: earlier });
        const stoppedTurnId = liveTurnByThread.get(threadId);
        const message = store.appendMessage(threadId, { role: "user", kind: "text", text, ...(sendKey ? { sendId: sendKey } : {}), sender: messageSender(auth) });
        const run = routines!.activeBotRunForBot(bot.id);
        if (run?.threadId === threadId) await routines!.cancelRun(run.id);
        else await stopDirectThreadByPerson(bot.id, threadId);
        closeCutToolRows(threadId);
        confirmStop(threadId, stoppedTurnId);
        return json(res, 200, { ok: true, threadId, stopped: true, message });
      }
      if (pressKey) widgetPressesInFlight.set(pressKey, sendId);
      // #1372: the goal starts only now, after every refusal above; a send
      // refused below puts back what was there. A person writing again in a
      // conversation whose goal waits on them sets it working again.
      const goalBefore = soloGoals.get(threadId);
      if (solo.kind === "start") soloGoals.start(threadId, solo.goal);
      else if (!pressed && !voiceCall && !guarded) soloGoals.resume(threadId);
      // #1329: the person wrote: the relaunch count starts over.
      finishUntilRuns.reset(threadId);
      const restoreGoal = () => { if (solo.kind === "start") soloGoals.restore(threadId, goalBefore); };
      const receipt = await sendSequencer.run(
        sendId ? `bot:${bot.id}:${threadId}:${sendId}` : undefined,
        sendFingerprint(text, replyTo?.id),
        async () => {
          if (sendId) {
            if (cancelledChatFollowup("bot", bot.id, threadId, sendId)) {
              throw Object.assign(new Error("this queued sendId was cancelled; send a new message to try again"), { status: 409 });
            }
            const accepted = acceptedSendMatch(store.messagesFor(threadId), sendId, text, replyTo?.id);
            if (accepted.kind === "conflict") {
              throw Object.assign(new Error("sendId already belongs to another message"), { status: 409 });
            }
            if (accepted.kind === "match") {
              const canonical = {
                ok: true as const,
                threadId,
                message: accepted.message,
              };
              return accepted.message.steered
                ? { ...canonical, steered: true as const }
                : canonical;
            }
            const queued = queuedSteeredMessage(bot.id, threadId, sendId);
            if (queued) {
              if (queued.text !== text || queued.replyToId !== replyTo?.id) {
                throw Object.assign(new Error("sendId already belongs to another message"), { status: 409 });
              }
              return { ok: true as const, queued: true as const, queueId: queued.id, threadId, reason: queued.reason };
            }
          }

          // Resolve first-run setup before reading admission/guarded-send
          // preconditions. Provider discovery yields; transcript reservation
          // after those checks must remain synchronous.
          const profile = store.bot(bot.id);
          if (profile && !profile.modelSelection.instanceId && !profile.modelSelection.model) {
            if (enginesRead) await enginesRead;
            registry.forgetSnapshots();
            await refreshUnsetModelSelections();
          }
          const currentAtStart = store.projectBotForTask(bot.id, threadId);
          if (!currentAtStart) throw Object.assign(new Error("no such bot"), { status: 404 });
          if (!store.taskByThread(currentAtStart.id, threadId)) {
            throw Object.assign(new Error("the target task no longer exists"), { status: 409 });
          }
          // Organization server: a turn asking Full access is refused while
          // the organization does not allow it (org-full-access.ts). The
          // person picks another level; the turn never runs elevated.
          if (IDENTITY.kind === "perspicax" && approvalModeFor(currentAtStart) === "full" && !orgFullAccessPolicy()) {
            throw Object.assign(new Error(ORG_FULL_ACCESS_DISABLED.error), { status: ORG_FULL_ACCESS_DISABLED.status, code: ORG_FULL_ACCESS_DISABLED.code });
          }

          if (guarded) {
            // There is no await between these checks and startTurn's
            // synchronous transcript append / runtime reservation. In
            // particular, never steer or enqueue under stale permissions.
            const expectedMode = body.expectedApprovalMode ?? "ask";
            if (approvalModeFor(currentAtStart) !== expectedMode ||
                (expectedMode === "ask" && (currentAtStart.autoApprove === true || currentAtStart.alwaysAllow?.length))) {
              throw Object.assign(new Error("guarded sends require the exact expected approval mode; Ask cannot have remembered permissions"), { status: 409, code: "guarded_permissions" });
            }
            if (store.activeLeaf(threadId) !== body.expectedActiveLeafId) {
              throw Object.assign(new Error("the conversation changed before this message could start"), { status: 409, code: "guarded_branch" });
            }
            const guardedAdmission = admit("guarded", {}, {
              botBusy: currentAtStart.busy,
              threadBusy: threadBusy(bot.id, threadId),
              atCapacity: botAtThreadCapacity(bot.id),
              parksBehindCoordination: parksBehindCoordination(bot.id, threadId),
              groupTurn: Boolean(activeGroupTurnForBot(bot.id)),
            });
            if (guardedAdmission.action === "refuse") {
              throw Object.assign(new Error("wait for a free thread slot before retrying this message"), { status: 409, code: "guarded_busy" });
            }
            const message = await startTurn(bot.id, text, { threadId, replyTo, sendId, sender: messageSender(auth), trigger, speaker: speakerFor(auth), relayed: true, dataContext });
            return { ok: true as const, threadId, message };
          }

          // Full-duplex call: one live turn. Talking while the bot only
          // thinks cancels that turn, drops the steer queue, and starts only
          // this utterance (issue #292). While its tool runs, the words fall
          // through to the steer path below and join it. Flag off: steer.
          if (voiceCall?.duplex && voiceFullDuplexEnabled()) {
            const duplex = await startDuplexCallTurn(bot.id, threadId, text, replyTo, sendId, messageSender(auth), trigger, speakerFor(auth), voiceCall);
            if (duplex !== DUPLEX_JOIN_RUNNING_TURN) return duplex;
          }

          // A new request while this conversation works: its own task, which
          // runs now (or when a slot frees) and answers here.
          if (currentAtStart.busy && busyMode === "parallel") {
            return startParallelTask({
              botId: bot.id, threadId, text, replyTo, sendId, sender: messageSender(auth), trigger,
              speaker: speakerFor(auth), principalId: auth.kind === "session" ? personKey(auth.session) : undefined, auth,
            });
          }
          // After this one: wait in the queue, never joining the running turn.
          if (currentAtStart.busy && busyMode === "after") {
            const queued = queueSteeredMessage(currentAtStart.id, threadId, text, {
              replyToId: replyTo?.id,
              sendId,
              ...(dataContext ? { dataContext } : {}),
              prompt: promptWithReply(promptWithDataContext(text, dataContext), replyTo, cfg.profile?.name?.trim() || "User"),
              sender: messageSender(auth),
              trigger,
              speaker: speakerFor(auth),
              ...(voiceCall ? { voiceCall } : {}),
            });
            return { ok: true as const, queued: true as const, queueId: queued.id, threadId };
          }
          // Claude can accept the message inside its live turn. If the write
          // loses a race with turn settlement, or the engine cannot steer, the
          // existing server-side queue records it atomically for the next turn.
          if (currentAtStart.busy) {
            const instance = runningTurnInstance(currentAtStart, threadId);
            let steered: SteerOutcome = "refused";
            // A live text steer has no image side channel. Keep an attachment
            // message intact for the next ordinary turn, where central image
            // admission can hand it to the provider natively.
            const carriesImages = extractTurnImages(text).images.length > 0;
            const steerTarget = handoffs.current(threadId);
            const busyAdmission = admit("direct-busy", {
              carriesImages,
              pendingComputerSelection: Boolean(computerSelectionTurns.get(threadId)?.selected),
              engineCanSteer: Boolean(instance?.adapter.capabilities.queueing && instance.adapter.steer)
                // someone else's words never join a running turn on an
                // organization server: they wait and get the gate
                && orgJoinsRunningTurn(currentAtStart, threadId, speakerFor(auth))
                // a turn being stopped takes no new words: they would be
                // withdrawn with it and never answered; they wait instead
                && !stoppingThreads.has(threadId),
            });
            // steer was offered only when a live instance could take it;
            // the second check carries that fact to the type system.
            const steerId = randomUUID();
            // Auto (server/busy-routing.ts): the bot routes the words it
            // reads, through the handle the note in front of them names.
            // Only a person's own running turn (depth 0) may route: a resumed
            // teammate reply now runs in that turn's process and still sees
            // route_message, which the route refuses at depth 1.
            const routable = busyMode === "auto" && autoRoutableThread(bot.id, threadId) && !isInternalTurn(threadId);
            const routeContext: AutoRouteContext = {
              replyTo, sendId, sender: messageSender(auth), trigger, speaker: speakerFor(auth),
              principalId: auth.kind === "session" ? personKey(auth.session) : undefined, auth,
            };
            if (busyAdmission.action === "steer" && instance?.adapter.steer) {
              const words = promptWithReply(promptWithDataContext(text, dataContext), replyTo, cfg.profile?.name?.trim() || "User");
              if (routable) routableSteers.open(steerId, { botId: bot.id, threadId, text, context: routeContext });
              steered = await instance.adapter
                .steer(threadId, voiceCallSteerPrompt(routable ? orchestratedSteerText(steerId, words) : words, voiceCall), { steerId })
                .catch((): SteerOutcome => "indeterminate");
            }
            // steer() is awaited adapter work. The turn can settle, the task can
            // switch, or the whole bot can be deleted before its acknowledgement
            // arrives. Re-read every ownership invariant before appending even a
            // successful steer; otherwise that late acknowledgement writes a user
            // message into a task the bot no longer owns. A conflict leaves the
            // text in the client's composer/outbox to resend deliberately.
            const current = store.projectBotForTask(bot.id, threadId);
            if (!current) throw Object.assign(new Error("no such bot"), { status: 404 });
            if (!store.taskByThread(bot.id, threadId)) {
              throw Object.assign(new Error("the target task no longer exists"), { status: 409 });
            }
            const delivered = steered !== "refused";
            if (delivered) {
              if (steered === "steered" && !current.busy) {
                routableSteers.drop(steerId);
                // Said on a call, the words must get an answer: the turn
                // they were written into ended first, so they start the
                // next one (a phone has no composer to resend from).
                if (voiceCall) {
                  return startOrQueueDirectMessage(bot.id, threadId, text, replyTo, sendId, messageSender(auth), trigger, speakerFor(auth), voiceCall, undefined, undefined, dataContext);
                }
                throw Object.assign(
                  new Error("the running turn ended before the steered message could be recorded"),
                  { status: 409 },
                );
              }
              // "indeterminate" falls through to the same record: the words
              // may already be folded into a turn whose acknowledgement was
              // lost, and handing them back for a resend could run them
              // twice. Recording them once is the honest outcome.
              // A person steering a webhook turn is present, and auto mode may
              // follow them again. But this route is also reachable from the
              // bot's own shell on a headless server (loopback is the owner
              // there), and "continue" typed by the turn itself must not be
              // the thing that lifts the block written against it — so only
              // a request that proves a person (a paired session, or the
              // desktop's owner capability, which every mutation there has
              // already shown) clears the mark.
              if (auth.kind === "session" || DESKTOP_MANAGED) clearUnattended(threadId);
              const message = store.appendMessage(threadId, {
                role: "user",
                kind: "text",
                text,
                replyToId: replyTo?.id,
                sendId,
                ...(dataContext ? { dataContext } : {}),
                steered: true,
                sender: messageSender(auth),
                ...(voiceCall ? { voiceCall } : {}),
              });
              // Written here, as the words that start a turn are (startTurn).
              store.setTaskAskedAt(bot.id, threadId, message.at);
              // Durable while the engine process holds them: a crash or stop can
              // resume them once (held-steers.ts).
              try {
                recordHeldSteer(DATA_DIR, { botId: bot.id, threadId, messageId: message.id, text, at: message.at });
              } catch (error) {
                console.warn(`held-steers: could not record steered message: ${error instanceof Error ? error.message : String(error)}`);
              }
              // Offered to the next turn again unless the person stops this one.
              handoffs.steered(threadId, steerTarget, instance?.instanceId, message.id, steerId);
              if (routable) routableSteers.bind(steerId, message.id);
              return { ok: true as const, steered: true as const, threadId, message };
            }
            routableSteers.drop(steerId);
            if (!current.busy) {
              return startOrQueueDirectMessage(bot.id, threadId, text, replyTo, sendId, messageSender(auth), trigger, speakerFor(auth), voiceCall, undefined, undefined, dataContext);
            }
            // Auto, and the running turn cannot take the words live (this
            // engine cannot steer, or the steer was refused): the server
            // routes them, a parallel task or the queue, never an error. A
            // turn being stopped keeps them for the next turn, as before.
            if (routable && !stoppingThreads.has(threadId)) {
              const decided = await classifyWithoutSteer({ text, running: runningRequestText(threadId), generateText: busyClassifyEngine(bot.id) });
              console.log(`[busy-route] ${bot.id}/${threadId} ${decided.mode} (${decided.by}, no live steer)`);
              const after = store.projectBotForTask(bot.id, threadId);
              if (!after || !store.taskByThread(bot.id, threadId)) throw Object.assign(new Error("the target task no longer exists"), { status: 409 });
              // the running turn ended while the model answered: a plain turn
              if (!after.busy) return startOrQueueDirectMessage(bot.id, threadId, text, replyTo, sendId, messageSender(auth), trigger, speakerFor(auth), voiceCall, undefined, undefined, dataContext);
              if (decided.mode === "parallel") return startParallelTask({ botId: bot.id, threadId, text, ...routeContext });
            }
            // 2026-10-28: the person's words never wait for the whole turn.
            // The running turn stops at its next safe point (the end of its
            // tool call) and the queue answers them at once. Only their own
            // 1:1 turn: a routine run, another person's turn on an
            // organization server, a call or a turn being stopped keep the
            // queue as before.
            const preempt = !voiceCall && !stoppingThreads.has(threadId)
              && (auth.kind === "session" || DESKTOP_MANAGED || IDENTITY.kind !== "perspicax")
              && !store.taskByThread(bot.id, threadId)?.routineRunId && !store.groupByThread(threadId)
              && orgJoinsRunningTurn(current, threadId, speakerFor(auth));
            const words = promptWithReply(promptWithDataContext(text, dataContext), replyTo, cfg.profile?.name?.trim() || "User");
            const queued = queueSteeredMessage(current.id, threadId, text, {
              replyToId: replyTo?.id,
              sendId,
              ...(dataContext ? { dataContext } : {}),
              prompt: preempt ? `${SAFE_POINT_NOTE}\n${words}` : words,
              sender: messageSender(auth),
              trigger,
              speaker: speakerFor(auth),
              ...(voiceCall ? { voiceCall } : {}),
            });
            if (preempt) preemptAtSafePoint(current.id, threadId);
            return { ok: true as const, queued: true as const, queueId: queued.id, threadId, ...(preempt ? { preempting: true as const } : {}) };
          }
          return startOrQueueDirectMessage(bot.id, threadId, text, replyTo, sendId, messageSender(auth), trigger, speakerFor(auth), voiceCall, undefined, undefined, dataContext);
        },
      ).catch((error: unknown) => {
        restoreGoal();
        throw error;
      }).finally(() => {
        if (pressKey) widgetPressesInFlight.delete(pressKey);
      });
      // Only an accepted message (started, steered or queued) answers the
      // widget. A retry of the press that already did changes nothing. A
      // queued one is remembered by its slot: cancelling it reopens the widget.
      press?.settle(receipt && typeof receipt === "object" && "queueId" in receipt && typeof receipt.queueId === "string" ? receipt.queueId : undefined);
      const person = actorPrincipalId(auth);
      recordAchievements(person, achievementSendEvents({ text, parallel: busyMode === "parallel", ...(voiceCall ? { voiceCall } : {}) }, achievementCallStarts, Date.now()));
      if (voiceCall) {
        const family = modelFamily(masteryThreadModel(threadId));
        recordAchievements(person, claudeActivityEvents({ family, kind: "voice" }));
      }
      // a correction into the running turn (steer, queued into it) counts for Prompter
      recordMastery(masterySendFacts({ threadId, text, steered: busyMode === "steer" && (receipt as { queued?: unknown }).queued === true }, person));
      return json(res, 202, receipt);
    }

    m = path.match(/^\/api\/bots\/([\w-]+)\/queue\/([\w-]+)$/);
    if (m && method === "DELETE") {
      const body = await readBody(req);
      requirePinnedClientThread(auth, req, m[1], body?.threadId);
      const bot = requestedTaskBot(m[1], body?.threadId);
      const queueId = m[2];
      if (!cancelSteeredMessage(bot.id, queueId, bot.threadId)) {
        return json(res, 404, { error: "no such queued message" });
      }
      // The words never reached the bot. If they were the answer to a
      // widget, it takes an answer again.
      reopenCancelledPress(store, bot.threadId, queueId);
      return json(res, 200, { ok: true });
    }

    // Stop one parallel task (shared/parallel-tasks.ts): its running turn,
    // or its place in line. The conversation it answers gets the outcome.
    m = path.match(/^\/api\/bots\/([\w-]+)\/parallel\/([\w-]+)\/stop$/);
    if (m && method === "POST") {
      const bot = store.bot(m[1]);
      if (!bot) return json(res, 404, { error: "no such bot" });
      const taskThreadId = routeThreadId(bot, m[2], "thread.post");
      const notYours = cloudThreadRefusal(auth, taskThreadId);
      if (notYours) return json(res, 403, { error: notYours });
      const outcome = await stopParallelTask(bot.id, taskThreadId);
      if (outcome === "not_pending") return json(res, 404, { error: "no running or waiting parallel task there" });
      return json(res, 200, { ok: true, outcome });
    }

    // Steer a queued message into the RUNNING turn (no interrupt). Engines
    // without a live steer keep the queue; this never ends the current turn.
    m = path.match(/^\/api\/bots\/([\w-]+)\/queue\/([\w-]+)\/steer$/);
    if (m && method === "POST") {
      const body = await readBody(req);
      requirePinnedClientThread(auth, req, m[1], body?.threadId);
      const bot = requestedTaskBot(m[1], body?.threadId);
      // Steered words reach the running turn like a sent line, so a Cloud
      // guest steers only in a conversation it started (as it sends).
      const steerRefusal = cloudGuestSendRefusal(auth, bot.threadId);
      if (steerRefusal) return json(res, 403, { error: steerRefusal });
      // Pressing Steer folds the queued words into the running turn. It does
      // not re-book that turn to whoever pressed it, and the words keep the
      // sender they were queued with.
      // Lift the whole queue atomically: a settle racing this request can
      // drain it as a follow-up, or this request can steer it into the live
      // turn — never both for the same words.
      const held = holdSteeredQueue(bot.id, bot.threadId, m[2]);
      if (!held) return json(res, 404, { error: "no such queued message" });
      // A live steer has no image side channel. Attachment words wait for a
      // real turn where central admission can hand the images to the engine.
      if (held.items.some((item: any) => extractTurnImages(item.text).images.length > 0)) {
        restoreHeldSteeredQueue(held);
        return json(res, 200, { ok: true, queued: true, threadId: bot.threadId });
      }
      const currentAtStart = store.projectBotForTask(bot.id, bot.threadId);
      const instance = currentAtStart?.busy ? runningTurnInstance(currentAtStart, bot.threadId) : undefined;
      // words said on a call keep their call mark when they join the turn
      const prompt = held.items.map((item: any) => voiceCallSteerPrompt(item.prompt, item.voiceCall)).join("\n\n");
      const steerTarget = handoffs.current(bot.threadId);
      let steered: SteerOutcome = "refused";
      const steerId = randomUUID();
      if (currentAtStart?.busy && instance?.adapter.capabilities.queueing && instance.adapter.steer) {
        steered = await instance.adapter
          .steer(bot.threadId, prompt, { steerId })
          .catch((): SteerOutcome => "indeterminate");
      }
      // The steer was awaited adapter work: re-read every ownership
      // invariant before writing anything, exactly like the live-send path.
      const current = store.projectBotForTask(bot.id, bot.threadId);
      // "indeterminate" never restores: the words may already be folded into
      // the turn that was live when they were sent, and replaying them into
      // a fresh follow-up turn would run them twice. Record them whenever
      // the destination still exists, busy or not.
      if (
        (steered === "steered" && current?.busy ||
          steered === "indeterminate" && current) &&
        store.taskByThread(bot.id, bot.threadId)
      ) {
        if (auth.kind === "session" || DESKTOP_MANAGED) clearUnattended(bot.threadId);
        const messages = held.items.map((item: any) => store.appendMessage(bot.threadId, {
          role: "user",
          kind: "text",
          text: item.text,
          replyToId: item.replyToId,
          sendId: item.sendId,
          ...(item.dataContext ? { dataContext: item.dataContext } : {}),
          queueId: item.messageId,
          peerAsk: item.peerAsk,
          steered: true,
          sender: item.sender,
          ...(item.voiceCall ? { voiceCall: item.voiceCall } : {}),
          ...spokenLineFields(item.via, item.callId),
        }));
        // Words a person queued are written here once steered in, as once a
        // drained turn starts with them (startTurn); a bot's own never are.
        const asked = messages.filter((_, index) => !held.items[index]?.unattended && !held.items[index]?.peerAsk).at(-1);
        if (asked) store.setTaskAskedAt(bot.id, bot.threadId, asked.at);
        // Offered to the next turn again unless the person stops this one.
        // one steer carried them all: the engine taking it in takes them all
        for (const message of messages) {
          handoffs.steered(bot.threadId, steerTarget, instance?.instanceId, message.id, steerId);
          try {
            recordHeldSteer(DATA_DIR, {
              botId: bot.id, threadId: bot.threadId, messageId: message.id,
              text: typeof message.text === "string" ? message.text : "", at: message.at,
            });
          } catch (error) {
            console.warn(`held-steers: could not record steered queue: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
        const queueIds = held.items.map((item: any) => item.messageId);
        settleHeldSteeredQueue(held);
        return json(res, 200, { ok: true, steered: true, threadId: bot.threadId, messages, queueIds });
      }
      if (steered === "indeterminate") {
        // No destination is left: settle so a restart cannot replay words a
        // dead turn may already have run.
        settleHeldSteeredQueue(held);
        if (!store.taskByThread(bot.id, bot.threadId)) {
          throw Object.assign(new Error("the target task no longer exists"), { status: 409 });
        }
        throw Object.assign(new Error("no such bot"), { status: 404 });
      }
      restoreHeldSteeredQueue(held);
      // The turn may have settled while the steer was refused; a queue that
      // is now drainable must not strand behind a missed settle.
      if (current && !current.busy) drainQueuedSends();
      return json(res, 200, { ok: true, queued: true, threadId: bot.threadId });
    }

    // Compaction shares normal turn admission and Stop, but never executes
    // an agent turn or provisions a computer. It preserves the full history.
    m = path.match(/^\/api\/bots\/([\w-]+)\/compact$/);
    if (m && method === "POST") {
      const body = await readBody(req);
      requirePinnedClientThread(auth, req, m[1], body?.threadId);
      const bot = requestedTaskBot(m[1], body?.threadId);
      const notYours = cloudThreadRefusal(auth, bot.threadId);
      if (notYours) return json(res, 403, { error: notYours });
      await startTurn(bot.id, "Summarize conversation context", {
        threadId: bot.threadId, compactOnly: true, cardContinuation: true, trigger: usageTriggerFor(auth), speaker: speakerFor(auth),
      });
      return json(res, 202, { ok: true, threadId: bot.threadId });
    }

    // edit a user message → fork the conversation there and rerun the turn.
    // Rewinding a live thread is refused, exactly like switching versions
    // below: interrupting mid-flight and branching under the dying turn is
    // how a conversation ends up with two tails. Stop, then edit.
    m = path.match(/^\/api\/bots\/([\w-]+)\/messages\/([\w-]+)\/edit$/);
    if (m && method === "POST") {
      const messageId = m[2];
      const body = await readBody(req);
      requirePinnedClientThread(auth, req, m[1], body?.threadId);
      const bot = requestedTaskBot(m[1], body.threadId);
      const notYours = cloudThreadRefusal(auth, bot.threadId);
      if (notYours) return json(res, 403, { error: notYours });
      const text = String(body.text ?? "").trim();
      if (!text) return json(res, 400, { error: "text required" });
      const threadMessages = store.messagesFor(bot.threadId);
      const source = threadMessages.find((msg: any) => msg.id === messageId);
      if (!source || source.role !== "user" || source.kind !== "text") {
        return json(res, 404, { error: "only user messages can be edited" });
      }
      // The client's id for this edit. A retry of an edit the server already
      // forked answers with that fork instead of forking (and rerunning) again.
      // Checked before the busy guard: that fork's own turn is what is busy.
      const sendId = parseSendId(body.sendId);
      if (sendId) {
        const accepted = acceptedSendMatch(threadMessages, sendId, text, source.replyToId);
        if (accepted.kind === "conflict" || (accepted.kind === "match" && (accepted.message.parentId ?? null) !== (source.parentId ?? null))) {
          return json(res, 409, { error: "sendId already belongs to another message" });
        }
        if (accepted.kind === "match") return json(res, 202, { ok: true, message: accepted.message });
      }
      // everything from here down is synchronous, so two racing edits can
      // never both get past this check: startTurn flips busy before the
      // next request is handled
      if (threadBusy(bot.id, bot.threadId)) return json(res, 409, { error: "the thread is working — stop it before editing" });
      if (phoneSecretSubmissions.hasThread(bot.threadId)) {
        return json(res, 409, { error: "this task is securely saving a credential — try again when it finishes" });
      }
      // A thread's own model that can't run gives way to the bot's when the
      // rerun starts (healThreadModel), so check the model it will run on.
      const rerunSelection = turnSelection(bot.id, bot.threadId) ?? bot.modelSelection;
      if (!registry.get(rerunSelection.instanceId)) {
        return json(res, 409, {
          error: `${engineReference(rerunSelection.instanceId)} is unavailable — pick another model in settings`,
        });
      }
      const rerunInstance = registry.get(rerunSelection.instanceId)!;
      const rerunRefusal = policyModelRefusal(rerunInstance);
      if (rerunRefusal) return json(res, 409, { error: rerunRefusal });
      // startTurn admits the rerun before branching. A shared-resource or
      // concurrency-limit refusal must leave the original transcript intact.
      const replyTo = source.replyToId ? resolveReplyTarget(bot.threadId, source.replyToId) : undefined;
      // Regenerate resends the same words: the rerun gets the Data context
      // the message was sent with, so the model sees what it saw. Changed
      // words take the context the client sends now, if any.
      const dataContext = ownPageContext(parseDataContext(body.dataContext), bot.id, auth) ?? (text === source.text ? source.dataContext : undefined);
      devPodsThreads.note(bot.threadId, parseDevPods(body.devPods));
      if (typeof body.singleStream === "boolean") noteStreamSend(bot.id, bot.threadId, body.singleStream);
      // On a Cloud home an edit is its author's line, so the owner's own edit
      // keeps their conversation theirs for lending (server/cloud-lending.ts).
      const message = await startTurn(bot.id, text, { threadId: bot.threadId, editedMessageId: messageId, replyTo, sendId, trigger: usageTriggerFor(auth), speaker: speakerFor(auth), dataContext,
     });
      return json(res, 202, { ok: true, message });
    }

    // switch which fork of the conversation is visible (no new turn)
    m = path.match(/^\/api\/bots\/([\w-]+)\/respond$/);
    if (m && method === "POST") {
      const body = await readBody(req);
      const selected = requestedTaskBot(m[1], body.threadId);
      const bot = botForThread(selected.id, selected.threadId)!;
      const behavior = requestBehavior(body.behavior);
      const reviewedSha256 = typeof body.reviewedSha256 === "string" ? body.reviewedSha256 : undefined;
      if (!behavior) return json(res, 400, { error: "behavior must be allow, deny, or answer" });
      // The security key comes first, before any path that settles a card
      // (a bot act included): server/step-up-gate.ts.
      const stepUpRefusal = stepUpGate(ruleManager(auth), bot.threadId, String(body.requestId), behavior, stepUpAnswerOf(body), body.stepUp);
      if (stepUpRefusal) return json(res, stepUpRefusal.status, stepUpRefusal.body);
      if (delegatedRequest() && store.isConfidentialThread(bot.threadId)) return json(res, 403, { error: CONFIDENTIAL_CARD_DELEGATED, code: "confidential_thread" });
      if (isConfidentialMemoryCard(bot.threadId, String(body.requestId))) {
        const settled = await settleConfidentialMemoryCard(auth, bot.threadId, String(body.requestId), behavior);
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
        const outcome = await answerRequest(bot.threadId, bot.modelSelection.instanceId, requestId, behavior, body.message, { id: bot.id, name: bot.name }, body.always === true, body.rememberCommand === true);
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
    // Answer by THREAD, so a request raised inside a room can be answered
    // too: a member's turn runs on the room's thread, and the bot that
    // owns the pending request is the one currently speaking there.
    m = path.match(/^\/api\/threads\/([\w-]+)\/respond$/);
    if (m && method === "POST") {
      const threadId = m[1];
      const body = await readBody(req);
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
        const settled = await settleConfidentialMemoryCard(auth, threadId, requestId, behavior);
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
        const outcome = await answerRequest(threadId, requestOwner?.modelSelection.instanceId ?? "", requestId, behavior, body.message, owner ? { id: owner.id, name: owner.name } : undefined, body.always === true, body.rememberCommand === true);
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
    m = path.match(/^\/api\/bots\/([\w-]+)\/interrupt$/);
    if (m && method === "POST") {
      const bot = store.bot(m[1]);
      if (!bot) return json(res, 404, { error: "no such bot" });
      const rawBody = await readBody(req);
      if (rawBody !== null && (typeof rawBody !== "object" || Array.isArray(rawBody))) {
        return json(res, 400, { error: "body must be a JSON object" });
      }
      const body = rawBody ?? {};
      requirePinnedClientThread(auth, req, bot.id, body.threadId);
      if (body.expectedUtteranceId !== undefined && (typeof body.expectedUtteranceId !== "string" || !/^[\w-]+$/.test(body.expectedUtteranceId))) {
        return json(res, 400, { error: "expectedUtteranceId must be an utterance id" });
      }
      const expectedUtteranceId = typeof body.expectedUtteranceId === "string" ? body.expectedUtteranceId : undefined;
      // Organization server: a person stops their own thread only, never
      // the bot's work for someone else (another person's thread, a room,
      // the owner's routine). The owner keeps the whole-bot stop.
      const stopper = scopedThreadViewer();
      if (stopper && !(viewerBotLevel(auth, bot) === "owner")) {
        const own = routeThreadId(bot, body.threadId);
        if (expectedUtteranceId && pinVoiceInterrupt({
          expectedUtteranceId,
          liveUtteranceId: liveVoiceUtteranceByThread.get(own),
        }) === "skip") {
          return json(res, 200, { ok: true, skipped: true });
        }
        const run = routines!.activeBotRunForBot(bot.id);
        if (run?.threadId === own) await routines!.cancelRun(run.id);
        else await stopDirectThreadByPerson(bot.id, own, expectedUtteranceId);
        return json(res, 200, { ok: true });
      }
      if (stopper && body.threadId !== undefined) routeThreadId(bot, body.threadId);
      const expectedThreadId = body.threadId;
      if (expectedThreadId !== undefined && (typeof expectedThreadId !== "string" || !/^[\w-]+$/.test(expectedThreadId))) {
        return json(res, 400, { error: "threadId must be a task id" });
      }
      if (expectedUtteranceId && pinVoiceInterrupt({
        expectedUtteranceId,
        liveUtteranceId: liveVoiceUtteranceByThread.get(typeof expectedThreadId === "string" ? expectedThreadId : bot.threadId),
      }) === "skip") {
        return json(res, 200, { ok: true, skipped: true });
      }
      // Explicit thread targets never fall through to another routine or
      // channel just because it belongs to the same bot.
      if (typeof expectedThreadId === "string" && store.taskByThread(bot.id, expectedThreadId)) {
        const routine = routines!.activeBotRunForBot(bot.id);
        if (routine?.threadId === expectedThreadId) await routines!.cancelRun(routine.id);
        else await stopDirectThreadByPerson(bot.id, expectedThreadId, expectedUtteranceId);
        return json(res, 200, { ok: true });
      }
      const directClaim = directTurnDispatchClaims.get(bot.threadId);
      const routineRun = routines!.activeBotRunForBot(bot.id);
      if (routineRun) {
        if (expectedThreadId !== undefined && routineRun.threadId !== expectedThreadId) {
          return json(res, 409, { error: "this bot is running a routine in another conversation" });
        }
        cancelDirectTurnDispatch(bot.id, routineRun.threadId ?? expectedThreadId);
        if (routineRun.threadId) {
          revokeInternalCapabilitiesForThread(routineRun.threadId);
        }
        await routines!.cancelRun(routineRun.id);
        return json(res, 200, { ok: true });
      }
      const instance = registry.get((botForThread(bot.id, expectedThreadId ?? bot.threadId) ?? bot).modelSelection.instanceId);
      // a bot busy in a ROOM is running on the room's thread — stopping it
      // from its own chat must reach that turn, not just the 1:1 thread
      const busyGroup = activeGroupTurnForBot(bot.id);
      if (busyGroup) {
        if (expectedThreadId !== undefined && busyGroup.threadId !== expectedThreadId) {
          return json(res, 409, { error: `this bot is working in channel ${busyGroup.group.name}` });
        }
        videoGenerations.cancelThread(busyGroup.threadId, bot.id);
        cancelGroupTurnOperations(busyGroup.group.id, busyGroup.threadId);
        revokeInternalCapabilitiesForThread(busyGroup.threadId);
        await instance?.adapter.interruptTurn(busyGroup.threadId).catch(() => {});
        closeOpenApprovals(busyGroup.threadId);
        return json(res, 200, { ok: true });
      }
      if (
        expectedThreadId !== undefined &&
        !busyGroup &&
        bot.threadId !== expectedThreadId &&
        directClaim?.threadId !== expectedThreadId
      ) {
        return json(res, 409, { error: "the bot switched tasks before it could be interrupted" });
      }
      await stopDirectThreadByPerson(bot.id, expectedThreadId ?? bot.threadId, expectedUtteranceId);
      return json(res, 200, { ok: true });
    }

        return PASS;
  };
}

