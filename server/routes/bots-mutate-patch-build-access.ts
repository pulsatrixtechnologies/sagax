// PATCH /api/bots/:id access, approval, peers, and standing grants (#1383).
// Never imports server/index.ts.
import type { ApprovalMode } from "../../shared/approval-mode.ts";
import type { BotPatchState, BotsMutateEnv } from "./bots-mutate-helpers.ts";
import { parseBuiltinPluginsPatch } from "../../shared/builtin-plugins.ts";

export async function buildBotPatchAccess(env: BotsMutateEnv, state: BotPatchState): Promise<boolean> {
  const { m, body, patch, existingBot, normalizedSelection, computerSpecified, requestedComputer, patchStepUp } = state;
  // Per-bot selection of app-wide MCP servers. Omitted keeps the current
  // selection; null restores all enabled servers; [] explicitly mounts none.
  let requestedMcpServers = existingBot?.mcpServers;
  if (Object.hasOwn(body, "toolScope")) {
    const parsed = env.parseToolScope(body.toolScope === null ? undefined : body.toolScope);
    if (!parsed.ok) {
      env.json(env.res, 400, { error: parsed.error });
      return true;
    }
    patch.toolScope = parsed.scope;
  }
  if (body.mcpServers !== undefined) {
    if (env.auth.kind === "session" && !env.sessions.isLive(env.auth.session.id)) {
      env.json(env.res, 401, { error: "unauthorized: this session has expired or was revoked" });
      return true;
    }
    if (body.mcpServers === null) {
      requestedMcpServers = undefined;
    } else if (!Array.isArray(body.mcpServers) || body.mcpServers.some((t: unknown) => typeof t !== "string" || env.mcpServerNameError(t) !== null)) {
      env.json(env.res, 400, { error: "mcpServers must be a list of server names, or null" });
      return true;
    } else {
      requestedMcpServers = [...new Set(body.mcpServers as string[])];
      if (requestedMcpServers.length > env.MAX_MCP_SERVERS) {
        env.json(env.res, 400, { error: `Select at most ${env.MAX_MCP_SERVERS} MCP servers.` });
        return true;
      }
    }
    patch.mcpServers = requestedMcpServers;
  }
  // Which saved account each server signs in with for this bot; read at
  // each turn's start, so a running turn keeps the one it began with.
  if (body.mcpAccounts !== undefined) {
    const parsed = env.parseMcpAccountChoices(body.mcpAccounts);
    if (!parsed.ok) {
      env.json(env.res, 400, { error: parsed.error });
      return true;
    }
    patch.mcpAccounts = parsed.choices;
  }
  if (body.builtinPlugins !== undefined) {
    const parsed = parseBuiltinPluginsPatch(body.builtinPlugins);
    if (!parsed.ok) {
      env.json(env.res, 400, { error: parsed.error });
      return true;
    }
    patch.builtinPlugins = { ...existingBot?.builtinPlugins, ...parsed.value };
  }
  if (body.memoryUpkeep !== undefined) {
    if (typeof body.memoryUpkeep !== "boolean") {
      env.json(env.res, 400, { error: "memoryUpkeep must be true or false" });
      return true;
    }
    patch.memoryUpkeep = body.memoryUpkeep;
  }
  if (body.skillLearning !== undefined) {
    if (typeof body.skillLearning !== "boolean") {
      env.json(env.res, 400, { error: "skillLearning must be true or false" });
      return true;
    }
    patch.skillLearning = body.skillLearning;
  }
  // false: the helper model never writes for this bot (server/side-jobs.ts)
  if (body.helperModel !== undefined) {
    if (typeof body.helperModel !== "boolean") {
      env.json(env.res, 400, { error: "helperModel must be true or false" });
      return true;
    }
    patch.helperModel = body.helperModel;
  }
  // Prompt-cache keep-warm: true/false overrides the workspace, null follows it.
  if (body.cacheKeepWarm !== undefined) {
    if (body.cacheKeepWarm !== null && typeof body.cacheKeepWarm !== "boolean") {
      env.json(env.res, 400, { error: "cacheKeepWarm must be true, false or null" });
      return true;
    }
    patch.cacheKeepWarm = body.cacheKeepWarm ?? undefined;
  }
  // per-bot gate on the app's built-in browser
  if (body.browser !== undefined) {
    if (typeof body.browser !== "boolean") {
      env.json(env.res, 400, { error: "browser must be true or false" });
      return true;
    }
    if (existingBot?.busy && body.browser !== (existingBot.browser !== false)) {
      env.json(env.res, 409, { error: "stop this bot's turn before changing its browser access" });
      return true;
    }
    patch.browser = body.browser;
  }
  // which named browser session this bot uses; null/"" = its own
  if (body.browserProfile !== undefined) {
    const requestedProfile = body.browserProfile === null || body.browserProfile === ""
      ? undefined
      : body.browserProfile;
    if (existingBot?.busy && requestedProfile !== existingBot.browserProfile) {
      env.json(env.res, 409, { error: "stop this bot's turn before changing its browser profile" });
      return true;
    }
    if (existingBot && requestedProfile !== existingBot.browserProfile &&
        env.browserRuntime.heldBy(env.currentBrowserSession(existingBot.id, existingBot.browserProfile))) {
      env.json(env.res, 409, { error: "Release browser control before changing its profile." });
      return true;
    }
    // A person signing in themselves in this bot's browser (the vault
    // card): the panel would move to a browser that is not armed.
    const signingIn = existingBot ? env.browserProfileChangeRefusal(env.browserRuntime, existingBot.id, existingBot.browserProfile, typeof requestedProfile === "string" ? requestedProfile : undefined) : null;
    if (signingIn) {
      env.json(env.res, 409, { error: signingIn, code: "person_signing_in" });
      return true;
    }
    if (requestedProfile === undefined) patch.browserProfile = undefined;
    else if (
      typeof requestedProfile === "string" &&
      (requestedProfile === "guest" || (requestedProfile === env.MY_CHROME_PROFILE && env.myChrome.offered) ||
        (env.cfg.browserProfiles ?? []).some((profile: any) => profile.id === requestedProfile) ||
        // #1098: one of the bot owner's own profiles
        env.personalProfileOf(env.recordedBotOwner(existingBot ?? {}), requestedProfile))
    ) {
      patch.browserProfile = requestedProfile;
    } else {
      env.json(env.res, 400, { error: "browserProfile must name an existing browser profile" });
      return true;
    }
  }
  if (body.cloudBackend !== undefined && !["box", "vps"].includes(String(body.cloudBackend))) {
    env.json(env.res, 400, { error: "cloudBackend must be box or vps" });
    return true;
  }
  if (body.cloudBackend === "vps" && env.IDENTITY.kind === "perspicax") {
    env.json(env.res, 409, { error: "On an organization server a bot works in its owner's server environment; a VPS computer per bot is not available.", code: "org_user_sandbox" });
    return true;
  }
  if (body.autoStartVps !== undefined) {
    if (typeof body.autoStartVps !== "boolean") {
      env.json(env.res, 400, { error: "autoStartVps must be true or false" });
      return true;
    }
    patch.autoStartVps = body.autoStartVps;
  }
  if (body.chiefOfStaff !== undefined && typeof body.chiefOfStaff !== "boolean") {
    env.json(env.res, 400, { error: "chiefOfStaff must be true or false" });
    return true;
  }
  if (body.cloudBackend !== undefined) {
    const backendError = env.cloudBackendChangeError(Boolean(existingBot?.busy), env.activeVpsThreads.has(m[1]));
    if (backendError) {
      env.json(env.res, 409, { error: backendError });
      return true;
    }
  }
  if (body.cwd !== undefined) {
    const checked = await env.validateBotCwdFor(body.cwd, { principalId: env.terminalPrincipalId(env.auth), botId: m[1], sessions: env.remoteSessions });
    if (!checked.ok) {
      env.json(env.res, 400, { error: checked.error });
      return true;
    }
    const outside = checked.remote ? null : env.memberFolderRefusal(env.memberFolderPrincipal(env.auth), checked.cwd);
    if (outside) {
      env.json(env.res, 403, { ...outside, field: "cwd" });
      return true;
    }
    patch.cwd = checked.cwd ?? undefined;
  }
  if (body.hidden === true && existingBot?.chiefOfStaff && body.chiefOfStaff !== false) {
    env.json(env.res, 400, { error: "choose another Primary Bot before hiding this bot" });
    return true;
  }
  // the permission fields decide what runs unattended, so they are
  // type-checked rather than copied through: a string alwaysAllow would
  // still answer .includes() — with substring matches, not tool names
  if (body.autoApprove !== undefined) {
    if (typeof body.autoApprove !== "boolean") {
      env.json(env.res, 400, { error: "autoApprove must be true or false" });
      return true;
    }
  }
  let requestedApprovalMode: ApprovalMode;
  if (body.approvalMode !== undefined) {
    if (!env.isApprovalMode(body.approvalMode)) {
      env.json(env.res, 400, {
        error: "approvalMode must be ask, auto, full, or custom"
      });
      return true;
    }
    requestedApprovalMode = body.approvalMode;
  } else if (body.autoApprove !== undefined) {
    // Compatibility for desktop/mobile builds that predate the four-level
    // selector. Their boolean can choose only safe Auto or Ask; it can
    // never silently create Full access.
    requestedApprovalMode = body.autoApprove ? "auto" : "ask";
  } else {
    requestedApprovalMode = env.approvalModeFor(existingBot ?? {});
  }
  const currentApprovalMode = env.approvalModeFor(existingBot ?? {});
  const approvalChangeRequested = body.approvalMode !== undefined || body.autoApprove !== undefined;
  if (approvalChangeRequested && (requestedApprovalMode === "full" || requestedApprovalMode === "custom") && existingBot && env.memberOwnedInOrg(existingBot)) {
    env.json(env.res, 409, env.MEMBER_BOT_FULL_ACCESS);
    return true;
  }
  // omb #3627: any level may change while the bot works; liveApprovalMode
  // reads the saved level on the next Sagax decision.
  if (approvalChangeRequested && existingBot && env.memberAutoRefused(existingBot, [currentApprovalMode], requestedApprovalMode)) {
    env.json(env.res, 403, env.MEMBER_AUTO_NOT_ALLOWED);
    return true;
  }
  if (approvalChangeRequested && existingBot) {
    const modeStepUp = env.approvalModeStepUpGate({ person: env.ruleManager(env.auth), botId: existingBot.id, op: "bot", thread: "*", froms: [currentApprovalMode], to: requestedApprovalMode, stepUp: patchStepUp });
    if (modeStepUp) {
      env.json(env.res, modeStepUp.status, modeStepUp.body);
      return true;
    }
  }
  if (body.approvalMode !== undefined || body.autoApprove !== undefined) {
    patch.approvalMode = requestedApprovalMode;
    // Keep the old wire field truthful for older paired apps. It means
    // specifically safe Auto, not "some mode that approves things".
    patch.autoApprove = requestedApprovalMode === "auto";
  }
  const targetSelection = normalizedSelection ?? existingBot?.modelSelection;
  // Full runs on every engine (omb #2808). Custom stays Codex-only and never
  // crosses engines.
  if (
    requestedApprovalMode === "custom" &&
    body.approvalMode !== undefined &&
    (!targetSelection || !env.supportsApprovalMode(targetSelection, requestedApprovalMode) ||
      (existingBot && normalizedSelection && env.engineSwitchNeedsAsk(requestedApprovalMode, existingBot.modelSelection, normalizedSelection)))
  ) {
    env.json(env.res, 400, {
      error: "This provider does not support the selected approval level, or changing providers requires choosing Ask first"
    });
    return true;
  }
  // Full access applies at once from any client that can reach this API
  // (PRO-RÈGLE / omb #2701): no desktop channel, no consent field. Custom
  // keeps the packaged desktop's private channel, into it and out of it,
  // because it holds restrictions the person wrote themselves.
  const requiresPrivateApprovalTransition =
    (requestedApprovalMode === "custom" && currentApprovalMode !== "custom") ||
    (currentApprovalMode === "custom" && requestedApprovalMode !== "custom");
  if (requiresPrivateApprovalTransition) {
    env.json(env.res, 403, {
      error: "Custom approval is turned on in the Sagax desktop app on the computer that runs this server"
    });
    return true;
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
    existingBot?.computer === "local" && env.approvalModeFor(existingBot) === "auto";
  if (wantsComputer === "local" && wantsAuto === true && !alreadyGranted && body.acknowledgeLocalAuto !== true) {
    env.json(env.res, 400, {
      error: "Auto mode on this computer requires confirming the warning first (acknowledgeLocalAuto)"
    });
    return true;
  }
  if (body.approvePeerComms !== undefined) {
    if (typeof body.approvePeerComms !== "boolean") {
      env.json(env.res, 400, { error: "approvePeerComms must be true or false" });
      return true;
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
      env.json(env.res, 400, { error: "peers must be a list of bot ids, or null for every bot in this section" });
      return true;
    } else {
      nextPeers = [...new Set<string>(body.peers)].slice(0, env.MAX_WORKSPACE_BOTS);
    }
    // A bot with no list is already at its widest, so the first list it
    // is ever given can only narrow it.
    const currentPeers = existingBot?.peers;
    const widensReach =
      Array.isArray(currentPeers) &&
      (nextPeers === undefined || nextPeers.some((peerId: any) => !currentPeers.includes(peerId)));
    if (widensReach && body.acknowledgePeerScope !== true) {
      env.json(env.res, 400, {
        error: "Widening a bot's allowed peers requires confirming it first (acknowledgePeerScope)"
      });
      return true;
    }
    patch.peers = nextPeers;
  }
  if (body.managedSections !== undefined) {
    const parsed = env.z.array(env.z.string().trim().max(60)).max(100).safeParse(body.managedSections);
    if (!parsed.success) {
      env.json(env.res, 400, { error: "managedSections must be a list of up to 100 team names (60 characters each)" });
      return true;
    }
    const sections = [...new Set(parsed.data)];
    const newSections = sections.filter((section: any) => !(existingBot?.managedSections ?? []).includes(section));
    if (newSections.some((section: any) => section !== "" && !env.store.sections.includes(section))) {
      env.json(env.res, 400, { error: "Create the named team before giving a Primary Bot access to it" });
      return true;
    }
    if (sections.length && !(body.chiefOfStaff === true || (existingBot?.chiefOfStaff && body.chiefOfStaff !== false))) {
      env.json(env.res, 400, { error: "Only a Primary Bot can be given access to additional teams" });
      return true;
    }
    if (newSections.length && body.acknowledgePeerScope !== true) {
      env.json(env.res, 400, { error: "Confirm which additional teams this Primary Bot may work with (acknowledgePeerScope)" });
      return true;
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
    const parsed = env.parseVisibility(body.visibility);
    if (!parsed.ok) {
      env.json(env.res, 400, { error: parsed.error });
      return true;
    }
    patch.visibility = env.ownerChosenVisibility(env.auth, parsed.visibility);
  }
  if (body.alwaysAllow !== undefined) {
    if (!Array.isArray(body.alwaysAllow) || body.alwaysAllow.some((t: unknown) => typeof t !== "string")) {
      env.json(env.res, 400, { error: "alwaysAllow must be a list of tool keys" });
      return true;
    }
    const nextAllow = [...new Set(body.alwaysAllow as string[])].slice(0, 200);
    patch.alwaysAllow = nextAllow;
    // A standing grant added here (a room card's Always allow) needs the
    // person's key like the card itself, when they chose "always-grant".
    const added = nextAllow.filter((key: any) => !(existingBot?.alwaysAllow ?? []).includes(key));
    if (added.length) {
      const person = env.ruleManager(env.auth);
      for (const key of added) {
        const pending = env.pendingApprovalCards().find((entry: any) => entry.bot.id === m![1] && entry.card.allowKey === key);
        const refused = pending
          ? env.alwaysAllowStepUpGate(person, m![1]!, pending.threadId, pending.card.requestId!, key, patchStepUp)
          : env.securityKeys.required(person, ["always-grant"], existingBot ? env.approvalOwnerId(existingBot) || null : null).length
            ? { status: 403, body: { error: "Always allow needs your security key: give it from the approval card.", code: "step_up_required", classes: ["always-grant"] } }
            : null;
        if (refused) {
          env.json(env.res, refused.status, refused.body);
          return true;
        }
      }
    }
  }
  // 2026-10-21 (parité 1C): who this bot writes to without a card. Like
  // an Always allow, adding someone is a standing grant: it needs the
  // person's key when they protect "always-grant", and it counts as a
  // loosening below. Removing someone is free; null clears the list.
  if (body.allowedRecipients !== undefined) {
    const nextRecipients = body.allowedRecipients === null ? [] : env.normalizeAllowedRecipients(body.allowedRecipients);
    if (!nextRecipients) {
      env.json(env.res, 400, { error: "allowedRecipients must be a list of email addresses, phone numbers or bot:<id> entries", code: "invalid_recipients" });
      return true;
    }
    const added = nextRecipients.filter((key: any) => !(existingBot?.allowedRecipients ?? []).includes(key));
    if (added.length && !env.standingGrantsAllowed()) {
      env.json(env.res, 409, { error: "Your organization requires an approval each time, so no one can be added to allowed recipients.", code: "standing_grants_off" });
      return true;
    }
    if (added.length) {
      const refused = env.settingsStepUpGate(env.ruleManager(env.auth), "allowed-recipients", { botId: m![1], added: [...added].sort() }, patchStepUp, existingBot ? env.approvalOwnerId(existingBot) || null : null);
      if (refused) {
        env.json(env.res, refused.status, refused.body);
        return true;
      }
    }
    patch.allowedRecipients = nextRecipients.length ? nextRecipients : undefined;
  }
  state.requestedMcpServers = requestedMcpServers;
  state.requestedApprovalMode = requestedApprovalMode;
  state.currentApprovalMode = currentApprovalMode;
  return false;
}
