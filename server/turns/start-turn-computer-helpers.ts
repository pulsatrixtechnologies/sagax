// @ts-nocheck
// #1388 wave 4 step 3: startTurn computer helpers (skipComputer, local VM claim/attach).
// Never imports server/index.ts.
import type { StartTurnHost } from "./start-turn-types.ts";
import type { TurnState } from "./start-turn-state.ts";

export function createComputerHelpersStartTurn(host: StartTurnHost) {
  const {
    ComputerWaitParked,
    DirectTurnSetupCancelled,
    PlaceUnavailableError,
    activeInternalGenerationByThread,
    autoLocalVmAttachable,
    autoVmClaims,
    bindTurnComputer,
    cfg,
    clearFailedAutoPin,
    cloudEngine,
    cloudPlaceRefusal,
    computerPlaceRefusal,
    computerToolsRefusal,
    containerComputerFrame,
    containerComputerMcp,
    containerComputerStatus,
    controlIntegration,
    deliverableNotification,
    directTurnGenerationByThread,
    failedTurnTool,
    honouredPin,
    interruptDirectThread,
    localVmActiveThreads,
    localVmIdleFor,
    localVmLeaseFor,
    localVmLifecycleBusy,
    localVmMode,
    localVmOwnerBusy,
    localVmPoolSeatHolder,
    localVmSeatPool,
    localVmSeen,
    localVmTargetForThread,
    localVmThreadTargets,
    notify,
    poolLocalVmTarget,
    readyLocalVmForTurn,
    redactSecretsInText,
    registerComputerResume,
    releaseLocalVmThread,
    releaseTurnComputer,
    reportIncident,
    screenPollers,
    startScreenPoller,
    stopScreenPoller,
    store,
    threadBusy,
    turnComputerResources,
    turnResources,
  } = host;

  return async function(state: TurnState): Promise<void> {
    /** A Team incidents turn's computer is optional (turnAnswers): a place
     * that cannot be prepared leaves it with none — any seat taken on the
     * way let go — and the state.prompt names the cause, where any other turn
     * fails. A stopped setup and a parked seat wait go on as for any turn. */
    state.skipComputer = (error: unknown) => {
      if (!state.answer.incident || error instanceof DirectTurnSetupCancelled || error instanceof ComputerWaitParked) throw error;
      state.computerSkipped ??= error instanceof Error ? error.message : String(error);
      state.wants = "off";
      state.teamComputer = undefined;
      delete state.integrations.localComputer;
      releaseTurnComputer(state.resourceOwner);
    };
    // A place the organisation disallows, or a Cloud home never offers, is
    // refused before anything is prepared; Auto below simply skips them.
    const wantedKind = state.teamComputer ? "box" : state.wants === "local" ? "thisComputer" : state.wants === "vm" ? "localVm"
      : state.wants === "cloud" ? (state.cloudBackend === "vps" ? "vps" : "box") : undefined;
    const placeRefusal = wantedKind && computerPlaceRefusal(wantedKind);
    if (placeRefusal) state.skipComputer(Object.assign(new Error(placeRefusal.message), { status: 409, code: placeRefusal.code }));
    // Where an explicit place came from, so its failure names the one
    // control that changes it (and a failed Auto-recorded pin is cleared).
    // Auto and a team's shared computer are nobody's per-turn choice.
    state.namedPlace = state.teamComputer || state.wants === undefined || state.wants === "off" ? undefined : state.wants;
    state.placeSource = !state.namedPlace ? undefined
      : state.opts?.runOn === "cloud" ? "routine"
      : state.plan.pinned ? (honouredPin(state.dispatchTask) ? "pin" : "auto-pin")
      : "works-on";
    // An engine that cannot use the cloud computer, or a Tool selection
    // that leaves its tools out, is refused here, before anything is
    // created or woken — never handed to another engine.
    if (state.wants === "cloud" && state.placeSource) {
      const unsupported = cloudPlaceRefusal(cloudEngine(state.instance, state.bot.modelSelection.model), state.placeSource, state.bot.name)
        ?? computerToolsRefusal(state.toolScope, state.placeSource, state.bot.name);
      if (unsupported) state.skipComputer(unsupported);
    }
    state.previewCapture = null;
    state.browserCapture = null;
    state.computerKind = null;
    state.autoVpsProblem = null;
    /** Whether Auto's VPS check reached SSH and Docker (vpsUnavailableHint). */
    state.autoVpsReachable = undefined;
    /** The Local VM frame capture for the poller and the settled transcript
     * screenshot. The shared desktop outlives the turn: once another thread
     * owns it, a capture still in flight would picture ITS work under this
     * bot's name — live and in the settled frame, which is taken after the
     * lease is already released. No owner means the desktop is simply
     * idle: that final frame is ours to keep. */
    state.localVmPreviewFor = (localVmTarget: LocalVmTarget, claimThreadId: string) => () => {
      const owner = localVmLeaseFor(localVmTarget).current(localVmOwnerBusy);
      if (owner && owner.threadId !== claimThreadId) {
        throw new Error("the Local VM moved on to another turn");
      }
      return containerComputerFrame(undefined, undefined, localVmTarget);
    };
    /** The exclusive Local VM claim sequence, verbatim from the old inline
     * attach path, shared by dispatch (eager) and the first-screen-call
     * gate (issue #1361). Idempotent per turn: the resource claim and the
     * lease both re-assert the same owner, so a re-entrant call from the
     * gate no-ops once dispatch has already claimed. A lazy attach pins
     * the target it mounted the tools against: the claim must lease that
     * desktop, not whatever localVmTargetForBot resolves to by the time
     * the first screen call arrives. */
    state.claimAutoLocalVm = async (claimThreadId: string, pinnedTarget?: LocalVmTarget): Promise<{ target: LocalVmTarget; runtime: Runtime }> => {
      state.localVmTarget = pinnedTarget ?? localVmThreadTargets.get(claimThreadId) ?? { ...localVmTargetForThread(state.bot.id, claimThreadId) };
      const localVmTarget = state.localVmTarget;
      await bindTurnComputer(state.resourceOwner, `computer:vm:${localVmTarget.key}`, true);
      if (host.localVmImageBusy || host.localVmModeChangeBusy || localVmLifecycleBusy.has(localVmTarget.key)) {
        throw new Error("this Local VM is being started, stopped, or replaced — wait for setup to finish");
      }
      // Claim before the first await. The lifecycle route performs its
      // matching check synchronously, so neither side can enter while the
      // other is between inspection and mutation.
      if (!localVmLeaseFor(localVmTarget).claim(claimThreadId, state.bot.id, localVmOwnerBusy)) {
        throw new Error("this Local VM is already being used by another turn — wait for that turn to finish");
      }
      // Only a turn that wins its lease extends pool affinity; a thread
      // retrying behind a stranger lets the TTL lapse and migrates.
      if (localVmMode(cfg) === "pool") localVmSeatPool.touch(claimThreadId);
      localVmThreadTargets.set(claimThreadId, localVmTarget);
      localVmActiveThreads.set(localVmTarget.key, claimThreadId);
      localVmIdleFor(localVmTarget).touch();
      // The lease is held from here. An eager attach that fails below
      // fails the turn and settle releases it; a lazy claim's rejection is
      // swallowed into the slot's failed flag and the turn carries on, so
      // without this the exclusive lease would sit held for the rest of a
      // turn that never got the VM — the very serialisation #1361 removes.
      const dropLease = () => {
        if (localVmThreadTargets.get(claimThreadId) !== localVmTarget) return;
        localVmLeaseFor(localVmTarget).release(claimThreadId);
        if (localVmActiveThreads.get(localVmTarget.key) === claimThreadId) localVmActiveThreads.delete(localVmTarget.key);
        localVmThreadTargets.delete(claimThreadId);
        // bindTurnComputer above also took the turn-level resource; a
        // later turn's exclusive bind queues behind it just the same.
        state.resource = `computer:vm:${localVmTarget.key}`;
        turnResources.releaseOne(state.resource, state.resourceOwner);
        if (turnComputerResources.get(state.resourceOwner.threadId)?.resource === state.resource) turnComputerResources.delete(state.resourceOwner.threadId);
      };
      let localVm: Awaited<ReturnType<typeof readyLocalVmForTurn>>;
      try {
        localVm = await readyLocalVmForTurn(state.bot.id, localVmTarget);
      } catch (error) {
        dropLease();
        throw error;
      }
      if (!localVm.ready || !localVm.runtime) {
        dropLease();
        throw new Error(`${localVm.problem ?? "the Local VM is not ready"} (App Settings → Computers)`);
      }
      // The readiness walk can wait minutes for the desktop, and the group
      // path re-validates its lease afterwards; the direct path needs the
      // same guard so a turn never attaches MCP to a desktop another turn
      // now owns.
      const owner = localVmLeaseFor(localVmTarget).current(localVmOwnerBusy);
      if (owner?.threadId !== claimThreadId || owner.botId !== state.bot.id) {
        dropLease();
        throw new Error("the Local VM lease expired while preparing the turn");
      }
      // Same contract as the Boat and VPS branches below: without this the
      // poller never starts, so the Local VM publishes no `screen` events
      // and every client that only has the stream (the phone) waits
      // forever. The web panel hid the gap by polling the screenshot
      // route itself.
      state.previewCapture = state.localVmPreviewFor(localVmTarget, claimThreadId);
      return { target: localVmTarget, runtime: localVm.runtime };
    };

    // Issue #1369: a lazy claim that rejects must not leave its turn busy
    // behind a gate that can only refuse. Surface the terminal
    // computer-unavailable error, then end the turn. Fenced to this
    // dispatch generation and a still-busy thread, so a rejection landing
    // after settle — or after a newer turn owns the thread — never touches
    // the newer turn. The gate's refusals stay fail-closed for any screen
    // call racing this teardown; the turn-failed buzz and incident follow
    // the dispatch-failure rules (person-started turns only).
    state.surfaceLazyClaimRejection = (label: string) => (failure: string, error?: unknown) => {
      if (activeInternalGenerationByThread.get(state.threadId) !== state.resourceOwner.generation || !threadBusy(state.bot.id, state.threadId)) return;
      // The wait ceiling parked this turn (#1651): register the resume and
      // settle the live turn. No error entry, no incident — the parked chip
      // the wait appended is the whole story. The slot still fails, so the
      // gate keeps refusing screen calls for the rest of this generation
      // while the interrupt lands.
      if (state.resourceOwner.computerParkedOn) {
        registerComputerResume({
          botId: state.bot.id,
          threadId: state.threadId,
          resource: state.resourceOwner.computerParkedOn,
          generation: state.resourceOwner.generation,
          afterMessageId: store.activePath(state.threadId).findLast((entry: any) => entry.role === "user")?.id
        });
        void interruptDirectThread(state.bot.id, state.threadId, { preserveComputerResume: true, cause: "computer-park" }).catch(() => {});
        return;
      }
      // A place that failed (mountBotBoat) is already read as its one line
      // and one way on, and never sticks as an Auto-recorded pin.
      const placeFailure: any = error instanceof PlaceUnavailableError ? error : undefined;
      if (placeFailure) clearFailedAutoPin(state.bot.id, state.threadId, placeFailure.place);
      const message = placeFailure?.message ?? `computer unavailable — ${label} could not be claimed for this turn (${failure})`;
      store.appendMessage(state.threadId, {
        role: "bot",
        kind: "activity",
        tool: failedTurnTool(message, placeFailure ? { place: placeFailure.row } : {})
      });
      if (state.opts?.automationSource === undefined && !state.opts?.commsDepth && !state.opts?.cardContinuation) {
        notify(deliverableNotification("turn-failed", state.bot, state.threadId, redactSecretsInText(message), { avatarUrl: state.bot.avatarUrl }));
        reportIncident({ kind: "could-not-start", bot: state.bot, threadId: state.threadId, detail: message });
        // Claude settles the interrupt below as exit_before_result; the
        // completion fold must not report this failure a second time.
        state.resourceOwner.lazyClaimFailureReported = true;
      }
      // A routine, a delegation or a resume reports this exactly as it
      // reports a place that failed at dispatch: with this cause, before
      // the interrupt settles the turn as merely "interrupted".
      state.opts?.onDispatchError?.(message);
      void interruptDirectThread(state.bot.id, state.threadId).catch(() => {});
    };

    /** A lazily claimed state.remote desktop (the VPS, the bot's Boat) streams
     * from the moment its claim lands. The dispatch-site poller start saw
     * no capture (the claim runs after dispatch), so restart the poller
     * with this one, keeping any browser capture and whether this turn
     * already touched its screen. Same still-running guard as dispatch: a
     * poller started after its own turn.completed would never stop. */
    state.adoptClaimedCapture = (capture: () => Promise<{ png: string; format: string }>) => {
      state.previewCapture = capture;
      if (!threadBusy(state.bot.id, state.threadId)) return;
      const touched = screenPollers.get(state.threadId)?.touched ?? false;
      stopScreenPoller(state.bot.id, state.threadId);
      startScreenPoller(
        state.bot.id,
        state.threadId,
        { computer: capture, ...(state.browserCapture ? { browser: state.browserCapture } : {}) },
        { screenIsTheWork: touched },
      );
    };

    // Explicit destinations are strict. In particular, Local VM must never
    // fall through to host CUA and accidentally click on the user's Mac.
    // The Local VM attach, shared by explicit "Local VM" and by Auto. Explicit
    // is strict and throws with the reason. Auto only reaches a VM this bot
    // already has — ready now, or one whose desktop image is prepared and can
    // be recreated on demand after idling away — and never creates a first
    // VM on its own; every failure there is a quiet "not this place".
    state.attachLocalVm = async (strict: boolean): Promise<boolean> => {
      if (!state.mountsComputerMcp) {
        if (!strict) return false;
        throw new Error("this model cannot use the Local VM — choose Claude or an ACP model provider, or select another computer destination");
      }
      if (!strict && localVmMode(cfg) === "pool") {
        // localVmTargetForThread records pool affinity, so a turn the
        // fast path is about to skip must not reserve or refresh a seat.
        // Gate on the side-effect-free candidate assign() would pick —
        // the automationSource bypass below stays authoritative.
        const poolCandidate = poolLocalVmTarget(localVmSeatPool.candidate(state.threadId, localVmPoolSeatHolder));
        if (!localVmSeen.has(poolCandidate.key) && !state.opts?.automationSource) return false;
      }
      state.localVmTarget = { ...localVmTargetForThread(state.bot.id, state.threadId) };
      const localVmTarget = state.localVmTarget;
      let lazyReadyVm: { runtime: Runtime } | null = null;
      if (!strict) {
        // Nothing this process has ever seen for this target, and nobody is
        // relying on an unattended run: do not pay for a runtime probe.
        if (!localVmSeen.has(localVmTarget.key) && !state.opts?.automationSource) return false;
        const seen = await containerComputerStatus(undefined, undefined, localVmTarget).catch(() => null);
        if (!seen || !autoLocalVmAttachable(seen)) return false;
        if (host.localVmImageBusy || host.localVmModeChangeBusy || localVmLifecycleBusy.has(localVmTarget.key)) return false;
        if (seen.ready && seen.runtime) lazyReadyVm = { runtime: seen.runtime };
      }
      try {
        if (lazyReadyVm) {
          // Lazy exclusivity (issue #1361): a VM that is ready right now
          // mounts without claiming — screen-less Auto turns never touch
          // the lease, and the first screen tools/call fires the claim
          // through the computer-control gate. A VM that must be created
          // or recreated first keeps the eager claim below: the bridge
          // child needs the container to exist, and readyLocalVmForTurn
          // is what boots it.
          state.integrations.localComputer = containerComputerMcp(
            lazyReadyVm.runtime,
            controlIntegration(state.bot.id, state.threadId, state.dispatchClaimId),
            localVmTarget,
          );
          autoVmClaims.set(state.threadId, {
            owner: state.resourceOwner,
            lazy: true,
            label: "the Local VM",
            localVm: true,
            onRejected: state.surfaceLazyClaimRejection("the Local VM"),
            claim: async () => {
              await state.claimAutoLocalVm(state.threadId, localVmTarget);
              // The dispatch-site poller start saw a null previewCapture
              // (this lazy mount runs before any claim exists), so this
              // turn would publish no live `screen` events and settle no
              // final computer frame. Restart the poller with the now-live
              // computer capture, keeping any browser capture and whether
              // this turn already touched its screen. Same still-running
              // guard as dispatch: a poller started after its own
              // turn.completed would never be torn down.
              if (state.previewCapture && threadBusy(state.bot.id, state.threadId)) {
                const touched = screenPollers.get(state.threadId)?.touched ?? false;
                stopScreenPoller(state.bot.id, state.threadId);
                startScreenPoller(
                  state.bot.id,
                  state.threadId,
                  { computer: state.previewCapture, ...(state.browserCapture ? { browser: state.browserCapture } : {}) },
                  { screenIsTheWork: touched },
                );
              }
            }
          });
          return true;
        }
        const claimed = await state.claimAutoLocalVm(state.threadId);
        state.integrations.localComputer = containerComputerMcp(
          claimed.runtime,
          controlIntegration(state.bot.id, state.threadId, state.dispatchClaimId),
          claimed.target,
        );
        // Hand the same claim to the first-screen-call gate. This eager
        // path has already claimed, so the gate's fire-once call can only
        // re-assert the same owner — a no-op (issue #1361).
        autoVmClaims.set(state.threadId, {
          owner: state.resourceOwner,
          label: "the Local VM",
          claim: async () => { await state.claimAutoLocalVm(state.threadId); }
        });
        return true;
      } catch (error) {
        // A wait ceiling settled this turn as parked, not as an unavailable
        // Auto destination. Let dispatch register its resume instead of
        // continuing the provider without the requested computer.
        if (strict || error instanceof ComputerWaitParked) throw error;
        if (directTurnGenerationByThread.get(state.threadId) === state.dispatchClaimId) releaseLocalVmThread(state.threadId);
        return false;
      }
    };
  };
}
