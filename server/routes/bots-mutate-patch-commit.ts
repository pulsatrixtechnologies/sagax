// PATCH /api/bots/:id trust check, runtime revoke, and persist (#1383).
// Never imports server/index.ts.
import type { BotRecord } from "../store.ts";
import type { BotPatchState, BotsMutateEnv } from "./bots-mutate-helpers.ts";

export async function commitBotPatch(env: BotsMutateEnv, state: BotPatchState): Promise<void> {
  const {
    m, body, patch, existingBot, selectedTask, beforeProfile, beforeVisibility,
    beforeBrowserProfile, beforeBrowserEnabled, normalizedSelection, profile,
    section, computerSpecified, requestedComputer, requestedMcpServers,
    requestedApprovalMode, currentApprovalMode,
  } = state;
  // What "the proof of a human" above actually rests on. In the packaged
  // desktop it is real: every mutation here already carried the owner
  // capability a tool call cannot forge. Outside it — `pnpm dev`, the
  // CLI, the Docker stack — loopback is the owner by design, so the
  // acknowledgement flag and the settings that loosen a bot's leash
  // (a wider peer list, the peer-approval gate switched off, a section
  // move that changes who is in reach, a standing always-allow grant)
  // are one curl away from the bot they constrain. What such a request
  // does NOT have is a paired session or a browser origin; and the one
  // moment a bot's shell can send it is while a turn is running. So an
  // originless, session-less loopback caller may loosen a bot only
  // while every bot is idle — and is logged when it does — while the
  // served UI (a browser, with its origin) and a paired device keep
  // working mid-turn as before. A bar, not a wall: the wall is the
  // desktop capability or a paired session, which is what the refusal
  // points at.
  const loosened: string[] = [];
  // These three fields were validated above before joining the broad patch.
  const trustPatch = patch as Pick<Partial<BotRecord>, "outbound" | "fallback">;
  if (body.outbound !== undefined && trustPatch.outbound?.policy === "allow" &&
      (existingBot?.outbound?.policy !== "allow" || trustPatch.outbound.dailyCap > existingBot.outbound.dailyCap)) loosened.push("outbound");
  if (body.fallback !== undefined && trustPatch.fallback?.some((candidate: any) =>
      !existingBot?.fallback?.some((previous: any) => previous.instanceId === candidate.instanceId && previous.model === candidate.model))) loosened.push("fallback");
  if (Array.isArray(patch.managedSections) && patch.managedSections.some((section: any) => !(existingBot?.managedSections ?? []).includes(section))) {
    loosened.push("managedSections");
  }
  // A shell can forge an Origin header. New cross-team authority may
  // come from local scripts only when all bots are idle; paired owners
  // and the packaged desktop's private capability can grant it mid-turn.
  if (loosened.includes("managedSections") && env.auth.kind === "loopback" && !env.DESKTOP_MANAGED && env.store.bots.some((bot: any) => bot.busy)) {
    env.json(env.res, 409, { error: "Stop running bots before granting access to another team, or use the desktop app or a paired Full-access session." });
    return;
  }
  if (body.peers !== undefined && Array.isArray(existingBot?.peers)) {
    const nextPeers = patch.peers;
    if (nextPeers === undefined || (Array.isArray(nextPeers) && nextPeers.some((peerId: any) => !existingBot.peers!.includes(peerId)))) {
      loosened.push("peers");
    }
  }
  if (body.approvePeerComms === false && existingBot?.approvePeerComms === true) loosened.push("approvePeerComms");
  if (section !== undefined && env.sectionKey(existingBot?.section) !== env.sectionKey(section)) loosened.push("section");
  if (Array.isArray(patch.alwaysAllow) && patch.alwaysAllow.some((key: any) => !(existingBot?.alwaysAllow ?? []).includes(key))) {
    loosened.push("alwaysAllow");
  }
  if (Array.isArray(patch.allowedRecipients) && patch.allowedRecipients.some((key: any) => !(existingBot?.allowedRecipients ?? []).includes(key))) {
    loosened.push("allowedRecipients");
  }
  if (body.mcpServers !== undefined && Array.isArray(existingBot?.mcpServers) &&
      (requestedMcpServers === undefined || requestedMcpServers.some((name: any) => !existingBot.mcpServers!.includes(name)))) {
    loosened.push("mcpServers");
  }
  if (Object.hasOwn(body, "toolScope") && env.toolScopeWidens(existingBot?.toolScope, patch.toolScope)) loosened.push("toolScope");
  const browserOrigin = typeof env.req.headers.origin === "string" && env.req.headers.origin.trim() !== "";
  if (loosened.length && env.auth.kind === "loopback" && !env.DESKTOP_MANAGED && !browserOrigin) {
    if (env.store.bots.some((candidate: any) => candidate.busy)) {
      env.json(env.res, 409, {
        error: "A bot is working right now, so this change has to come from the desktop app or a paired device. Try again once every bot is idle."
      });
      return;
    }
    console.warn(`bot ${m[1]}: ${loosened.join(", ")} loosened by ${env.requestSource(env.req)} through the local API with no paired session`);
  }
  if (existingBot?.computer === "local" && computerSpecified && requestedComputer !== "local") {
    await env.interruptAllDirectThreads(existingBot.id);
    const routine = env.routines!.activeBotRunForBot(existingBot.id);
    if (routine) await env.routines!.cancelRun(routine.id);
    const groupTurn = env.activeGroupTurnForBot(existingBot.id);
    if (groupTurn) {
      env.cancelGroupTurnOperations(groupTurn.group.id, groupTurn.threadId);
      env.revokeInternalCapabilitiesForThread(groupTurn.threadId);
      await env.runningTurnInstance(existingBot, groupTurn.threadId)?.adapter.interruptTurn(groupTurn.threadId).catch(() => {});
      env.closeOpenApprovals(groupTurn.threadId);
    }
  }
  let bot: BotRecord | null;
  const freshBrowserBot = env.store.bot(m[1]);
  // Connector validation and runtime revocation can yield after the first
  // memory check. Keep the same idle-only transition at the final commit.
  if (freshBrowserBot && body.memoryEnabled !== undefined &&
      body.memoryEnabled !== (freshBrowserBot.memoryEnabled !== false) &&
      (freshBrowserBot.busy || env.activeGroupTurnForBot(freshBrowserBot.id))) {
    env.json(env.res, 409, { error: "stop this bot's turn before changing its memory setting" });
    return;
  }
  if (Object.hasOwn(body, "toolScope")) {
    if (env.auth.kind === "session" && !env.sessions.isLive(env.auth.session.id)) {
      env.json(env.res, 401, { error: "unauthorized: this session has expired or was revoked" });
      return;
    }
    if (env.toolScopeWidens(freshBrowserBot?.toolScope, patch.toolScope) && env.auth.kind === "loopback" && !env.DESKTOP_MANAGED && !browserOrigin && env.store.bots.some((candidate: any) => candidate.busy)) {
      env.json(env.res, 409, { error: "A bot is working right now, so this change has to come from the desktop app or a paired device. Try again once every bot is idle." });
      return;
    }
    if (freshBrowserBot && JSON.stringify(freshBrowserBot.toolScope) !== JSON.stringify(patch.toolScope)
      && (freshBrowserBot.busy || env.activeGroupTurnForBot(freshBrowserBot.id))) {
      env.json(env.res, 409, { error: "Stop this bot's turns before changing its tool selection." });
      return;
    }
  }
  // Custom servers are process configuration: a running turn cannot
  // unmount them. Recheck after any awaited runtime revocation above.
  if (body.mcpServers !== undefined) {
    if (env.auth.kind === "session" && !env.sessions.isLive(env.auth.session.id)) {
      env.json(env.res, 401, { error: "unauthorized: this session has expired or was revoked" });
      return;
    }
    if (Array.isArray(freshBrowserBot?.mcpServers) &&
        (requestedMcpServers === undefined || requestedMcpServers.some((name: any) => !freshBrowserBot.mcpServers!.includes(name))) &&
        env.auth.kind === "loopback" && !env.DESKTOP_MANAGED && !browserOrigin && env.store.bots.some((candidate: any) => candidate.busy)) {
      env.json(env.res, 409, { error: "A bot is working right now, so this change has to come from the desktop app or a paired device. Try again once every bot is idle." });
      return;
    }
    if (freshBrowserBot &&
        JSON.stringify(requestedMcpServers?.toSorted()) !== JSON.stringify(freshBrowserBot.mcpServers?.toSorted()) &&
        (freshBrowserBot.busy || env.activeGroupTurnForBot(freshBrowserBot.id))) {
      env.json(env.res, 409, { error: "Stop this bot's turns before changing its MCP servers." });
      return;
    }
  }
  if (normalizedSelection && selectedTask) {
    const current = env.store.projectBotForTask(selectedTask.id, selectedTask.threadId);
    if (!current) {
      env.json(env.res, 404, { error: "no such task" });
      return;
    }
    const checked = env.checkedModelSelection(normalizedSelection, { selection: current.modelSelection, busy: env.threadBusy(current.id, current.threadId) }, false, env.sessionPrincipal(env.auth));
    if (!checked.ok) {
      env.json(env.res, checked.status, { error: checked.error });
      return;
    }
    if (freshBrowserBot && env.activeGroupTurnForBot(freshBrowserBot.id)) {
      const groupChecked = env.checkedModelSelection(normalizedSelection, { selection: freshBrowserBot.modelSelection, busy: true }, false, env.sessionPrincipal(env.auth));
      if (!groupChecked.ok) {
        env.json(env.res, groupChecked.status, { error: groupChecked.error });
        return;
      }
    }
  }
  if (freshBrowserBot && body.browserProfile !== undefined &&
      patch.browserProfile !== freshBrowserBot.browserProfile &&
      (freshBrowserBot.busy || env.browserRuntime.heldBy(env.currentBrowserSession(freshBrowserBot.id, freshBrowserBot.browserProfile)))) {
    env.json(env.res, 409, { error: "Stop the bot and release browser control before changing its profile." });
    return;
  }
  // #1373: what each running turn answers at before this change
  const liveApprovalBefore = existingBot && patch.approvalMode !== undefined && requestedApprovalMode !== currentApprovalMode
    && env.liveApprovalChange(currentApprovalMode, requestedApprovalMode) && env.botRunning(existingBot.id)
    ? env.runningTurnLevels(existingBot.id) : null;
  if (profile.patch.soul !== undefined) {
    if (freshBrowserBot) env.assertTeamComputerChangeIdle(freshBrowserBot, { ...freshBrowserBot, ...patch } as BotRecord);
    // A mixed settings request must not turn a runtime revocation into
    // a persist-first edit. Apply runtime fields with their existing
    // fail-closed semantics; atomically commit only the profile fields.
    const runtimePatch = { ...patch };
    for (const field of Object.keys(profile.patch)) delete runtimePatch[field];
    if (Object.keys(runtimePatch).length) env.store.patchBot(m[1], runtimePatch, { actorPrincipalId: env.sessionPrincipal(env.auth) });
    bot = env.store.patchBotProfile(m[1], profile.patch);
  } else {
    if (freshBrowserBot) env.assertTeamComputerChangeIdle(freshBrowserBot, { ...freshBrowserBot, ...patch } as BotRecord);
    // omb #2701: Full over HTTP records consent so new conversations and
    // turn-time checks know who chose it (same marker the desktop channel wrote).
    if (patch.approvalMode === "full") {
      const principalId = env.sessionPrincipal(env.auth)
        ?? (env.auth.kind === "loopback" && env.auth.trust !== "service" ? env.localPrincipalId().trim().toLowerCase() : null);
      if (principalId) patch = { ...patch, fullAccessConsent: { principalId, at: Date.now() } };
    }
    bot = env.store.patchBot(m[1], patch, { actorPrincipalId: env.sessionPrincipal(env.auth) });
  }
  if (!bot) {
    env.json(env.res, 404, { error: "no such bot" });
    return;
  }
  if (body.memoryUpkeep === false || body.memoryEnabled === false) env.memoryUpkeep.dropBot(bot.id);
  if (body.cacheKeepWarm !== undefined) env.cacheKeepWarm.refresh();
  // A defined Works on is the newest explicit choice: this bot's
  // auto-recorded pins that now point elsewhere give way immediately, so
  // the next turn on each thread follows the new setting. Person-set pins
  // and pins that already match stay; returning to Auto sweeps nothing.
  if (computerSpecified && requestedComputer !== undefined) env.store.clearAutoSurfacePins(m[1], requestedComputer);
  // patchBot moved every thread silently; hosted state for the selected
  // thread is reset through the same model-change path.
  if (normalizedSelection && selectedTask) env.store.patchTask(bot.id, selectedTask.threadId, { modelSelection: undefined,
    ...env.hostedModels?.resetTask(selectedTask.modelSelection, normalizedSelection) });
  if (existingBot && (bot.browserProfile !== beforeBrowserProfile || bot.browser !== beforeBrowserEnabled)) {
    env.browserLive.closeForBot(bot.id);
    env.browserNetworkDebug.clearBot(bot.id);
    if (beforeBrowserProfile === "guest" && (bot.browserProfile !== "guest" || bot.browser === false)) {
      void env.forgetTemporaryBrowser(bot.id).catch((error: any) => console.warn("temporary browser cleanup failed", error));
    }
  }
  // A Primary Bot is one per person, not per section: moving it to
  // another team keeps the role.
  const chiefChanges = body.chiefOfStaff === true ? env.store.setPrimaryBot(bot.id) : [];
  if (chiefChanges === null) {
    env.json(env.res, 404, { error: "no such bot" });
    return;
  }
  if (beforeProfile) {
    const now = env.store.bot(bot.id)!;
    env.recordProfileChange(bot.id, "user", "api", beforeProfile, env.profileSnapshot(now));
    env.recordPersonaSave(env.auth, bot.id, beforeProfile, env.profileSnapshot(now));
  }
  // A new audience changes who may see this bot's rooms and teams too:
  // re-announce them so every member's stream gains or withdraws them.
  if (Object.hasOwn(patch, "visibility") && JSON.stringify(beforeVisibility ?? "everyone") !== JSON.stringify(bot.visibility ?? "everyone")) {
    for (const group of env.store.groups.filter((candidate: any) => candidate.memberIds.includes(bot!.id))) {
      env.broadcast({ kind: "group", group: env.publicGroupState(group) });
    }
    env.broadcast({ kind: "sections", sections: env.store.sections });
    env.audienceChanged();
  }
  if (liveApprovalBefore) {
    try {
      await env.applyStricterApprovalLive(bot.id, liveApprovalBefore);
    } catch (error) {
      env.json(env.res, 409, { error: env.stricterApprovalStopError(error) });
      return;
    }
  }
  env.json(env.res, 200, { bot: env.wireBot(env.store.bot(bot.id)!) });
  return;
}
