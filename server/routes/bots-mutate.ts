/**
 * Leftover authenticated bot mutate routes (#1388): model, read, Auto preview,
 * command allowlist, always-allow, PATCH/DELETE bot, guarded request interrupt.
 *
 * Registered in ROUTES after the auth gate. Never imports server/index.ts.
 * Pure move of the former fallback() handlers; behaviour unchanged.
 */
import type { ApprovalMode } from "../../shared/approval-mode.ts";
import type { AutoModelEntry, AutoModelExcluded } from "../../shared/auto-model.ts";
import type { ModelSelection } from "../../shared/model-selection.ts";
import type { BotRecord } from "../store.ts";
import { PASS, type RouteHandler } from "./table.ts";

/** Injected closures from index.ts. Pure move; host locals stay loosely typed. */
export type BotsMutateRouteDeps = Record<string, any>;

export function createBotsMutateRoutes(deps: BotsMutateRouteDeps): RouteHandler {
  return async ({ req, res, url, path, method, auth, json, readBody }) => {
    if (!path.startsWith("/api/bots/")) return PASS;

    let m: RegExpMatchArray | null = null;

    const {
      ADMIN_APPROVAL_REQUIRED,
      BOTS_READ_ONLY,
      COMMAND_ALLOWLIST_ADD_REFUSAL,
      COMMAND_ALLOWLIST_DRIVERS,
      DESKTOP_MANAGED,
      IDENTITY,
      MAX_MCP_SERVERS,
      MAX_WORKSPACE_BOTS,
      MEMBER_AUTO_NOT_ALLOWED,
      MEMBER_BOT_FULL_ACCESS,
      MY_CHROME_PROFILE,
      activeGroupTurnForBot,
      cancelGroupTurnOperations,
      activeVpsThreads,
      actorPrincipalId,
      alwaysAllowStepUpGate,
      applyStricterApprovalLive,
      approvalAnswerRefusal,
      approvalModeFor,
      approvalModeStepUpGate,
      approvalOwnerId,
      assertRequestTarget,
      assertTeamComputerChangeIdle,
      assignBotHost,
      atLeast,
      audienceChanged,
      auditApprovalModeChange,
      autoEnginesFor,
      autoModelRecord,
      autoPayerKey,
      autoPickForTurn,
      autoRefusalsFor,
      botEditsNeedOwner,
      botRecoveryBackups,
      botRunning,
      browserLive,
      browserNetworkDebug,
      browserProfileChangeRefusal,
      browserRuntime,
      cacheKeepWarm,
      callerBotsReadOnly,
      canManageCommandAllowlist,
      cardAnswerRefusal,
      cfg,
      channelActorId,
      checkedModelSelection,
      clientBotPatchViolation,
      closeOpenApprovals,
      cloudBackendChangeError,
      commandAllowlist,
      commandAllowlistCandidate,
      commandAllowlistResponse,
      companionBotFieldViolation,
      companionRequest,
      computerOwner,
      currentBrowserSession,
      deleteBotWithLifecycle,
      directRequestOwners,
      directTurnBots,
      engineDisplayName,
      engineSwitchNeedsAsk,
      explainPick,
      forgetTemporaryBrowser,
      guardedRequestSnapshot,
      handoffs,
      hostedModels,
      interruptAllDirectThreads,
      interruptDirectThread,
      isAgentConversation,
      isApprovalMode,
      isProactiveMode,
      isTeamMemorySharing,
      limitFailover,
      liveApprovalChange,
      lockedLookRefusal,
      maySetBotHost,
      mcpServerNameError,
      memberAutoRefused,
      memberBotFieldRefusal,
      memberBotFieldViolation,
      memberFolderPrincipal,
      memberFolderRefusal,
      memberOwnedInOrg,
      memberOwnsBot,
      memoryUpkeep,
      myChrome,
      normalizeAllowedRecipients,
      normalizeOutboundPolicy,
      normalizeProactiveMode,
      orgFullAccessRefusalFor,
      ownerChosenVisibility,
      ownerOrAdminOf,
      ownerSettingsForbidden,
      parseBotProfilePatch,
      parseMcpAccountChoices,
      parseOrgFullAccessBody,
      parseToolScope,
      parseVisibility,
      pendingApprovalCards,
      permissionRefusal,
      personalProfileOf,
      personalProviderInstances,
      primaryAskedReplay,
      profileSnapshot,
      projectMessages,
      publicGroupState,
      pushHub,
      readCursor,
      recordPersonaSave,
      recordProfileChange,
      recordedBotOwner,
      registeredWorkers,
      registry,
      remoteSessions,
      requestConflict,
      requestSource,
      requestedTaskBot,
      requestedWorksOn,
      revokeInternalCapabilitiesForThread,
      routeThreadId,
      routines,
      ruleManager,
      runningTurnInstance,
      runningTurnLevels,
      scopedThreadViewer,
      sectionKey,
      securityKeys,
      selectionOnMachine,
      sessionPrincipal,
      sessions,
      settingsStepUpGate,
      speakerFor,
      standingGrantsAllowed,
      store,
      storedAvatarExists,
      stricterApprovalStopError,
      supportsApprovalMode,
      terminalPrincipalId,
      threadBusy,
      threadFollowsFullGrant,
      threadsShownTo,
      toolScopeWidens,
      validateBotCwdFor,
      viewerBotLevel,
      viewerForApproval,
      wireBot,
      z,
      broadcast
    } = deps;

const requirePinnedClientThread = (botId: string, threadId: unknown): void => {
  const owner = store.bot(botId);
  if (threadId === undefined &&
    (auth.kind === "session" || req.headers["x-openmausbot-companion"] === "1") &&
    // Organization server: only the caller's own threads count, never an
    // outside agent's conversation with the bot (shared/agent-conversation.ts).
    (owner ? threadsShownTo(owner, store.tasks(botId), scopedThreadViewer()) : store.tasks(botId)).filter((task: any) => !isAgentConversation(task)).length > 1) {
    // #1674: the request did not say which conversation it is for. An up
    // to date app names it (Edit bot, Edit N bots, sagax_settings); the
    // words never blame the app's version, which may well be current.
    throw Object.assign(new Error("This bot has several conversations and the change did not say which one. Open the conversation to change, then try again."), { status: 409, code: "thread_required" });
  }
};
m = path.match(/^\/api\/bots\/([\w-]+)\/model$/);
if (m && method === "PATCH") {
  const body = await readBody(req);
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const unsupported = Object.keys(body).find(
      (key: any) => key !== "instanceId" && key !== "model" && key !== "effort" && key !== "variant",
    );
    if (unsupported) {
      json(res, 400, { error: `unsupported model field: ${unsupported}` });
      return;
    }
  }
  const existing = store.bot(m[1]);
  if (!existing) {
    json(res, 404, { error: "no such bot" });
    return;
  }
  const modelRefusal = ownerSettingsForbidden(auth, existing, { model: true });
  if (modelRefusal) {
    json(res, 403, modelRefusal);
    return;
  }
  requirePinnedClientThread(existing.id, undefined);
  const selected = requestedTaskBot(existing.id, undefined);
  if (existing.approvalGrant) {
    json(res, 409, { error: "wait for the approval-level change to finish before changing models" });
    return;
  }
  const onMachine = selectionOnMachine({ host: existing.host, workers: registeredWorkers, raw: body });
  const checked = onMachine ?? checkedModelSelection(
    body,
    { selection: selected.modelSelection, busy: threadBusy(selected.id, selected.threadId) },
    true,
    sessionPrincipal(auth),
  );
  if (!checked.ok) {
    json(res, checked.status, { error: checked.error });
    return;
  }
  if (activeGroupTurnForBot(existing.id) && !onMachine) {
    const groupChecked = checkedModelSelection(checked.selection, { selection: existing.modelSelection, busy: true }, false, sessionPrincipal(auth));
    if (!groupChecked.ok) {
      json(res, groupChecked.status, { error: groupChecked.error });
      return;
    }
  }
  // patchBot persists first and emits the canonical bot change, which the
  // store listener above turns into the slim wire-format SSE broadcast.
  // Every thread that follows the bot moves with it; the selected thread
  // follows it from now on too, as if picked there.
  const bot = store.patchBot(existing.id, { modelSelection: checked.selection });
  if (!bot) {
    json(res, 404, { error: "no such bot" });
    return;
  }
  store.patchTask(bot.id, selected.threadId, { modelSelection: undefined,
    ...hostedModels?.resetTask(selected.modelSelection, checked.selection) });
  json(res, 200, { bot: wireBot(bot) });
  return;
}
m = path.match(/^\/api\/bots\/([\w-]+)\/read$/);
if (m && method === "POST") {
  const body = await readBody(req);
  requirePinnedClientThread(m[1], body?.threadId);
  const current = requestedTaskBot(m[1], body?.threadId);
  store.patchTask(current.id, current.threadId, { unread: false, ...readCursor(current.threadId) });
  pushHub.noteRead(actorPrincipalId(auth), current.threadId);
  const bot = store.bot(current.id)!;
  const visible = wireBot(bot);
  broadcast({ kind: "bot", bot: visible });
  json(res, 200, { bot: visible });
  return;
}
// Auto (docs/plans/2026-10-08-auto-model.md): the model this person's
// next turn with the bot would run on, and the one sentence saying why.
m = path.match(/^\/api\/bots\/([\w-]+)\/auto-model$/);
if (m && method === "GET") {
  const bot = requestedTaskBot(m[1], url.searchParams.get("threadId") ?? undefined);
  const speaker = speakerFor(auth);
  const previewBot = { ...bot, modelSelection: { ...bot.modelSelection, auto: true as const } };
  const excluded: AutoModelExcluded[] = [];
  const engines = autoEnginesFor(previewBot, speaker, false, excluded);
  const payer = autoPayerKey(bot, speaker);
  const refused = autoRefusalsFor(payer);
  const limited = limitFailover.autoExcluded(payer, engines);
  const entry = (choice: { instanceId: string; model: string }): AutoModelEntry | null => {
    const engine = engines.find((candidate: any) => candidate.instanceId === choice.instanceId);
    const option = engine?.models.options.find((candidate: any) => candidate.id === choice.model);
    return engine && option ? { ...choice, engineLabel: engine.displayName, modelLabel: option.label || option.id, ...(engine.via ? { via: engine.via } : {}) } : null;
  };
  for (const choice of refused) {
    const item = entry(choice); if (item) excluded.push({ ...item, reason: "refused" });
  }
  for (const engine of engines) {
    if (limited.has(engine.instanceId) && engines.some((candidate: any) => !limited.has(candidate.instanceId))) excluded.push({ instanceId: engine.instanceId, engineLabel: engine.displayName, reason: "limit" });
  }
  const turn = autoPickForTurn({ bot: previewBot, threadId: bot.threadId, speaker, role: "orchestration", text: "" });
  const chain = (turn?.pick.chain ?? []).flatMap((choice: any) => {
    const item = entry(choice);
    return item && !refused.some((skip: any) => skip.instanceId === choice.instanceId && skip.model === choice.model) ? [item] : [];
  });
  const usablePick = turn && chain.some((choice: any) => choice.instanceId === turn.pick.selection.instanceId && choice.model === turn.pick.selection.model);
  // Recovery uses the saved selections, including custom/local endpoints
  // that the automatic candidate scorer intentionally leaves out.
  const backups = botRecoveryBackups(bot, cfg).flatMap((choice: any) => {
    const instance = registry.get(choice.instanceId);
    if (!instance || !personalProviderInstances.visible(choice.instanceId, IDENTITY.kind === "perspicax" ? actorPrincipalId(auth) ?? "" : "solo")) return [];
    const option = instance.models.options.find((candidate: any) => candidate.id === choice.model);
    return [{ ...choice, engineLabel: engineDisplayName(instance), modelLabel: option?.label || choice.model }];
  });
  json(res, 200, { auto: bot.modelSelection.auto === true, pick: usablePick ? autoModelRecord(turn.pick, Date.now()) : null,
    chain, excluded, backups, explanation: usablePick ? explainPick(turn.pick) : "" });
  return;
}
m = path.match(/^\/api\/bots\/([\w-]+)\/command-allowlist(?:\/([\w-]+))?$/);
if (m && ["GET", "POST", "DELETE"].includes(method)) {
  // A client session (iOS parity S2) reads and removes the rules of a
  // bot it owns, or of any bot when it is this computer's own person.
  // Removing a rule only narrows what runs unasked; adding one stays admin.
  const owned = store.bot(m[1]);
  const ownerReadOrRemove = ((method === "GET" && !m[2]) || (method === "DELETE" && Boolean(m[2]))) &&
    Boolean(owned) && (computerOwner(auth) || ownerOrAdminOf(auth, owned!));
  if (!canManageCommandAllowlist(auth) && !ownerReadOrRemove) {
    json(res, 403, { error: method === "POST" ? COMMAND_ALLOWLIST_ADD_REFUSAL : "Only the bot's owner, an admin, or someone allowed to run commands on this server can see or remove its saved command permissions." });
    return;
  }
  const bot = requestedTaskBot(m[1], url.searchParams.get("threadId") ?? undefined);
  if (method === "GET" && !m[2]) {
    json(res, 200, commandAllowlistResponse(bot));
    return;
  }
  if (method === "POST" && !m[2]) {
    const raw = await readBody(req);
    const allowlistStepUp = raw && typeof raw === "object" ? (raw as Record<string, unknown>).stepUp : undefined;
    if (raw && typeof raw === "object") delete (raw as Record<string, unknown>).stepUp;
    const candidate = commandAllowlistCandidate(raw);
    if (!candidate) {
      json(res, 400, { error: "Enter an exact command without secret values, an absolute working folder, and a provider." });
      return;
    }
    const instance = registry.get(candidate.providerInstanceId);
    if (!instance || !COMMAND_ALLOWLIST_DRIVERS.has(instance.driverKind)) {
      json(res, 400, { error: "This provider does not supply structured command approvals." });
      return;
    }
    // a saved command runs without asking: a standing grant
    const refused = settingsStepUpGate(ruleManager(auth), "command-allowlist", { botId: bot.id, command: candidate.command, cwd: candidate.cwd, providerInstanceId: candidate.providerInstanceId }, allowlistStepUp, approvalOwnerId(bot) || null);
    if (refused) {
      json(res, refused.status, refused.body);
      return;
    }
    commandAllowlist.add(bot.id, candidate);
    json(res, 200, commandAllowlistResponse(bot));
    return;
  }
  if (method === "DELETE" && m[2]) {
    commandAllowlist.remove(bot.id, m[2]);
    json(res, 200, commandAllowlistResponse(bot));
    return;
  }
  json(res, 405, { error: "Unsupported command allowlist operation" });
  return;
}
m = path.match(/^\/api\/bots\/([\w-]+)\/always-allow$/);
if (m && method === "POST") {
  const body = await readBody(req);
  requirePinnedClientThread(m[1], body?.threadId);
  let allowKey = typeof body.allowKey === "string" ? body.allowKey : "";
  let bot = requestedTaskBot(m[1], body.threadId);
  if (!allowKey) {
    json(res, 400, { error: "allowKey required" });
    return;
  }
  let pending = store.messagesFor(bot.threadId).find((message: any) =>
    message.card?.requestId &&
    !message.card.answered &&
    message.card.dismissed !== true &&
    message.card.allowKey === allowKey
  );
  if (!pending) {
    json(res, 409, { error: "that grant is not on a pending approval for this bot" });
    return;
  }
  const source = deps.originApprovals?.sourceFor(bot.threadId, pending.card.requestId);
  if (source === false) return json(res, 409, { error: "This approval is no longer available in this conversation." });
  if (source) {
    const owner = store.botByThread(source.threadId);
    if (!owner) return json(res, 409, { error: "The approval's bot is no longer available." });
    bot = requestedTaskBot(owner.id, source.threadId);
    pending = store.messagesFor(source.threadId).find((message: any) => message.card?.requestId === source.requestId);
    if (!pending?.card?.allowKey) return json(res, 409, { error: "That grant is no longer on the original approval." });
    allowKey = pending.card.allowKey;
  }
  // A card an admin answers (a command on the shared server) is approved
  // once, by an admin. 2026-10-26: any other card of a member's own bot
  // is hers, Always allow included (her bot, her environment); the
  // answerer checks below still refuse anyone else's bot, and an
  // organization that turned standing grants off keeps them off.
  if (pending.card?.adminApproval) {
    json(res, 403, ADMIN_APPROVAL_REQUIRED);
    return;
  }
  // #1098: never in the person's own sandbox, where the grant is theirs
  if (memberOwnedInOrg(bot) && !standingGrantsAllowed({ ownSandbox: pending.card?.ownSandbox === true })) {
    json(res, 409, { error: "Your organization requires an approval each time, so this cannot be always allowed.", code: "standing_grants_off" });
    return;
  }
  // A standing grant is an approval: the same people who may approve
  // the card it came from may remember it (security review 2026-10-19:
  // its answerer, not only whoever started the thread).
  const answererRefusal = approvalAnswerRefusal(auth, bot.threadId, pending.card!.requestId!);
  if (answererRefusal) {
    json(res, 403, { error: answererRefusal });
    return;
  }
  const refusal = cardAnswerRefusal(auth, bot.threadId, pending.card!.requestId!, "allow");
  if (refusal) {
    json(res, 403, { error: refusal });
    return;
  }
  const stepUpRefusal = alwaysAllowStepUpGate(ruleManager(auth), bot.id, bot.threadId, pending.card!.requestId!, allowKey, body.stepUp);
  if (stepUpRefusal) {
    json(res, stepUpRefusal.status, stepUpRefusal.body);
    return;
  }
  store.patchTask(bot.id, bot.threadId, {
    alwaysAllow: [...new Set([...(bot.alwaysAllow ?? []), allowKey])].slice(0, 200)
  });
  const live = directTurnBots.get(bot.threadId);
  if (live) live.alwaysAllow = [...new Set([...(live.alwaysAllow ?? []), allowKey])].slice(0, 200);
  const updated = store.bot(bot.id)!;
  const visible = wireBot(updated);
  broadcast({ kind: "bot", bot: visible });
  json(res, 200, { bot: visible });
  return;
}
m = path.match(/^\/api\/bots\/([\w-]+)$/);
if (m && method === "PATCH") {
  const body = await readBody(req);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    json(res, 400, { error: "body must be a JSON object" });
    return;
  }
  // A security key step-up rides along (server/auth/step-up-gate.ts); it is
  // never a bot field.
  const patchStepUp = body.stepUp;
  delete body.stepUp;
  const sharedSettings = ownerSettingsForbidden(auth, store.bot(m[1]), {
    model: Object.prototype.hasOwnProperty.call(body, "modelSelection"),
    notifications: Object.prototype.hasOwnProperty.call(body, "notifications")
  });
  if (sharedSettings) {
    json(res, 403, sharedSettings);
    return;
  }
  // A paired phone reaches a personal server through the companion as
  // its owner, with the fields an owner may set from a phone (look,
  // framing, name, instructions, notifications, model, memory, and the
  // Permissions / Approval / Proactive / Access fields of Lot 1). Org
  // sharing and host fields stay off the phone.
  if (companionRequest(req, auth)) {
    const field = companionBotFieldViolation(body);
    if (field) {
      json(res, 403, { error: `forbidden: a phone may change a bot's name, look, instructions, notifications, model, memory, permissions and access, not "${field}"` });
      return;
    }
  }
  if (Object.prototype.hasOwnProperty.call(body, "host")) {
    const target = store.bot(m[1]);
    if (!target) {
      json(res, 404, { error: "no such bot" });
      return;
    }
    if (!maySetBotHost(auth, target)) {
      json(res, 403, { error: "Only the bot's owner or an editor can choose where it runs." });
      return;
    }
    const assigned = assignBotHost({ callerUserId: channelActorId(auth), workers: registeredWorkers, host: (body as { host?: unknown }).host });
    if (!assigned.ok) {
      json(res, assigned.status, { error: assigned.error });
      return;
    }
    const hosted = store.patchBot(target.id, {
      host: assigned.host,
      ...(assigned.model ? { modelSelection: assigned.model } : {})
    });
    if (!hosted) {
      json(res, 404, { error: "no such bot" });
      return;
    }
    delete (body as { host?: unknown }).host;
    if (Object.keys(body).length === 0) {
      const visible = wireBot(store.bot(hosted.id)!);
      broadcast({ kind: "bot", bot: visible });
      json(res, 200, { bot: visible });
      return;
    }
  }
  // Organization server: the bot's owner, signed in, turns Full on as
  // the bot's default (its new threads and routines) while the
  // organization allows it (org-full-access.ts). A request of its own:
  // nothing else rides along.
  if (IDENTITY.kind === "perspicax" && body.approvalMode === "full") {
    const target = store.bot(m[1]);
    if (!target) {
      json(res, 404, { error: "no such bot" });
      return;
    }
    const parsedFull = parseOrgFullAccessBody(body as Record<string, unknown>);
    if ("error" in parsedFull) {
      json(res, 400, { error: parsedFull.error });
      return;
    }
    // use may talk and rename a thread, not raise the bot. This branch
    // returns before the member field check, so the cap is applied here.
    if (callerBotsReadOnly(auth)) {
      json(res, 403, BOTS_READ_ONLY);
      return;
    }
    const refusal = orgFullAccessRefusalFor(auth, target, parsedFull.confirm);
    if (refusal) {
      json(res, refusal.status, { error: refusal.error, code: refusal.code, ...("permission" in refusal ? permissionRefusal(refusal.permission) : {}) });
      return;
    }
    if (target.busy && !primaryAskedReplay()) {
      json(res, 409, { error: "stop this bot's turn before changing its approval level" });
      return;
    }
    if (target.approvalGrant) {
      json(res, 409, { error: "the bot's approval mode is still being confirmed" });
      return;
    }
    if (!supportsApprovalMode(target.modelSelection, "full")) {
      json(res, 400, { error: "This provider does not support Full access" });
      return;
    }
    // The settings control shows the open conversation. The grant has to
    // land on that thread too, or the menu snaps back to the thread's
    // previous level while only the bot default changed. Only a thread
    // this caller is shown: never another member's conversation.
    const followTask = parsedFull.threadId ? store.taskByThread(target.id, parsedFull.threadId) : undefined;
    const followViewer = scopedThreadViewer() ?? sessionPrincipal(auth) ?? undefined;
    const follow = threadFollowsFullGrant({
      threadId: parsedFull.threadId,
      knownThread: Boolean(followTask) && threadsShownTo(target, [followTask!], followViewer).length === 1,
      threadBusy: Boolean(parsedFull.threadId && threadBusy(target.id, parsedFull.threadId))
    });
    const threadBefore = follow ? approvalModeFor(store.projectBotForTask(target.id, follow) ?? target) : undefined;
    // The key is asked against every level this grant loosens: the bot's
    // default and, when it follows, the thread's own.
    const fullStepUp = approvalModeStepUpGate({ person: ruleManager(auth), botId: target.id, op: "bot", thread: "*", froms: [approvalModeFor(target), ...(threadBefore ? [threadBefore] : [])], to: "full", stepUp: patchStepUp });
    if (fullStepUp) {
      json(res, fullStepUp.status, fullStepUp.body);
      return;
    }
    const before = approvalModeFor(target);
    const updated = store.patchBot(target.id, {
      approvalMode: "full", autoApprove: false, alwaysAllow: [],
      fullAccessConsent: { principalId: sessionPrincipal(auth)!, at: Date.now() }
    }, { actorPrincipalId: sessionPrincipal(auth) })!;
    // #1169: every thread of the bot, hidden ones included, now follows
    // it to Full (store.patchBot), except a level another person chose
    // for their own conversation; the open one is recorded too.
    if (follow) {
      store.patchTask(updated.id, follow, { approvalOwn: undefined, alwaysAllow: [] });
      auditApprovalModeChange(auth, target.id, threadBefore!, "full", follow);
    }
    auditApprovalModeChange(auth, target.id, before, "full");
    const visible = wireBot(store.bot(updated.id)!);
    broadcast({ kind: "bot", bot: visible });
    json(res, 200, { bot: visible });
    return;
  }
  if (auth.kind === "session" && !auth.scopes.includes("admin")) {
    const target = store.bot(m[1]);
    const own = Boolean(target && memberOwnsBot(auth, target));
    // A member asking Full or Custom for their own bot hits the org rule
    // first (S3-7): the answer is the same 409 an admin gets.
    if (
      own && target && memberOwnedInOrg(target) &&
      (body.approvalMode === "full" || body.approvalMode === "custom")
    ) {
      json(res, 409, MEMBER_BOT_FULL_ACCESS);
      return;
    }
    // Slice 4: someone granted edit changes what the owner could as a
    // member (MEMBER_BOT_FIELDS); never the approval level or anything
    // that decides where or how far the bot runs.
    const editor = !own && Boolean(target) && IDENTITY.kind === "perspicax" && atLeast(viewerBotLevel(auth, target!), "edit");
    // 2026-10-09: the owner sets more with the permissions of their
    // profiles (BOT_FIELD_PERMISSIONS); an editor stays at MEMBER_BOT_FIELDS.
    if (own) {
      const refused = memberBotFieldRefusal(auth, body);
      if (refused?.permission) {
        json(res, 403, { ...permissionRefusal(refused.permission), field: refused.field });
        return;
      }
    }
    const field = own ? memberBotFieldRefusal(auth, body)?.field ?? null : editor ? memberBotFieldViolation(body) : clientBotPatchViolation(body);
    if (field) {
      json(res, 403, {
        error: own || editor
          ? `forbidden: a member may change their bot's name, look, instructions and model, not "${field}"`
          : `forbidden: this session may change how a bot looks, not "${field}" (needs the admin scope)`
      });
      return;
    }
    if (!own && !editor && target && botEditsNeedOwner(auth) && Object.keys(body).some((key: any) => key === "color" || key.startsWith("mascot") || key.startsWith("avatar"))) {
      json(res, 403, { error: "forbidden: only the bot owner can change how it looks", code: "bot_look_owner_only" });
      return;
    }
  }
  const existingBot = store.bot(m[1]);
  const rawSelection = (body as Record<string, unknown>).modelSelection;
  if (body.threadId !== undefined && rawSelection === undefined) {
    json(res, 400, { error: "threadId goes with modelSelection" });
    return;
  }
  if (rawSelection !== undefined) requirePinnedClientThread(m[1], body.threadId);
  const selectedTask = existingBot ? requestedTaskBot(existingBot.id, body.threadId) : null;
  const beforeProfile = existingBot ? profileSnapshot(existingBot) : undefined;
  const beforeVisibility = existingBot?.visibility;
  if (body.requireAvailableModel !== undefined && typeof body.requireAvailableModel !== "boolean") {
    json(res, 400, { error: "requireAvailableModel must be true or false" });
    return;
  }
  const beforeBrowserProfile = existingBot?.browserProfile;
  const beforeBrowserEnabled = existingBot?.browser;
  // Neither Codex (free-form string field) nor Grok (lazy, logs-only)
  // rejects an unknown effort level at their own boundary — this is the
  // only real gate, so it stays. But it fires only when the target
  // instance actually resolves. An instance that isn't there declares no
  // levels, and rejecting against that empty list would 400 the *whole*
  // request: this is the app's general-purpose bot endpoint, and
  // duplicateBot re-sends the source bot's entire modelSelection beside
  // its name, title and description, so a source engine that happens to
  // be offline would cost the copy all of them. Letting it through is
  // safe — startTurn refuses to run a turn on an unavailable instance
  // anyway, so an unverifiable level never reaches a CLI.
  if (
    existingBot?.approvalGrant &&
    (rawSelection !== undefined || body.approvalMode !== undefined || body.autoApprove !== undefined)
  ) {
    json(res, 409, { error: "wait for the approval-level change to finish before changing this setting" });
    return;
  }
  if (body.requireAvailableModel === true && rawSelection === undefined) {
    json(res, 400, { error: "requireAvailableModel requires modelSelection" });
    return;
  }
  let normalizedSelection: ModelSelection | undefined;
  if (rawSelection !== undefined) {
    const onMachine = existingBot ? selectionOnMachine({ host: existingBot.host, workers: registeredWorkers, raw: rawSelection }) : null;
    const checked = onMachine ?? checkedModelSelection(
      rawSelection,
      selectedTask ? { selection: selectedTask.modelSelection, busy: threadBusy(selectedTask.id, selectedTask.threadId) } : undefined,
      body.requireAvailableModel === true,
      sessionPrincipal(auth),
    );
    if (!checked.ok) {
      json(res, checked.status, { error: checked.error });
      return;
    }
    normalizedSelection = checked.selection;
    if (existingBot && activeGroupTurnForBot(existingBot.id)) {
      const groupChecked = checkedModelSelection(normalizedSelection, { selection: existingBot.modelSelection, busy: true }, false, sessionPrincipal(auth));
      if (!groupChecked.ok) {
        json(res, groupChecked.status, { error: groupChecked.error });
        return;
      }
    }
  }
  // Persona/profile fields reach prompts and paired clients. Both this
  // broad desktop endpoint and the paired-safe profile endpoint pass
  // through the same validation and clear-value normalization.
  const profile = parseBotProfilePatch(body);
  if (!profile.ok) {
    json(res, 400, { error: profile.error });
    return;
  }
  if (profile.patch.avatarUrl && !storedAvatarExists(profile.patch.avatarUrl)) {
    json(res, 400, { error: "avatarUrl must reference an existing stored image" });
    return;
  }
  const lookLocked = lockedLookRefusal(auth, existingBot, profile.patch.mascotLook);
  if (lookLocked) {
    json(res, 403, lookLocked);
    return;
  }
  const patch: Record<string, unknown> = {};
  Object.assign(patch, profile.patch);
  let section: string | undefined | null;
  if (body.section !== undefined) {
    if (body.section === null) section = null;
    else if (typeof body.section !== "string") {
      json(res, 400, { error: "section must be a string" });
      return;
    }
    else {
      const trimmed = body.section.trim();
      if (!trimmed) section = null;
      else if (trimmed.length > 60) {
        json(res, 400, { error: "section must be at most 60 characters" });
        return;
      }
      else section = trimmed;
    }
  }
  for (const key of ["unread", "cloudBackend", "color", "mascotExpression", "mascotBody", "pinned", "hidden"] as const) {
    if (body[key] !== undefined) patch[key] = body[key];
  }
  const computerSpecified = Object.prototype.hasOwnProperty.call(body, "computer");
  let requestedComputer = existingBot?.computer;
  if (computerSpecified) {
    if (body.computer === null) {
      // Auto is represented by an absent durable field. JSON needs a
      // concrete clear value, so clients send null at the PATCH boundary.
      requestedComputer = undefined;
      patch.computer = undefined;
    } else if (
      typeof body.computer === "string" &&
      ["auto", "cloud", "vm", "local", "browser", "off"].includes(body.computer)
    ) {
      // This computer and the cloud computer are saved. A Local VM or
      // the browser still reads as Auto, without an error. Off stays.
      requestedComputer = body.computer === "auto" ? undefined : requestedWorksOn(body.computer);
      patch.computer = requestedComputer;
    } else {
      json(res, 400, { error: "computer must be null, auto, local, cloud, or off" });
      return;
    }
  }
  if (normalizedSelection) patch.modelSelection = normalizedSelection;
  // one pinned message per thread; null/"" clears. The id is not
  // validated against the transcript here — a pin whose message was
  // edited to another branch or deleted simply resolves to nothing.
  if (body.pinnedMessageId !== undefined) {
    if (body.pinnedMessageId === null || body.pinnedMessageId === "") patch.pinnedMessageId = undefined;
    else if (typeof body.pinnedMessageId === "string" && /^[\w-]+$/.test(body.pinnedMessageId)) {
      patch.pinnedMessageId = body.pinnedMessageId;
    } else {
      json(res, 400, { error: "pinnedMessageId must be a message id" });
      return;
    }
  }
  if (section !== undefined) patch.section = section ?? undefined;
  if (body.chiefOfStaff === false) patch.chiefOfStaff = false;
  // where a task carries on when this engine is unavailable, in order
  if (body.fallback !== undefined) {
    if (!Array.isArray(body.fallback) || body.fallback.length > 5) {
      json(res, 400, { error: "fallback must be a list of up to five { instanceId, model } entries" });
      return;
    }
    const chain: Array<{ instanceId: string; model: string }> = [];
    for (const entry of body.fallback as unknown[]) {
      const row = entry && typeof entry === "object" ? (entry as { instanceId?: unknown; model?: unknown }) : null;
      if (!row || typeof row.instanceId !== "string" || !/^[\w.-]+$/.test(row.instanceId) || typeof row.model !== "string" || !row.model.trim() || row.model.length > 500) {
        json(res, 400, { error: "fallback must be a list of up to five { instanceId, model } entries" });
        return;
      }
      if (!registry.get(row.instanceId)) {
        json(res, 400, { error: `fallback engine "${row.instanceId}" is not available` });
        return;
      }
      if (chain.some((seen) => seen.instanceId === row.instanceId)) continue;
      chain.push({ instanceId: row.instanceId, model: row.model.trim() });
    }
    patch.fallback = chain;
  }
  // sending on the person's behalf: ask every time, or a daily allowance
  if (body.outbound !== undefined) {
    const policy = normalizeOutboundPolicy(body.outbound);
    if (!policy) {
      json(res, 400, { error: "outbound must be { policy: ask | allow, dailyCap: 1..1000 }" });
      return;
    }
    patch.outbound = policy;
  }
  // per-bot gate on sending voice notes: the toggle is about what this
  // bot may do (an admin decision), not how it looks, so it lives here
  // rather than the client-writable profile surface.
  if (body.voiceNotes !== undefined) {
    if (typeof body.voiceNotes !== "boolean") {
      json(res, 400, { error: "voiceNotes must be true or false" });
      return;
    }
    patch.voiceNotes = body.voiceNotes;
  }
  if (body.emailDrafts !== undefined) {
    if (typeof body.emailDrafts !== "boolean") {
      json(res, 400, { error: "emailDrafts must be true or false" });
      return;
    }
    patch.emailDrafts = body.emailDrafts;
  }
  // Per-bot proactive on/off (shared/proactive-mode.ts). Legacy
  // propose / read-auto / follow-rules normalize to proactive.
  if (body.proactiveMode !== undefined) {
    if (typeof body.proactiveMode !== "string") {
      json(res, 400, { error: "proactiveMode must be off or proactive" });
      return;
    }
    const raw = body.proactiveMode;
    const legacy = raw === "propose" || raw === "read-auto" || raw === "follow-rules";
    if (!isProactiveMode(raw) && !legacy) {
      json(res, 400, { error: "proactiveMode must be off or proactive" });
      return;
    }
    patch.proactiveMode = normalizeProactiveMode(raw);
  }
  if (body.teamMemorySharing !== undefined) {
    if (!isTeamMemorySharing(body.teamMemorySharing)) {
      json(res, 400, { error: "teamMemorySharing must be \"shared\" or \"private\"" });
      return;
    }
    // absent reads as shared: the default stays unwritten
    patch.teamMemorySharing = body.teamMemorySharing === "private" ? "private" : undefined;
  }
  if (body.memoryEnabled !== undefined) {
    if (typeof body.memoryEnabled !== "boolean") {
      json(res, 400, { error: "memoryEnabled must be true or false" });
      return;
    }
    if (existingBot && (existingBot.busy || activeGroupTurnForBot(existingBot.id)) &&
        body.memoryEnabled !== (existingBot.memoryEnabled !== false)) {
      json(res, 409, { error: "stop this bot's turn before changing its memory setting" });
      return;
    }
    patch.memoryEnabled = body.memoryEnabled;
  }
  if (body.loopGuard !== undefined) {
    if (typeof body.loopGuard !== "boolean") {
      json(res, 400, { error: "loopGuard must be true or false" });
      return;
    }
    patch.loopGuard = body.loopGuard;
  }
  // Queue this bot's direct messages behind outstanding delegated work
  // instead of steering the conversation immediately (#1194).
  if (body.parkDirectMessages !== undefined) {
    if (typeof body.parkDirectMessages !== "boolean") {
      json(res, 400, { error: "parkDirectMessages must be true or false" });
      return;
    }
    patch.parkDirectMessages = body.parkDirectMessages;
  }
  // Per-bot selection of app-wide MCP servers. Omitted keeps the current
  // selection; null restores all enabled servers; [] explicitly mounts none.
  let requestedMcpServers = existingBot?.mcpServers;
  if (Object.hasOwn(body, "toolScope")) {
    const parsed = parseToolScope(body.toolScope === null ? undefined : body.toolScope);
    if (!parsed.ok) {
      json(res, 400, { error: parsed.error });
      return;
    }
    patch.toolScope = parsed.scope;
  }
  if (body.mcpServers !== undefined) {
    if (auth.kind === "session" && !sessions.isLive(auth.session.id)) {
      json(res, 401, { error: "unauthorized: this session has expired or was revoked" });
      return;
    }
    if (body.mcpServers === null) {
      requestedMcpServers = undefined;
    } else if (!Array.isArray(body.mcpServers) || body.mcpServers.some((t: unknown) => typeof t !== "string" || mcpServerNameError(t) !== null)) {
      json(res, 400, { error: "mcpServers must be a list of server names, or null" });
      return;
    } else {
      requestedMcpServers = [...new Set(body.mcpServers as string[])];
      if (requestedMcpServers.length > MAX_MCP_SERVERS) {
        json(res, 400, { error: `Select at most ${MAX_MCP_SERVERS} MCP servers.` });
        return;
      }
    }
    patch.mcpServers = requestedMcpServers;
  }
  // Which saved account each server signs in with for this bot; read at
  // each turn's start, so a running turn keeps the one it began with.
  if (body.mcpAccounts !== undefined) {
    const parsed = parseMcpAccountChoices(body.mcpAccounts);
    if (!parsed.ok) {
      json(res, 400, { error: parsed.error });
      return;
    }
    patch.mcpAccounts = parsed.choices;
  }
  if (body.memoryUpkeep !== undefined) {
    if (typeof body.memoryUpkeep !== "boolean") {
      json(res, 400, { error: "memoryUpkeep must be true or false" });
      return;
    }
    patch.memoryUpkeep = body.memoryUpkeep;
  }
  // Prompt-cache keep-warm: true/false overrides the workspace, null follows it.
  if (body.cacheKeepWarm !== undefined) {
    if (body.cacheKeepWarm !== null && typeof body.cacheKeepWarm !== "boolean") {
      json(res, 400, { error: "cacheKeepWarm must be true, false or null" });
      return;
    }
    patch.cacheKeepWarm = body.cacheKeepWarm ?? undefined;
  }
  // per-bot gate on the app's built-in browser
  if (body.browser !== undefined) {
    if (typeof body.browser !== "boolean") {
      json(res, 400, { error: "browser must be true or false" });
      return;
    }
    if (existingBot?.busy && body.browser !== (existingBot.browser !== false)) {
      json(res, 409, { error: "stop this bot's turn before changing its browser access" });
      return;
    }
    patch.browser = body.browser;
  }
  // which named browser session this bot uses; null/"" = its own
  if (body.browserProfile !== undefined) {
    const requestedProfile = body.browserProfile === null || body.browserProfile === ""
      ? undefined
      : body.browserProfile;
    if (existingBot?.busy && requestedProfile !== existingBot.browserProfile) {
      json(res, 409, { error: "stop this bot's turn before changing its browser profile" });
      return;
    }
    if (existingBot && requestedProfile !== existingBot.browserProfile &&
        browserRuntime.heldBy(currentBrowserSession(existingBot.id, existingBot.browserProfile))) {
      json(res, 409, { error: "Release browser control before changing its profile." });
      return;
    }
    // A person signing in themselves in this bot's browser (the vault
    // card): the panel would move to a browser that is not armed.
    const signingIn = existingBot ? browserProfileChangeRefusal(browserRuntime, existingBot.id, existingBot.browserProfile, typeof requestedProfile === "string" ? requestedProfile : undefined) : null;
    if (signingIn) {
      json(res, 409, { error: signingIn, code: "person_signing_in" });
      return;
    }
    if (requestedProfile === undefined) patch.browserProfile = undefined;
    else if (
      typeof requestedProfile === "string" &&
      (requestedProfile === "guest" || (requestedProfile === MY_CHROME_PROFILE && myChrome.offered) ||
        (cfg.browserProfiles ?? []).some((profile: any) => profile.id === requestedProfile) ||
        // #1098: one of the bot owner's own profiles
        personalProfileOf(recordedBotOwner(existingBot ?? {}), requestedProfile))
    ) {
      patch.browserProfile = requestedProfile;
    } else {
      json(res, 400, { error: "browserProfile must name an existing browser profile" });
      return;
    }
  }
  if (body.cloudBackend !== undefined && !["box", "vps"].includes(String(body.cloudBackend))) {
    json(res, 400, { error: "cloudBackend must be box or vps" });
    return;
  }
  if (body.cloudBackend === "vps" && IDENTITY.kind === "perspicax") {
    json(res, 409, { error: "On an organization server a bot works in its owner's server environment; a VPS computer per bot is not available.", code: "org_user_sandbox" });
    return;
  }
  if (body.autoStartVps !== undefined) {
    if (typeof body.autoStartVps !== "boolean") {
      json(res, 400, { error: "autoStartVps must be true or false" });
      return;
    }
    patch.autoStartVps = body.autoStartVps;
  }
  if (body.chiefOfStaff !== undefined && typeof body.chiefOfStaff !== "boolean") {
    json(res, 400, { error: "chiefOfStaff must be true or false" });
    return;
  }
  if (body.cloudBackend !== undefined) {
    const backendError = cloudBackendChangeError(Boolean(existingBot?.busy), activeVpsThreads.has(m[1]));
    if (backendError) {
      json(res, 409, { error: backendError });
      return;
    }
  }
  if (body.cwd !== undefined) {
    const checked = await validateBotCwdFor(body.cwd, { principalId: terminalPrincipalId(auth), botId: m[1], sessions: remoteSessions });
    if (!checked.ok) {
      json(res, 400, { error: checked.error });
      return;
    }
    const outside = checked.remote ? null : memberFolderRefusal(memberFolderPrincipal(auth), checked.cwd);
    if (outside) {
      json(res, 403, { ...outside, field: "cwd" });
      return;
    }
    patch.cwd = checked.cwd ?? undefined;
  }
  if (body.hidden === true && existingBot?.chiefOfStaff && body.chiefOfStaff !== false) {
    json(res, 400, { error: "choose another Primary Bot before hiding this bot" });
    return;
  }
  // the permission fields decide what runs unattended, so they are
  // type-checked rather than copied through: a string alwaysAllow would
  // still answer .includes() — with substring matches, not tool names
  if (body.autoApprove !== undefined) {
    if (typeof body.autoApprove !== "boolean") {
      json(res, 400, { error: "autoApprove must be true or false" });
      return;
    }
  }
  let requestedApprovalMode: ApprovalMode;
  if (body.approvalMode !== undefined) {
    if (!isApprovalMode(body.approvalMode)) {
      json(res, 400, {
        error: "approvalMode must be ask, auto, full, or custom"
      });
      return;
    }
    requestedApprovalMode = body.approvalMode;
  } else if (body.autoApprove !== undefined) {
    // Compatibility for desktop/mobile builds that predate the four-level
    // selector. Their boolean can choose only safe Auto or Ask; it can
    // never silently create Full access.
    requestedApprovalMode = body.autoApprove ? "auto" : "ask";
  } else {
    requestedApprovalMode = approvalModeFor(existingBot ?? {});
  }
  const currentApprovalMode = approvalModeFor(existingBot ?? {});
  const approvalChangeRequested = body.approvalMode !== undefined || body.autoApprove !== undefined;
  if (approvalChangeRequested && (requestedApprovalMode === "full" || requestedApprovalMode === "custom") && existingBot && memberOwnedInOrg(existingBot)) {
    json(res, 409, MEMBER_BOT_FULL_ACCESS);
    return;
  }
  if (existingBot?.busy && approvalChangeRequested && requestedApprovalMode !== currentApprovalMode && !primaryAskedReplay()
    && !liveApprovalChange(currentApprovalMode, requestedApprovalMode)) {
    json(res, 409, {
      error: "stop this bot's turn before changing its approval level"
    });
    return;
  }
  if (approvalChangeRequested && existingBot && memberAutoRefused(existingBot, [currentApprovalMode], requestedApprovalMode)) {
    json(res, 403, MEMBER_AUTO_NOT_ALLOWED);
    return;
  }
  if (approvalChangeRequested && existingBot) {
    const modeStepUp = approvalModeStepUpGate({ person: ruleManager(auth), botId: existingBot.id, op: "bot", thread: "*", froms: [currentApprovalMode], to: requestedApprovalMode, stepUp: patchStepUp });
    if (modeStepUp) {
      json(res, modeStepUp.status, modeStepUp.body);
      return;
    }
  }
  if (body.approvalMode !== undefined || body.autoApprove !== undefined) {
    patch.approvalMode = requestedApprovalMode;
    // Keep the old wire field truthful for older paired apps. It means
    // specifically safe Auto, not "some mode that approves things".
    patch.autoApprove = requestedApprovalMode === "auto";
  }
  const targetSelection = normalizedSelection ?? existingBot?.modelSelection;
  if (
    (requestedApprovalMode === "full" || requestedApprovalMode === "custom") &&
    body.approvalMode !== undefined &&
    (!targetSelection || !supportsApprovalMode(targetSelection, requestedApprovalMode) ||
      (existingBot && normalizedSelection && engineSwitchNeedsAsk(requestedApprovalMode, existingBot.modelSelection, normalizedSelection)))
  ) {
    json(res, 400, {
      error: "This provider does not support the selected approval level, or changing providers requires choosing Ask first"
    });
    return;
  }
  const requiresPrivateApprovalTransition =
    ((requestedApprovalMode === "full" || requestedApprovalMode === "custom") &&
      currentApprovalMode !== requestedApprovalMode) ||
    (currentApprovalMode === "custom" && requestedApprovalMode !== "custom");
  if (requiresPrivateApprovalTransition) {
    json(res, 403, {
      error: "Full access and Custom approval are turned on in the Sagax desktop app on the computer that runs this server"
    });
    return;
  }
  // "Auto on this Mac" hands a bot the user's real session, so the grant
  // must prove a human saw the warning. The desktop dialog is the only
  // caller that sends acknowledgeLocalAuto; without it a PATCH that would
  // create the combination — a bot curling the loopback API from a tool
  // call, a script, a stale client — is refused. The renderer dialog
  // alone is not a boundary; this check is.
  const wantsComputer = computerSpecified ? requestedComputer : existingBot?.computer;
  const wantsAuto = requestedApprovalMode === "auto";
  const alreadyGranted =
    existingBot?.computer === "local" && approvalModeFor(existingBot) === "auto";
  if (wantsComputer === "local" && wantsAuto === true && !alreadyGranted && body.acknowledgeLocalAuto !== true) {
    json(res, 400, {
      error: "Auto mode on this computer requires confirming the warning first (acknowledgeLocalAuto)"
    });
    return;
  }
  if (body.approvePeerComms !== undefined) {
    if (typeof body.approvePeerComms !== "boolean") {
      json(res, 400, { error: "approvePeerComms must be true or false" });
      return;
    }
    patch.approvePeerComms = body.approvePeerComms;
  }
  // Who this bot may contact. null clears the list back to "everyone
  // visible in my section"; an array — including an empty one — is the
  // explicit wiring, so a bot can be given exactly one correspondent.
  //
  // Narrowing is free, widening is not. The bot this field constrains
  // can reach this endpoint: resolveRequestAuth hands admin+client to
  // any loopback caller, so a bot holding Bash is one curl from
  // deleting its own leash — the same adversary the acknowledgeLocalAuto
  // block above is written against, and the exact bot the allow-list
  // exists to contain. So cutting reach needs nothing (an operator, a
  // script, even the bot itself may only ever make it smaller), while
  // clearing the list or adding an id needs the proof of a human the
  // desktop dialog sends and a tool call cannot forge.
  if (body.peers !== undefined) {
    let nextPeers: string[] | undefined;
    if (body.peers === null) nextPeers = undefined;
    else if (
      !Array.isArray(body.peers) ||
      body.peers.some((peerId: unknown) => typeof peerId !== "string")
    ) {
      json(res, 400, { error: "peers must be a list of bot ids, or null for every bot in this section" });
      return;
    } else {
      nextPeers = [...new Set<string>(body.peers)].slice(0, MAX_WORKSPACE_BOTS);
    }
    // A bot with no list is already at its widest, so the first list it
    // is ever given can only narrow it.
    const currentPeers = existingBot?.peers;
    const widensReach =
      Array.isArray(currentPeers) &&
      (nextPeers === undefined || nextPeers.some((peerId: any) => !currentPeers.includes(peerId)));
    if (widensReach && body.acknowledgePeerScope !== true) {
      json(res, 400, {
        error: "Widening a bot's allowed peers requires confirming it first (acknowledgePeerScope)"
      });
      return;
    }
    patch.peers = nextPeers;
  }
  if (body.managedSections !== undefined) {
    const parsed = z.array(z.string().trim().max(60)).max(100).safeParse(body.managedSections);
    if (!parsed.success) {
      json(res, 400, { error: "managedSections must be a list of up to 100 team names (60 characters each)" });
      return;
    }
    const sections = [...new Set(parsed.data)];
    const newSections = sections.filter((section: any) => !(existingBot?.managedSections ?? []).includes(section));
    if (newSections.some((section: any) => section !== "" && !store.sections.includes(section))) {
      json(res, 400, { error: "Create the named team before giving a Primary Bot access to it" });
      return;
    }
    if (sections.length && !(body.chiefOfStaff === true || (existingBot?.chiefOfStaff && body.chiefOfStaff !== false))) {
      json(res, 400, { error: "Only a Primary Bot can be given access to additional teams" });
      return;
    }
    if (newSections.length && body.acknowledgePeerScope !== true) {
      json(res, 400, { error: "Confirm which additional teams this Primary Bot may work with (acknowledgePeerScope)" });
      return;
    }
    patch.managedSections = sections;
  }
  // Removing the role revokes its grants, rather than leaving dormant
  // authority to return if this bot is elected Primary Bot again later.
  if (body.chiefOfStaff === false) patch.managedSections = [];
  // Who may see this bot on a workspace several people share
  // (bot-visibility.ts): "everyone" (the default), "admins", or
  // { people: [...] }. Access control, applied at once; members' PATCHes
  // never get here (clientBotPatchViolation).
  if (Object.hasOwn(body, "visibility")) {
    const parsed = parseVisibility(body.visibility);
    if (!parsed.ok) {
      json(res, 400, { error: parsed.error });
      return;
    }
    patch.visibility = ownerChosenVisibility(auth, parsed.visibility);
  }
  if (body.alwaysAllow !== undefined) {
    if (!Array.isArray(body.alwaysAllow) || body.alwaysAllow.some((t: unknown) => typeof t !== "string")) {
      json(res, 400, { error: "alwaysAllow must be a list of tool keys" });
      return;
    }
    const nextAllow = [...new Set(body.alwaysAllow as string[])].slice(0, 200);
    patch.alwaysAllow = nextAllow;
    // A standing grant added here (a room card's Always allow) needs the
    // person's key like the card itself, when they chose "always-grant".
    const added = nextAllow.filter((key: any) => !(existingBot?.alwaysAllow ?? []).includes(key));
    if (added.length) {
      const person = ruleManager(auth);
      for (const key of added) {
        const pending = pendingApprovalCards().find((entry: any) => entry.bot.id === m![1] && entry.card.allowKey === key);
        const refused = pending
          ? alwaysAllowStepUpGate(person, m![1]!, pending.threadId, pending.card.requestId!, key, patchStepUp)
          : securityKeys.required(person, ["always-grant"], existingBot ? approvalOwnerId(existingBot) || null : null).length
            ? { status: 403, body: { error: "Always allow needs your security key: give it from the approval card.", code: "step_up_required", classes: ["always-grant"] } }
            : null;
        if (refused) {
          json(res, refused.status, refused.body);
          return;
        }
      }
    }
  }
  // 2026-10-21 (parité 1C): who this bot writes to without a card. Like
  // an Always allow, adding someone is a standing grant: it needs the
  // person's key when they protect "always-grant", and it counts as a
  // loosening below. Removing someone is free; null clears the list.
  if (body.allowedRecipients !== undefined) {
    const nextRecipients = body.allowedRecipients === null ? [] : normalizeAllowedRecipients(body.allowedRecipients);
    if (!nextRecipients) {
      json(res, 400, { error: "allowedRecipients must be a list of email addresses, phone numbers or bot:<id> entries", code: "invalid_recipients" });
      return;
    }
    const added = nextRecipients.filter((key: any) => !(existingBot?.allowedRecipients ?? []).includes(key));
    if (added.length && !standingGrantsAllowed()) {
      json(res, 409, { error: "Your organization requires an approval each time, so no one can be added to allowed recipients.", code: "standing_grants_off" });
      return;
    }
    if (added.length) {
      const refused = settingsStepUpGate(ruleManager(auth), "allowed-recipients", { botId: m![1], added: [...added].sort() }, patchStepUp, existingBot ? approvalOwnerId(existingBot) || null : null);
      if (refused) {
        json(res, refused.status, refused.body);
        return;
      }
    }
    patch.allowedRecipients = nextRecipients.length ? nextRecipients : undefined;
  }
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
  if (loosened.includes("managedSections") && auth.kind === "loopback" && !DESKTOP_MANAGED && store.bots.some((bot: any) => bot.busy)) {
    json(res, 409, { error: "Stop running bots before granting access to another team, or use the desktop app or a paired Full-access session." });
    return;
  }
  if (body.peers !== undefined && Array.isArray(existingBot?.peers)) {
    const nextPeers = patch.peers;
    if (nextPeers === undefined || (Array.isArray(nextPeers) && nextPeers.some((peerId: any) => !existingBot.peers!.includes(peerId)))) {
      loosened.push("peers");
    }
  }
  if (body.approvePeerComms === false && existingBot?.approvePeerComms === true) loosened.push("approvePeerComms");
  if (section !== undefined && sectionKey(existingBot?.section) !== sectionKey(section)) loosened.push("section");
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
  if (Object.hasOwn(body, "toolScope") && toolScopeWidens(existingBot?.toolScope, patch.toolScope)) loosened.push("toolScope");
  const browserOrigin = typeof req.headers.origin === "string" && req.headers.origin.trim() !== "";
  if (loosened.length && auth.kind === "loopback" && !DESKTOP_MANAGED && !browserOrigin) {
    if (store.bots.some((candidate: any) => candidate.busy)) {
      json(res, 409, {
        error: "A bot is working right now, so this change has to come from the desktop app or a paired device. Try again once every bot is idle."
      });
      return;
    }
    console.warn(`bot ${m[1]}: ${loosened.join(", ")} loosened by ${requestSource(req)} through the local API with no paired session`);
  }
  if (existingBot?.computer === "local" && computerSpecified && requestedComputer !== "local") {
    await interruptAllDirectThreads(existingBot.id);
    const routine = routines!.activeBotRunForBot(existingBot.id);
    if (routine) await routines!.cancelRun(routine.id);
    const groupTurn = activeGroupTurnForBot(existingBot.id);
    if (groupTurn) {
      cancelGroupTurnOperations(groupTurn.group.id, groupTurn.threadId);
      revokeInternalCapabilitiesForThread(groupTurn.threadId);
      await runningTurnInstance(existingBot, groupTurn.threadId)?.adapter.interruptTurn(groupTurn.threadId).catch(() => {});
      closeOpenApprovals(groupTurn.threadId);
    }
  }
  let bot: BotRecord | null;
  const freshBrowserBot = store.bot(m[1]);
  // Connector validation and runtime revocation can yield after the first
  // memory check. Keep the same idle-only transition at the final commit.
  if (freshBrowserBot && body.memoryEnabled !== undefined &&
      body.memoryEnabled !== (freshBrowserBot.memoryEnabled !== false) &&
      (freshBrowserBot.busy || activeGroupTurnForBot(freshBrowserBot.id))) {
    json(res, 409, { error: "stop this bot's turn before changing its memory setting" });
    return;
  }
  if (Object.hasOwn(body, "toolScope")) {
    if (auth.kind === "session" && !sessions.isLive(auth.session.id)) {
      json(res, 401, { error: "unauthorized: this session has expired or was revoked" });
      return;
    }
    if (toolScopeWidens(freshBrowserBot?.toolScope, patch.toolScope) && auth.kind === "loopback" && !DESKTOP_MANAGED && !browserOrigin && store.bots.some((candidate: any) => candidate.busy)) {
      json(res, 409, { error: "A bot is working right now, so this change has to come from the desktop app or a paired device. Try again once every bot is idle." });
      return;
    }
    if (freshBrowserBot && JSON.stringify(freshBrowserBot.toolScope) !== JSON.stringify(patch.toolScope)
      && (freshBrowserBot.busy || activeGroupTurnForBot(freshBrowserBot.id))) {
      json(res, 409, { error: "Stop this bot's turns before changing its tool selection." });
      return;
    }
  }
  // Custom servers are process configuration: a running turn cannot
  // unmount them. Recheck after any awaited runtime revocation above.
  if (body.mcpServers !== undefined) {
    if (auth.kind === "session" && !sessions.isLive(auth.session.id)) {
      json(res, 401, { error: "unauthorized: this session has expired or was revoked" });
      return;
    }
    if (Array.isArray(freshBrowserBot?.mcpServers) &&
        (requestedMcpServers === undefined || requestedMcpServers.some((name: any) => !freshBrowserBot.mcpServers!.includes(name))) &&
        auth.kind === "loopback" && !DESKTOP_MANAGED && !browserOrigin && store.bots.some((candidate: any) => candidate.busy)) {
      json(res, 409, { error: "A bot is working right now, so this change has to come from the desktop app or a paired device. Try again once every bot is idle." });
      return;
    }
    if (freshBrowserBot &&
        JSON.stringify(requestedMcpServers?.toSorted()) !== JSON.stringify(freshBrowserBot.mcpServers?.toSorted()) &&
        (freshBrowserBot.busy || activeGroupTurnForBot(freshBrowserBot.id))) {
      json(res, 409, { error: "Stop this bot's turns before changing its MCP servers." });
      return;
    }
  }
  if (normalizedSelection && selectedTask) {
    const current = store.projectBotForTask(selectedTask.id, selectedTask.threadId);
    if (!current) {
      json(res, 404, { error: "no such task" });
      return;
    }
    const checked = checkedModelSelection(normalizedSelection, { selection: current.modelSelection, busy: threadBusy(current.id, current.threadId) }, false, sessionPrincipal(auth));
    if (!checked.ok) {
      json(res, checked.status, { error: checked.error });
      return;
    }
    if (freshBrowserBot && activeGroupTurnForBot(freshBrowserBot.id)) {
      const groupChecked = checkedModelSelection(normalizedSelection, { selection: freshBrowserBot.modelSelection, busy: true }, false, sessionPrincipal(auth));
      if (!groupChecked.ok) {
        json(res, groupChecked.status, { error: groupChecked.error });
        return;
      }
    }
  }
  if (freshBrowserBot && body.browserProfile !== undefined &&
      patch.browserProfile !== freshBrowserBot.browserProfile &&
      (freshBrowserBot.busy || browserRuntime.heldBy(currentBrowserSession(freshBrowserBot.id, freshBrowserBot.browserProfile)))) {
    json(res, 409, { error: "Stop the bot and release browser control before changing its profile." });
    return;
  }
  // #1373: what each running turn answers at before this change
  const liveApprovalBefore = existingBot && patch.approvalMode !== undefined && requestedApprovalMode !== currentApprovalMode
    && liveApprovalChange(currentApprovalMode, requestedApprovalMode) && botRunning(existingBot.id)
    ? runningTurnLevels(existingBot.id) : null;
  if (profile.patch.soul !== undefined) {
    if (freshBrowserBot) assertTeamComputerChangeIdle(freshBrowserBot, { ...freshBrowserBot, ...patch } as BotRecord);
    // A mixed settings request must not turn a runtime revocation into
    // a persist-first edit. Apply runtime fields with their existing
    // fail-closed semantics; atomically commit only the profile fields.
    const runtimePatch = { ...patch };
    for (const field of Object.keys(profile.patch)) delete runtimePatch[field];
    if (Object.keys(runtimePatch).length) store.patchBot(m[1], runtimePatch, { actorPrincipalId: sessionPrincipal(auth) });
    bot = store.patchBotProfile(m[1], profile.patch);
  } else {
    if (freshBrowserBot) assertTeamComputerChangeIdle(freshBrowserBot, { ...freshBrowserBot, ...patch } as BotRecord);
    bot = store.patchBot(m[1], patch, { actorPrincipalId: sessionPrincipal(auth) });
  }
  if (!bot) {
    json(res, 404, { error: "no such bot" });
    return;
  }
  if (body.memoryUpkeep === false || body.memoryEnabled === false) memoryUpkeep.dropBot(bot.id);
  if (body.cacheKeepWarm !== undefined) cacheKeepWarm.refresh();
  // A defined Works on is the newest explicit choice: this bot's
  // auto-recorded pins that now point elsewhere give way immediately, so
  // the next turn on each thread follows the new setting. Person-set pins
  // and pins that already match stay; returning to Auto sweeps nothing.
  if (computerSpecified && requestedComputer !== undefined) store.clearAutoSurfacePins(m[1], requestedComputer);
  // patchBot moved every thread silently; hosted state for the selected
  // thread is reset through the same model-change path.
  if (normalizedSelection && selectedTask) store.patchTask(bot.id, selectedTask.threadId, { modelSelection: undefined,
    ...hostedModels?.resetTask(selectedTask.modelSelection, normalizedSelection) });
  if (existingBot && (bot.browserProfile !== beforeBrowserProfile || bot.browser !== beforeBrowserEnabled)) {
    browserLive.closeForBot(bot.id);
    browserNetworkDebug.clearBot(bot.id);
    if (beforeBrowserProfile === "guest" && (bot.browserProfile !== "guest" || bot.browser === false)) {
      void forgetTemporaryBrowser(bot.id).catch((error: any) => console.warn("temporary browser cleanup failed", error));
    }
  }
  // A Primary Bot is one per person, not per section: moving it to
  // another team keeps the role.
  const chiefChanges = body.chiefOfStaff === true ? store.setPrimaryBot(bot.id) : [];
  if (chiefChanges === null) {
    json(res, 404, { error: "no such bot" });
    return;
  }
  if (beforeProfile) {
    const now = store.bot(bot.id)!;
    recordProfileChange(bot.id, "user", "api", beforeProfile, profileSnapshot(now));
    recordPersonaSave(auth, bot.id, beforeProfile, profileSnapshot(now));
  }
  // A new audience changes who may see this bot's rooms and teams too:
  // re-announce them so every member's stream gains or withdraws them.
  if (Object.hasOwn(patch, "visibility") && JSON.stringify(beforeVisibility ?? "everyone") !== JSON.stringify(bot.visibility ?? "everyone")) {
    for (const group of store.groups.filter((candidate: any) => candidate.memberIds.includes(bot!.id))) {
      broadcast({ kind: "group", group: publicGroupState(group) });
    }
    broadcast({ kind: "sections", sections: store.sections });
    audienceChanged();
  }
  if (liveApprovalBefore) {
    try {
      await applyStricterApprovalLive(bot.id, liveApprovalBefore);
    } catch (error) {
      json(res, 409, { error: stricterApprovalStopError(error) });
      return;
    }
  }
  json(res, 200, { bot: wireBot(store.bot(bot.id)!) });
  return;
}

m = path.match(/^\/api\/bots\/([\w-]+)$/);
if (m && method === "DELETE") {
  if (auth.kind === "session" && !auth.scopes.includes("admin")) {
    const target = store.bot(m[1]);
    if (!target) {
      json(res, 404, { error: "no such bot" });
      return;
    }
    if (!memberOwnsBot(auth, target)) {
      json(res, 403, { error: "forbidden: only the bot owner or an admin can delete it", code: "bot_delete_owner_only" });
      return;
    }
  }
  const result = await deleteBotWithLifecycle(m[1]);
  json(res, result.status, result.body);
  return;
}

m = path.match(/^\/api\/bots\/([\w-]+)\/requests\/([A-Za-z0-9_-]{16,80})(\/interrupt)?$/);
if (m && ((method === "GET" && !m[3]) || (method === "POST" && m[3]))) {
  const body = method === "GET" ? { threadId: url.searchParams.get("threadId") } : await readBody(req);
  const id = z.string().regex(/^[\w-]+$/);
  const parsed = (method === "GET" ? z.object({ threadId: id }).strict() : z.object({
    threadId: id, messageId: id, expectedActiveLeafId: id.nullable(),
    expectedTurnId: z.string().min(1).max(200).nullable(), expectedExecutionId: id.nullable()
  }).strict()).safeParse(body);
  if (!parsed.success) {
    json(res, 400, { error: "A pinned thread and exact request snapshot are required" });
    return;
  }
  const threadId = parsed.data.threadId;
  const requestBot = store.bot(m[1]);
  if (requestBot) routeThreadId(requestBot, threadId, method === "GET" ? "thread.read" : "thread.post");
  const snapshot = guardedRequestSnapshot(m[1], threadId, m[2]);
  res.setHeader("cache-control", "private, no-store");
  if (method === "GET") {
    json(res, 200, { ...snapshot, messages: projectMessages(threadId, snapshot.messages, viewerForApproval(auth)) });
    return;
  }
  assertRequestTarget(snapshot, body);
  const owner = directRequestOwners.get(threadId);
  if (snapshot.phase === "untracked" || !owner || owner.messageId !== snapshot.messageId) {
    json(res, 409, { error: "This continuation cannot be safely stopped from this interface", code: "guarded_request_untracked" });
    return;
  }
  if (snapshot.phase === "settled") throw requestConflict("This request has already settled");
  // No await between comparing the exact lease and revoking it. Retrying
  // this body cannot bind to a later setup claim with a null provider id.
  owner.stopped = true;
  handoffs.stoppedByPerson(threadId);
  await interruptDirectThread(m[1], threadId);
  json(res, 200, { ok: true, outcome: "stopped" });
  return;
}
    return PASS;
  };
}
