/**
 * POST /api/bots/:id/tasks and POST /api/bots/:id/tasks/:threadId (#1388 B1).
 * Own match scratch. The collection path is matched before the thread path.
 * Never imports server/index.ts.
 */
import { validateBotCwdFor } from "../bots/bot-cwd.ts";
import { newThreadConfidential } from "../threads/confidential-threads.ts";
import { newConversationFullAllowed } from "../org/org-full-access.ts";
import { isPrincipalId } from "../auth/principals.ts";
import { sessionPrincipal } from "../auth/request-auth.ts";

import { BOT_FIELD_PERMISSIONS, permissionRefusal } from "../../shared/permissions.ts";

import { MEMBER_BOT_FULL_ACCESS, type BotsCoreRouteDeps } from "./bots-core-deps.ts";
import { PASS, type RouteHandler } from "./table.ts";

export function createBotsCoreTasksRoutes(deps: BotsCoreRouteDeps): RouteHandler {
  return async ({ req, res, url, path, method, auth, json, readBody }) => {
    const {
      store,
      pageSize,
      threadsWithActiveCoordination,
      wireBot,
      listedTasks,
      wireTask,
      messagePage,
      viewerForApproval,
      memberFolderRefusal,
      memberFolderPrincipal,
      projectBotTranscript,
      publicBot,
      viewerBotLevel,
      effectiveBotOwner,
      ownerOrAdminOf,
      phoneSecretSubmissions,
      callerCan,
      terminalPrincipalId,
      remoteSessions,
      callerBotsReadOnly,
      orgFullAccessRefusalFor,
      localPrincipalId,
      sharedWorkspaceFullAccessEnabled,
      approvalModeStepUpGate,
      ruleManager,
      confidentialThreadsByDefault,
      scopedThreadViewer,
      conversationThreadFor,
      selectViewerThread,
      noteStreamSend,
      refreshStreamDigests,
      actorKey,
      threadStarters,
      memberOwnedInOrg,
    } = deps;
    const IDENTITY = deps.identity;
    let m: RegExpMatchArray | null = null;

    m = path.match(/^\/api\/bots\/([\w-]+)\/tasks$/);
    if (m && method === "POST") {
      const body = await readBody(req);
      if (!body || typeof body !== "object" || Array.isArray(body)) return json(res, 400, { error: "body must be a JSON object" });
      const bot = store.bot(m[1]);
      if (!bot) return json(res, 404, { error: "no such bot" });
      let cwd: string | undefined;
      if (body.cwd !== undefined) {
        // Opening a conversation is client-scoped, choosing where its file
        // tools run has the same authority as editing the bot's folder: an
        // admin, or on an organization server the bot's owner holding the
        // folder permission (folders.botWorkingFolder, the PATCH rule).
        const folderPermission = BOT_FIELD_PERMISSIONS.cwd!;
        if (!auth.scopes.includes("admin") && !(IDENTITY.kind === "perspicax" && ownerOrAdminOf(auth, bot) && callerCan(auth, folderPermission))) {
          return json(res, 403, { error: "Choosing a working folder needs the right to choose your bots' working folder.", ...(IDENTITY.kind === "perspicax" ? permissionRefusal(folderPermission) : {}) });
        }
        const checked = await validateBotCwdFor(body.cwd, { principalId: terminalPrincipalId(auth), botId: bot.id, sessions: remoteSessions });
        if (!checked.ok) return json(res, 400, { error: checked.error });
        if (!checked.cwd) return json(res, 400, { error: "Choose an existing working folder, or omit cwd to use the bot's default" });
        const outside = checked.remote ? null : memberFolderRefusal(memberFolderPrincipal(auth), checked.cwd);
        if (outside) return json(res, 403, { ...outside, field: "cwd" });
        cwd = checked.cwd;
      }
      if (body.approvalMode !== undefined && body.approvalMode !== "ask" && body.approvalMode !== "full") {
        return json(res, 400, { error: "new task approvalMode must be ask or full" });
      }
      if (body.approvalMode === "full") {
        // 2026-10-27 (#1098): the bot's owner who already confirmed Full
        // access for this bot opens a new conversation on Full, from any of
        // their apps: on an organization server the signed-in owner holding
        // that confirmation, on a solo server the operator (this computer or
        // one of their admin devices) once the desktop app confirmed it.
        const ownerConfirmedFull = (IDENTITY.kind !== "perspicax" || (!callerBotsReadOnly(auth) && orgFullAccessRefusalFor(auth, bot, false) === null))
          && newConversationFullAllowed({
            identity: IDENTITY.kind,
            callerPrincipalId: sessionPrincipal(auth),
            ownerPrincipalId: effectiveBotOwner(bot),
            soloOwner: (auth.kind === "loopback" && auth.trust !== "service") || (auth.kind === "session" && auth.scopes.includes("admin")),
            localPrincipalId: localPrincipalId().trim().toLowerCase(),
            consent: bot.fullAccessConsent,
          });
        if (!ownerConfirmedFull && memberOwnedInOrg(bot)) return json(res, 409, MEMBER_BOT_FULL_ACCESS);
        if (!ownerConfirmedFull && (auth.kind !== "loopback" || !sharedWorkspaceFullAccessEnabled())) {
          return json(res, 403, { error: "New Full tasks require the operator's dedicated shared-workspace policy" });
        }
        if (bot.approvalGrant) return json(res, 409, { error: "the bot's approval mode is still being confirmed" });
        // Full runs on every engine (omb #2808); no provider gate here.
        const fullStepUp = approvalModeStepUpGate({ person: ruleManager(auth), botId: bot.id, op: "new-task", thread: "*", froms: ["ask"], to: "full", stepUp: body.stepUp });
        if (fullStepUp) return json(res, fullStepUp.status, fullStepUp.body);
      }
      if (phoneSecretSubmissions.hasBot(bot.id)) {
        return json(res, 409, { error: "this bot is securely saving a credential — try again when it finishes" });
      }
      if (body.projectId !== undefined && (typeof body.projectId !== "string" || !store.project(bot.id, body.projectId))) {
        return json(res, 400, { error: "projectId must belong to this bot" });
      }
      if (body.hidden !== undefined && body.hidden !== true) return json(res, 400, { error: "hidden must be true when given" });
      if (body.stream !== undefined && typeof body.stream !== "boolean") return json(res, 400, { error: "stream must be a boolean when given" });
      // #1170: `hidden` (an older AI client's hidden conversation, #291) is
      // accepted and ignored: no conversation is hidden from its person any
      // more. Still started beside the person's chat, never selected, so
      // nothing on their screens moves to it.
      const startedAside = body.hidden === true;
      const hidden = false;
      // A confidential thread (server/threads/confidential-threads.ts): the person's
      // choice, else the organization's default. Its files stay in its own
      // folder, so no other working folder is taken with it.
      const confidentialChoice = newThreadConfidential(body.confidential, confidentialThreadsByDefault());
      if (!confidentialChoice.ok) return json(res, 400, { error: confidentialChoice.error });
      if (confidentialChoice.confidential && cwd !== undefined) {
        return json(res, 400, { error: "A confidential thread works in its own folder: omit cwd", code: "confidential_thread" });
      }
      // Organization server: the new thread is its creator's, and only their
      // selection moves (the bot's own selection is its owner's).
      const creator = scopedThreadViewer();
      // "New topic" over a conversation nobody wrote in yet: that one already
      // is a new topic (no empty segments pile up, on any device).
      if (body.stream === true && !hidden && !confidentialChoice.confidential && cwd === undefined) {
        const current = conversationThreadFor(bot, creator);
        const task = current ? store.taskByThread(bot.id, current) : undefined;
        if (task && store.messagesFor(task.threadId).length === 0) {
          if (creator) selectViewerThread(bot.id, creator, task.threadId);
          if ((!creator || viewerBotLevel(auth, bot) === "owner") && bot.threadId !== task.threadId) store.switchTask(bot.id, task.threadId);
          const same = publicBot(store.projectBotForTask(bot.id, task.threadId) ?? store.bot(bot.id)!);
          return json(res, 200, { bot: projectBotTranscript(same, viewerForApproval(auth)), task: wireTask(task, store.bot(bot.id)!.modelSelection) });
        }
      }
      const ownerCreates = !creator || viewerBotLevel(auth, bot) === "owner";
      const task = store.createTask(bot.id, typeof body.title === "string" ? body.title : undefined, ownerCreates && !startedAside, body.projectId, undefined, body.approvalMode, creator && isPrincipalId(creator) ? creator : undefined, undefined, hidden, cwd, confidentialChoice.confidential);
      if (!task) return json(res, 500, { error: "couldn't create that task" });
      // #4200: a new conversation runs at its bot's level. The auto-review
      // default no longer writes a level of its own on it (that wrote Approve
      // for me on conversations of a bot set to Full access).
      if (creator && !startedAside) selectViewerThread(bot.id, creator, task.threadId);
      // "New topic" in a single stream (threads off): a stream segment from
      // the start, and the topic it closes gets its digest written now, in
      // the background, while the person types (server/streams/single-stream.ts).
      if (body.stream === true && !hidden && !confidentialChoice.confidential) {
        noteStreamSend(bot.id, task.threadId, true);
        refreshStreamDigests(bot.id, task.threadId);
      }
      // Who opened it decides who may answer its cards on a shared workspace.
      if (auth.kind === "session") threadStarters.set(task.threadId, actorKey(auth));
      // A non-owner's new thread is not the bot's selection: answer with
      // the bot as seen from that thread.
      const fresh = publicBot(ownerCreates && !startedAside ? store.bot(bot.id)! : store.projectBotForTask(bot.id, task.threadId) ?? store.bot(bot.id)!);
      return json(res, 201, { bot: projectBotTranscript(fresh, viewerForApproval(auth)), task: wireTask(store.taskByThread(bot.id, task.threadId) ?? task, store.bot(bot.id)!.modelSelection) });
    }
    m = path.match(/^\/api\/bots\/([\w-]+)\/tasks\/([\w-]+)$/);
    if (m && method === "POST") {
      const bot = store.bot(m[1]);
      if (!bot) return json(res, 404, { error: "no such bot" });
      if (phoneSecretSubmissions.hasBot(bot.id)) {
        return json(res, 409, { error: "this bot is securely saving a credential — try again when it finishes" });
      }
      // Navigation only: execution owns its thread, never this selected id.
      const requestedMessages = url.searchParams.get("messages");
      const switchLimit = pageSize(requestedMessages);
      if (switchLimit === null) return json(res, 400, { error: "messages must be a non-negative whole number" });
      // Organization server: the gate already refused a thread that is not
      // the caller's; switching moves the caller's selection, and the bot's
      // own only for its owner.
      const switcher = scopedThreadViewer();
      if (switcher && store.taskByThread(bot.id, m[2])) selectViewerThread(bot.id, switcher, m[2]);
      const switched = switcher && viewerBotLevel(auth, bot) !== "owner"
        ? store.projectBotForTask(bot.id, m[2])
        : store.switchTask(bot.id, m[2]);
      if (!switched) return json(res, 404, { error: "no such task" });
      const switchCoordinated = threadsWithActiveCoordination();
      const switchedSettings = { ...wireBot(switched), tasks: listedTasks(switched.threadId, store.tasks(switched.id)).map((task) => wireTask(task, switched.modelSelection, switchCoordinated)) };
      // "0" is settings only, a positive page is a bounded transcript, and no
      // parameter is the whole thread — the one branch that materialises it.
      // Search results land through that branch (src/lib/focus-message.ts):
      // the hit can be older than one page.
      const responseBot = requestedMessages === "0"
        ? switchedSettings
        : projectBotTranscript({ ...switchedSettings, ...messagePage(switched.threadId, switchLimit, null, viewerForApproval(auth)) }, viewerForApproval(auth));
      return json(res, 200, { bot: responseBot });
    }
    return PASS;
  };
}
