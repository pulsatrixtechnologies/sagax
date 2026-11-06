// PATCH /api/bots/:id admission: host, org Full access, member field gates (#1383).
// Never imports server/index.ts.
import type { BotPatchState, BotsMutateEnv } from "./bots-mutate-helpers.ts";

export async function admitBotPatch(env: BotsMutateEnv, state: BotPatchState): Promise<boolean> {
  const { m } = state;
  const body = await env.readBody(env.req);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    env.json(env.res, 400, { error: "body must be a JSON object" });
    return true;
  }
  // A security key step-up rides along (server/auth/step-up-gate.ts); it is
  // never a bot field.
  const patchStepUp = body.stepUp;
  delete body.stepUp;
  const sharedSettings = env.ownerSettingsForbidden(env.auth, env.store.bot(m[1]), {
    model: Object.prototype.hasOwnProperty.call(body, "modelSelection"),
    notifications: Object.prototype.hasOwnProperty.call(body, "notifications")
  });
  if (sharedSettings) {
    env.json(env.res, 403, sharedSettings);
    return true;
  }
  // A paired phone reaches a personal server through the companion as
  // its owner, with the fields an owner may set from a phone (look,
  // framing, name, instructions, notifications, model, memory, and the
  // Permissions / Approval / Proactive / Access fields of Lot 1). Org
  // sharing and host fields stay off the phone.
  if (env.companionRequest(env.req, env.auth)) {
    const field = env.companionBotFieldViolation(body);
    if (field) {
      env.json(env.res, 403, { error: `forbidden: a phone may change a bot's name, look, instructions, notifications, model, memory, permissions and access, not "${field}"` });
      return true;
    }
  }
  if (Object.prototype.hasOwnProperty.call(body, "host")) {
    const target = env.store.bot(m[1]);
    if (!target) {
      env.json(env.res, 404, { error: "no such bot" });
      return true;
    }
    if (!env.maySetBotHost(env.auth, target)) {
      env.json(env.res, 403, { error: "Only the bot's owner or an editor can choose where it runs." });
      return true;
    }
    const assigned = env.assignBotHost({ callerUserId: env.channelActorId(env.auth), workers: env.registeredWorkers, host: (body as { host?: unknown }).host });
    if (!assigned.ok) {
      env.json(env.res, assigned.status, { error: assigned.error });
      return true;
    }
    const hosted = env.store.patchBot(target.id, {
      host: assigned.host,
      ...(assigned.model ? { modelSelection: assigned.model } : {})
    });
    if (!hosted) {
      env.json(env.res, 404, { error: "no such bot" });
      return true;
    }
    delete (body as { host?: unknown }).host;
    if (Object.keys(body).length === 0) {
      const visible = env.wireBot(env.store.bot(hosted.id)!);
      env.broadcast({ kind: "bot", bot: visible });
      env.json(env.res, 200, { bot: visible });
      return true;
    }
  }
  // Organization server: the bot's owner, signed in, turns Full on as
  // the bot's default (its new threads and routines) while the
  // organization allows it (org-full-access.ts). A request of its own:
  // nothing else rides along.
  if (env.IDENTITY.kind === "perspicax" && body.approvalMode === "full") {
    const target = env.store.bot(m[1]);
    if (!target) {
      env.json(env.res, 404, { error: "no such bot" });
      return true;
    }
    const parsedFull = env.parseOrgFullAccessBody(body as Record<string, unknown>);
    if ("error" in parsedFull) {
      env.json(env.res, 400, { error: parsedFull.error });
      return true;
    }
    // use may talk and rename a thread, not raise the bot. This branch
    // returns before the member field check, so the cap is applied here.
    if (env.callerBotsReadOnly(env.auth)) {
      env.json(env.res, 403, env.BOTS_READ_ONLY);
      return true;
    }
    const refusal = env.orgFullAccessRefusalFor(env.auth, target, parsedFull.confirm);
    if (refusal) {
      env.json(env.res, refusal.status, { error: refusal.error, code: refusal.code, ...("permission" in refusal ? env.permissionRefusal(refusal.permission) : {}) });
      return true;
    }
    if (target.busy && !env.primaryAskedReplay()) {
      env.json(env.res, 409, { error: "stop this bot's turn before changing its approval level" });
      return true;
    }
    if (target.approvalGrant) {
      env.json(env.res, 409, { error: "the bot's approval mode is still being confirmed" });
      return true;
    }
    // Full runs on every engine (omb #2808); no provider gate here.
    // The settings control shows the open conversation. The grant has to
    // land on that thread too, or the menu snaps back to the thread's
    // previous level while only the bot default changed. Only a thread
    // this caller is shown: never another member's conversation.
    const followTask = parsedFull.threadId ? env.store.taskByThread(target.id, parsedFull.threadId) : undefined;
    const followViewer = env.scopedThreadViewer() ?? env.sessionPrincipal(env.auth) ?? undefined;
    const follow = env.threadFollowsFullGrant({
      threadId: parsedFull.threadId,
      knownThread: Boolean(followTask) && env.threadsShownTo(target, [followTask!], followViewer).length === 1,
      threadBusy: Boolean(parsedFull.threadId && env.threadBusy(target.id, parsedFull.threadId))
    });
    const threadBefore = follow ? env.approvalModeFor(env.store.projectBotForTask(target.id, follow) ?? target) : undefined;
    // The key is asked against every level this grant loosens: the bot's
    // default and, when it follows, the thread's own.
    const fullStepUp = env.approvalModeStepUpGate({ person: env.ruleManager(env.auth), botId: target.id, op: "bot", thread: "*", froms: [env.approvalModeFor(target), ...(threadBefore ? [threadBefore] : [])], to: "full", stepUp: patchStepUp });
    if (fullStepUp) {
      env.json(env.res, fullStepUp.status, fullStepUp.body);
      return true;
    }
    const before = env.approvalModeFor(target);
    const updated = env.store.patchBot(target.id, {
      approvalMode: "full", autoApprove: false, alwaysAllow: [],
      fullAccessConsent: { principalId: env.sessionPrincipal(env.auth)!, at: Date.now() }
    }, { actorPrincipalId: env.sessionPrincipal(env.auth) })!;
    // #1169: every thread of the bot, hidden ones included, now follows
    // it to Full (store.patchBot), except a level another person chose
    // for their own conversation; the open one is recorded too.
    if (follow) {
      env.store.patchTask(updated.id, follow, { approvalOwn: undefined, alwaysAllow: [] });
      env.auditApprovalModeChange(env.auth, target.id, threadBefore!, "full", follow);
    }
    env.auditApprovalModeChange(env.auth, target.id, before, "full");
    const visible = env.wireBot(env.store.bot(updated.id)!);
    env.broadcast({ kind: "bot", bot: visible });
    env.json(env.res, 200, { bot: visible });
    return true;
  }
  if (env.auth.kind === "session" && !env.auth.scopes.includes("admin")) {
    const target = env.store.bot(m[1]);
    const own = Boolean(target && env.memberOwnsBot(env.auth, target));
    // A member asking Full or Custom for their own bot hits the org rule
    // first (S3-7): the answer is the same 409 an admin gets.
    if (
      own && target && env.memberOwnedInOrg(target) &&
      (body.approvalMode === "full" || body.approvalMode === "custom")
    ) {
      env.json(env.res, 409, env.MEMBER_BOT_FULL_ACCESS);
      return true;
    }
    // Slice 4: someone granted edit changes what the owner could as a
    // member (MEMBER_BOT_FIELDS); never the approval level or anything
    // that decides where or how far the bot runs.
    const editor = !own && Boolean(target) && env.IDENTITY.kind === "perspicax" && env.atLeast(env.viewerBotLevel(env.auth, target!), "edit");
    // 2026-10-09: the owner sets more with the permissions of their
    // profiles (BOT_FIELD_PERMISSIONS); an editor stays at MEMBER_BOT_FIELDS.
    if (own) {
      const refused = env.memberBotFieldRefusal(env.auth, body);
      if (refused?.permission) {
        env.json(env.res, 403, { ...env.permissionRefusal(refused.permission), field: refused.field });
        return true;
      }
    }
    const field = own ? env.memberBotFieldRefusal(env.auth, body)?.field ?? null : editor ? env.memberBotFieldViolation(body) : env.clientBotPatchViolation(body);
    if (field) {
      env.json(env.res, 403, {
        error: own || editor
          ? `forbidden: a member may change their bot's name, look, instructions and model, not "${field}"`
          : `forbidden: this session may change how a bot looks, not "${field}" (needs the admin scope)`
      });
      return true;
    }
    if (!own && !editor && target && env.botEditsNeedOwner(env.auth) && Object.keys(body).some((key: any) => key === "color" || key.startsWith("mascot") || key.startsWith("avatar"))) {
      env.json(env.res, 403, { error: "forbidden: only the bot owner can change how it looks", code: "bot_look_owner_only" });
      return true;
    }
  }
  state.body = body;
  state.patchStepUp = patchStepUp;
  return false;
}
