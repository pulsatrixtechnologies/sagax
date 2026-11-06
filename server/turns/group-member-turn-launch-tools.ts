// @ts-nocheck
// #1383: room-member launch, tools and claim. Never imports server/index.ts.
import type { GroupMemberTurnHost } from "./group-member-turn-types.ts";
import type { GroupMemberTurnCtx } from "./group-member-turn-ctx.ts";

export function createPrepareRoomMemberTools(host: GroupMemberTurnHost) {
  const {
    IDENTITY,
    agentsIntegration,
    assertModelVariantSupported,
    assertWithinBudget,
    attachCustomMcp,
    availableSkills,
    cfg,
    DATA_DIR,
    decideWorkplace,
    engineHasNativeWebSearch,
    extractTurnImages,
    holdTurnAttachments,
    hooksEnabled,
    hooksIntegration,
    mcpServersAsPerson,
    mergeSkills,
    messagesIntegration,
    messagesWanted,
    orgSpeakerPrincipal,
    perspicaxMcp,
    personalFeatureOn,
    phoneIntegration,
    roomConsumedMessageId,
    runLifecycleEvent,
    selectBundledSkills,
    serializeRoomContext,
    skillAuthoringEnabled,
    store,
    supportsWorkspaceFiles,
    vaultPrincipalForThread,
    withClaimsFlag,
    withholdHostToolsFor,
    workplaceTurnText,
  } = host;

  function prepareRoomImages(ctx: GroupMemberTurnCtx) {
    const {
      bot, instance, roomTurnSelection, threadId, hop, skillAuthoringClaim, cardContinuation,
      internalGeneration, orchestration, operation,
    } = ctx;
  // A workspace at its monthly spend limit rechecks the cap at execution time
  // for every room, goal, queued, calendar, and chained-mention turn.
  assertWithinBudget(cfg, DATA_DIR);
  assertModelVariantSupported(roomTurnSelection(bot), instance.adapter.capabilities);
  const integrations: NonNullable<Parameters<typeof instance.adapter.sendTurn>[0]["integrations"]> = {};
  const skillAuthoring =
    personalFeatureOn("skillAuthoring", skillAuthoringEnabled(cfg), vaultPrincipalForThread(threadId)) &&
    hop === 0 &&
    !skillAuthoringClaim.claimed &&
    !cardContinuation &&
    instance.adapter.capabilities.agentsMcp === true;
  // 2026-10-28: a room hop keeps its tools too; past one hop without a
  // handoff it is mounted without the peer tools (SAGAX_PEER_HOP).
  if (instance.adapter.capabilities.agentsMcp === true) {
    integrations.agents = agentsIntegration(bot.id, threadId, hop, skillAuthoring, internalGeneration, orchestration?.roomHandoffId, !orchestration || Boolean(orchestration.roomHandoffId), false, supportsWorkspaceFiles(instance.driverKind), !engineHasNativeWebSearch(instance.driverKind, withholdHostToolsFor(instance), roomTurnSelection(bot).model));
  }
  if (instance.adapter.capabilities.hooks === true && hooksEnabled()) {
    integrations.hooks = hooksIntegration(bot.id, threadId, internalGeneration);
    void runLifecycleEvent(bot.id, threadId, "before_submit_prompt", {}).catch(() => {});
  }
  const latestUser = [...store.activePath(threadId)].reverse().find(
    (message) => message.role === "user" && message.kind === "text" && message.text,
  );
  const usesNativeImageInput = instance.adapter.capabilities.nativeImageInput === true;
  // M2: a drained room turn runs one sender's whole burst as ONE turn, so
  // every burst line must reach the responder the way its own turn would
  // have carried it  -  attachments extracted natively, their tags stripped
  // from the rendered context. Recover the burst by the queueIds recorded
  // on the operation, not by position: the last line alone is not the burst.
  const burstIds = new Set(operation?.queuedQueueIds ?? []);
  const burstOverrides: Array<{ messageId: string; text: string }> = [];
  const burstImages: ReturnType<typeof extractTurnImages>["images"] = [];
  const burstVideos: ReturnType<typeof extractTurnImages>["videos"] = [];
  if (usesNativeImageInput && !cardContinuation) {
    for (const message of store.activePath(threadId)) {
      if (message.role !== "user" || message.kind !== "text" || !message.text) continue;
      if (!message.queueId || !burstIds.has(message.queueId)) continue;
      const resolved = extractTurnImages(message.text);
      burstOverrides.push({ messageId: message.id, text: resolved.text });
      burstImages.push(...resolved.images);
      burstVideos.push(...resolved.videos);
    }
  }
  // the latest line is usually the burst's last item: extracting it again
  // would double-count its attachments and re-strip already-stripped words
  const latestInBurst = latestUser?.queueId !== undefined && burstIds.has(latestUser.queueId);
  const resolvedLatestImages = latestUser?.text && !cardContinuation && !latestInBurst
    ? extractTurnImages(latestUser.text)
    : { text: latestUser?.text ?? "", images: [], videos: [] };
  // stored files sealed at rest go plain for the engine (server/encryption/content-at-rest.ts)
  const roomVideos = [...burstVideos, ...resolvedLatestImages.videos];
  const roomAttachmentsHold = cardContinuation ? undefined : holdTurnAttachments(threadId, [latestUser?.text], [...burstImages, ...resolvedLatestImages.images], {
    picturesByPath: instance.driverKind === "codex",
    ...(usesNativeImageInput && roomVideos.length ? { videos: roomVideos } : {}),
  });
    ctx.skillAuthoring = skillAuthoring;
    ctx.integrations = integrations;
    ctx.latestUser = latestUser;
    ctx.usesNativeImageInput = usesNativeImageInput;
    ctx.burstOverrides = burstOverrides;
    ctx.burstImages = burstImages;
    ctx.burstVideos = burstVideos;
    ctx.latestInBurst = latestInBurst;
    ctx.resolvedLatestImages = resolvedLatestImages;
    ctx.roomAttachmentsHold = roomAttachmentsHold;
    ctx.latestVideoFrames = [];
  }

  function placeAndSkills(ctx: GroupMemberTurnCtx) {
    const {
      bot, instance, threadId, internalGeneration, latestUser, latestInBurst, usesNativeImageInput,
      resolvedLatestImages, burstImages, burstOverrides, skillAuthoring, integrations,
      roomRoutine, roomPrincipal, roomSpeakerId, userName, cardContinuation,
    } = ctx;
  // Organization server: where this room turn's tools run (the person whose
  // message it answers), and their own attachments pointed there.
  let roomPlace = decideWorkplace({ desktopTargeted: false, routine: roomRoutine, principal: roomPrincipal, personAsked: Boolean(roomSpeakerId) });
  // (solo: no principal; an attached archive still gets its manifest)
  const roomPlaced = latestUser && !cardContinuation && !latestInBurst && (IDENTITY.kind !== "perspicax" || latestUser.sender?.id?.trim().toLowerCase() === roomPlace.principal)
    ? workplaceTurnText(usesNativeImageInput ? resolvedLatestImages.text : latestUser.text ?? "", roomPlace)
    : { text: null, staging: null, annotated: false };
  const latestOverride = roomPlaced.text !== null && (roomPlaced.staging !== null || roomPlaced.annotated)
    ? roomPlaced.text
    : usesNativeImageInput ? resolvedLatestImages.text : null;
  // Read receipts: the newest room line this prompt carries word for word.
  const roomConsumedId = roomConsumedMessageId(threadId);
  const roomContext = serializeRoomContext(
    threadId,
    userName,
    latestUser && (usesNativeImageInput || latestOverride !== null)
      ? [
          ...burstOverrides,
          ...(latestInBurst || latestOverride === null ? [] : [{ messageId: latestUser.id, text: latestOverride }]),
        ]
      : undefined,
    bot.id,
  );
  const turnImages = usesNativeImageInput
    ? [...burstImages, ...resolvedLatestImages.images, ...(ctx.latestVideoFrames ?? [])]
    : [];
  const skills = availableSkills();
  const selectedSkills = mergeSkills(
    selectBundledSkills(
      roomContext,
      instance.adapter.capabilities.phoneMcp === true ? ["phoneMcp"] : [],
      skills,
    ),
    selectBundledSkills(
      latestUser?.text ?? "",
      skillAuthoring ? ["skillAuthoring"] : [],
      skills,
    ),
  );
  if (selectedSkills.some((skill) => skill.manifest.requiredCapabilities.includes("phoneMcp"))) {
    integrations.phone = phoneIntegration(bot.id, threadId, internalGeneration);
  }
  if (messagesWanted()) integrations.messages = messagesIntegration(bot.id, threadId, internalGeneration);
  // user-configured MCP servers: same gating as the 1:1 site above.
  let roomGithubWithheld: string[] = [];
    ctx.roomPlace = roomPlace;
    ctx.roomPlaced = roomPlaced;
    ctx.roomConsumedId = roomConsumedId;
    ctx.roomContext = roomContext;
    ctx.turnImages = turnImages;
    ctx.selectedSkills = selectedSkills;
    ctx.roomGithubWithheld = roomGithubWithheld;
  }

  function mountCustomMcp(ctx: GroupMemberTurnCtx) {
    const { bot, threadId, roomAccessSpeaker, integrations } = ctx;
    const mounted = mcpServersAsPerson(bot, orgSpeakerPrincipal(bot, roomAccessSpeaker), threadId);
    attachCustomMcp(integrations, mounted.servers, cfg);
    ctx.roomGithubWithheld = mounted.githubWithheld;
  }

  function perspicaxArgs(ctx: GroupMemberTurnCtx) {
    ctx.roomPerspicaxPrompt = "";
    const { bot, threadId, internalGeneration, roomAccessSpeaker, integrations, instance } = ctx;
    // The account's main Perspicax connection, as the person who speaks in the room.
    if (!(IDENTITY.kind === "perspicax" && instance.adapter.capabilities.customMcp === true)) return null;
    return {
      bot,
      threadId,
      generation: internalGeneration,
      speaker: roomAccessSpeaker,
      taken: Object.keys(integrations.custom ?? {}),
      from: { botId: bot.id, name: bot.name, color: bot.color },
    };
  }

  function applyPerspicax(ctx: GroupMemberTurnCtx, perspicax: any) {
    if (Object.keys(perspicax.custom).length) ctx.integrations.custom = { ...ctx.integrations.custom, ...perspicax.custom };
    ctx.roomPerspicaxPrompt = perspicax.prompt;
    if (ctx.integrations.agents) ctx.integrations.agents = withClaimsFlag(ctx.integrations.agents, perspicaxMcp?.hasMounted(ctx.threadId, ctx.internalGeneration, ctx.bot.id) === true);
  }

  return { prepareRoomImages, placeAndSkills, mountCustomMcp, perspicaxArgs, applyPerspicax };
}

export function createClaimRoomMemberTurn(host: GroupMemberTurnHost) {
  const {
    IDENTITY,
    DESKTOP_BRIDGE_MCP_NAME,
    boatLifecycleBusyBots,
    builtInBrowserEnabled,
    cfg,
    cloudEngine,
    cloudPlaceRefusal,
    computerPlaceRefusal,
    computerToolsRefusal,
    dataIntegration,
    groupSpeakers,
    inheritedTeamComputer,
    providerTransitionForTurn,
    registry,
    remoteComputerForTurn,
    resolveSurface,
    roomStallCompletions,
    roomTurnApprovalMode,
    roomTurnBrief,
    coordinator,
    directCoordinationSettlers,
    handoffOpener,
    requestWorkOrigin,
    store,
    toolScopeForTurn,
    turnProvider,
    watchdog,
  } = host;

  return function claimRoomMemberTurn(ctx: GroupMemberTurnCtx) {
    const {
      isCancelled, bot, group, instance, threadId, orchestration, preparedApprovalMode, preparedSelection,
      setupRetry, runGroupMemberTurn, groupId, botId, hop, spoken, cardContinuation, onDispatchError,
      onProviderHandshakeStarted, onProviderHandshakeSettled, skillAuthoringClaim, operation,
      internalGeneration, roomTurnSelection, roomPlace, integrations,
    } = ctx;
    let roomSpeaker = ctx.roomSpeaker;
  // Connected-app discovery is intentionally awaited before a provider owns
  // the bot. An interrupt during that setup window must still stop the queued
  // room operation before it starts a process.
  if (isCancelled?.()) return false;
  // A 1:1 or another room turn may have claimed this bot while connected-app
  // setup was in flight. Re-check immediately before the synchronous claim so
  // one bot can never own two provider processes.
  const readyBot = store.bot(bot.id);
  if (!readyBot) return false;
  const roomToolScope = toolScopeForTurn(readyBot.id);
  const readyGroup = store.group(group.id);
  const stillOwnsThread = readyGroup?.dm
    ? readyGroup.threadId === threadId
    : Boolean(readyGroup && store.groupTaskByThread(readyGroup.id, threadId));
  if (!readyGroup || !stillOwnsThread || !readyGroup.memberIds.includes(readyBot.id)) return false;
  const setupChanged =
    registry.get(roomTurnSelection(readyBot).instanceId) !== instance ||
    roomTurnApprovalMode(readyBot, threadId, orchestration) !== preparedApprovalMode ||
    readyBot.modelSelection.auto !== preparedSelection.auto ||
    readyBot.modelSelection.instanceId !== preparedSelection.instanceId ||
    readyBot.modelSelection.model !== preparedSelection.model ||
    readyBot.modelSelection.effort !== preparedSelection.effort ||
    readyBot.modelSelection.variant !== preparedSelection.variant;
  if (setupChanged) {
    if (setupRetry === 0) {
      return runGroupMemberTurn(
        groupId,
        threadId,
        botId,
        hop,
        spoken,
        cardContinuation,
        onDispatchError,
        isCancelled,
        onProviderHandshakeStarted,
        onProviderHandshakeSettled,
        skillAuthoringClaim,
        orchestration,
        operation,
        1,
      );
    }
    if (orchestration) {
      orchestration.result.outcome = "busy";
      return true;
    }
    const message = `${readyBot.name}'s settings changed while starting  -  skipped this round`;
    store.appendMessage(threadId, {
      role: "bot",
      kind: "activity",
      from: { botId: readyBot.id, name: readyBot.name, color: readyBot.color },
      tool: { name: message, ok: false }
    });
    onDispatchError?.(message);
    return true;
  }
  const providerChangeError = providerTransitionForTurn(readyBot);
  if (providerChangeError) {
    if (orchestration) {
      orchestration.result.outcome = "busy";
      return true;
    }
    const message = `${bot.name}'s computer provider is being updated  -  skipped this round`;
    store.appendMessage(threadId, {
      role: "bot",
      kind: "activity",
      from: { botId: bot.id, name: bot.name, color: bot.color },
      tool: { name: message, ok: false }
    });
    onDispatchError?.(message);
    return true;
  }
  if (boatLifecycleBusyBots.has(readyBot.id)) {
    if (orchestration) {
      orchestration.result.outcome = "busy";
      return true;
    }
    const message = `${bot.name}'s cloud computer is being changed  -  skipped this round`;
    store.appendMessage(threadId, {
      role: "bot",
      kind: "activity",
      from: { botId: bot.id, name: bot.name, color: bot.color },
      tool: { name: message, ok: false }
    });
    onDispatchError?.(message);
    return true;
  }
  if (readyBot.busy) {
    if (orchestration) {
      // Connected-app discovery yields. A direct turn can legitimately win
      // the claim during that gap; tell goal mode to wait and retry instead
      // of misclassifying the lost race as a failed team turn.
      orchestration.result.outcome = "busy";
      return true;
    }
    const message = `${bot.name} became busy in another conversation  -  skipped this round`;
    store.appendMessage(threadId, {
      role: "bot",
      kind: "activity",
      from: { botId: bot.id, name: bot.name, color: bot.color },
      tool: { name: message, ok: false }
    });
    onDispatchError?.(message);
    return true;
  }
  store.setActivity(bot.id, "working");
  // Claim cleanup ownership before browser preparation can yield or reject.
  // The finally block must release exactly this setup, never a newer turn.
  roomSpeaker = { botId: bot.id, name: bot.name, color: bot.color };
  ctx.roomSpeaker = roomSpeaker;
  groupSpeakers.set(threadId, roomSpeaker);
  store.patchGroup(readyGroup.id, { busyBotId: bot.id });
  orchestration?.onClaimed?.();
  // Every room turn is a root of the runtime (OpenMausBot beginTurn, #2204):
  // a node the runtime dispatched settles through its run hook, a hand-off
  // into the room keeps its own node, any other turn opens its root here and
  // ends it at the finally (it parks on the computer or on its cards there).
  if (orchestration?.coordination) {
    directCoordinationSettlers.set(internalGeneration, { nodeId: orchestration.coordination.id, settle: orchestration.coordination.settle });
  } else if (!orchestration?.roomHandoffId) {
    const latestUser = [...store.activePath(threadId)].reverse().find(
      (message) => message.role === "user" && message.kind === "text" && message.text,
    );
    const opener = handoffOpener({ botId: bot.id, threadId }, threadId);
    coordinator.beginTurn({
      id: internalGeneration, address: { groupId: readyGroup.id, threadId, botId: bot.id },
      brief: roomTurnBrief(threadId, bot, hop > 0 && !orchestration ? hop : 0, latestUser),
      level: preparedApprovalMode, ...(opener ? { opener } : {}), origin: requestWorkOrigin({ line: latestUser }),
      ...(orchestration?.goalRunId ? { goalRunId: orchestration.goalRunId } : {}),
    });
  }
  ctx.roomRootOpened = !orchestration?.roomHandoffId;
  // The stall completion handler only exists once the provider turn runs
  // (registered at dispatch below), but this watch is armed at claim. Latch
  // a stall that fires during setup  -  browser, boat, and VM mounts can all
  // wedge  -  so the dispatch site completes the turn instead of launching a
  // provider turn the person was already told was stopped. The finally
  // below unregisters the latch on every other exit.
  ctx.setupStallCause = undefined;
  ctx.unregisterSetupStall = roomStallCompletions.register(threadId, (cause) => {
    ctx.setupStallCause = cause;
  });
  // Watch from claim, not provider dispatch: room setup (connected-app
  // discovery, browser, boat, and VM mounts) can wedge before any provider
  // event exists. The exits between here and dispatch either throw into the
  // finally's guarded cleanup or return through the revalidation block,
  // both of which settle the watch.
  watchdog.watch(threadId, bot.id);

  // Connected-app discovery above can yield for a network round trip. A
  // profile may be removed, or the browser feature switched off, during that
  // window. Mint the capability only after this turn has synchronously
  // claimed the fresh bot record so a deleted profile cannot be resurrected
  // as a ghost session by an already-preparing room turn.
  // "Works on" decides here exactly as it decides a 1:1 turn: the same
  // shared policy, so a room cannot become the loophole that hands a bot
  // set to Off the browser its own settings withhold everywhere else.
  const inheritedRoomComputer = inheritedTeamComputer(readyBot);
  const roomRemote = remoteComputerForTurn({
    organization: IDENTITY.kind === "perspicax",
    runOnCloud: false,
    hasTeamComputer: Boolean(inheritedRoomComputer)
  });
  const roomTeamComputer = roomRemote.skipRemote ? undefined : inheritedRoomComputer;
  const roomPlan = resolveSurface({
    destination: roomTeamComputer ? "cloud" : readyBot.computer,
    browserOn:
      builtInBrowserEnabled(cfg) &&
      readyBot.browser !== false &&
      instance.adapter.capabilities.browserMcp === true
  });
  // A place the organisation disallows, or a Cloud home never offers, is
  // refused before anything is provisioned or started, exactly as a bot
  // thread refuses it. On an organization server Cloud is the person's
  // server environment, so it is not classified as a Boat or a VPS.
  const roomKind = roomTeamComputer ? "box" : roomPlan.computer === "local" ? "thisComputer" : readyBot.computer === "vm" ? "localVm"
    : roomPlan.computer === "cloud" && !roomRemote.skipRemote ? (turnProvider(readyBot) === "vps" ? "vps" : "box") : undefined;
  const roomPlaceRefusal = roomKind && computerPlaceRefusal(roomKind);
  if (roomPlaceRefusal) throw Object.assign(new Error(roomPlaceRefusal.message), { code: roomPlaceRefusal.code });
  // The same one rule as a bot thread, before anything is provisioned: an
  // engine that cannot use the cloud computer is refused, never swapped.
  if (!roomTeamComputer && !roomRemote.skipRemote && roomPlan.computer === "cloud") {
    const unsupported = cloudPlaceRefusal(cloudEngine(instance, readyBot.modelSelection.model), "room", readyBot.name)
      ?? computerToolsRefusal(readyBot.toolScope, "room", readyBot.name);
    if (unsupported) throw unsupported;
  }
  if (instance.adapter.capabilities.dataMcp === true) {
    const data = dataIntegration(readyBot.id, { threadId, generation: internalGeneration });
    if (data) integrations.data = data;
  }
    ctx.readyBot = readyBot;
    ctx.readyGroup = readyGroup;
    ctx.roomToolScope = roomToolScope;
    ctx.roomTeamComputer = roomTeamComputer;
    ctx.roomRemote = roomRemote;
    ctx.roomPlan = roomPlan;
    ctx.roomNeedsBrowser = Boolean(roomPlan.browser && !(roomPlan.computer === undefined && roomTeamComputer) && !(roomPlace.target === "user-desktop" && integrations.custom?.[DESKTOP_BRIDGE_MCP_NAME]));
  };
}
