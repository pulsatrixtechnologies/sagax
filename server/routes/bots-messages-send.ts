/**
 * POST /api/bots/:id/messages and /messages/guarded (#1388 B3).
 * Never imports server/index.ts.
 */
import { randomUUID } from "node:crypto";

import type { BusySendRequest } from "../../shared/parallel-tasks.ts";
import type { ResolvedSender } from "../../shared/wire.ts";
import type { SteerOutcome } from "../contracts.ts";
import type { TurnSpeaker } from "../engines/engine-access.ts";
import type { ReplyTarget } from "../messages/replies.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import type { Message } from "../store.ts";
import type { UsageTrigger } from "../usage/usage-ledger.ts";
import { approvalModeFor } from "../../shared/approval-mode.ts";
import { promptWithDataContext } from "../../shared/data-context.ts";
import { isBusySendRequest } from "../../shared/parallel-tasks.ts";
import { isStopIntent } from "../../shared/stop-intent.ts";
import {
  masterySendFacts,
  modelFamily,
} from "../achievements/achievements-mastery.ts";
import { achievementSendEvents } from "../achievements/achievements.ts";
import { admit } from "../admission.ts";
import {
  classifyWithoutSteer,
  orchestratedSteerText,
} from "../busy-routing.ts";
import { prepareWidgetPress } from "../widgets/chat-widgets.ts";
import { claudeActivityEvents } from "../engines/claude-activity.ts";
import { cloudGuestSendRefusal } from "../cloud-thread-refusal.ts";
import { DATA_DIR } from "../config.ts";
import { parseDataContext } from "../data-context.ts";
import { parseDevPods } from "../dev-pods-prompt.ts";
import {
  typedCommandForTurn,
  unavailableCommandError,
} from "../harness-commands.ts";
import { recordHeldSteer } from "../turns/held-steers.ts";
import { introAdvance } from "../intro-tour.ts";
import { cancelledChatFollowup } from "../messages/message-db.ts";
import { misuseRefusal } from "../safety/misuse-guardrails.ts";
import { ORG_FULL_ACCESS_DISABLED } from "../org/org-full-access.ts";
import { promptWithReply } from "../messages/replies.ts";
import {
  personKey,
  speakerFor,
} from "../request-speaker.ts";
import { SAFE_POINT_NOTE } from "../safe-point-preempt.ts";
import { safetyHttpRefusal } from "../safety/safety-review.ts";
import {
  acceptedSendMatch,
  parseSendId,
  sendFingerprint,
} from "../messages/send-idempotency.ts";
import {
  soloGoalCommand,
  soloGoalLine,
} from "../solo-goal.ts";
import { assertWithinBudget } from "../usage/spend.ts";
import {
  queueSteeredMessage,
  queuedSteeredMessage,
} from "../turns/steer-queue.ts";
import { extractTurnImages } from "../turns/turn-images.ts";
import {
  voiceFullDuplexEnabled,
  withoutDuplexMarks,
} from "../voice/voice-call-duplex.ts";
import {
  parseVoiceCallMeta,
  voiceCallSteerPrompt,
} from "../voice/voice-call-prompt.ts";
import { parseVoiceClientTiming } from "../voice/voice-timing.ts";
import type { BotsMessagesRouteDeps } from "./bots-messages-deps.ts";
import { PASS, type RouteContext, type RouteHandler } from "./table.ts";

interface AutoRouteContext {
  replyTo?: Message;
  sendId?: string;
  sender?: ResolvedSender;
  trigger?: UsageTrigger;
  speaker?: TurnSpeaker;
  principalId?: string;
  auth?: RequestAuth;
}

async function runSequencedBotSend(input: {
  auth: RequestAuth;
  body: any;
  bot: any;
  busyMode: BusySendRequest;
  dataContext: any;
  guarded: boolean;
  replyTo: ReplyTarget | undefined;
  sendId: string | undefined;
  text: string;
  threadId: string;
  trigger: UsageTrigger;
  voiceCall: any;
  store: any;
  messageSender: any;
  cfg: any;
  threadBusy: any;
  IDENTITY: any;
  DESKTOP_MANAGED: any;
  DUPLEX_JOIN_RUNNING_TURN: any;
  activeGroupTurnForBot: any;
  autoRoutableThread: any;
  botAtThreadCapacity: any;
  busyClassifyEngine: any;
  clearUnattended: any;
  computerSelectionTurns: any;
  enginesRead: any;
  handoffs: any;
  isInternalTurn: any;
  orgFullAccessPolicy: any;
  orgJoinsRunningTurn: any;
  parksBehindCoordination: any;
  preemptAtSafePoint: any;
  refreshUnsetModelSelections: any;
  registry: any;
  routableSteers: any;
  runningRequestText: any;
  runningTurnInstance: any;
  startDuplexCallTurn: any;
  startOrQueueDirectMessage: any;
  startParallelTask: any;
  startTurn: any;
  stoppingThreads: any;
}): Promise<any> {
  const {
    auth, body, bot, busyMode, dataContext, guarded, replyTo, sendId, text, threadId, trigger, voiceCall,
    store, messageSender, cfg, threadBusy,
    IDENTITY, DESKTOP_MANAGED, DUPLEX_JOIN_RUNNING_TURN,
    activeGroupTurnForBot, autoRoutableThread, botAtThreadCapacity, busyClassifyEngine,
    clearUnattended, computerSelectionTurns, enginesRead, handoffs, isInternalTurn,
    orgFullAccessPolicy, orgJoinsRunningTurn, parksBehindCoordination, preemptAtSafePoint,
    refreshUnsetModelSelections, registry, routableSteers, runningRequestText, runningTurnInstance,
    startDuplexCallTurn, startOrQueueDirectMessage, startParallelTask, startTurn, stoppingThreads,
  } = input;

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
  // preconditions. Provider discovery yields, and reads a thread's own model's
  // engines at start before it may give way; transcript reservation after
  // those checks must remain synchronous.
  const ownModel = store.taskByThread(bot.id, threadId)?.modelSelection;
  const ownModelRead = ownModel && registry.engineRead?.(ownModel.instanceId, store.bot(bot.id)?.modelSelection.instanceId);
  if (ownModelRead) await ownModelRead;
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
      // #2575: an AI client's prompt keeps its own turn and reply
      ...(body.aiClient === true ? { aiClient: true } : {}),
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
    const resolvedAttachments = extractTurnImages(text);
    const carriesImages = resolvedAttachments.images.length > 0 || resolvedAttachments.videos.length > 0;
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
      // background-sweep.ts: what the server archived is theirs again
      if (store.taskByThread(bot.id, threadId)?.openedBy?.kind !== "agent") store.restoreAutoArchived(bot.id, threadId);
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
}

async function handleBotMessagePost(deps: BotsMessagesRouteDeps, ctx: RouteContext): Promise<typeof PASS | void> {
  const { req, res, path, method, auth, json, readBody } = ctx;
  const {
    achievementCallStarts, actorPrincipalId, activeGroupTurnForBot, appendSoloGoalRow, autoRoutableThread,
    botAtThreadCapacity, busyClassifyEngine, cfg, clearUnattended, closeCutToolRows, computerSelectionTurns,
    confirmStop, delegatedRequest, DESKTOP_MANAGED, devPodsThreads, DUPLEX_JOIN_RUNNING_TURN, enginesRead,
    finishUntilRuns, guardedSendSchema, handoffs, harnessCommandSource, harnessCommandSpeaker, harnessCommands,
    IDENTITY, isInternalTurn, liveTurnByThread, masteryThreadModel, messageSender, misuseActor, noteStreamSend,
    orgFullAccessPolicy, orgJoinsRunningTurn, ownPageContext, parksBehindCoordination, preemptAtSafePoint,
    recordAchievements, recordMastery, refreshUnsetModelSelections, registry, requirePinnedClientThread,
    resolveReplyTarget, routeThreadId, routableSteers, routines, runningRequestText, runningTurnInstance,
    sendSequencer, soloGoalReceipts, soloGoals, startDuplexCallTurn, startOrQueueDirectMessage, startParallelTask,
    startTurn, stoppingThreads, stopDirectThreadByPerson, store, threadBusy, usageTriggerFor, voiceCalls,
    voiceLatency, widgetPressesInFlight, feedback,
  } = deps;
  let m: RegExpMatchArray | null = null;
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
    // not only the page's mark (server/voice/voice-call-session.ts).
    const voiceCall = guarded ? sentVoiceCall : voiceCalls.markFor(threadId, sentVoiceCall);
    // #2618: the Feedback bot's conversation, a /feedback typed in any chat
    // and the answers to its questions are the server's own short flow: no
    // turn runs (server/feedback/service.ts). Ahead of the engine command
    // check, which would refuse /feedback as an unknown command.
    if (feedback && !guarded && !pressed && !voiceCall) {
      const feedbackSendId = parseSendId(body.sendId);
      const earlier = feedbackSendId ? store.messagesFor(threadId).find((m: any) => m.role === "user" && m.sendId === feedbackSendId) : undefined;
      const handled = earlier ?? feedback.handleMessage({
        botId: bot.id, threadId, text: typed, principalId: actorPrincipalId(auth) || null,
        ...(feedbackSendId ? { sendId: feedbackSendId } : {}), sender: messageSender(auth),
      });
      if (handled) return json(res, 202, { ok: true, threadId, message: handled });
    }
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
    // (server/messages/replies.ts transcriptText); it is never asked to do it.
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
      // an onboarding card, no permission; full-access: exempt
      if (intro.kind === "card") store.appendMessage(threadId, { role: "bot", kind: "options", card: intro.card });
      else store.appendMessage(threadId, { role: "bot", kind: "text", text: intro.text });
      return json(res, 202, { ok: true, threadId, message });
    }
    const text = press ? press.text : postedText;
    const target = resolveReplyTarget(threadId, press ? press.messageId : body.replyToId);
    // Only here is a reply known to be a press: a copy of the widget row
    // says so to whatever composes the prompt (server/messages/replies.ts). A typed
    // reply to the same row carries no such mark, whatever its words.
    const replyTo: ReplyTarget | undefined = press && target ? { ...target, widgetPress: { label: press.label, action: press.action } } : target;
    const pressKey = press?.settles ? `${threadId}:${press.messageId}` : undefined;
    if (pressKey && widgetPressesInFlight.has(pressKey) && !(sendId && widgetPressesInFlight.get(pressKey) === sendId)) {
      return json(res, 409, { error: "That answer is already on its way." });
    }
    // A Data context is put in front of the words the model gets, and a
    // press is read by its first line (server/messages/replies.ts): it carries none.
    const dataContext = press ? undefined : ownPageContext(parseDataContext(body.dataContext), bot.id, auth);
    // the coding view is on for the device that sent this (server/dev-pods-prompt.ts)
    devPodsThreads.note(threadId, parseDevPods(body.devPods));
    // Single stream (server/streams/single-stream.ts): a client showing one
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
    if (messageMisuse) return json(res, messageMisuse.status, { error: messageMisuse.message, code: messageMisuse.code, ...(messageMisuse.reason ? { reason: messageMisuse.reason } : {}) });
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
      () => runSequencedBotSend({
        auth, body, bot, busyMode, dataContext, guarded, replyTo, sendId, text, threadId, trigger, voiceCall,
        store, messageSender, cfg, threadBusy,
        IDENTITY, DESKTOP_MANAGED, DUPLEX_JOIN_RUNNING_TURN,
        activeGroupTurnForBot, autoRoutableThread, botAtThreadCapacity, busyClassifyEngine,
        clearUnattended, computerSelectionTurns, enginesRead, handoffs, isInternalTurn,
        orgFullAccessPolicy, orgJoinsRunningTurn, parksBehindCoordination, preemptAtSafePoint,
        refreshUnsetModelSelections, registry, routableSteers, runningRequestText, runningTurnInstance,
        startDuplexCallTurn, startOrQueueDirectMessage, startParallelTask, startTurn, stoppingThreads,
      }),
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
    // #2618: one ready-made report offered when the person sounds frustrated
    if (feedback && !guarded && !pressed && !voiceCall) feedback.maybeOffer({ botId: bot.id, threadId, text, principalId: person || null });
    return json(res, 202, receipt);
  }
  return PASS;
}

export function createBotsMessagesSendRoutes(deps: BotsMessagesRouteDeps): RouteHandler {
  return (ctx) => handleBotMessagePost(deps, ctx);
}
