// Model, read, Auto preview, command allowlist, and always-allow (#1383).
// Never imports server/index.ts.
import type { AutoModelEntry, AutoModelExcluded } from "../../shared/auto-model.ts";
import type { BotsMutateEnv } from "./bots-mutate-helpers.ts";
import { requirePinnedClientThread } from "./bots-mutate-helpers.ts";

export async function handleSmallBotMutations(env: BotsMutateEnv): Promise<boolean> {
  if (await handleBotModel(env)) return true;
  if (await handleBotRead(env)) return true;
  if (await handleBotAutoModel(env)) return true;
  if (await handleBotCommandAllowlist(env)) return true;
  if (await handleBotAlwaysAllow(env)) return true;
  return false;
}

async function handleBotModel(env: BotsMutateEnv): Promise<boolean> {
  const m = env.path.match(/^\/api\/bots\/([\w-]+)\/model$/);
  if (m && env.method === "PATCH") {
    const body = await env.readBody(env.req);
    if (body && typeof body === "object" && !Array.isArray(body)) {
      const unsupported = Object.keys(body).find(
        (key: any) => key !== "instanceId" && key !== "model" && key !== "effort" && key !== "variant",
      );
      if (unsupported) {
        env.json(env.res, 400, { error: `unsupported model field: ${unsupported}` });
        return true;
      }
    }
    const existing = env.store.bot(m[1]);
    if (!existing) {
      env.json(env.res, 404, { error: "no such bot" });
      return true;
    }
    const modelRefusal = env.ownerSettingsForbidden(env.auth, existing, { model: true });
    if (modelRefusal) {
      env.json(env.res, 403, modelRefusal);
      return true;
    }
    requirePinnedClientThread(env, existing.id, undefined);
    const selected = env.requestedTaskBot(existing.id, undefined);
    if (existing.approvalGrant) {
      env.json(env.res, 409, { error: "wait for the approval-level change to finish before changing models" });
      return true;
    }
    const onMachine = env.selectionOnMachine({ host: existing.host, workers: env.registeredWorkers, raw: body });
    const checked = onMachine ?? env.checkedModelSelection(
      body,
      { selection: selected.modelSelection, busy: env.threadBusy(selected.id, selected.threadId) },
      true,
      env.sessionPrincipal(env.auth),
    );
    if (!checked.ok) {
      env.json(env.res, checked.status, { error: checked.error });
      return true;
    }
    if (env.activeGroupTurnForBot(existing.id) && !onMachine) {
      const groupChecked = env.checkedModelSelection(checked.selection, { selection: existing.modelSelection, busy: true }, false, env.sessionPrincipal(env.auth));
      if (!groupChecked.ok) {
        env.json(env.res, groupChecked.status, { error: groupChecked.error });
        return true;
      }
    }
    // patchBot persists first and emits the canonical bot change, which the
    // store listener above turns into the slim wire-format SSE broadcast.
    // Every thread that follows the bot moves with it; the selected thread
    // follows it from now on too, as if picked there.
    const bot = env.store.patchBot(existing.id, { modelSelection: checked.selection });
    if (!bot) {
      env.json(env.res, 404, { error: "no such bot" });
      return true;
    }
    env.store.patchTask(bot.id, selected.threadId, { modelSelection: undefined,
      ...env.hostedModels?.resetTask(selected.modelSelection, checked.selection) });
    env.json(env.res, 200, { bot: env.wireBot(bot) });
    return true;
  }
  return false;
}

async function handleBotRead(env: BotsMutateEnv): Promise<boolean> {
  const m = env.path.match(/^\/api\/bots\/([\w-]+)\/read$/);
  if (m && env.method === "POST") {
    const body = await env.readBody(env.req);
    requirePinnedClientThread(env, m[1], body?.threadId);
    const current = env.requestedTaskBot(m[1], body?.threadId);
    const task = env.store.taskByThread(current.id, current.threadId);
    const cursor = env.readCursor(current.threadId);
    const changed = Boolean(task?.unread) || (cursor.lastReadMessageId !== undefined && task?.lastReadMessageId !== cursor.lastReadMessageId);
    if (changed) env.store.patchTask(current.id, current.threadId, { unread: false, ...cursor });
    env.pushHub.noteRead(env.actorPrincipalId(env.auth), current.threadId);
    const visible = env.wireBot(env.store.bot(current.id)!);
    if (changed) env.broadcast({ kind: "bot", bot: visible });
    env.json(env.res, 200, { bot: visible });
    return true;
  }
  return false;
}

async function handleBotAutoModel(env: BotsMutateEnv): Promise<boolean> {
  // Auto (docs/plans/2026-10-08-auto-model.md): the model this person's
  // next turn with the bot would run on, and the one sentence saying why.
  const m = env.path.match(/^\/api\/bots\/([\w-]+)\/auto-model$/);
  if (m && env.method === "GET") {
    const bot = env.requestedTaskBot(m[1], env.url.searchParams.get("threadId") ?? undefined);
    const speaker = env.speakerFor(env.auth);
    const previewBot = { ...bot, modelSelection: { ...bot.modelSelection, auto: true as const } };
    const excluded: AutoModelExcluded[] = [];
    const engines = env.autoEnginesFor(previewBot, speaker, false, excluded);
    const payer = env.autoPayerKey(bot, speaker);
    const refused = env.autoRefusalsFor(payer);
    const limited = env.limitFailover.autoExcluded(payer, engines);
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
    const turn = env.autoPickForTurn({ bot: previewBot, threadId: bot.threadId, speaker, role: "orchestration", text: "" });
    const chain = (turn?.pick.chain ?? []).flatMap((choice: any) => {
      const item = entry(choice);
      return item && !refused.some((skip: any) => skip.instanceId === choice.instanceId && skip.model === choice.model) ? [item] : [];
    });
    const usablePick = turn && chain.some((choice: any) => choice.instanceId === turn.pick.selection.instanceId && choice.model === turn.pick.selection.model);
    // Recovery uses the saved selections, including custom/local endpoints
    // that the automatic candidate scorer intentionally leaves out.
    const backups = env.botRecoveryBackups(bot, env.cfg).flatMap((choice: any) => {
      const instance = env.registry.get(choice.instanceId);
      if (!instance || !env.personalProviderInstances.visible(choice.instanceId, env.IDENTITY.kind === "perspicax" ? env.actorPrincipalId(env.auth) ?? "" : "solo")) return [];
      const option = instance.models.options.find((candidate: any) => candidate.id === choice.model);
      return [{ ...choice, engineLabel: env.engineDisplayName(instance), modelLabel: option?.label || choice.model }];
    });
    env.json(env.res, 200, { auto: bot.modelSelection.auto === true, pick: usablePick ? env.autoModelRecord(turn.pick, Date.now()) : null,
      chain, excluded, backups, explanation: usablePick ? env.explainPick(turn.pick) : "" });
    return true;
  }
  return false;
}

async function handleBotCommandAllowlist(env: BotsMutateEnv): Promise<boolean> {
  const m = env.path.match(/^\/api\/bots\/([\w-]+)\/command-allowlist(?:\/([\w-]+))?$/);
  if (m && ["GET", "POST", "DELETE"].includes(env.method)) {
    // A client session (iOS parity S2) reads and removes the rules of a
    // bot it owns, or of any bot when it is this computer's own person.
    // Removing a rule only narrows what runs unasked; adding one stays admin.
    const owned = env.store.bot(m[1]);
    const ownerReadOrRemove = ((env.method === "GET" && !m[2]) || (env.method === "DELETE" && Boolean(m[2]))) &&
      Boolean(owned) && (env.computerOwner(env.auth) || env.ownerOrAdminOf(env.auth, owned!));
    if (!env.canManageCommandAllowlist(env.auth) && !ownerReadOrRemove) {
      env.json(env.res, 403, { error: env.method === "POST" ? env.COMMAND_ALLOWLIST_ADD_REFUSAL : "Only the bot's owner, an admin, or someone allowed to run commands on this server can see or remove its saved command permissions." });
      return true;
    }
    const bot = env.requestedTaskBot(m[1], env.url.searchParams.get("threadId") ?? undefined);
    if (env.method === "GET" && !m[2]) {
      env.json(env.res, 200, env.commandAllowlistResponse(bot));
      return true;
    }
    if (env.method === "POST" && !m[2]) {
      const raw = await env.readBody(env.req);
      const allowlistStepUp = raw && typeof raw === "object" ? (raw as Record<string, unknown>).stepUp : undefined;
      if (raw && typeof raw === "object") delete (raw as Record<string, unknown>).stepUp;
      const candidate = env.commandAllowlistCandidate(raw);
      if (!candidate) {
        env.json(env.res, 400, { error: "Enter an exact command without secret values, an absolute working folder, and a provider." });
        return true;
      }
      const instance = env.registry.get(candidate.providerInstanceId);
      if (!instance || !env.COMMAND_ALLOWLIST_DRIVERS.has(instance.driverKind)) {
        env.json(env.res, 400, { error: "This provider does not supply structured command approvals." });
        return true;
      }
      // a saved command runs without asking: a standing grant
      const refused = env.settingsStepUpGate(env.ruleManager(env.auth), "command-allowlist", { botId: bot.id, command: candidate.command, cwd: candidate.cwd, providerInstanceId: candidate.providerInstanceId }, allowlistStepUp, env.approvalOwnerId(bot) || null);
      if (refused) {
        env.json(env.res, refused.status, refused.body);
        return true;
      }
      env.commandAllowlist.add(bot.id, candidate);
      env.json(env.res, 200, env.commandAllowlistResponse(bot));
      return true;
    }
    if (env.method === "DELETE" && m[2]) {
      env.commandAllowlist.remove(bot.id, m[2]);
      env.json(env.res, 200, env.commandAllowlistResponse(bot));
      return true;
    }
    env.json(env.res, 405, { error: "Unsupported command allowlist operation" });
    return true;
  }
  return false;
}

async function handleBotAlwaysAllow(env: BotsMutateEnv): Promise<boolean> {
  const m = env.path.match(/^\/api\/bots\/([\w-]+)\/always-allow$/);
  if (m && env.method === "POST") {
    const body = await env.readBody(env.req);
    requirePinnedClientThread(env, m[1], body?.threadId);
    let allowKey = typeof body.allowKey === "string" ? body.allowKey : "";
    let bot = env.requestedTaskBot(m[1], body.threadId);
    if (!allowKey) {
      env.json(env.res, 400, { error: "allowKey required" });
      return true;
    }
    let pending = env.store.messagesFor(bot.threadId).find((message: any) =>
      message.card?.requestId &&
      !message.card.answered &&
      message.card.dismissed !== true &&
      message.card.allowKey === allowKey
    );
    if (!pending) {
      env.json(env.res, 409, { error: "that grant is not on a pending approval for this bot" });
      return true;
    }
    const source = env.originApprovals?.sourceFor(bot.threadId, pending.card.requestId);
    if (source === false) {
      env.json(env.res, 409, { error: "This approval is no longer available in this conversation." });
      return true;
    }
    if (source) {
      const owner = env.store.botByThread(source.threadId);
      if (!owner) {
        env.json(env.res, 409, { error: "The approval's bot is no longer available." });
        return true;
      }
      bot = env.requestedTaskBot(owner.id, source.threadId);
      pending = env.store.messagesFor(source.threadId).find((message: any) => message.card?.requestId === source.requestId);
      if (!pending?.card?.allowKey) {
        env.json(env.res, 409, { error: "That grant is no longer on the original approval." });
        return true;
      }
      allowKey = pending.card.allowKey;
    }
    // A card an admin answers (a command on the shared server) is approved
    // once, by an admin. 2026-10-26: any other card of a member's own bot
    // is hers, Always allow included (her bot, her environment); the
    // answerer checks below still refuse anyone else's bot, and an
    // organization that turned standing grants off keeps them off.
    if (pending.card?.adminApproval) {
      env.json(env.res, 403, env.ADMIN_APPROVAL_REQUIRED);
      return true;
    }
    // #1098: never in the person's own sandbox, where the grant is theirs
    if (env.memberOwnedInOrg(bot) && !env.standingGrantsAllowed({ ownSandbox: pending.card?.ownSandbox === true })) {
      env.json(env.res, 409, { error: "Your organization requires an approval each time, so this cannot be always allowed.", code: "standing_grants_off" });
      return true;
    }
    // A standing grant is an approval: the same people who may approve
    // the card it came from may remember it (security review 2026-10-19:
    // its answerer, not only whoever started the thread).
    const answererRefusal = env.approvalAnswerRefusal(env.auth, bot.threadId, pending.card!.requestId!);
    if (answererRefusal) {
      env.json(env.res, 403, { error: answererRefusal });
      return true;
    }
    const refusal = env.cardAnswerRefusal(env.auth, bot.threadId, pending.card!.requestId!, "allow");
    if (refusal) {
      env.json(env.res, 403, { error: refusal });
      return true;
    }
    const stepUpRefusal = env.alwaysAllowStepUpGate(env.ruleManager(env.auth), bot.id, bot.threadId, pending.card!.requestId!, allowKey, body.stepUp);
    if (stepUpRefusal) {
      env.json(env.res, stepUpRefusal.status, stepUpRefusal.body);
      return true;
    }
    env.store.patchTask(bot.id, bot.threadId, {
      alwaysAllow: [...new Set([...(bot.alwaysAllow ?? []), allowKey])].slice(0, 200)
    });
    // An exact read-shaped provider tool grant belongs to the bot, not only to
    // the conversation where the card appeared: a later task inherits it.
    if (allowKey.startsWith("provider-tool:")) {
      const owner = env.store.bot(bot.id);
      if (owner) env.store.patchBot(bot.id, { alwaysAllow: [...new Set([...(owner.alwaysAllow ?? []), allowKey])].slice(0, 200) });
    }
    const live = env.directTurnBots.get(bot.threadId);
    if (live) live.alwaysAllow = [...new Set([...(live.alwaysAllow ?? []), allowKey])].slice(0, 200);
    const updated = env.store.bot(bot.id)!;
    const visible = env.wireBot(updated);
    env.broadcast({ kind: "bot", bot: visible });
    env.json(env.res, 200, { bot: visible });
    return true;
  }
  return false;
}
