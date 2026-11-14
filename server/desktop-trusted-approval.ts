// @ts-nocheck
/** Desktop trusted approval message handler (#1388). Pure move from server/index.ts. */
export type DesktopTrustedHost = Record<string, any>;

export function createHandleDesktopTrustedApprovalMessage(getHost: () => DesktopTrustedHost) {
function handleDesktopTrustedApprovalMessage(raw: unknown): boolean {
  const host = getHost();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const message = raw as Record<string, unknown>;
  const grantTarget = (bot: BotRecord) => bot.approvalGrant?.threadOnly
    ? host.store.projectBotForTask(bot.id, bot.approvalGrant.threadId!) : bot;
  const grantBusy = (bot: BotRecord) => bot.approvalGrant?.threadOnly
    ? host.threadBusy(bot.id, bot.approvalGrant.threadId!) : bot.busy ||
      Boolean(bot.approvalGrant?.allThreads && host.store.tasks(bot.id).some(task => host.threadBusy(bot.id, task.threadId)));
  const grantSupported = (bot: BotRecord, mode: ApprovalMode) => host.supportsApprovalMode(
    grantTarget(bot)?.modelSelection, mode) &&
    (!bot.approvalGrant?.allThreads || host.store.tasks(bot.id).every(task => host.supportsApprovalMode(
      task.modelSelection ?? bot.modelSelection, mode)));
  const clearGrant = (bot: BotRecord) => host.store.patchBot(bot.id, {
    ...(!bot.approvalGrant?.threadOnly ? { approvalMode: "ask" as const, autoApprove: false } : {}),
    approvalGrant: undefined
  });
  const threadCanReceiveGrant = (bot: BotRecord): boolean => {
    const threadId = bot.approvalGrant?.threadId;
    if (!threadId) return true;
    const target = host.store.projectBotForTask(bot.id, threadId);
    return Boolean(target && !host.threadBusy(bot.id, threadId) && (bot.approvalGrant?.threadOnly ||
      host.registry.cliTarget(target.modelSelection.instanceId)?.driverKind === host.registry.cliTarget(bot.modelSelection.instanceId)?.driverKind));
  };
  if (message.type === "approval-trusted-mode-commit") {
    const requestId = typeof message.requestId === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(message.requestId)
      ? message.requestId
      : null;
    const botId = typeof message.botId === "string" && /^[\w-]{1,128}$/.test(message.botId)
      ? message.botId
      : null;
    const mode = message.mode === "full" || message.mode === "custom" ? message.mode : null;
    if (!requestId) return true;
    if (!botId || !mode) return true;
    const bot = host.store.bot(botId);
    if (
      bot?.approvalGrant?.requestId === requestId &&
      bot.approvalGrant.mode === mode &&
      bot.approvalGrant.phase === "committed" &&
      (bot.approvalGrant.threadOnly || bot.approvalMode === mode) &&
      !grantBusy(bot) &&
      threadCanReceiveGrant(bot) &&
      grantSupported(bot, mode)
    ) {
      // Read the grant first: setAllThreadApprovalMode clears approvalGrant on
      // this same record, and reading it afterwards threw, so the commit was
      // applied without its consent record, audit row or reply.
      const grant = bot.approvalGrant;
      const committedThread = grant.threadId;
      if (grant.allThreads && mode === "full") {
        host.store.setAllThreadApprovalMode(botId, mode);
      } else if (grant.refreshPermissions && grant.threadId) {
        host.store.refreshTaskPermissions(botId, grant.threadId);
      } else if (grant.threadId && grant.threadOnly) {
        // a grant an older build prepared for one conversation: the bot's level now (#4200)
        host.store.patchBot(botId, { approvalMode: mode, autoApprove: false });
      } else if (grant.threadId) {
        // the bot's own level: its open thread follows it, like every other (#1169)
        host.store.patchTask(botId, grant.threadId, { approvalOwn: undefined });
      }
      // The person confirmed the warning in the desktop app: remember it for
      // this bot, so the next grant asks no more (org-full-access.ts).
      host.store.patchBot(botId, { approvalGrant: undefined,
        ...(mode === "full" ? { fullAccessConsent: { principalId: host.localPrincipalId().trim().toLowerCase(), at: Date.now() } } : {}) });
      host.auditApprovalModeChange(null, botId, "ask", mode, committedThread);
      host.postDesktopPrivateMessage({ type: "approval-trusted-mode-commit-result", requestId, ok: true, bot: host.wireBot(host.store.bot(botId)!) });
    } else if (bot?.approvalGrant?.requestId === requestId) {
      clearGrant(bot);
      host.postDesktopPrivateMessage({ type: "approval-trusted-mode-commit-result", requestId, ok: false });
    } else {
      host.postDesktopPrivateMessage({ type: "approval-trusted-mode-commit-result", requestId, ok: false });
    }
    return true;
  }
  if (message.type === "approval-trusted-mode-confirm") {
    const requestId = typeof message.requestId === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(message.requestId)
      ? message.requestId
      : null;
    const botId = typeof message.botId === "string" && /^[\w-]{1,128}$/.test(message.botId)
      ? message.botId
      : null;
    const mode = message.mode === "full" || message.mode === "custom" ? message.mode : null;
    if (!requestId) return true;
    const confirm = (ok: boolean, error?: string) => {
      host.postDesktopPrivateMessage({
        type: "approval-trusted-mode-confirm-result",
        requestId,
        ok,
        ...(error ? { error } : {})
      });
    };
    if (!botId || !mode) {
      confirm(false, "The approval confirmation was invalid");
      return true;
    }
    const bot = host.store.bot(botId);
    if (
      bot?.approvalGrant?.requestId === requestId &&
      bot.approvalGrant.mode === mode &&
      bot.approvalGrant.phase === "prepared" &&
      (bot.approvalGrant.threadOnly || bot.approvalMode === mode)
    ) {
      if (!grantSupported(bot, mode)) {
        clearGrant(bot);
        confirm(false, "This provider does not support the selected approval level");
        return true;
      }
      host.store.patchBot(botId, {
        approvalGrant: { ...bot.approvalGrant, requestId, mode, phase: "confirmed" }
      });
      confirm(true);
      return true;
    }
    // A matching journal whose other fields no longer agree is ambiguous.
    // Revoke only that request; never clear a newer grant for the same bot.
    if (bot?.approvalGrant?.requestId === requestId) {
      clearGrant(bot);
    }
    confirm(false, "The approval confirmation no longer matches this bot");
    return true;
  }
  if (message.type === "approval-trusted-mode-activate") {
    const requestId = typeof message.requestId === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(message.requestId)
      ? message.requestId
      : null;
    const botId = typeof message.botId === "string" && /^[\w-]{1,128}$/.test(message.botId)
      ? message.botId
      : null;
    const mode = message.mode === "full" || message.mode === "custom" ? message.mode : null;
    if (!requestId) return true;
    const activate = (ok: boolean, error?: string) => {
      host.postDesktopPrivateMessage({
        type: "approval-trusted-mode-activate-result",
        requestId,
        ok,
        ...(error ? { error } : {})
      });
    };
    if (!botId || !mode) {
      activate(false, "The approval activation was invalid");
      return true;
    }
    const bot = host.store.bot(botId);
    if (
      bot?.approvalGrant?.requestId === requestId &&
      bot.approvalGrant.mode === mode &&
      bot.approvalGrant.phase === "confirmed" &&
      (bot.approvalGrant.threadOnly || bot.approvalMode === mode)
    ) {
      if (grantBusy(bot) || !grantSupported(bot, mode)) {
        clearGrant(bot);
        activate(false, grantBusy(bot)
          ? "Stop this bot's turn before changing its approval level"
          : "This provider does not support the selected approval level");
        return true;
      }
      // Still inert: Electron must receive this acknowledgement and request
      // finalization before the durable mode can affect any turn.
      host.store.patchBot(botId, { approvalGrant: { ...bot.approvalGrant, requestId, mode, phase: "activated" } });
      activate(true);
      return true;
    }
    if (bot?.approvalGrant?.requestId === requestId) {
      clearGrant(bot);
    }
    activate(false, "The approval activation no longer matches this bot");
    return true;
  }
  if (message.type === "approval-trusted-mode-finalize") {
    const requestId = typeof message.requestId === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(message.requestId)
      ? message.requestId
      : null;
    const botId = typeof message.botId === "string" && /^[\w-]{1,128}$/.test(message.botId)
      ? message.botId
      : null;
    const mode = message.mode === "full" || message.mode === "custom" ? message.mode : null;
    if (!requestId) return true;
    const finalize = (ok: boolean, error?: string) => {
      host.postDesktopPrivateMessage({
        type: "approval-trusted-mode-finalize-result",
        requestId,
        ok,
        ...(error ? { error } : {})
      });
    };
    if (!botId || !mode) {
      finalize(false, "The approval finalization was invalid");
      return true;
    }
    const bot = host.store.bot(botId);
    if (
      bot?.approvalGrant?.requestId === requestId &&
      bot.approvalGrant.mode === mode &&
      bot.approvalGrant.phase === "activated" &&
      (bot.approvalGrant.threadOnly || bot.approvalMode === mode) &&
      !grantBusy(bot) &&
      threadCanReceiveGrant(bot) &&
      grantSupported(bot, mode)
    ) {
      // Durable but still inert. Electron must observe this exact ACK before
      // sending the one-way commit release that clears the journal.
      // #1098: Full on a member's bot of an organization runs as Full only
      // with its owner's consent (host.orgDeniesFull); the owner confirmed it in
      // this app (trustedChannelFullRefusal let only them through).
      const ownerConsent = mode === "full" && host.memberOwnedInOrg(bot)
        && host.effectiveBotOwner(bot).trim().toLowerCase() === host.localPrincipalId().trim().toLowerCase()
        ? { fullAccessConsent: { principalId: host.localPrincipalId().trim().toLowerCase(), at: Date.now() } } : {};
      host.store.patchBot(botId, { approvalGrant: { ...bot.approvalGrant, requestId, mode, phase: "committed" }, ...ownerConsent });
      finalize(true);
      return true;
    }
    if (bot?.approvalGrant?.requestId === requestId) {
      clearGrant(bot);
    }
    finalize(false, bot?.busy
      ? "Stop this bot's turn before changing its approval level"
      : "The approval finalization no longer matches this bot");
    return true;
  }
  if (message.type !== "approval-trusted-mode-set") return false;
  // #4200 (one approval level per bot): a level chosen from a conversation
  // is the bot's level, applied to every conversation of the bot.
  if (message.threadOnly === true && message.refreshPermissions !== true) {
    delete message.threadOnly;
    delete message.threadId;
  }
  const requestId = typeof message.requestId === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(message.requestId)
    ? message.requestId
    : null;
  if (!requestId) return true;
  const respond = (result: { ok: boolean; bot?: ReturnType<typeof host.wireBot>; error?: string }) => {
    host.postDesktopPrivateMessage({
      type: "approval-trusted-mode-result",
      requestId,
      ...result
    });
  };
  const botId = typeof message.botId === "string" && /^[\w-]{1,128}$/.test(message.botId)
    ? message.botId
    : null;
  if (!botId) {
    respond({ ok: false, error: "The bot id is invalid" });
    return true;
  }
  const mode = host.isApprovalMode(message.mode) ? message.mode : null;
  if (!mode) {
    respond({ ok: false, error: "The approval mode is invalid" });
    return true;
  }
  const existing = host.store.bot(botId);
  if (!existing) {
    respond({ ok: false, error: "No such bot" });
    return true;
  }
  // #1098 (2026-10-28): Full on a member's bot follows the HTTP route's
  // rule (its owner turns it on), never a blanket refusal; Custom stays the
  // HTTP route's answer.
  if (mode === "custom" && host.memberOwnedInOrg(existing)) {
    respond({ ok: false, error: host.MEMBER_BOT_FULL_ACCESS.error });
    return true;
  }
  if (mode === "full" && host.memberOwnedInOrg(existing)) {
    const refusal = host.trustedChannelFullRefusal({
      policyAllowed: host.orgFullAccessPolicy(),
      localPrincipalId: host.localPrincipalId(),
      ownerPrincipalId: host.effectiveBotOwner(existing),
      mayFullAccess: host.principalIsOrgAdmin(host.localPrincipalId()) || host.principalCan(host.localPrincipalId(), "bots.fullAccess")
    });
    if (refusal) {
      respond({ ok: false, error: refusal.error });
      return true;
    }
  }
  const currentMode = host.approvalModeFor(existing);
  const threadId = message.threadId;
  // A looser level needs the person's security key when they chose
  // "rule-change": the app asked the key for it a moment ago
  // (POST /api/security-keys/approval-mode), this channel carries none.
  {
    const scoped = message.threadOnly === true && typeof threadId === "string";
    const refresh = message.refreshPermissions === true && scoped ? host.refreshWidens(botId, threadId as string) : null;
    const op = message.allThreads === true ? "all-threads" : message.refreshPermissions === true ? "refresh" : scoped ? "thread" : "bot";
    const froms = message.allThreads === true ? host.everyThreadMode(existing)
      : refresh ? [refresh.from]
        : [scoped ? host.approvalModeFor(host.store.projectBotForTask(botId, threadId as string) ?? existing) : currentMode];
    if (host.memberAutoRefused(existing, froms, mode)) {
      respond({ ok: false, error: host.MEMBER_AUTO_NOT_ALLOWED.error });
      return true;
    }
    if (host.approvalModeStepUpGate({
      person: host.localPrincipalId(), botId, op, thread: scoped ? threadId as string : "*", froms, to: mode,
      allowance: message.stepUpAllowance, widensAllow: refresh?.widensAllow === true
    })) {
      respond({ ok: false, error: "This approval level needs your security key. Confirm it with your key and try again." });
      return true;
    }
  }
  if (message.allThreads !== undefined && (typeof message.allThreads !== "boolean" ||
    (message.allThreads && (threadId !== undefined || message.threadOnly === true ||
      message.modelSelection !== undefined || message.updateBotDefault !== undefined ||
      mode === "custom")))) {
    respond({ ok: false, error: "Invalid all-threads approval scope" });
    return true;
  }
  if (message.allThreads === true && mode === "ask") {
    const updated = host.store.setAllThreadApprovalMode(botId, "ask")!;
    void host.stopBotForEmergencyApprovalDowngrade(botId).then(
      () => respond({ ok: true, bot: host.wireBot(host.store.bot(botId) ?? updated) }),
      () => respond({ ok: false, error: "Approval was reset to Ask, but an active turn could not be stopped" }),
    );
    return true;
  }
  if (message.allThreads === true && (existing.approvalGrant || host.store.tasks(botId).some(task =>
      host.threadBusy(botId, task.threadId) || !host.supportsApprovalMode(
        task.modelSelection ?? existing.modelSelection, mode)))) {
    respond({ ok: false, error: "Finish this bot's active turns and approval changes first. Every thread's provider must support this level." });
    return true;
  }
  // #3568: Auto and Edits reach every thread in one write with no grant
  // phases, how a team-wide level leaves Custom in the desktop app (the
  // coordinator and the renderer send it; this branch refused it).
  if (message.allThreads === true && (mode === "auto" || mode === "edits")) {
    if (mode === "auto" && existing.computer === "local" && message.acknowledgeLocalAuto !== true &&
      host.everyThreadMode(existing).some((level: string) => level !== "auto")) {
      respond({ ok: false, error: "Auto mode on this computer requires confirming the warning" });
      return true;
    }
    host.store.setAllThreadApprovalMode(botId, mode);
    respond({ ok: true, bot: host.wireTrustedApprovalBot(host.store.bot(botId)!) });
    return true;
  }
  if (message.threadOnly !== undefined && typeof message.threadOnly !== "boolean") {
    respond({ ok: false, error: "Invalid thread approval scope" });
    return true;
  }
  if (message.refreshPermissions !== undefined && message.refreshPermissions !== true) {
    respond({ ok: false, error: "Invalid permission refresh" });
    return true;
  }
  if (message.refreshPermissions === true) {
    const target = typeof threadId === "string" ? host.store.projectBotForTask(botId, threadId) : null;
    const savedMode = host.approvalModeFor({ ...existing, approvalGrant: undefined });
    if (message.threadOnly !== true || !target || message.allThreads === true || message.modelSelection !== undefined || message.updateBotDefault !== undefined || savedMode !== mode) {
      respond({ ok: false, error: "Choose this bot's approval level in bot settings before refreshing a thread" });
      return true;
    }
    if (existing.approvalGrant || host.threadBusy(botId, target.threadId)) {
      respond({ ok: false, error: "Stop this thread and finish its pending approval change first" });
      return true;
    }
    if (!host.supportsApprovalMode(target.modelSelection, mode)) {
      respond({ ok: false, error: "This thread's provider does not support that approval level" });
      return true;
    }
    if (mode === "auto" && target.computer === "local" && host.approvalModeFor(target) !== "auto" && message.acknowledgeLocalAuto !== true) {
      respond({ ok: false, error: "Auto mode on this computer requires confirming the warning" });
      return true;
    }
    if (mode === "full" || mode === "custom") {
      host.store.patchBot(botId, { approvalGrant: { requestId, mode, phase: "prepared", threadId: target.threadId, threadOnly: true, refreshPermissions: true } });
    } else if (!host.store.refreshTaskPermissions(botId, target.threadId)) {
      respond({ ok: false, error: "That thread is no longer available" });
      return true;
    }
    respond({ ok: true, bot: host.wireTrustedApprovalBot(host.store.bot(botId)!) });
    return true;
  }
  if (threadId !== undefined) {
    const target = typeof threadId === "string" && /^[\w-]{1,128}$/.test(threadId)
      ? host.store.projectBotForTask(botId, threadId) : null;
    if (!target || (mode !== "full" && mode !== "custom") || currentMode !== mode || existing.approvalGrant) {
      respond({ ok: false, error: "Choose this bot's approval level in bot settings before applying it to an existing thread" });
      return true;
    }
    if (host.threadBusy(botId, threadId as string) ||
      host.registry.cliTarget(target.modelSelection.instanceId)?.driverKind !== host.registry.cliTarget(existing.modelSelection.instanceId)?.driverKind) {
      respond({ ok: false, error: "Stop this thread and use the bot's provider before applying its approval level" });
      return true;
    }
  }
  const emergencyDowngrade = existing.busy && host.isEmergencyApprovalDowngrade(currentMode, mode);
  const clearsPendingElevation = mode === "ask" && existing.approvalGrant !== undefined;
  if (existing.busy && !emergencyDowngrade && !clearsPendingElevation && !host.liveApprovalChange(currentMode, mode)) {
    respond({ ok: false, error: "Stop this bot's turn before changing its approval level" });
    return true;
  }
  if (!host.supportsApprovalMode(existing.modelSelection, mode)) {
    // Full runs on every engine (omb #2808); only Custom is engine-bound.
    respond({ ok: false, error: "Custom approval settings are available only for Codex bots" });
    return true;
  }
  if (
    mode === "auto" &&
    existing.computer === "local" &&
    host.approvalModeFor(existing) !== "auto" &&
    message.acknowledgeLocalAuto !== true
  ) {
    respond({ ok: false, error: "Auto mode on this computer requires confirming the warning" });
    return true;
  }
  // #1373: what each running turn answers at before this change
  const liveBefore = !emergencyDowngrade && host.liveApprovalChange(currentMode, mode) && host.botRunning(botId) ? host.runningTurnLevels(botId) : null;
  const updated = host.store.patchBot(botId, {
    approvalMode: mode,
    autoApprove: mode === "auto",
    approvalGrant: mode === "full" || mode === "custom"
      ? { requestId, mode, phase: "prepared", ...(typeof threadId === "string" ? { threadId } : {}), ...(message.allThreads === true ? { allThreads: true } : {}) }
      : undefined
  });
  if (!updated) {
    respond({ ok: false, error: "No such bot" });
    return true;
  }
  if (emergencyDowngrade) {
    // A lost Full/Custom reply is ambiguous: Electron compensates with Ask.
    // Persist that fail-closed state before the first await, then stop the
    // exact setup/turn that may already hold an elevated per-turn snapshot.
    // Only answer once the interrupt has been issued, so Electron cannot
    // advance a newer selection while the old turn is still live.
    void host.stopBotForEmergencyApprovalDowngrade(updated.id).then(
      () => respond({ ok: true, bot: host.wireBot(host.store.bot(updated.id) ?? updated) }),
      (error) => respond({
        ok: false,
        error: `Approval was reset to Ask, but the active turn could not be stopped: ${
          error instanceof Error ? error.message : String(error)
        }`
      }),
    );
    return true;
  }
  if (liveBefore) {
    void host.applyStricterApprovalLive(updated.id, liveBefore).then(
      () => respond({ ok: true, bot: host.wireTrustedApprovalBot(host.store.bot(updated.id) ?? updated) }),
      (error) => respond({ ok: false, error: host.stricterApprovalStopError(error) }),
    );
    return true;
  }
  respond({ ok: true, bot: host.wireTrustedApprovalBot(updated) });
  return true;
}

  return handleDesktopTrustedApprovalMessage;
}
