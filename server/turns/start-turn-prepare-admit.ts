// @ts-nocheck
// #1388 wave 4 step 3: startTurn prepare leaf. Never imports server/index.ts.
import { randomUUID } from "node:crypto";
import type { StartTurnHost } from "./start-turn-types.ts";
import type { TurnState, PrepareResult } from "./start-turn-state.ts";

export function createPrepareAdmitStartTurn(host: StartTurnHost) {
  const {
    IDENTITY,
    SMALL_TALK_TURN_NOTE,
    accessCardFor,
    activeRoutineRunForThread,
    assertModelVariantSupported,
    assertTurnAdmission,
    autoComputerStateFor,
    autoModelRecord,
    autoStartTarget,
    autoTurnsByThread,
    autoWorkspaceWanted,
    botUserName,
    cfg,
    clearInternalTurn,
    cloudOnlyBot,
    confidentialThreadOwner,
    connectorSwitchText,
    coordinator,
    decideWorkplace,
    deliverableNotification,
    desktopBridges,
    drainQueuedSends,
    effectiveBotOwner,
    effortAcceptedByEngine,
    effortForModel,
    engineAccessNotice,
    engineDisplayName,
    explainPick,
    extractTurnImages,
    generateThreadTitle,
    holdBotMemoryPlain,
    holdTurnAttachments,
    inheritedTeamComputer,
    isSmallTalk,
    limitBackupRefusedInThread,
    liveVoiceUtteranceByThread,
    llmThreadTitlesEnabled,
    markInternalTurn,
    noteAutoWorkspace,
    notifyAccess,
    officeTurnText,
    orgEngineRefusal,
    orgSpeakerPrincipal,
    ownerModelOfflineRefusal,
    personalFeatureOn,
    promptWithDataContext,
    quietTurnThreads,
    remoteComputerForTurn,
    repeatsShownFailure,
    resolveTurnSpeaker,
    routineLineage,
    sandboxPrincipalForTurn,
    settleInputRequests,
    spokenLineFields,
    store,
    supportsWorkspaceFiles,
    turnClockEnabled,
    turnHolder,
    turnModelRequested,
    turnRunByThread,
    turnRunFor,
    turnStartLogLine,
    turnWorksOn,
    turnZoneFor,
    userSandbox,
    vaultPrincipalForThread,
    voiceCallSection,
    voiceCallTurnPrompt,
    voiceCalls,
    withTurnClock,
    withWorkplaceNote,
    workplacePreference,
    workplaceTurnText,
  } = host;


  return async function(state: TurnState): Promise<PrepareResult> {

  // Codex and the API drivers cannot start without a prompt. Sending them
  // an empty one would bill a turn and show it. Claude is the engine that
  // can hold a process with stdin open and no model call.
  if (state.warmOnly && state.instance.adapter.capabilities.warmSession !== true) {
    console.error(`[voice-call] warm skipped: ${state.instance.driverKind}`);
    state.opts?.onWarmSettled?.(false);
    return { kind: "return", value: {
      id: `warm-${randomUUID()}`,
      at: Date.now(),
      role: "user" as const,
      kind: "text" as const,
      text: "",
      ...(state.opts?.voiceCall ? { voiceCall: state.opts.voiceCall } : {})
    } };
  }
  // Resolve only transport tags from this newly submitted text. The original
  // string remains the durable message. Native-image providers get a
  // path-free prompt and bounded inputs instead of needing a Read tool;
  // path-reading drivers retain the attachment tag as their compatibility route.
  state.resolvedImages = extractTurnImages(state.text);
  // Files sealed at rest go plain in place for the engine (server/content-at-rest.ts):
  // this message's attachments before anything reads them; the bot's memory
  // files in parallel with the rest of the setup, awaited before the engine
  // starts (below).
  if (!state.warmOnly && supportsWorkspaceFiles(state.instance.driverKind)) void holdBotMemoryPlain(state.bot.id, turnHolder(state.threadId));
  const attachmentsHold = state.warmOnly ? undefined : holdTurnAttachments(state.threadId, [state.text], state.resolvedImages.images, { picturesByPath: state.instance.driverKind === "codex" });
  if (attachmentsHold) {
    await attachmentsHold;
    // The wait yielded: another start may have taken this slot since the
    // checks above. From here to the dispatch claim nothing yields again.
    assertTurnAdmission(state.botId, state.threadId);
  }
  const usesNativeImageInput = state.instance.adapter.capabilities.nativeImageInput === true;
  state.providerText = promptWithDataContext(usesNativeImageInput ? state.resolvedImages.text : state.text, state.opts?.dataContext);
  state.turnImages = usesNativeImageInput ? state.resolvedImages.images : [];
  state.commsDepth = state.opts?.commsDepth ?? 0;
  // Classify the turn where the peer paths' depth actually arrives: by the
  // time it settles, the fold has only a thread id to go on.
  if (state.commsDepth > 0) markInternalTurn(state.threadId);
  else clearInternalTurn(state.threadId);
  if (state.answer.quiet) quietTurnThreads.add(state.threadId);
  else quietTurnThreads.delete(state.threadId);
  // a task takes its name from the first thing you asked it to do
  if (!state.warmOnly && state.resolvedImages.text.trim() && !state.opts?.cardContinuation) {
    const titled = store.titleTaskFromFirstMessage(state.bot.id, state.resolvedImages.text, state.threadId);
    // The snippet is only the fallback name. A cheap one-shot may trade it
    // for a title a person would have typed, but never on a peer-opened
    // row: its title belongs to the assigned work. Everywhere else, the
    // swap happens only while the row still carries the snippet — a rename
    // by a person has already broken that equality by then.
    const snippet = titled?.title;
    if (titled && snippet && !titled.openedBy?.botId && personalFeatureOn("llmThreadTitles", llmThreadTitlesEnabled(cfg), vaultPrincipalForThread(state.threadId)) && state.instance.generateText) {
      void generateThreadTitle(state.instance, state.resolvedImages.text)
        .then((title: any) => {
          if (title) store.retitleTask(state.bot.id, state.threadId, snippet, title);
        })
        .catch(() => undefined);
    }
  }

  // Spoken words never reach the log. A direct send says so itself; a
  // drained queue (or a continuation) carries it on the user lines it runs.
  const turnLineIds = new Set(state.opts?.excludeMessageIds ?? []);
  state.spoken = state.opts?.via === "call" || state.opts?.userMessage?.via === "call" ||
    (turnLineIds.size > 0 && store.messagesFor(state.threadId).some((message: any) => turnLineIds.has(message.id) && message.via === "call"));
  if (state.warmOnly) console.error(`[voice-call] warming thread ${state.threadId}`);
  else console.error(turnStartLogLine({
    botId: state.botId, text: state.resolvedImages.text, images: state.turnImages.length, depth: state.commsDepth, card: Boolean(state.opts?.cardContinuation), spoken: state.spoken,
    confidential: store.isConfidentialThread(state.threadId)
  }));
  state.instanceId = state.instance.instanceId;
  // A turn always runs on the bot's own engine, model, effort and variant,
  // wherever it works: a cloud computer is a tool it mounts, never a reason
  // to swap the engine (the provider_not_configured incident).
  state.model = state.bot.modelSelection.model;
  const askedEffort = state.bot.modelSelection.effort;
  state.variant = state.bot.modelSelection.variant;
  // What this turn runs on, kept for the bot text it writes (a quiet line
  // under the reply shows it). A warm-up writes no reply.
  if (!state.warmOnly) turnRunByThread.set(state.threadId, turnRunFor(state.bot.modelSelection, turnModelRequested.get(state.threadId)));
  assertModelVariantSupported({ variant: state.variant, effort: askedEffort }, state.instance.adapter.capabilities);
  // A selection can be persisted while its engine is offline. Re-check when
  // the engine returns so an old or unsupported value never reaches a CLI.
  if (askedEffort && !effortAcceptedByEngine(askedEffort, state.instance.adapter.capabilities.effortLevels ?? [])) {
    throw Object.assign(
      new Error(`effort "${askedEffort}" is not offered by this bot's engine — choose another level in settings`),
      { status: 409 },
    );
  }
  // The engine takes it but this model may not (shared/model-capabilities.ts):
  // then nothing is sent and the model runs at its own default.
  state.effort = effortForModel(askedEffort, state.instance.models.options.find((option: any) => option.id === state.bot.modelSelection.model),
    state.instance.adapter.capabilities.effortLevels);

  // an edit hands us its already-branched user message; a plain send appends
  state.userMessage= state.opts?.userMessage;
  if (state.opts?.editedMessageId) {
    const edited = store.branchMessage(state.threadId, state.opts.editedMessageId, state.text, state.opts.sendId, state.opts.sender, state.opts.dataContext);
    if (!edited) throw Object.assign(new Error("only a user text message can be edited"), { status: 400 });
    store.patchTask(state.bot.id, state.threadId, { rewound: true });
    state.userMessage = edited;
  }
  if (!state.userMessage) {
    state.userMessage = state.warmOnly
      ? { id: `warm-${randomUUID()}`, at: Date.now(), role: "user", kind: "text", text: "", ...(state.opts?.voiceCall ? { voiceCall: state.opts.voiceCall } : {}) }
      : state.opts?.cardContinuation
      ? { id: `card-${randomUUID()}`, at: Date.now(), role: "user", kind: "text", text: state.text }
      : store.appendMessage(state.threadId, {
          role: "user",
          kind: "text",
          text: state.text,
          replyToId: state.opts?.replyTo?.id,
          sendId: state.opts?.sendId,
          ...(state.opts?.dataContext ? { dataContext: state.opts.dataContext } : {}),
          peerAsk: state.opts?.peerAsk,
          sender: state.opts?.sender,
          ...(state.opts?.peerAsk && state.autoTurn?.pick.role === "worker" ? { autoModel: autoModelRecord(state.autoTurn.pick, Date.now()) } : {}),
          ...(state.opts?.voiceCall ? { voiceCall: state.opts.voiceCall } : {}),
          ...spokenLineFields(state.opts?.via, state.opts?.callId),
          ...(state.opts?.relayed ? { relayed: true } : {})
        });
  }
  // Runtime path only (coordinator.answer is always false on the legacy
  // tree): a person's ordinary message into a thread whose coordinated
  // assignment is parked on a question IS the answer. The assignment takes
  // the words and the runtime runs the teammate's next turn itself (run
  // hook, with the answer in its envelope), so no turn starts here. Only a
  // person's own line counts: not a continuation, a wake, a routine, a peer
  // hop or an edit. The early return happens before admission — no dispatch
  // claim, request owner, busy flag or watchdog exists yet — so it settles
  // only what callers read: the message route carries the stored user line
  // in its receipt, and a drained queue holds its receipt until
  // onTurnSettled; a turn that never started publishes no completion, so
  // the drain is nudged as its own error path does (M2 in drainQueuedSends).
  state.personLine = !state.opts?.coordination && !state.opts?.cardContinuation && !state.opts?.automationSource && !state.opts?.compactOnly
    && !state.opts?.computerSelectionContinuation && !state.opts?.editedMessageId && !state.warmOnly && !state.commsDepth && !state.opts?.peerAsk && !state.userMessage.peerAsk;
  if (state.personLine && coordinator.answer(state.threadId, state.text)) {
    store.appendMessage(state.threadId, { role: "bot", kind: "activity", tool: { name: "Answer passed to the waiting work", ok: true } });
    settleInputRequests(state.threadId);
    state.opts?.onTurnSettled?.();
    queueMicrotask(drainQueuedSends);
    return { kind: "return", value: state.userMessage };
  }
  if (!state.warmOnly && state.opts?.voiceCall?.utteranceId) {
    liveVoiceUtteranceByThread.set(state.threadId, state.opts.voiceCall.utteranceId);
  }
  // Organization server (slice 3, D13): no turn without engine access. The
  // person's message stays; the thread gets the card saying why, the owner
  // a notification, and the sender an ordinary accepted send.
  state.speaker = resolveTurnSpeaker({
    speaker: state.opts?.speaker,
    sender: state.opts?.sender ?? (state.opts?.editedMessageId ? undefined : state.userMessage.sender),
    peerAsk: state.opts?.peerAsk ?? (state.opts?.editedMessageId ? undefined : state.userMessage.peerAsk),
    trigger: state.opts?.trigger,
    automationSource: state.opts?.automationSource
  });
  // an automatic recovery re-enters with these options: same speaker
  state.opts = { ...state.opts, speaker: state.speaker };
  // A voice call turn gets the hidden phone-call instruction; the first
  // written turn after a call is told the call ended. Only a person's own
  // turn: a continuation or a peer hop is not said on the phone.
  // The thread is on a live call (server/voice-call-session.ts): the engine
  // stays warm between turns and the turn's context stays short.
  state.onCall = Boolean(voiceCalls.active(state.threadId)) && !state.opts?.commsDepth && !state.userMessage.peerAsk;
  state.voiceCallText = state.opts?.cardContinuation || state.opts?.commsDepth || state.userMessage.peerAsk
    ? ""
    : voiceCallSection(
      state.userMessage,
      store.activePath(state.threadId).findLast((message: any) => message.role === "user" && message.id !== state.userMessage?.id && !message.peerAsk && message.at <= state.userMessage!.at),
      state.userMessage.sender?.name ?? botUserName(state.bot),
    );
  // Organization server: where this turn's tools run, and for whom, decided
  // once (server/desktop-bridge.ts); the speaker's own attachments are
  // pointed there and small text ones given inline.
  const turnRemote = remoteComputerForTurn({
    organization: IDENTITY.kind === "perspicax",
    runOnCloud: state.opts?.runOn === "cloud" || cloudOnlyBot(state.bot.id),
    hasTeamComputer: Boolean(inheritedTeamComputer(state.bot))
  });
  const turnWorks = turnWorksOn(state.plan, turnRemote.forceCloud);
  state.turnPrincipal = sandboxPrincipalForTurn({
    botOwnerPrincipalId: effectiveBotOwner(state.bot),
    confidentialOwnerPrincipalId: confidentialThreadOwner(state.threadId),
    routine: routineLineage(state.speaker),
    speakerPrincipalId: orgSpeakerPrincipal(state.bot, state.speaker)
  });
  const turnPersonAsked = !routineLineage(state.speaker) && Boolean(orgSpeakerPrincipal(state.bot, state.speaker));
  // Auto (2026-10-15; routines 2026-11-01): a person-asked turn prefers
  // the person's computer when connected, else the cloud. A routine starts
  // in the cloud; routinesAllowed only permits an explicit computer_select
  // to this_computer. A thread opened with a workspace starts there when
  // allowed (server/auto-computer.ts).
  const turnAutoWanted = turnWorks.auto ? autoWorkspaceWanted(state.bot, state.threadId) : null;
  const turnAutoStart = turnWorks.auto && IDENTITY.kind === "perspicax" && state.turnPrincipal ? autoStartTarget({
    wanted: turnAutoWanted,
    routine: routineLineage(state.speaker),
    personAsked: turnPersonAsked,
    desktopConnected: desktopBridges.connected(state.turnPrincipal.trim().toLowerCase()),
    routinesAllowed: workplacePreference(state.turnPrincipal.trim().toLowerCase()).routines,
    sandboxConfigured: Boolean(userSandbox),
    browserAvailable: state.plan.browser
  }) : null;
  state.turnPlace = decideWorkplace({
    desktopTargeted: state.plan.computer === "local" || state.plan.computer === "vm" || turnAutoStart?.target === "this_computer" || turnAutoStart?.target === "local_vm",
    routine: routineLineage(state.speaker),
    principal: state.turnPrincipal,
    personAsked: turnPersonAsked
  });
  state.turnAuto = autoComputerStateFor(state.turnPlace, turnWorks, routineLineage(state.speaker), turnAutoStart, state.plan.browser);
  // Each call turn's words carry the call mark themselves: a live session
  // gets the volatile call section only when it changed, so from the second
  // call turn on the section alone never reached the engine.
  if (state.userMessage.voiceCall && !state.opts.cardContinuation && !state.opts.commsDepth && !state.userMessage.peerAsk) {
    state.providerText = voiceCallTurnPrompt(state.providerText, state.userMessage.voiceCall);
  }
  // A greeting, thanks or small talk alone (server/small-talk.ts) asks for
  // no action: the engine is told so, and the cloud computer is not woken.
  state.smallTalk = !state.warmOnly && !state.opts.cardContinuation && !state.opts.commsDepth && !state.opts.automationSource && !state.userMessage.peerAsk
    && !state.userMessage.voiceCall && !routineLineage(state.speaker) && isSmallTalk(state.userMessage.text, state.bot.name);
  if (state.smallTalk) state.providerText += SMALL_TALK_TURN_NOTE;
  if (!state.opts.cardContinuation && !state.warmOnly) {
    // Pictures ride as image input only on Claude Code, which reads them for
    // sure; another engine gets the saved picture files to read instead.
    const office = officeTurnText(state.providerText, state.turnPlace.principal, usesNativeImageInput && state.instance.driverKind === "claudeAgent", state.turnImages);
    state.providerText = office.text;
    state.turnImages.push(...office.images);
  }
  state.placedText = state.opts.cardContinuation ? { text: state.providerText, staging: null } : workplaceTurnText(state.providerText, state.turnPlace);
  state.providerText = withWorkplaceNote(state.placedText.text, state.turnPlace, state.turnAuto, state.bot.id);
  // The engine's container runs in UTC: tell it the time where its person is
  // (server/turn-clock.ts), so times are said in their zone.
  const clockZone = state.opts.cardContinuation || !turnClockEnabled() ? null : turnZoneFor(state.bot, state.speaker);
  if (clockZone) state.providerText = withTurnClock(state.providerText, new Date(), clockZone);
  // A compaction summarizes with the bot's engine too, so it is gated like
  // a turn, and so is a fresh delegated turn (a hop, as ask_bot's is); other
  // card continuations resume a turn already admitted.
  const freshHop = Boolean(state.opts.coordination && !state.opts.coordination.resumed);
  const accessRefusal = state.opts.cardContinuation && !state.opts.compactOnly && !freshHop ? null
    : orgEngineRefusal(state.bot, state.instance, state.speaker, state.bot.modelSelection.model) ?? ownerModelOfflineRefusal(state.bot, state.instance, state.speaker, state.bot.modelSelection.model);
  if (accessRefusal) {
    if (state.warmOnly) {
      console.error(`[voice-call] warm skipped: ${accessRefusal.reason}`);
      state.opts?.onWarmSettled?.(false);
      return { kind: "return", value: state.userMessage };
    }
    state.engine = engineDisplayName(state.instance);
    // A backup the usage-limit failover picked: one plain error, no card.
    state.backupRefused = limitBackupRefusedInThread(state.botId, state.threadId, state.speaker);
    state.card = accessCardFor(state.bot, accessRefusal, state.engine);
    if (!state.backupRefused && !repeatsShownFailure(store.messagesFor(state.threadId), { role: "bot", kind: "access", access: state.card }, state.bot.id)) {
      store.appendMessage(state.threadId, {
        role: "bot",
        kind: "access",
        access: state.card
      });
    }
    state.notice = state.backupRefused ?? engineAccessNotice(accessRefusal.reason, state.engine, accessRefusal);
    const refusedRun = routineLineage(state.speaker) ? activeRoutineRunForThread(state.threadId)?.id : undefined;
    notifyAccess(deliverableNotification("turn-failed", state.bot, state.threadId, state.notice, { avatarUrl: state.bot.avatarUrl }), state.card, refusedRun);
    console.error(`[omb-turn] bot=${state.botId} refused: ${accessRefusal.reason}${accessRefusal.cause ? `/${accessRefusal.cause}` : ""} (${state.instance.instanceId})`);
    state.opts?.coordination?.settle({ ok: false, text: state.notice });
    state.opts?.onDispatchError?.(state.notice);
    state.opts?.onTurnSettled?.();
    return { kind: "return", value: state.userMessage };
  }
  // Auto: one discreet line when this turn starts on another place than the
  // thread last showed, or could not start where it was sent.
  if (state.turnAuto?.auto && turnAutoStart && !state.warmOnly && !state.opts.cardContinuation) noteAutoWorkspace(state.threadId, turnAutoStart, turnAutoWanted !== null);
  state.recoveryUserMessageId = state.opts?.coordination
    ? store.activePath(state.threadId).findLast((m: any) => m.role === "user" && m.kind === "text")?.id
    : state.userMessage.id;
  // Auto: the pick is this thread's now that the turn is admitted, and
  // work handed out gets its activity row (which model, and why).
  if (state.autoTurn) {
    const earlierPick = store.taskByThread(state.bot.id, state.threadId)?.autoModel;
    store.patchTask(state.bot.id, state.threadId, { autoModel: autoModelRecord(state.autoTurn.pick, Date.now()) });
    autoTurnsByThread.set(state.threadId, { payer: state.autoTurn.payer, entry: { instanceId: state.autoTurn.pick.selection.instanceId, model: state.autoTurn.pick.selection.model } });
    // The person's own turn (2026-10-29): the words decide the model, so a
    // turn that runs on another model than the last one says so in one
    // line (the chip and the picker say it on the first turn).
    const ownTurnMoved = state.autoTurn.pick.role === "orchestration" && earlierPick !== undefined &&
      (earlierPick.instanceId !== state.autoTurn.pick.selection.instanceId || earlierPick.model !== state.autoTurn.pick.selection.model);
    if ((state.autoTurn.pick.role === "worker" || ownTurnMoved) && !state.warmOnly && !state.autoContinuing) {
      store.appendMessage(state.threadId, {
        role: "bot",
        kind: "activity",
        autoModel: autoModelRecord(state.autoTurn.pick, Date.now()),
        tool: { name: `notice: ${explainPick(state.autoTurn.pick)}`, ok: true }
      });
    }
  } else autoTurnsByThread.delete(state.threadId);
  if (state.connectorSwitch) {
    state.line = { engine: state.connectorSwitch.engineLabel, connector: state.connectorSwitch.connector };
    store.appendMessage(state.threadId, { role: "bot", kind: "activity", tool: { name: `notice: ${connectorSwitchText(state.line)}`, ok: true, connectorSwitch: state.line } });
  }
  return { kind: "continue" };
  };
}
