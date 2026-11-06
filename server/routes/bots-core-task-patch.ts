/**
 * PATCH /api/bots/:id/tasks/:threadId (#1388 B1).
 * Own match scratch. Never imports server/index.ts.
 */
import { cloudThreadRefusal } from "../cloud-thread-refusal.ts";
import { confidentialPatch } from "../threads/confidential-threads.ts";
import { MEMBER_AUTO_NOT_ALLOWED } from "../approvals/member-auto-approval.ts";
import { sessionPrincipal } from "../auth/request-auth.ts";
import { parseSurface } from "../surface.ts";
import { parseThreadOrganization } from "../threads/thread-folders.ts";

import { approvalModeFor, approvalModeWidens, liveApprovalChange, type ApprovalMode } from "../../shared/approval-mode.ts";
import type { ModelSelection } from "../../shared/model-selection.ts";
import { permissionRefusal } from "../../shared/permissions.ts";
import { threadLinkUrl } from "../../shared/thread-link.ts";

import { BOTS_READ_ONLY, MEMBER_BOT_FULL_ACCESS, type BotsCoreRouteDeps } from "./bots-core-deps.ts";
import { PASS, type RouteHandler } from "./table.ts";

export function createBotsCoreTaskPatchRoutes(deps: BotsCoreRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    const {
      store,
      wireTask,
      viewerForApproval,
      memberAutoRefused,
      checkedModelSelection,
      hostedModels,
      projectBotTranscript,
      publicBot,
      ownerSettingsForbidden,
      threadBusy,
      callerBotsReadOnly,
      orgFullAccessRefusalFor,
      approvalModeStepUpGate,
      ruleManager,
      supportsApprovalMode,
      makeThreadConfidential,
      privateFolderThread,
      liveCoordination,
      computerSelectionMoves,
      checkedTaskModelSwitch,
      auditApprovalModeChange,
      runningTurnLevels,
      applyStricterApprovalLive,
      stricterApprovalStopError,
      primaryAskedReplay,
      memberOwnedInOrg,
      localPrincipalId,
    } = deps;
    const IDENTITY = deps.identity;
    const DESKTOP_MANAGED = deps.desktopManaged;
    const FIXED_WORKSPACE_SEAM = deps.fixedWorkspaceSeam;
    let m: RegExpMatchArray | null = null;

    m = path.match(/^\/api\/bots\/([\w-]+)\/tasks\/([\w-]+)$/);
    if (m && method === "PATCH") {
      const body = await readBody(req);
      if (!body || typeof body !== "object" || Array.isArray(body)) return json(res, 400, { error: "body must be a JSON object" });
      const current = store.projectBotForTask(m[1], m[2]);
      if (!current) return json(res, 404, { error: "no such task" });
      const taskStepUp = body.stepUp;
      delete body.stepUp;
      const allowed = new Set(["title", "projectId", "modelSelection", "updateBotDefault", "approvalMode", "autoApprove", "requireAvailableModel", "pinnedMessageId", "acknowledgeLocalAuto", "confirmFullAccess", "archivedAt", "pinned", "snoozedUntil", "surface", "refreshPermissions", "link", "confidential", "confirmConfidential"]);
      if (Object.keys(body).some((key) => !allowed.has(key))) return json(res, 400, { error: "unsupported thread setting" });
      const notYours = cloudThreadRefusal(auth, m[2]);
      if (notYours) return json(res, 403, { error: notYours });
      // Confidential is one way (server/threads/confidential-threads.ts): on with the
      // person's confirmation that it is permanent, never off again.
      const confidentialChange = confidentialPatch(store.taskByThread(m[1], m[2]) ?? {}, body);
      if (confidentialChange.kind === "refused") {
        return json(res, confidentialChange.status, { error: confidentialChange.error, ...(confidentialChange.code ? { code: confidentialChange.code } : {}) });
      }
      delete body.confidential;
      delete body.confirmConfidential;
      if (confidentialChange.kind === "make") {
        if (threadBusy(current.id, current.threadId)) return json(res, 409, { error: "Stop this thread before making it confidential." });
        if (liveCoordination(current.threadId)) {
          return json(res, 409, { error: "Teammate work this thread is part of is still under way. Let it finish or stop it, then make the thread confidential.", code: "confidential_live_work" });
        }
        // A thread that already works in a shared folder (the bot's project
        // folder, a chosen one) cannot take its files back from there, and
        // its checkpoints live with that folder: it stays ordinary.
        if (!privateFolderThread(current.id, current.threadId)) {
          return json(res, 409, { error: "This thread already works in a shared folder, so its files cannot be kept to you. Open a new confidential thread instead.", code: "confidential_shared_folder" });
        }
        makeThreadConfidential(current.id, current.threadId);
        if (!Object.keys(body).length) {
          return json(res, 200, { task: wireTask(store.taskByThread(m[1], m[2])!, store.bot(m[1])!.modelSelection), bot: projectBotTranscript(publicBot(store.bot(m[1])!), viewerForApproval(auth)) });
        }
      }
      for (const key of ["requireAvailableModel", "acknowledgeLocalAuto", "confirmFullAccess", "updateBotDefault"] as const) {
        if (body[key] !== undefined && typeof body[key] !== "boolean") return json(res, 400, { error: `${key} must be a boolean` });
      }
      if (body.requireAvailableModel === true && body.modelSelection === undefined) return json(res, 400, { error: "requireAvailableModel requires modelSelection" });
      if (body.updateBotDefault === true && body.modelSelection === undefined) return json(res, 400, { error: "updateBotDefault requires modelSelection" });
      // updateBotDefault writes the bot's own model (switchTaskModel), which
      // is an edit. A thread-only model change leaves the flag off.
      if (body.updateBotDefault === true && callerBotsReadOnly(auth)) return json(res, 403, BOTS_READ_ONLY);
      if (body.updateBotDefault === true) {
        const refusal = ownerSettingsForbidden(auth, store.bot(m[1]) ?? current, { model: true });
        if (refusal) return json(res, 403, refusal);
      }
      if (body.refreshPermissions !== undefined && body.refreshPermissions !== true) {
        return json(res, 400, { error: "refreshPermissions must be true" });
      }
      if (body.refreshPermissions === true) {
        const extra = Object.keys(body).filter((key) => key !== "refreshPermissions" && key !== "acknowledgeLocalAuto");
        if (extra.length) return json(res, 400, { error: "refreshPermissions cannot be combined with other thread settings" });
        const profile = store.bot(m[1]);
        if (!profile) return json(res, 404, { error: "no such bot" });
        if (profile.approvalGrant) return json(res, 409, { error: "the bot's approval mode is still being confirmed" });
        if (threadBusy(profile.id, m[2])) return json(res, 409, { error: "stop this thread before changing its approval mode" });
        const nextMode = approvalModeFor({ ...profile, approvalGrant: undefined });
        // Full and Custom never travel over the bot-reachable HTTP surface.
        // The desktop's private channel copies those levels, and it is also
        // the only way to leave Custom.
        // #1674: on an organization server Full comes back to this thread as
        // the bot's owner grants it (orgFullGrant below): the same rule, no
        // desktop channel there.
        const orgFullRefresh = nextMode === "full" && IDENTITY.kind === "perspicax";
        if (orgFullRefresh) {
          if (callerBotsReadOnly(auth)) return json(res, 403, BOTS_READ_ONLY);
          const refusal = orgFullAccessRefusalFor(auth, profile, false);
          if (refusal) return json(res, refusal.status, { error: refusal.error, code: refusal.code, ...(refusal.permission ? permissionRefusal(refusal.permission) : {}) });
        }
        if (!orgFullRefresh && (nextMode === "full" || nextMode === "custom")) {
          return json(res, 403, { error: "Full access and Custom approval are turned on in the Sagax desktop app on the computer that runs this server" });
        }
        if (approvalModeFor(current) === "custom") {
          return json(res, 403, { error: "Leaving Custom approval requires the packaged desktop app" });
        }
        if (!supportsApprovalMode(current.modelSelection, nextMode)) {
          return json(res, 400, { error: "This provider does not support the selected approval level" });
        }
        if (nextMode === "auto" && current.computer === "local" && approvalModeFor(current) !== "auto" && body.acknowledgeLocalAuto !== true) {
          return json(res, 400, { error: "Auto mode on this computer requires confirming the warning first (acknowledgeLocalAuto)" });
        }
        const widensMode = approvalModeWidens(approvalModeFor(current), nextMode);
        const nextAllow = profile.alwaysAllow ?? [];
        const widensAllow = nextAllow.some((key) => !(current.alwaysAllow ?? []).includes(key));
        if (memberAutoRefused(current, [approvalModeFor(current)], nextMode)) return json(res, 403, MEMBER_AUTO_NOT_ALLOWED);
        // a refresh that widens needs the person's key, like the desktop channel
        const refreshStepUp = approvalModeStepUpGate({
          person: ruleManager(auth), botId: profile.id, op: "refresh", thread: m[2]!, froms: [approvalModeFor(current)], to: nextMode, stepUp: taskStepUp, widensAllow,
        });
        if (refreshStepUp) return json(res, refreshStepUp.status, refreshStepUp.body);
        if ((widensMode || widensAllow) && auth.kind === "loopback" && !DESKTOP_MANAGED && !req.headers.origin && store.bots.some((bot) => bot.busy)) {
          return json(res, 409, { error: "Change approval mode from the app or a paired device while bots are working." });
        }
        const task = store.refreshTaskPermissions(profile.id, m[2]);
        if (!task) return json(res, 404, { error: "no such task" });
        return json(res, 200, { task: wireTask(task, store.bot(profile.id)!.modelSelection), bot: publicBot(store.bot(profile.id)!) });
      }
      // Archive, snooze, pin and folder: the same rules as a group thread
      // (server/threads/thread-folders.ts).
      const organization = parseThreadOrganization(body, (projectId) => Boolean(store.project(current.id, projectId)), "projectId must belong to this bot, or null to ungroup the thread");
      if (!organization.ok) return json(res, 400, { error: organization.error });
      const patch: Record<string, unknown> = { ...organization.patch };
      let orgFullGrant = false;
      let fullConsentPrincipal: string | null = null;
      if (body.title !== undefined) {
        if (typeof body.title !== "string") return json(res, 400, { error: "title must be a string" });
        patch.title = body.title;
      }
      if (body.link !== undefined) {
        const link = body.link === null ? undefined : threadLinkUrl(body.link);
        if (link === null) return json(res, 400, { error: "link must be an http(s) address of at most 2048 characters, or null to remove it" });
        patch.link = link;
        patch.linkAuto = link ? undefined : false;
      }
      if (body.surface !== undefined) {
        // Workspace is always Auto (2026-10-18): a conversation is never
        // pinned to a place any more. An older app that still sends one gets
        // no error and no pin; the bot keeps choosing per task.
        if (body.surface !== null && !parseSurface(body.surface)) {
          return json(res, 400, { error: "surface must be cloud, vm, local, browser, or null to follow the bot" });
        }
        if (FIXED_WORKSPACE_SEAM) {
          if (threadBusy(current.id, current.threadId)) return json(res, 409, { error: "Stop this thread before changing its computer destination." });
          computerSelectionMoves.delete(current.threadId);
          patch.surface = body.surface === null ? undefined : parseSurface(body.surface);
          patch.surfaceSource = body.surface === null ? undefined : "user";
        }
      }
      if (body.pinnedMessageId !== undefined) {
        if (body.pinnedMessageId === null || body.pinnedMessageId === "") patch.pinnedMessageId = undefined;
        else if (typeof body.pinnedMessageId === "string" && store.messagesFor(current.threadId).some((message) => message.id === body.pinnedMessageId)) patch.pinnedMessageId = body.pinnedMessageId;
        else return json(res, 400, { error: "pinnedMessageId must belong to this thread" });
      }
      if (body.modelSelection !== undefined) {
        if (current.approvalGrant) return json(res, 409, { error: "the bot's approval mode is still being confirmed" });
        const checked = checkedModelSelection(body.modelSelection, { selection: current.modelSelection, busy: threadBusy(current.id, current.threadId) }, body.requireAvailableModel === true, sessionPrincipal(auth));
        if (!checked.ok) return json(res, checked.status, { error: checked.error });
        patch.modelSelection = checked.selection;
      }
      if (body.approvalMode !== undefined || body.autoApprove !== undefined) {
        if (body.autoApprove !== undefined && typeof body.autoApprove !== "boolean") return json(res, 400, { error: "autoApprove must be a boolean" });
        const mode = body.approvalMode ?? (body.autoApprove ? "auto" : "ask");
        // Organization server: the bot's owner, signed in, turns Full on
        // over HTTP while the organization allows it (org-full-access.ts).
        if (mode === "full" && IDENTITY.kind === "perspicax") {
          // The grant also stores fullAccessConsent on the bot. thread.post
          // is enough to reach this handler, so the read-only cap is here.
          if (callerBotsReadOnly(auth)) return json(res, 403, BOTS_READ_ONLY);
          const refusal = orgFullAccessRefusalFor(auth, current, body.confirmFullAccess === true);
          if (refusal) return json(res, refusal.status, { error: refusal.error, code: refusal.code, ...(refusal.permission ? permissionRefusal(refusal.permission) : {}) });
          orgFullGrant = true;
        }
        if (!orgFullGrant && (mode === "full" || mode === "custom") && memberOwnedInOrg(current)) return json(res, 409, MEMBER_BOT_FULL_ACCESS);
        // Full applies over HTTP like any other level (omb #2701). Custom
        // still needs the packaged desktop's private channel.
        if (!orgFullGrant && mode === "custom") return json(res, 403, { error: "Custom approval is turned on in the Sagax desktop app on the computer that runs this server" });
        if (approvalModeFor(current) === "custom") return json(res, 403, { error: "Leaving Custom approval requires confirmation in the packaged desktop app" });
        if (mode === "full" && !orgFullGrant) {
          // Solo (and any non-org path): record who set Full so new
          // conversations and turn-time checks see the same consent marker.
          fullConsentPrincipal = sessionPrincipal(auth)
            ?? (auth.kind === "loopback" && auth.trust !== "service" ? localPrincipalId().trim().toLowerCase() : null);
          if (fullConsentPrincipal) orgFullGrant = true;
        }
        if (!supportsApprovalMode((patch.modelSelection as ModelSelection | undefined) ?? current.modelSelection, mode as ApprovalMode)) {
          return json(res, 400, { error: "This provider does not support the selected approval level" });
        }
        if (threadBusy(current.id, current.threadId) && !primaryAskedReplay() && !liveApprovalChange(approvalModeFor(current), mode)) return json(res, 409, { error: "stop this thread before changing its approval mode" });
        if (current.approvalGrant) return json(res, 409, { error: "the bot's approval mode is still being confirmed" });
        if (mode === "auto" && approvalModeFor(current) !== "auto" && auth.kind === "loopback" && !DESKTOP_MANAGED && !req.headers.origin && store.bots.some((bot) => bot.busy)) {
          return json(res, 409, { error: "Change approval mode from the app or a paired device while bots are working." });
        }
        if (mode === "auto" && current.computer === "local" && approvalModeFor(current) !== "auto" && body.acknowledgeLocalAuto !== true) {
          return json(res, 400, { error: "Auto mode on this computer requires confirming the warning first (acknowledgeLocalAuto)" });
        }
        if (memberAutoRefused(current, [approvalModeFor(current)], mode)) return json(res, 403, MEMBER_AUTO_NOT_ALLOWED);
        const modeStepUp = approvalModeStepUpGate({ person: ruleManager(auth), botId: current.id, op: "thread", thread: m[2]!, froms: [approvalModeFor(current)], to: mode, stepUp: taskStepUp });
        if (modeStepUp) return json(res, modeStepUp.status, modeStepUp.body);
        patch.approvalMode = mode;
        patch.autoApprove = mode === "auto";
        if (orgFullGrant) patch.alwaysAllow = [];
      }
      if (patch.modelSelection) {
        const checked = checkedTaskModelSwitch({ ...current,
          ...(patch.approvalMode ? { approvalMode: patch.approvalMode, autoApprove: patch.autoApprove } : {}),
        }, patch.modelSelection, body.updateBotDefault === true, body.requireAvailableModel === true);
        if (!checked.ok) return json(res, checked.status, { error: checked.error });
      }
      const modeBefore = approvalModeFor(current);
      // #1373: what each running turn answers at before this change
      const liveApprovalBefore = patch.approvalMode && patch.approvalMode !== modeBefore
        && liveApprovalChange(modeBefore, patch.approvalMode as ApprovalMode) && threadBusy(current.id, current.threadId)
        ? runningTurnLevels(m[1]) : null;
      if (orgFullGrant) {
        const principalId = fullConsentPrincipal ?? sessionPrincipal(auth);
        if (principalId) store.patchBot(m[1], { fullAccessConsent: { principalId, at: Date.now() } });
      }
      const task = patch.modelSelection
        ? store.switchTaskModel(m[1], m[2], patch.modelSelection as ModelSelection, body.updateBotDefault === true,
          { ...patch, ...hostedModels?.resetTask?.(current.modelSelection, patch.modelSelection as ModelSelection) })!
        : store.patchTask(m[1], m[2], patch)!;
      if (patch.approvalMode) auditApprovalModeChange(auth, m[1], modeBefore, patch.approvalMode as ApprovalMode, m[2]);
      if (liveApprovalBefore) {
        try {
          await applyStricterApprovalLive(m[1], liveApprovalBefore);
        } catch (error) {
          return json(res, 409, { error: stricterApprovalStopError(error) });
        }
      }
      return json(res, 200, { task: wireTask(task, store.bot(m[1])!.modelSelection), bot: projectBotTranscript(publicBot(store.bot(m[1])!), viewerForApproval(auth)) });
    }
    return PASS;
  };
}
