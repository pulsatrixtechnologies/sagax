// @ts-nocheck
// #1388 wave 4 step 3: startTurn computer workspace half (cwd, sandbox, local VM helpers).
// Never imports server/index.ts.
import type { StartTurnHost } from "./start-turn-types.ts";
import type { TurnState } from "./start-turn-state.ts";

export function createComputerWorkspaceStartTurn(host: StartTurnHost) {
  const {
    IDENTITY,
    beginMemoryTurn,
    cloudGuestOpened,
    ensureTaskWorkspace,
    ensureWorkspace,
    inheritedTeamComputer,
    installedPlaybookInstructions,
    mountPersonalMcp,
    mountPluginMcp,
    mountUserSandbox,
    remoteComputerForTurn,
    renderSkillInstructions,
    store,
    supportsWorkspaceFiles,
    vps,
  } = host;

  return async function(state: TurnState): Promise<void> {
    state.worksInWorkspace = supportsWorkspaceFiles(state.instance.driverKind);
    if (state.worksInWorkspace) {
      ensureWorkspace(state.bot.id);
      // memory sealed at rest opens back to plain in place for the engine's
      // file tools (started above, off the turn's path), until the turn ends
      // baseline for the journal's turn-boundary diff (see the bus hook)
      // A warm has no turn to journal. endMemoryTurn would close the previous one.
      if (!state.warmOnly && state.bot.memoryEnabled !== false) beginMemoryTurn(state.bot.id, state.threadId);
    }
    state.privateWorkspace = state.worksInWorkspace ? ensureTaskWorkspace(state.bot.id, state.threadId) : undefined;
    state.skillInstructions = renderSkillInstructions(state.selectedSkills, {
      includeRoot: state.worksInWorkspace
    });
    state.packagePlaybooks = installedPlaybookInstructions(state.providerText, state.bot.playbooks);
    // An explicit working folder wins for new tasks; otherwise they use
    // the private bot workspace. A legacy task with an existing provider
    // session deliberately pins to null (the old home-folder behavior),
    // because moving a live session would break resume.
    // A cloud run keeps the bot's own engine on this host, with the cloud
    // computer as one more tool, so it works in the same folder as any
    // other turn.
    // On a Cloud home a conversation a guest opened is pinned to its own
    // folder when it first runs, not the bot's project folder the owner's
    // conversations share (what it leaves there reaches none of them). One
    // that ran before keeps its pin, unless the session that opened it was
    // revoked: then it was unpinned at boot (server/cloud-owner.ts).
    const pinnedCwd =
      state.privateWorkspace
        // A confidential thread works in its own folder, never the bot's
        // project folder other threads share (server/confidential-threads.ts).
        ? store.pinTaskCwd(state.bot.id, state.threadId, state.privateWorkspace, { privateOnly: cloudGuestOpened(state.threadId) || store.isConfidentialThread(state.threadId) })
        : null;
    // A bot's threads run side by side in one project folder, like several
    // Claude Code or Codex sessions open in one repo: the folder is never a
    // turn-long claim. What truly needs one writer queues on its own — the
    // per-turn snapshot per folder (server/checkpoints.ts), memory through
    // memory_update — and the engines key their sessions by id, not folder.
    state.cwd = pinnedCwd ?? undefined;
    // Checkpoint explicit project folders, where a bot can overwrite the
    // user's work. Its private Sagax workspace is app-owned and changes
    // on nearly every ordinary chat; snapshotting it would add hidden disk
    // and process overhead without a user project to list changes for.
    const checkpointCwd = state.cwd && state.cwd !== state.privateWorkspace ? state.cwd : undefined;
    // dweb is opt-in: without an explicit daemon URL, do not advertise
    // tools that would fail on every call or spawn an unnecessary proxy.
    const dwebUrl = process.env.DWEB_URL?.trim();
    if (dwebUrl) state.integrations.dweb = { url: dwebUrl };
    // Cloud routines on a solo server use the bot's Boat. The per-bot
    // backend applies only to ordinary turns. An organization server
    // never attaches that Boat, a VPS, or a shared team computer: Cloud,
    // including a cloud routine, is the person's one server environment.
    state.inheritedComputer = state.computerSkipped ? undefined : inheritedTeamComputer(state.bot);
    state.remote = remoteComputerForTurn({
      organization: IDENTITY.kind === "perspicax",
      runOnCloud: state.opts?.runOn === "cloud",
      hasTeamComputer: Boolean(state.inheritedComputer)
    });
    state.teamComputer = state.remote.skipRemote ? undefined : state.inheritedComputer;
    state.cloudBackend = state.teamComputer || state.opts?.runOn === "cloud" || state.bot.cloudBackend !== "vps" ? "box" : "vps";
    state.mountsComputerMcp = state.instance.adapter.capabilities.computerMcp === true;
    state.mountsLocalComputer = state.instance.adapter.capabilities.localComputerMcp === true;
    // Where this turn's hands may land. The bot's "Works on" choice is
    // strict; a browser-only bot gets no computer at all, and a bot whose
    // browser is withheld (workspace flag, its own switch, or an engine
    // without browser tools) gets told so instead of silently falling back
    // to a desktop it was never meant to touch.
    // The conversation's own place wins over the bot default: the person
    // pinned it from the composer, or its first Auto turn recorded where it
    // landed. A team computer or a cloud routine is not this conversation's
    // choice, so those ignore the pin.
    const dispatchTask = store.taskByThread(state.bot.id, state.threadId);
    // Organization server: the person's computers are reached through
    // turnPlace (their server environment, or their own computer through
    // the desktop app). Auto, Cloud, a cloud routine, Local VM and This
    // computer claim nothing here, and a team computer does not either.
    state.wants = state.computerSkipped ? "off" : state.remote.skipRemote && state.plan.computer !== "off" ? "off" : state.plan.computer;
    mountUserSandbox(state.integrations, {
      botId: state.bot.id, threadId: state.threadId, generation: state.dispatchClaimId,
      customMcp: state.instance.adapter.capabilities.customMcp === true,
      decision: state.turnPlace, staging: state.placedText.staging, auto: state.turnAuto
    });
    await mountPersonalMcp(state.integrations, {
      botId: state.bot.id, threadId: state.threadId, generation: state.dispatchClaimId,
      customMcp: state.instance.adapter.capabilities.customMcp === true, principal: state.turnPlace.principal
    });
    await mountPluginMcp(state.integrations, {
      botId: state.bot.id, threadId: state.threadId, generation: state.dispatchClaimId,
      customMcp: state.instance.adapter.capabilities.customMcp === true, principal: state.turnPlace.principal
    });
  };
}
