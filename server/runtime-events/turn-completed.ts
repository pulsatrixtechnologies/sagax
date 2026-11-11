// @ts-nocheck
/** handleTurnCompleted (#1388). Pure move from server/index.ts bus.subscribe. */
import { INCIDENTS_THREAD_TITLE } from "../peers/incidents.ts";
import { isShuttingDown } from "../process/http-shutdown.ts";
import { isEngineEmptyFailure } from "../peers/incidents.ts";
import { withBotNotify } from "../../shared/notification.ts";
import { retireSafetyHolds } from "../safety/safety-review.ts";
import { firstSignedOut } from "../engines/engine-refusals.ts";
import { ROUTINE_PROBLEM_STREAK_TOLD } from "../../shared/routine-repeat.ts";
/** Whether a finished routine run rings "done": a completed result the
 * routine posts, never a quiet one, never one whose items for the person
 * rang "needs you" from its card, and (#3479) never the same problem as the
 * previous run, which its first run said already. */
export function routineRunRingsDone(routineRun: any, host: any): boolean {
  // #3695: a routine that repeats more than once a day rings once, with the
  // card that says its problems lasted ROUTINE_PROBLEM_STREAK_TOLD runs
  if (host.routines?.reportsByStreak?.(routineRun) && !host.personAttention(routineRun.output)) {
    return routineRun.status === "completed" && Boolean(routineRun.problems) && (routineRun.problemRepeat?.count ?? 1) === ROUTINE_PROBLEM_STREAK_TOLD;
  }
  return routineRun.status === "completed" && !routineRun.quiet && !routineRun.problemRepeat
    && host.routineEffectivePostResults(routineRun) && !host.personAttention(routineRun.output);
}

export function handleTurnCompleted(event: any, ctx: any, host: any): void {
  const { deleteAttachment, endedToolOutput } = host;
  const {
    bot, group, speaker, pushMessage, routineRun, completedTurnId,
  } = ctx;
  switch (event.type) {
    case "turn.completed":
    {
      if (event.ok && bot) {
        const instance = host.registry.get(event.providerInstanceId ?? bot.modelSelection.instanceId);
        const access = host.turnAccessByThread.get(event.threadId);
        if (instance) host.clearEngineRefusal(instance.instanceId, host.refusalAccount(access?.via ?? "server", access?.payerPrincipalId, host.turnSlotFor(bot, instance)));
        // #3551: the account signs in again: its open sign-in cards close on every bot
        if (instance && access?.payerPrincipalId) host.signInCards?.signedIn(access.payerPrincipalId, { instanceId: instance.instanceId });
      }

      host.safePoints.clear(event.threadId);
      host.turnReplyRepeats.settle(event.threadId, event.turnId);
      host.autoApprovals.clear(event.threadId);
      host.roleJournal.endTurn(event.threadId);
      // QA 0.8.67 G5: a held card (a role switch, a safety hold) of this
      // turn can no longer be answered for it: retired with the turn, its
      // card marked expired, so the next turn's await never surfaces it.
      retireSafetyHolds(event.threadId, bot?.id ?? speaker?.botId);
      host.appPiecesByThread.delete(event.threadId);
      host.settleWaitingOnPersonChips(event.threadId);
      // A peer-started turn settles as coordination, not as news. What keeps
      // that classification from outliving its turn is the rewrite at
      // dispatch, not this line — releasing it here too is hygiene, so a
      // thread nobody types in again (a deleted bot's) is not held forever.
      const internal = host.isInternalTurn(event.threadId);
      host.clearInternalTurn(event.threadId);
      const reviewAnswer = host.reviewAnswerThreads.delete(event.threadId);
      const generatedKey = host.turnAttachmentKey(event.threadId, event.turnId);
      const generated = host.turnAttachmentsByTurn.get(generatedKey) ?? [];
      host.turnAttachmentsByTurn.delete(generatedKey);
      // A turn that never completed never lands its half-said note: parked
      // audio is deleted when the settle is not ok (person stop, provider
      // failure) rather than posted as if the turn finished (#1742).
      // Generated images keep their long-standing settle-anyway behavior.
      for (const attachment of generated) {
        if (event.ok || attachment.kind !== "audio") continue;
        deleteAttachment(attachment.path);
      }
      const settled = event.ok || !generated.length
        ? generated
        : generated.filter((attachment) => attachment.kind !== "audio");
      if (settled.length) {
        const response = [...host.store.messagesFor(event.threadId)].reverse().find(
          (message) =>
            message.role === "bot" &&
            message.kind === "text" &&
            message.turnId === completedTurnId,
        );
        // A voice note's text is its transcript: the visible caption search,
        // compaction and notifications read (#1740 decision 3).
        const transcript = settled
          .filter((attachment) => attachment.kind === "audio" && attachment.text)
          .map((attachment) => attachment.text!.trim())
          .filter(Boolean)
          .join("\n\n");
        const staged = settled.map((attachment) =>
          attachment.kind === "audio"
            ? { kind: "audio" as const, path: attachment.path, mime: attachment.mime }
            : attachment,
        );
        if (response) {
          host.store.patchMessage(event.threadId, response.id, {
            attachments: [...(response.attachments ?? []), ...staged],
            // The note's text is its transcript and stays visible beside a
            // written epilogue: the wire audio carries no text, so letting
            // the epilogue replace it would erase what was said (#1740
            // decision 3).
            ...(transcript
              ? {
                  text: [response.text?.trim(), host.redactSecretsInText(transcript)]
                    .filter(Boolean)
                    .join("\n\n")
                }
              : {})
          });
        } else {
          // Some turns have no textual epilogue. Keep the attachment as the
          // terminal assistant response instead of inventing model words; a
          // voice note's own text is the visible transcript there.
          pushMessage({
            role: "bot",
            kind: "text",
            text: transcript,
            attachments: staged,
            turnId: completedTurnId
          });
        }
      }
      if (completedTurnId) {
        const terminal = host.store.markTerminalAssistantMessage(event.threadId, completedTurnId);
        if (terminal) host.store.patchMessage(event.threadId, terminal.id, { turnSucceeded: event.ok });
        if (bot && event.ok) host.store.suggestTaskLink(bot.id, event.threadId, host.store.activePath(event.threadId)
          .filter((message) => message.role === "bot" && message.kind === "text" && message.turnId === completedTurnId)
          .map((message) => message.text ?? "").join("\n"));
      }
      const reply = host.lastReply.get(event.threadId) ?? "";
      host.lastReply.delete(event.threadId);
      // A parallel task's first turn answers in the conversation it came from.
      host.settleParallelTask(event.threadId, { ok: event.ok, reply, why: event.stopReason ?? undefined });
      const stoppedTurnId = host.stoppedTurns.get(event.threadId);
      const clientStopped = host.stoppedTurns.has(event.threadId)
        && (stoppedTurnId === undefined || completedTurnId === undefined || stoppedTurnId === completedTurnId);
      host.stoppedTurns.delete(event.threadId);
      // ACP and Pi acknowledge a clean Stop as cancelled, without a text
      // or error row. It must not become an unfinished-turn continuation.
      const stopped = event.stopReason === "interrupted" || event.stopReason === "cancelled" || clientStopped;
      // The turn is over: no call or sub-agent of it can still be at work.
      host.closeCutToolRows(event.threadId, endedToolOutput({ stopped }));
      // Hang up only when the goodbye finished. A failed or interrupted
      // turn drops the request so a later turn does not inherit it.
      host.finishVoiceCallRequestedByBot(event.threadId, host.voiceCallTurnSettle(event, stopped));
      // A run that broke — not one the person stopped, and not a routine's,
      // which reports through its own failure path — is the Primary Bot's to see.
      // A lazy computer-claim rejection already reported its failure and
      // interrupted the turn; Claude settles that interrupt as
      // exit_before_result, not "interrupted", so this generation's marker
      // keeps the same failure from reporting a second incident.
      // A turn parked at the computer ceiling (#1651) settles itself the
      // same way: interrupted for a resume, not broken.
      const lazyClaimAlreadyReported = event.stopReason === "exit_before_result" &&
        host.turnResourceOwners.get(event.threadId)?.lazyClaimFailureReported === true;
      const computerParked = event.stopReason === "exit_before_result" &&
        host.turnResourceOwners.get(event.threadId)?.computerParkedOn !== undefined;
      // A usage limit: another engine continues the turn, or it waits for the
      // reset (server/usage/limit-failover-host.ts); either way no incident.
      // Prefer backup failover over reconnect-wait / usage requeue when a
      // backup exists: pass waiting and queued routine runs too (Claude
      // extra-usage often lands as waiting, never failed).
      const failureCause = host.turnFailureCause(event);
      const usageLimitShaped = Boolean(host.limitKindOf(failureCause, event.stopReason));
      const routineForFailover = (() => {
        // A provider refusal now settles as blocked (routine reliability).
        // Keep it on the routine rerun path, never as a direct resend.
        if (!usageLimitShaped) return routineRun && ["failed", "blocked"].includes(routineRun.status) ? routineRun : null;
        const candidate = routineRun ?? host.routines?.runForThread(event.threadId);
        return candidate && ["failed", "blocked", "waiting", "queued"].includes(candidate.status) ? candidate : null;
      })();
      const limitTaken = !event.ok && !stopped && !lazyClaimAlreadyReported && !computerParked && Boolean(bot) &&
        host.limitFailover.turnFailed({ threadId: event.threadId, turnId: completedTurnId, cause: failureCause, stopReason: event.stopReason,
          routineRun: routineForFailover, engine: event.providerInstanceId ?? bot?.modelSelection.instanceId });
      // reasoning_only / empty model on a chat turn: one automatic resend of
      // the same user message before an incident (server/empty-response-retry.ts).
      const emptyDetail = failureCause ?? event.stopReason;
      const emptyRetried = host.shouldEmptyResponseRetry({
        ok: event.ok,
        stopped,
        limitTaken,
        alreadyReported: lazyClaimAlreadyReported || computerParked,
        isRoutine: Boolean(host.routines?.runForThread(event.threadId) || routineRun),
        empty: isEngineEmptyFailure(emptyDetail),
        detail: emptyDetail,
        take: () => host.emptyResponseRetry.take(event.threadId),
      });
      if (emptyRetried && bot) {
        const request = host.directRequestOwners.get(event.threadId);
        const messageId = request?.messageId;
        if (messageId && !request?.stopped && request?.origin?.kind === "user") {
          host.resendUserMessage(bot.id, event.threadId, messageId, host.turnSpeakers.get(event.threadId), "empty-response-retry");
        }
      } else if (event.ok) {
        host.emptyResponseRetry.clear(event.threadId);
        host.signInRefusalResent.delete(event.threadId);
      }
      // #2057: a sign-in refusal held for its renew reports when it settles.
      const signInHeld = host.signInRefusalHeld.delete(event.threadId);
      // #3315: a turn its engine refused for a sign-in holds that engine for
      // this payer (new turns and conversations start on a chosen backup),
      // and its stretch files one incident per bot, not one per refused turn.
      let signedOutAgain = false;
      if (!event.ok && !stopped && bot) {
        const verdict = host.readinessFailureClass(failureCause ?? "", { stopReason: event.stopReason });
        const instance = host.registry.get(event.providerInstanceId ?? bot.modelSelection.instanceId);
        if (instance && verdict.kind === "owner" && verdict.cause === "signed_out") {
          const access = host.turnAccessByThread.get(event.threadId);
          const account = host.refusalAccount(access?.via ?? "server", access?.payerPrincipalId, host.turnSlotFor(bot, instance));
          host.noteEngineRefusal({ engine: instance.instanceId, account, cause: "signed_out", at: Date.now() });
          signedOutAgain = !firstSignedOut(instance.instanceId, account, `incident:${bot.id}`);
        }
      }
      if (!event.ok && !stopped && !limitTaken && !emptyRetried && !signInHeld && !signedOutAgain && !lazyClaimAlreadyReported && !computerParked && !host.routines?.runForThread(event.threadId)) {
        const broken = bot ?? (speaker ? host.store.bot(speaker.botId) : undefined);
        if (broken) host.reportIncident({ kind: "failed", bot: broken, threadId: event.threadId, detail: failureCause ?? "the run ended without a result" });
      }
      const lastReported = host.turnUsage.get(event.threadId);
      host.turnUsage.delete(event.threadId);
      const lastContext = host.turnContext.get(event.threadId);
      host.turnContext.delete(event.threadId);
      // group turns run on the room's thread — the speaking bot's task
      // tally is not the right home for a shared room's spend, so only
      // 1:1 task turns are tallied for now.
      settleTurnTask(event, ctx, host, { internal, reviewAnswer, reply, clientStopped, stopped, lastReported, lastContext });
      if (speaker) {
        host.releaseTurnResources(host.turnResourceOwners.get(event.threadId));
        host.groupSpeakers.delete(event.threadId);
        const remaining = group ? host.activeGroupSpeaker(group.id) : undefined;
        if (group) host.store.patchGroup(group.id, { busyBotId: remaining?.botId ?? null, unread: true });
        const speakingBot = host.store.bot(speaker.botId);
        if (speakingBot?.busy) {
          host.store.setActivity(speakingBot.id, "idle");
          host.retryDelegationsWaitingOn(speakingBot.id);
        }
      }
      // A delegated turn's terminal state belongs in the A⇄B channel:
      // the request was mirrored there when the delegation drained, and a
      // channel that only ever shows requests is half a record. Mirror the
      // reply on success; mirror a failed/stopped terminal chip otherwise.
      // Either one carries the note on approvals nobody answered: a failed
      // turn's requester reads only its failure.
      const delegationFailureName = host.unansweredApprovals.annotate(event.threadId, event.turnId, !event.ok && host.delegationWatch.has(event.threadId)
        ? `Delegated turn did not finish — ${host.stoppedTurnText(event.threadId, completedTurnId, undefined, event.stopReason)}`
        : "Delegated turn did not finish", false);
      host.finalizeDelegationWatch(event.threadId, event.ok, host.unansweredApprovals.annotate(event.threadId, event.turnId, reply, event.ok), delegationFailureName);
      // group busy/unread settle in the group turn engine, which knows
      // whether more member turns are queued behind this one
      break;
    }
  }
}

/** The settle of the turn's task: a bot's direct turn, or a room's
 * speaking member. Split out of handleTurnCompleted (#1383). */
function settleTurnTask(event: any, ctx: any, host: any, turn: any): void {
  const { DATA_DIR, deliverableNotification, flushUsageLedger } = host;
  const { bot, group, speaker, routineRun, completedTurnId } = ctx;
  const { internal, reviewAnswer, reply, clientStopped, stopped, lastReported, lastContext } = turn;
  if (bot) {
    const resourceOwner = host.turnResourceOwners.get(event.threadId);
    const generation = host.directTurnGenerationByThread.get(event.threadId);
    // A person waits on this turn in the chat (server/turns/unfinished-turn.ts):
    // read now, settleTrackedRequest forgets the request below.
    const personTurn = !internal && !routineRun && !host.routines?.runForThread(event.threadId) &&
      host.directRequestOwners.get(event.threadId)?.origin?.kind === "user";
    const isCurrent = () => host.directTurnGenerationByThread.get(event.threadId) === generation &&
      Boolean(host.store.taskByThread(bot.id, event.threadId));
    const settleDirectTurn = (resumeQueued = false) => {
      // Resource claims can outlive a deleted thread, but a stale capture
      // must never release a replacement generation's VM or busy state.
      const ownsResources = resourceOwner &&
        host.turnResourceOwners.get(event.threadId)?.generation === resourceOwner.generation;
      if (ownsResources) {
        host.vpsThreadEnded(bot.id, event.threadId);
        host.releaseLocalVmThread(event.threadId);
      }
      host.releaseTurnResources(resourceOwner);
      if (!isCurrent()) return;
      host.clearThreadStopping(event.threadId);
      host.scheduleVoiceCallWatchdog(bot.id, event.threadId);
      host.scheduleSoloGoalRound(bot.id, event.threadId, { ok: event.ok, stopped: clientStopped });
      host.scheduleFinishUntilRound(bot.id, event.threadId, { ok: event.ok, stopped: clientStopped });
      host.scheduleUnfinishedTurn(bot.id, event.threadId, completedTurnId, { ok: event.ok, stopped, personTurn });
      if (host.store.taskByThread(bot.id, event.threadId)?.activity !== "dead") {
        const question = event.ok && !stopped && host.openQuestionCard(event.threadId);
        host.store.setTaskActivity(bot.id, event.threadId, question ? "waiting-on-you" : resourceOwner?.computerParkedOn !== undefined ? "parked.computer" : "idle",
          question ? { settledQuestion: true } : undefined);
      }
      host.directTurnBots.delete(event.threadId);
      if (host.continueComputerSelection(event.threadId, generation, event.ok)) return;
      // Ordinary completion still drains from the existing bus subscribers.
      // An asynchronous screenshot finishes after those subscribers ran.
      if (resumeQueued) {
        host.retryDelegationsWaitingOn(bot.id);
        host.drainQueuedSends();
        host.drainComputerResumes();
        host.drainSecretResumes();
        host.drainTeamSetupResumes();
        host.drainDelegationWakes();
      }
      host.settleTrackedRequest(event.threadId);
    };
    // bank what this turn spent before the bot broadcast carries the
    // task list to every window. The driver's own per-turn figure
    // (turn.completed.usage) is authoritative; a driver that only
    // streams the running indicator falls back to its last value.
    const tokens = event.usage ?? lastReported;
    // the context figure: what the last model call's prompt held, with
    // the window from the driver or, failing that, the model's family
    const contextModel = host.store.taskByThread(bot.id, event.threadId)?.modelSelection?.model ?? bot.modelSelection.model;
    const promptBytes = host.turnPromptBytes.get(event.threadId);
    const promptSize = promptBytes ? promptBytes.stable + promptBytes.volatile : 0;
    const buckets = host.turnContextBuckets.get(event.threadId);
    host.store.addTaskUsage(bot.id, event.threadId, {
      input: tokens?.input,
      output: tokens?.output,
      cachedInput: tokens?.cachedInput,
      costUsd: event.cost ?? null,
      context: {
        tokens: lastContext?.tokens,
        window: lastContext?.window ?? host.modelContextWindow(contextModel),
        ...(promptSize > 0 ? { promptBytes: promptSize } : {}),
        ...(buckets ? { buckets } : {})
      }
    });
    // and write the same figures to the month's ledger, which outlives
    // the task and answers "what did we spend, by whom" for a period
    const settledTask = host.store.taskByThread(bot.id, event.threadId);
    const selection = settledTask?.modelSelection ?? bot.modelSelection;
    // A provider that omitted a context measurement must not reuse a
    // stale reading from a different model or a pre-compaction session.
    const measuredSelection = host.directTurnBots.get(event.threadId)?.modelSelection ?? selection;
    host.store.patchTask(bot.id, event.threadId, { lastContextModel: Number.isFinite(lastContext?.tokens) && (lastContext?.tokens ?? 0) > 0
      ? `${measuredSelection.instanceId}:${measuredSelection.model}` : undefined });
    host.turnPromptBytes.delete(event.threadId);
    host.turnContextBuckets.delete(event.threadId);
    host.bookTurnUsage({
      botId: bot.id,
      botName: bot.name,
      threadId: event.threadId,
      instanceId: selection.instanceId,
      driverKind: host.registry.get(selection.instanceId)?.driverKind ?? "unknown",
      model: selection.model,
      ...(event.models?.length ? { models: event.models } : {}),
      input: tokens?.input ?? 0,
      output: tokens?.output ?? 0,
      ...(typeof tokens?.cachedInput === "number" ? { cachedInput: tokens.cachedInput } : {}),
      ...(promptBytes ? { promptBytes } : {}),
      costUsd: event.cost ?? null,
      ...host.turnDuration(event.threadId),
      trigger: routineRun
        ? { kind: "routine", routineId: routineRun.routineId, label: routineRun.routineName, ...(routineRun.runAs ? { runAsPrincipalId: routineRun.runAs } : {}) }
        : internal
          ? { kind: "bot", ...(settledTask?.openedBy?.botId ? { botId: settledTask.openedBy.botId } : {}) }
          : host.turnTriggers.get(event.threadId) ?? { kind: "owner" }
    });
    const digestSettled = completedTurnId ? host.scheduleTurnDigest({
        botId: bot.id,
        botName: bot.name,
        threadId: event.threadId,
        turnId: completedTurnId,
        succeeded: event.ok,
        driverKind: host.registry.get(selection.instanceId)?.driverKind,
        instanceId: selection.instanceId,
        reply,
        isCurrent,
        ...(tokens ? { usage: { input: tokens.input ?? 0, output: tokens.output ?? 0, ...(typeof tokens.cachedInput === "number" ? { cachedInput: tokens.cachedInput } : {}), costUsd: event.cost ?? null } } : {})
      }) : Promise.resolve();
    if (resourceOwner) host.settlingResourceOwners.set(resourceOwner.threadId, resourceOwner.generation);
    host.liveTurnByThread.delete(event.threadId);
    // #3514: the cards this turn posted no longer have a running turn
    host.postedCardTurns?.turnEnded(event.threadId);
    // The bot chose to settle this reply without alerting anyone
    // (set_reply_notify, send_to_bot notify false): its message and
    // unread stay, its notification and push do not ring. Read once.
    // #2695: FYI (set_reply_notify fyi) is quiet now and waits for the brief
    const replyFyi = host.fyiReplyThreads?.delete(event.threadId) === true;
    const replySilent = host.silentReplyThreads?.delete(event.threadId) === true;
    const replyAlerts: boolean | "fyi" = replyFyi ? "fyi" : !replySilent;
    // A Team incidents report (server/peers/incidents.ts): the Primary Bot
    // worked in its "Team incidents" thread, beside its conversation;
    // what it has to say arrives as its own message in the person's one
    // conversation with it (2026-10-28, the reference design: one
    // transcript per bot), with the link to the thread it worked in.
    const incidentsReport = reply && settledTask?.openedBy?.botId === bot.id && settledTask.title === INCIDENTS_THREAD_TITLE
      ? host.conversationOrStart(bot, host.privateThreads() ? host.effectiveBotOwner(bot) : undefined) : undefined;
    const incidentsCopied = Boolean(incidentsReport && incidentsReport !== event.threadId);
    if (incidentsCopied) {
      host.store.appendMessage(incidentsReport!, {
        role: "bot", kind: "text", text: reply,
        threadRef: { botId: bot.id, threadId: event.threadId, title: settledTask!.title }
      });
      host.store.patchTask(bot.id, incidentsReport!, { unread: true });
      // The copy lands in the conversation, but its push follows the
      // turn's own rule: a quiet turn (turnAnswers: only reports that
      // waited, about failures that already buzzed the person) rings
      // nothing here either. notify() checks quietTurnThreads by the
      // notice's thread, and this one names the conversation.
      if (!host.computerSelectionTurns.get(event.threadId)?.selected && !host.quietTurnThreads.has(event.threadId)) {
        host.notify(withBotNotify(deliverableNotification("done", bot, incidentsReport!, reply, { avatarUrl: bot.avatarUrl }), replyAlerts));
      }
    }
    // 2026-11-05: a result that needs the person reaches the person,
    // whatever thread it came from (server/turns/person-attention-relay.ts):
    // a hand-off, a thread another bot opened, a routine run's task the
    // run no longer reports from. Never from the person's own conversation.
    try {
      const attentionInput = { bot, threadId: event.threadId, turnId: completedTurnId, ok: event.ok, stopped, runTurn: Boolean(routineRun) };
      relayFinishedTurn({
        attention: () => host.relayPersonAttention(attentionInput, host.personAttentionDeps),
        lateRun: () => host.mirrorLateRunReply(attentionInput, host.personAttentionDeps),
        // #3148: a turn the shutdown cut resumes at the next start; no
        // "did not finish (error)" trace in the chat for the restart.
        background: () => (!event.ok || stopped) && isShuttingDown() ? false : host.mirrorBackgroundReply(attentionInput, host.personAttentionDeps),
      }, incidentsCopied);
    } catch (error) {
      console.error(`[attention] not relayed: ${error instanceof Error ? error.message.slice(0, 160) : "error"}`);
    }
    const routineReportThread = routineRun ? host.routineSourceThread(routineRun) : null;
    // A routine's result belongs to its reporting thread's unread state.
    // Its internal execution should not light up the sidebar as well.
    // Neither should a peer's hop: the exchange is already recorded in the
    // pair channel and chipped into both threads, which is the whole of
    // what the person needs to be able to find it.
    // A person's own job's review answer is the exception: news like a reply.
    // A Team incidents report was copied into the conversation above: that
    // copy carries the unread. Marking the incidents thread too would keep
    // the bot's sidebar dot on forever with threads hidden (#1770).
    if (!routineReportThread && (!internal || reviewAnswer) && !incidentsCopied) host.store.patchTask(bot.id, event.threadId, { unread: true });
    // A failed peer turn stays a chip too. The bot that delegated is woken
    // with the failure and answers the person in its own thread — buzzing
    // here as well would ring twice for one piece of news.
    // A routine run with nothing to report, or one whose routine does not
    // post results to the conversation, rings nothing (2026-10-22).
    // A Team incidents report rang once above, on the conversation it was
    // copied to: one piece of news, one push.
    // A report with items for the person rang "needs you" from its card
    // (syncRoutineRunToSource): one piece of news, one push.
    // #3479: the same problem as the previous run was said by its first run.
    if ((!routineRun || routineRunRingsDone(routineRun, host)) && !internal && !incidentsCopied && !host.computerSelectionTurns.get(event.threadId)?.selected) {
      // the frame carries the bot's avatar so every desktop client can
      // show the notification under that bot's own face
      const completionDetail = routineRun
        ? reply || routineRun.output || routineRun.routineName
        : reply;
      const notificationBot = (routineRun && host.routineSourceOwner(routineRun)?.bot) || bot;
      host.notify(withBotNotify(deliverableNotification("done", notificationBot, routineReportThread ?? event.threadId, completionDetail, {
        avatarUrl: notificationBot.avatarUrl,
        ...(routineRun && routineRun.status === "completed" ? { routineRunId: routineRun.id, routineName: routineRun.routineName } : {})
      }), replyAlerts));
    }
    if (host.screenPollers.has(event.threadId) && host.askedForView(host.latestPersonText(event.threadId), "screen")) {
      // views on request only (shared/requested-views.ts): the settled
      // screenshot joins the chat only when the person asked to see the
      // screen; the live screen panel is unchanged.
      // the last live frame becomes a settled inline screen message —
      // the screenshot-in-chat moment. One fresh capture first, so the
      // frame shows the turn's END state (the final tool's poke may
      // still be in flight).
      //
      // Keep the thread busy until its bounded final capture releases
      // the screen: an accepted follow-up must not take the desktop
      // before the END-state frame is captured.
      const settleLeafId = host.store.activePath(event.threadId).at(-1)?.id;
      let timeout: ReturnType<typeof setTimeout>;
      const screenSettled = Promise.race([
        host.finalScreenFrame(bot.id, event.threadId),
        new Promise<null>((resolve) => { timeout = setTimeout(() => resolve(null), host.SCREEN_SETTLE_TIMEOUT_MS); }),
      ]).then((frame) => {
        if (frame && isCurrent()) {
          host.store.insertMessageAfter(event.threadId, settleLeafId, { role: "bot", kind: "screen", requested: true, png: frame.png, mime: frame.mime });
        }
      }).catch(host.reportBackgroundError).finally(() => {
        clearTimeout(timeout);
      });
      void Promise.all([screenSettled, digestSettled]).finally(() => settleDirectTurn(true));
    } else {
      void digestSettled.finally(() => settleDirectTurn(true));
    }
  } else if (group && speaker) {
    // Room/goal turns run on a shared thread, but their spend still counts
    // against the workspace cap and the ledger. Book it under the speaker.
    const tokens = event.usage ?? lastReported;
    const speakingBot = host.store.bot(speaker.botId);
    const selection = speakingBot?.modelSelection;
    host.roomMemberContexts.record(event.threadId, speaker.botId, lastContext, selection?.model,
      selection ? host.registry.get(selection.instanceId)?.models : undefined);
    const promptBytes = host.turnPromptBytes.get(event.threadId);
    host.turnPromptBytes.delete(event.threadId);
    host.turnContextBuckets.delete(event.threadId);
    host.bookTurnUsage({
      botId: speaker.botId,
      botName: speaker.name,
      threadId: event.threadId,
      instanceId: selection?.instanceId ?? "unknown",
      driverKind: (selection && host.registry.get(selection.instanceId)?.driverKind) ?? "unknown",
      model: selection?.model ?? "unknown",
      ...(event.models?.length ? { models: event.models } : {}),
      input: tokens?.input ?? 0,
      output: tokens?.output ?? 0,
      ...(typeof tokens?.cachedInput === "number" ? { cachedInput: tokens.cachedInput } : {}),
      ...(promptBytes ? { promptBytes } : {}),
      costUsd: event.cost ?? null,
      ...host.turnDuration(event.threadId),
      trigger: routineRun
        ? { kind: "routine", routineId: routineRun.routineId, label: routineRun.routineName, ...(routineRun.runAs ? { runAsPrincipalId: routineRun.runAs } : {}) }
        : host.turnTriggers.get(event.threadId) ?? { kind: "owner" }
    });
    // Appends are asynchronous. Refresh after persistence so the settled
    // turn appears immediately, without waiting for another message.
    void flushUsageLedger(DATA_DIR).then(() => {
      host.groupUsageReader.refresh();
      const current = host.store.group(group.id);
      if (current) host.broadcast({ kind: "group", group: host.publicGroupState(current) });
    }).catch(host.reportBackgroundError);
    if (completedTurnId) {
      void host.scheduleTurnDigest({
        botId: speaker.botId, botName: speaker.name,
        threadId: event.threadId, turnId: completedTurnId,
        driverKind: selection && host.registry.get(selection.instanceId)?.driverKind,
        reply, from: speaker,
        isCurrent: () => host.store.groupByThread(event.threadId)?.id === group.id,
        usage: { input: tokens?.input ?? 0, output: tokens?.output ?? 0, costUsd: event.cost ?? null }
      });
    }
    host.liveTurnByThread.delete(event.threadId);
  }
}

/** #2915: where a finished turn's words reach the person, once: a card that
 * needs them (unless they muted such cards), else the late reply of a
 * routine run, else (#2901) the mirror of an MCP or teammate conversation,
 * unless the Team incidents report was already copied into the chat. */
export function relayFinishedTurn(steps: {
  attention(): { posted: boolean; reason?: string };
  lateRun(): boolean;
  background(): boolean;
}, incidentsCopied: boolean): "attention" | "muted" | "late-run" | "incidents" | "background" | "none" {
  const relayed = steps.attention();
  if (relayed.posted) return "attention";
  if (relayed.reason === "muted") return "muted";
  if (steps.lateRun()) return "late-run";
  if (incidentsCopied) return "incidents";
  return steps.background() ? "background" : "none";
}
