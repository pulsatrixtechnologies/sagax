// @ts-nocheck
// #1388 wave 4 step 3: startTurn computer mount half (host/VPS/Boat/browser/agents).
// Never imports server/index.ts.
import type { StartTurnHost } from "./start-turn-types.ts";
import type { TurnState } from "./start-turn-state.ts";

export function createComputerMountStartTurn(host: StartTurnHost) {
  const {
    CREDENTIAL_PROMPT,
    DESKTOP_BRIDGE_MCP_NAME,
    DirectTurnSetupCancelled,
    HOST_COMPUTER_RESOURCE,
    LEARN_PROMPT,
    ROUTINE_PROMPT,
    SESSION_SEARCH_SYSTEM_PROMPT,
    THREADS_PROMPT,
    WIDGET_APPROVAL_PROMPT,
    WIDGET_PROMPT,
    agentBrowserFrame,
    agentsIntegration,
    asPlaceFailure,
    attachTeamBoat,
    autoRecallEnabled,
    autoVmClaims,
    bindTurnComputer,
    boat,
    boatNotConfigured,
    botCreationOffered,
    botProfilePrompt,
    browserIntegration,
    browserRuntime,
    builtInBrowserEnabled,
    canWorkOnCloud,
    cfg,
    checkpoints,
    chiefOfStaffSystemPrompt,
    claimTurnResource,
    cloudEngine,
    computerPlaceRefusal,
    computerSelectionTurns,
    recordTurnPlace,
    controlIntegration,
    dataIntegration,
    directRequestOwners,
    directTurnClaimIsCurrent,
    engineHasNativeWebSearch,
    forgetTurnCheckpoint,
    gatedLocalComputer,
    hooksEnabled,
    hooksIntegration,
    hostScreenTurns,
    managedPolicy,
    markDirectTurnDispatching,
    mentionedBots,
    mountBotBoat,
    mountBotVps,
    mountHostComputer,
    namedTeammates,
    ownerBotsReadOnly,
    peerRosterSystemPrompt,
    pendingCancelledProviderHandshakes,
    prepareSemanticRecall,
    prewarmNamedTeammates,
    reachablePeers,
    readCuaConnection,
    recallQuery,
    runLifecycleEvent,
    sameOwnerRosterMember,
    savedSteps,
    semanticEmbeddingEndpoint,
    setupModeActive,
    shouldMountLocalComputer,
    store,
    surfaceOfComputerKind,
    turnCheckpoints,
    turnResourceOwners,
    vps,
    vpsThreadEnded,
    vpsThreadStarted,
    withholdHostToolsFor,
  } = host;

  return async function(state: TurnState): Promise<void> {
    // An explicit place that cannot be attached fails the turn with its
    // cause and the next action; it never quietly moves the work elsewhere.
    try {
      if (state.wants === "vm") {
        if (await state.attachLocalVm(true)) state.computerKind = "vm";
      } else if (state.wants === "local") {
        state.integrations.localComputer = await mountHostComputer(
          state.resourceOwner, state.bot.id, state.mountsLocalComputer, state.surfaceLazyClaimRejection("this computer"),
          savedSteps.journals(directRequestOwners.get(state.threadId)),
        );
        state.computerKind = "local";
      }

      // A VPS is a local-agent computer mount, never a remote agent runner.
      // Explicit Cloud may prepare/start it. Auto remains read-only unless
      // the person explicitly opted this bot into remote lifecycle actions.
      // On Auto an engine that cannot use a computer simply skips it.
      if ((state.wants === "cloud" || (state.wants === undefined && managedPolicy.computerAllowed("vps"))) && state.cloudBackend === "vps" &&
          canWorkOnCloud(cloudEngine(state.instance))) {
        // The VPS "computer" is the desktop inside this bot's managed
        // container, and only screen work needs that desktop to itself.
        // So the lease is claimed on the first computer call, through the
        // computer-control gate (the Local VM's seam, #1361), never at
        // mount: a bot's turns that never touch the computer tools run
        // side by side, and its 3-hourly routine no longer queues behind
        // — or fails after 30 minutes behind — its own long-running task.
        // Container lifecycle (provision, start) is serialized by the
        // runner's per-container lock, not by this turn.
        vpsThreadStarted(state.bot.id, state.threadId);
        const mounted = await mountBotVps(state.bot, state.resourceOwner, {
          start: vps.vpsStartsForTurn({ wants: state.wants, autoStartVps: state.bot.autoStartVps, automationSource: state.opts?.automationSource }),
          // The claim restarts the poller with the capture, the way the
          // Local VM's lazy claim does.
          onClaimed: (vpsCapture: any) => {
            state.adoptClaimedCapture(vpsCapture);
          },
          onRejected: state.surfaceLazyClaimRejection("the VPS computer")
        }).catch((error: unknown) => {
          // Explicit Cloud is strict. On Auto a start the person allowed
          // that could not finish is one more reason the VPS is
          // unavailable, read below like any other.
          if (state.wants === "cloud") throw error;
          return { problem: error instanceof Error ? error.message : String(error), reachable: undefined };
        });
        if ("integration" in mounted) {
          state.integrations.localComputer = mounted.integration;
          state.computerKind = "vps";
        } else {
          vpsThreadEnded(state.bot.id, state.threadId);
          if (state.wants === "cloud") {
            throw new Error(mounted.problem ?? "the VPS computer could not be created or reached");
          }
          state.autoVpsProblem = mounted.problem ?? "the VPS computer could not be reached";
          state.autoVpsReachable = mounted.reachable;
        }
      }

      if (state.teamComputer) {
        const attached = await attachTeamBoat(state.teamComputer, state.bot.id, state.resourceOwner, canWorkOnCloud(cloudEngine(state.instance)));
        Object.assign(state.integrations, attached.mount);
        state.previewCapture = attached.capture;
        state.computerKind = "box";
      }
      // Cloud is strict when selected. A turn reaches the Boat only when
      // this conversation is on it (Works on, a pin, a cloud routine, or
      // select_computer): an Auto turn never reads the Boat account, so it
      // adds no Boat call, cannot be stopped by a Boat being deleted, and
      // never records a place nobody chose. Even then the Boat is created
      // or woken only by the bot's first computer call (mountBotBoat): a
      // chat that never touches the screen uses no plan hours.
      if (!state.teamComputer && state.cloudBackend === "box" && boat.boatConfigured(cfg) && state.wants === "cloud") {
        state.integrations.localComputer = mountBotBoat(state.bot, state.resourceOwner, {
          // The row a failed attach always wrote: the place's one line and
          // its one way on, read where the place came from (an
          // Auto-recorded pin is cleared, as dispatch clears it).
          source: state.placeSource,
          onClaimed: state.adoptClaimedCapture,
          onRejected: state.surfaceLazyClaimRejection("the cloud computer")
        });
        state.computerKind = "box";
      }
      if (state.wants === "cloud" && state.cloudBackend === "box" && !boat.boatConfigured(cfg)) {
        throw boatNotConfigured(state.bot, state.placeSource ?? "works-on");
      }
      if (state.wants === "cloud" && state.cloudBackend === "box" && state.computerKind !== "box") {
        throw new Error("the cloud computer could not be created or reached");
      }
    } catch (error) {
      // Auto, Off and a team's shared computer name no place; they fail as
      // they are.
      state.skipComputer(!state.namedPlace || !state.placeSource ? error : await asPlaceFailure(error, state.namedPlace, state.placeSource, state.bot, state.cloudBackend));
    }

    // Auto-only host fallback. Electron owns cua-driver/TCC attribution;
    // the harness only reads its already-running connection descriptor.
    // Auto reaches a Local VM this bot already has before it ever touches the
    // host's own desktop: on a headless server that VM is the only desktop
    // there is, and a person who prepared one meant it to be used.
    if (state.wants === undefined && !state.integrations.localComputer && !computerPlaceRefusal("localVm") && await state.attachLocalVm(false)) state.computerKind = "vm";
    // An unattended run on a bot with a VPS configured never lands on the
    // host's own desktop instead: a scheduled job clicking on someone's
    // laptop is worse than a scheduled job that fails and says why.
    const unattendedVps = state.cloudBackend === "vps" && Boolean(state.opts?.automationSource);
    if (
      !state.integrations.localComputer &&
      state.wants === undefined &&
      !unattendedVps &&
      !computerPlaceRefusal("thisComputer") &&
      shouldMountLocalComputer({
        requested: undefined,
        hostPlatform: process.platform,
        providerSupportsLocal: state.mountsLocalComputer
      })
    ) {
      const cua = readCuaConnection();
      if (cua) {
        // Lazy host claim (issue #1650): the gated integration mounts
        // now, but the exclusive computer:host seat is taken only by the
        // first screen tools/call, through the computer-control gate —
        // the same seam as the Local VM (#1361) and the VPS. An Auto
        // turn that never touches the screen holds no desktop seat and
        // records no pin; a claim that finds the seat held waits behind
        // the holder like every other seat instead of failing on the
        // spot.
        autoVmClaims.set(state.threadId, {
          owner: state.resourceOwner,
          lazy: true,
          label: "this computer",
          onRejected: state.surfaceLazyClaimRejection("this computer"),
          claim: async () => {
            await bindTurnComputer(state.resourceOwner, HOST_COMPUTER_RESOURCE, true);
            recordTurnPlace(state.bot.id, state.threadId, "local");
          }
        });
        state.integrations.localComputer = gatedLocalComputer(
          cua, controlIntegration(state.bot.id, state.threadId, state.dispatchClaimId, "this computer"),
          savedSteps.journals(directRequestOwners.get(state.threadId)),
        );
        state.computerKind = "local";
      }
    }
    // Auto found this bot's VPS unavailable and no other computer took its
    // place. A scheduled run fails and says why: its work is the screen,
    // and nobody is there to read a reply. Every other turn runs — a
    // Chief's assignment or a card's resume that never touches the screen
    // must not fail on a VPS it never uses — and its model is told the
    // true reason and the one way on, so work that does need the screen
    // says so instead of claiming it. A turn with select_computer can
    // start the VPS itself.
    state.vpsUnavailableNote = "";
    if (
      state.wants === undefined &&
      state.cloudBackend === "vps" &&
      !state.integrations.localComputer &&
      state.autoVpsProblem &&
      !computerSelectionTurns.has(state.threadId)
    ) {
      const hint = vps.vpsUnavailableHint({ automationSource: state.opts?.automationSource, autoStartVps: state.bot.autoStartVps, reachable: state.autoVpsReachable });
      if (state.opts?.automationSource) state.skipComputer(new Error(`${state.autoVpsProblem}. ${hint}`));
      else state.vpsUnavailableNote = ` This bot's VPS computer is unavailable this turn (${state.autoVpsProblem}), so no computer is mounted. Work that needs no screen can go ahead. If the request needs the VPS desktop, do not claim to have used it: say it is unavailable${hint ? ` and what the person can do: ${hint}` : "."}`;
    }
    // Agent control tools include peer comms and the secure credential
    // request card. A comms-invoked turn (depth ≥ cap) gets none — hard recursion
    // stop, so the user's tokens can't be burned by a bot-to-bot loop.
    // Only drivers that mount the tools get the integration (and, via the
    // integrations.agents gate below, the prompt hint) — a bot on a driver
    // without it must not be told about tools it cannot call. Any bot can
    // still be the TARGET of ask_bot regardless of its driver.
    // One reachability rule for the roster, list_bots and @mention
    // resolution: a bot is never told about — or nudged toward — a peer
    // that ask_bot and delegate_bot would then refuse.
    state.sectionPeers = reachablePeers(store.bots, state.bot);
    if (state.agentsMounted) {
      // Only a direct human request can create separate self-owned jobs.
      // Coordinated children and self-opened jobs stay inside their scope;
      // a later real user message on the same task is a fresh request.
      state.origin = state.opts?.cardContinuation
        ? store.activePath(state.threadId).findLast((message: any) => message.role === "user" && message.kind === "text")
        : state.userMessage;
      const ownThreadCreation = state.boundedCoordination && !state.coordinated && Boolean(state.origin && !state.origin.peerAsk);
      state.integrations.agents = agentsIntegration(state.bot.id, state.threadId, state.commsDepth, state.skillAuthoring, state.dispatchClaimId, state.opts?.coordination?.id, state.boundedCoordination, ownThreadCreation, state.worksInWorkspace, !engineHasNativeWebSearch(state.instance.driverKind, withholdHostToolsFor(state.instance), state.model));
    }
    if (state.instance.adapter.capabilities.hooks === true && hooksEnabled()) {
      state.integrations.hooks = hooksIntegration(state.bot.id, state.threadId, state.dispatchClaimId);
      void runLifecycleEvent(state.bot.id, state.threadId, "before_submit_prompt", {}).catch(() => {});
    }
    // @mentions in the user's message (the composer's tagging UI) become
    // an explicit coordination nudge. The agent still chooses the matching
    // peer tool, so the harness stays the single owner of turns/permissions.
    state.tagged = state.integrations.agents && !state.peerHop
      ? mentionedBots(
          state.providerText,
          state.sectionPeers,
        )
      : [];
    // A person's request that names a teammate: its engine starts now, in
    // the work thread coordinate_bots would use, so the delegation does not
    // wait for a cold start (perf round 3).
    if (!state.warmOnly && state.integrations.agents && state.boundedCoordination && !state.commsDepth && !state.opts?.coordination && !store.groupByThread(state.threadId)) {
      prewarmNamedTeammates(state.bot, state.threadId, namedTeammates(state.providerText, state.sectionPeers, state.tagged));
    }
    state.coordinationPrompt = state.bot.chiefOfStaff
      ? chiefOfStaffSystemPrompt(
          state.bot.id,
          store.bots,
          Boolean(state.integrations.agents) && !state.peerHop,
          state.boundedCoordination,
        )
      : state.integrations.agents && !state.peerHop && state.sectionPeers.length > 0
        // Ordinary bots could always CALL the peer tools; until now the
        // one generic sentence they got never named a teammate, so the
        // first move of any collaboration was a list_bots round trip the
        // model mostly did not think to make.
        ? peerRosterSystemPrompt(state.sectionPeers, state.boundedCoordination, botCreationOffered(state.bot, ownerBotsReadOnly(state.bot)), sameOwnerRosterMember(state.bot))
        : "";
    state.credentialPrompt = state.integrations.agents ? CREDENTIAL_PROMPT + (state.boundedCoordination || state.peerHop ? "" : THREADS_PROMPT) + WIDGET_PROMPT + WIDGET_APPROVAL_PROMPT : "";
    state.routinePrompt = state.integrations.agents ? ROUTINE_PROMPT : "";
    state.profilePrompt = state.integrations.agents ? botProfilePrompt(state.bot) : "";
    state.recallPrompt = state.integrations.agents && state.bot.memoryEnabled !== false ? SESSION_SEARCH_SYSTEM_PROMPT : "";
    state.learnPrompt = state.skillAuthoring ? LEARN_PROMPT : "";

    // (activeVpsThreads was already claimed above, before the provision or
    // reuse await, so the backend guards saw this turn the whole time.)
    // Wait immediately before dispatch: resources are already claimed, but
    // the engine cannot edit the project until the snapshot has settled.
    // snapshot() absorbs failures, so checkpointing may delay but never fail
    // a turn.
    if (state.checkpointCwd) {
      // Pinned by this dispatch: a sibling thread's snapshot in the same
      // folder must not reclaim this turn's "before" state while it runs.
      const before = await checkpoints.snapshot(state.bot.id, state.checkpointCwd, `turn ${state.threadId.slice(0, 8)}`, undefined, { pin: state.dispatchClaimId });
      if (!directTurnClaimIsCurrent(state.bot.id, state.dispatchClaimId, state.threadId)) {
        if (before) void checkpoints.release(state.bot.id, state.checkpointCwd, state.dispatchClaimId);
        throw new DirectTurnSetupCancelled("turn stopped during checkpoint");
      }
      forgetTurnCheckpoint(state.threadId);
      if (before) turnCheckpoints.set(state.threadId, { botId: state.bot.id, cwd: state.checkpointCwd, hash: before, pin: state.dispatchClaimId });
    }
    if (!directTurnClaimIsCurrent(state.bot.id, state.dispatchClaimId, state.threadId)) {
      throw new DirectTurnSetupCancelled("turn stopped before dispatch");
    }
    // Mint the browser bearer at the last possible moment. The desktop
    // registration is asynchronous, so validate this exact setup claim
    // again inside browserIntegration before the capability is published.
    // Also the one bot snapshot setupModeActive and the prompt's soul
    // (below) share, so a soul saved mid-dispatch is seen by both instead
    // of the two disagreeing about whether setup mode is still active.
    state.liveBot = store.bot(state.bot.id);
    state.setupMode =
      state.peerToolsMounted &&
      setupModeActive({
        soul: state.liveBot?.soul ?? state.bot.soul,
        description: state.liveBot?.description ?? state.bot.description,
        text: state.providerText
      });
    if (state.liveBot && state.instance.adapter.capabilities.dataMcp === true) {
      const data = dataIntegration(state.bot.id, { threadId: state.threadId, generation: state.dispatchClaimId });
      if (data) state.integrations.data = data;
    }
    // One place per turn. On Auto the branches above may have reached a
    // computer; then the built-in browser stays unmounted and web work
    // happens in that computer's own browser. Not on this computer, the
    // person's own screen (2026-10-28): the built-in browser stays beside
    // it, so a lookup never opens a window in front of them
    // (HOST_SCREEN_RULE in server/surface.ts).
    state.mountedComputer = surfaceOfComputerKind(state.computerKind);
    if (state.computerKind === "local") hostScreenTurns.set(state.threadId, { botId: state.bot.id, generation: state.dispatchClaimId });
    else hostScreenTurns.delete(state.threadId);
    if (
      state.liveBot &&
      state.plan.browser &&
      !(state.plan.computer === undefined && state.mountedComputer && state.mountedComputer !== "local") &&
      // On the person's computer, web pages open in their own browser
      // (sagax-desktop browse), on their network, not on this server.
      // Auto keeps the built-in browser: it is one of the places it picks.
      !(state.turnPlace.target === "user-desktop" && !state.turnAuto?.auto && state.integrations.custom?.[DESKTOP_BRIDGE_MCP_NAME]) &&
      builtInBrowserEnabled(cfg) &&
      state.liveBot.browser !== false &&
      state.instance.adapter.capabilities.browserMcp === true
    ) {
      const selectedProfile = state.liveBot.browserProfile;
      state.browser = await browserIntegration(state.bot.id, selectedProfile, { threadId: state.threadId, generation: state.dispatchClaimId });
      if (state.browser) state.integrations.browser = state.browser.integration;
      // The browser lost its frame source when the Electron surface was
      // removed: previewCapture is set by the computer branches above, and
      // nothing replaced it here. A bot with only a browser was pictured
      // not at all; a bot with both was pictured on its desktop even while
      // the work was a web page, because agent-browser runs its own headless
      // Chrome on the host rather than inside that desktop.
      if (state.browser) {
        const frame = { binaryPath: state.browser.spec.command, env: state.browser.spec.env };
        const session = state.browser.session;
        // The preview shares the profile with tool calls: claim the same
        // exclusive browser:<session> resource the tools/call path claims,
        // and skip the frame while another thread holds it.
        state.browserCapture = async () => {
          const owner = turnResourceOwners.get(state.threadId);
          if (!owner || !claimTurnResource(owner, `browser:${session}`)) throw new Error("another thread is using this browser");
          return browserRuntime.previewFrame(session, () => agentBrowserFrame(frame));
        };
      }
    }
    // Auto remembers no place (2026-10-16): where this turn works, the
    // built-in browser or a computer it claims, is never written to the
    // conversation. The next message decides again; only the person's own
    // pin holds a place (honouredPin).
    // Where this turn works, for a request_sign_in it makes (signInPlace):
    // the built-in browser, else the computer it mounted.
    recordTurnPlace(state.bot.id, state.threadId, state.plan.computer === undefined && state.mountedComputer === "local" && state.integrations.browser
      ? "browser" : state.mountedComputer ?? (state.integrations.browser ? "browser" : null));
    const computerSelection = computerSelectionTurns.get(state.threadId);
    if (computerSelection) computerSelection.mounted = state.mountedComputer ?? (state.integrations.browser ? "browser" : undefined);
    // A cancelled adapter can be between accepting sendTurn and revealing
    // its provider turn id. Never overlap a replacement with that ambiguous
    // pre-id window: wait for the old handshake to settle or for its bounded
    // quarantine to expire, then revalidate this exact claim before launch.
    // An embedding endpoint the person runs reads this turn's recall query
    // first (bounded, server/recall/semantic-recall.ts), before the claim below
    // is revalidated. Without one nothing is awaited.
    if (state.bot.memoryEnabled !== false && autoRecallEnabled(cfg) && semanticEmbeddingEndpoint(cfg)) await prepareSemanticRecall(state.bot.id, recallQuery(state.resolvedImages.text));
    await pendingCancelledProviderHandshakes.waitForClear(state.threadId);
    if (!markDirectTurnDispatching(state.bot.id, state.dispatchClaimId, state.threadId)) {
      throw new DirectTurnSetupCancelled("turn stopped before dispatch");
    }
  };
}
