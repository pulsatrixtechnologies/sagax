// PATCH /api/bots/:id profile and presentation fields (#1383).
// Never imports server/index.ts.
import type { ModelSelection } from "../../shared/model-selection.ts";
import type { BotPatchState, BotsMutateEnv } from "./bots-mutate-helpers.ts";
import { requirePinnedClientThread } from "./bots-mutate-helpers.ts";
import { normalizeDirectTriggers } from "../../shared/direct-triggers.ts";

export async function buildBotPatchProfile(env: BotsMutateEnv, state: BotPatchState): Promise<boolean> {
  const { m, body } = state;
  const existingBot = env.store.bot(m[1]);
  const rawSelection = (body as Record<string, unknown>).modelSelection;
  if (body.threadId !== undefined && rawSelection === undefined) {
    env.json(env.res, 400, { error: "threadId goes with modelSelection" });
    return true;
  }
  if (rawSelection !== undefined) requirePinnedClientThread(env, m[1], body.threadId);
  const selectedTask = existingBot ? env.requestedTaskBot(existingBot.id, body.threadId) : null;
  const beforeProfile = existingBot ? env.profileSnapshot(existingBot) : undefined;
  const beforeVisibility = existingBot?.visibility;
  if (body.requireAvailableModel !== undefined && typeof body.requireAvailableModel !== "boolean") {
    env.json(env.res, 400, { error: "requireAvailableModel must be true or false" });
    return true;
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
    env.json(env.res, 409, { error: "wait for the approval-level change to finish before changing this setting" });
    return true;
  }
  if (body.requireAvailableModel === true && rawSelection === undefined) {
    env.json(env.res, 400, { error: "requireAvailableModel requires modelSelection" });
    return true;
  }
  let normalizedSelection: ModelSelection | undefined;
  if (rawSelection !== undefined) {
    const onMachine = existingBot ? env.selectionOnMachine({ host: existingBot.host, workers: env.registeredWorkers, raw: rawSelection }) : null;
    const checked = onMachine ?? env.checkedModelSelection(
      rawSelection,
      selectedTask ? { selection: selectedTask.modelSelection, busy: env.threadBusy(selectedTask.id, selectedTask.threadId) } : undefined,
      body.requireAvailableModel === true,
      env.sessionPrincipal(env.auth),
    );
    if (!checked.ok) {
      env.json(env.res, checked.status, { error: checked.error });
      return true;
    }
    normalizedSelection = checked.selection;
    if (existingBot && env.activeGroupTurnForBot(existingBot.id)) {
      const groupChecked = env.checkedModelSelection(normalizedSelection, { selection: existingBot.modelSelection, busy: true }, false, env.sessionPrincipal(env.auth));
      if (!groupChecked.ok) {
        env.json(env.res, groupChecked.status, { error: groupChecked.error });
        return true;
      }
    }
  }
  // Persona/profile fields reach prompts and paired clients. Both this
  // broad desktop endpoint and the paired-safe profile endpoint pass
  // through the same validation and clear-value normalization.
  const profile = env.parseBotProfilePatch(body);
  if (!profile.ok) {
    env.json(env.res, 400, { error: profile.error });
    return true;
  }
  if (profile.patch.avatarUrl && !env.storedAvatarExists(profile.patch.avatarUrl)) {
    env.json(env.res, 400, { error: "avatarUrl must reference an existing stored image" });
    return true;
  }
  const lookLocked = env.lockedLookRefusal(env.auth, existingBot, profile.patch.mascotLook);
  if (lookLocked) {
    env.json(env.res, 403, lookLocked);
    return true;
  }
  const patch: Record<string, unknown> = {};
  Object.assign(patch, profile.patch);
  let section: string | undefined | null;
  if (body.section !== undefined) {
    if (body.section === null) section = null;
    else if (typeof body.section !== "string") {
      env.json(env.res, 400, { error: "section must be a string" });
      return true;
    }
    else {
      const trimmed = body.section.trim();
      if (!trimmed) section = null;
      else if (trimmed.length > 60) {
        env.json(env.res, 400, { error: "section must be at most 60 characters" });
        return true;
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
      requestedComputer = body.computer === "auto" ? undefined : env.requestedWorksOn(body.computer);
      patch.computer = requestedComputer;
    } else {
      env.json(env.res, 400, { error: "computer must be null, auto, local, cloud, or off" });
      return true;
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
      env.json(env.res, 400, { error: "pinnedMessageId must be a message id" });
      return true;
    }
  }
  if (section !== undefined) {
    patch.section = section ?? undefined;
    // #2045: keep the stable team link beside the displayed name.
    if (typeof env.resolveSectionId === "function") {
      patch.sectionId = section
        ? env.resolveSectionId(section, env.auth, existingBot ?? undefined)
        : undefined;
    }
  }
  if (body.chiefOfStaff === false) patch.chiefOfStaff = false;
  // where a task carries on when this engine is unavailable, in order
  if (body.fallback !== undefined) {
    if (!Array.isArray(body.fallback) || body.fallback.length > 5) {
      env.json(env.res, 400, { error: "fallback must be a list of up to five { instanceId, model } entries" });
      return true;
    }
    const chain: Array<{ instanceId: string; model: string }> = [];
    for (const entry of body.fallback as unknown[]) {
      const row = entry && typeof entry === "object" ? (entry as { instanceId?: unknown; model?: unknown }) : null;
      if (!row || typeof row.instanceId !== "string" || !/^[\w.-]+$/.test(row.instanceId) || typeof row.model !== "string" || !row.model.trim() || row.model.length > 500) {
        env.json(env.res, 400, { error: "fallback must be a list of up to five { instanceId, model } entries" });
        return true;
      }
      if (!env.registry.get(row.instanceId)) {
        env.json(env.res, 400, { error: `fallback engine "${row.instanceId}" is not available` });
        return true;
      }
      if (chain.some((seen) => seen.instanceId === row.instanceId)) continue;
      chain.push({ instanceId: row.instanceId, model: row.model.trim() });
    }
    patch.fallback = chain;
  }
  // sending on the person's behalf: ask every time, or a daily allowance
  if (body.outbound !== undefined) {
    const policy = env.normalizeOutboundPolicy(body.outbound);
    if (!policy) {
      env.json(env.res, 400, { error: "outbound must be { policy: ask | allow, dailyCap: 1..1000 }" });
      return true;
    }
    patch.outbound = policy;
  }
  // per-bot gate on sending voice notes: the toggle is about what this
  // bot may do (an admin decision), not how it looks, so it lives here
  // rather than the client-writable profile surface.
  if (body.voiceNotes !== undefined) {
    if (typeof body.voiceNotes !== "boolean") {
      env.json(env.res, 400, { error: "voiceNotes must be true or false" });
      return true;
    }
    patch.voiceNotes = body.voiceNotes;
  }
  if (body.emailDrafts !== undefined) {
    if (typeof body.emailDrafts !== "boolean") {
      env.json(env.res, 400, { error: "emailDrafts must be true or false" });
      return true;
    }
    patch.emailDrafts = body.emailDrafts;
  }
  if (body.collaboratorsCreateRoutines !== undefined) {
    if (typeof body.collaboratorsCreateRoutines !== "boolean") {
      env.json(env.res, 400, { error: "collaboratorsCreateRoutines must be true or false" });
      return true;
    }
    patch.collaboratorsCreateRoutines = body.collaboratorsCreateRoutines;
  }
  if (body.memeReplies !== undefined) {
    if (body.memeReplies !== "auto" && body.memeReplies !== "off") {
      env.json(env.res, 400, { error: "memeReplies must be auto or off" });
      return true;
    }
    patch.memeReplies = body.memeReplies;
  }
  // Per-bot proactive on/off (shared/proactive-mode.ts). Legacy
  // propose / read-auto / follow-rules normalize to proactive.
  if (body.proactiveMode !== undefined) {
    if (typeof body.proactiveMode !== "string") {
      env.json(env.res, 400, { error: "proactiveMode must be off or proactive" });
      return true;
    }
    const raw = body.proactiveMode;
    const legacy = raw === "propose" || raw === "read-auto" || raw === "follow-rules";
    if (!env.isProactiveMode(raw) && !legacy) {
      env.json(env.res, 400, { error: "proactiveMode must be off or proactive" });
      return true;
    }
    patch.proactiveMode = env.normalizeProactiveMode(raw);
  }
  // #2691: direct triggers per channel with filters; null clears them all.
  if (body.directTriggers !== undefined) {
    const parsed = normalizeDirectTriggers(body.directTriggers);
    if (!parsed.ok) {
      env.json(env.res, 400, { error: parsed.error });
      return true;
    }
    patch.directTriggers = parsed.value ?? undefined;
  }
  // #2048: remembered publish target (Sagax page / artifact / Claude / …).
  if (body.pageTargetDefault !== undefined) {
    const parsed = env.parsePageTargetDefault(body.pageTargetDefault);
    if (!parsed.ok) {
      env.json(env.res, 400, { error: parsed.error });
      return true;
    }
    patch.pageTargetDefault = parsed.value ?? undefined;
  }
  if (body.teamMemorySharing !== undefined) {
    if (!env.isTeamMemorySharing(body.teamMemorySharing)) {
      env.json(env.res, 400, { error: "teamMemorySharing must be \"shared\" or \"private\"" });
      return true;
    }
    // absent reads as shared: the default stays unwritten
    patch.teamMemorySharing = body.teamMemorySharing === "private" ? "private" : undefined;
  }
  if (body.memoryEnabled !== undefined) {
    if (typeof body.memoryEnabled !== "boolean") {
      env.json(env.res, 400, { error: "memoryEnabled must be true or false" });
      return true;
    }
    if (existingBot && (existingBot.busy || env.activeGroupTurnForBot(existingBot.id)) &&
        body.memoryEnabled !== (existingBot.memoryEnabled !== false)) {
      env.json(env.res, 409, { error: "stop this bot's turn before changing its memory setting" });
      return true;
    }
    patch.memoryEnabled = body.memoryEnabled;
  }
  if (body.loopGuard !== undefined) {
    if (typeof body.loopGuard !== "boolean") {
      env.json(env.res, 400, { error: "loopGuard must be true or false" });
      return true;
    }
    patch.loopGuard = body.loopGuard;
  }
  // Queue this bot's direct messages behind outstanding delegated work
  // instead of steering the conversation immediately (#1194).
  if (body.parkDirectMessages !== undefined) {
    if (typeof body.parkDirectMessages !== "boolean") {
      env.json(env.res, 400, { error: "parkDirectMessages must be true or false" });
      return true;
    }
    patch.parkDirectMessages = body.parkDirectMessages;
  }
  state.existingBot = existingBot;
  state.selectedTask = selectedTask;
  state.beforeProfile = beforeProfile;
  state.beforeVisibility = beforeVisibility;
  state.beforeBrowserProfile = beforeBrowserProfile;
  state.beforeBrowserEnabled = beforeBrowserEnabled;
  state.normalizedSelection = normalizedSelection;
  state.profile = profile;
  if (state.teamOverrides) patch.teamOverrides = state.teamOverrides.length ? state.teamOverrides : undefined;
  state.patch = patch;
  state.section = section;
  state.computerSpecified = computerSpecified;
  state.requestedComputer = requestedComputer;
  return false;
}
