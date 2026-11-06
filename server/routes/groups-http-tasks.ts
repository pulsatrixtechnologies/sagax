// POST /api/groups/:id/tasks, POST /api/groups/:id/tasks/:taskId, PATCH /api/groups/:id/tasks/:taskId, DELETE /api/groups/:id/tasks/:taskId (#1383). Each handler matches its own path and returns PASS otherwise.
import { z } from "zod";
import { cloudThreadRefusal } from "../cloud-thread-refusal.ts";
import { parseConversationTurnTimeout } from "../rooms/room-turn-timeout.ts";
import { parseThreadOrganization } from "../threads/thread-folders.ts";
import type { GroupsHttpDeps, GroupsHttpScratch } from "./groups-http-types.ts";
import { PASS, type RouteContext } from "./table.ts";

const createGroupTaskRequestSchema = z.object({
  title: z.string().optional(),
  projectId: z.string().regex(/^[\w-]+$/).optional(),
});
export async function postGroupTasks(deps: GroupsHttpDeps, ctx: RouteContext, _scratch: GroupsHttpScratch): Promise<typeof PASS | void> {
  const {
    req,
    res,
    path,
    method,
    auth,
    json,
    readBody,
  } = ctx;
  const {
    store,
    peopleDmProjection,
    groupReaderId,
    phoneHasGroup,
    peopleDmSetSelection,
    recordThreadStarter,
    defaultPage,
    viewerForApproval,
    actorKey,
    projectGroupTranscript,
    groupWithThread,
  } = deps;
  const m = path.match(/^\/api\/groups\/([\w-]+)\/tasks$/);
  if (!(m && method === "POST")) return PASS;
  const body = await readBody(req);
  const group = store.group(m[1]);
  if (!group) return json(res, 404, { error: "no such channel" });
  if (group.dm) return json(res, 400, { error: "bot-to-bot channels keep one canonical conversation" });
  // Navigation and thread creation stay unblocked while other threads work
  if (phoneHasGroup(group.id)) {
    return json(res, 409, { error: "this channel is securely saving a credential — try again when it finishes" });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json(res, 400, { error: "body must be a JSON object" });
  }
  const request = createGroupTaskRequestSchema.safeParse(body);
  if (!request.success) return json(res, 400, { error: "title must be text" });
  // A person conversation: a new thread is the pair's, opened by the
  // person who made it; the default thread (what a client from before
  // threads reads) does not move.
  if (group.peopleDm) {
    if (request.data.projectId !== undefined && !store.groupProject(group.id, request.data.projectId)) {
      return json(res, 400, { error: "projectId must be one of this conversation's folders" });
    }
    const made = store.createGroupTask(group.id, request.data.title, false, request.data.projectId);
    if (!made) return json(res, 500, { error: "couldn't create that thread" });
    const person = groupReaderId(auth);
    peopleDmSetSelection(group.id, person, made.threadId);
    return json(res, 201, { group: peopleDmProjection(store.group(group.id)!, person, true, { limit: defaultPage, viewer: viewerForApproval(auth) }), task: made });
  }
  const task = store.createGroupTask(group.id, request.data.title);
  if (!task) return json(res, 500, { error: "couldn't create that task" });
  // Who opened it decides who may answer its cards on a shared workspace.
  if (auth.kind === "session") recordThreadStarter(task.threadId, actorKey(auth));
  return json(res, 201, { group: projectGroupTranscript(groupWithThread(store.group(group.id)!), viewerForApproval(auth)), task });
}

export async function postGroupTask(deps: GroupsHttpDeps, ctx: RouteContext, _scratch: GroupsHttpScratch): Promise<typeof PASS | void> {
  const {
    req,
    res,
    url,
    path,
    method,
    auth,
    json,
  } = ctx;
  const {
    store,
    peopleDmProjection,
    groupReaderId,
    knowsPersonThreads,
    publicGroupState,
    phoneHasGroup,
    peopleDmSetSelection,
    viewerForApproval,
    projectGroupTranscript,
    pageSize,
    messagePage,
  } = deps;
  const m = path.match(/^\/api\/groups\/([\w-]+)\/tasks\/([\w-]+)$/);
  if (!(m && method === "POST")) return PASS;
  const group = store.group(m[1]);
  if (!group) return json(res, 404, { error: "no such channel" });
  if (group.dm) return json(res, 400, { error: "bot-to-bot channels keep one canonical conversation" });
  if (phoneHasGroup(group.id)) {
    return json(res, 409, { error: "this channel is securely saving a credential — try again when it finishes" });
  }
  // Navigation between tasks is always allowed
  // Parsed before the switch: a rejected parameter must not leave the
  // channel pointing at another thread.
  const requestedMessages = url.searchParams.get("messages");
  const switchLimit = pageSize(requestedMessages);
  if (switchLimit === null) return json(res, 400, { error: "messages must be a non-negative whole number" });
  // A person conversation: switching opens the thread for the person
  // switching only; the other person and the default thread stay.
  if (group.peopleDm) {
    if (!store.groupTaskByThread(group.id, m[2])) return json(res, 404, { error: "no such thread" });
    const person = groupReaderId(auth);
    // A client from before threads stays on the default thread: its
    // live frames would name that one and its sends follow its own pick.
    const knows = knowsPersonThreads(req);
    if (knows) peopleDmSetSelection(group.id, person, m[2]);
    const view = peopleDmProjection(group, person, knows, requestedMessages === "0" ? undefined : { limit: switchLimit, viewer: viewerForApproval(auth) });
    return json(res, 200, { group: view });
  }
  const switched = store.switchGroupTask(group.id, m[2]);
  if (!switched) return json(res, 404, { error: "no such channel task" });
  const switchedSettings = publicGroupState(switched);
  // "0" predates paging and means settings only — no `messages` key at
  // all, which clients tell apart from an empty page. A positive page is
  // the transcript a client can actually hold; omitting the parameter
  // keeps the whole transcript, as it always did — and only that branch
  // materialises it.
  const approvalViewer = viewerForApproval(auth);
  const responseGroup = requestedMessages === "0"
    ? switchedSettings
    : projectGroupTranscript({ ...switchedSettings, ...messagePage(switched.threadId, switchLimit, null, approvalViewer) }, approvalViewer);
  return json(res, 200, { group: responseGroup });
}

export async function patchGroupTask(deps: GroupsHttpDeps, ctx: RouteContext, _scratch: GroupsHttpScratch): Promise<typeof PASS | void> {
  const {
    req,
    res,
    path,
    method,
    auth,
    json,
    readBody,
  } = ctx;
  const { store, groupThreadIsWorking } = deps;
  const m = path.match(/^\/api\/groups\/([\w-]+)\/tasks\/([\w-]+)$/);
  if (!(m && method === "PATCH")) return PASS;
  const body = await readBody(req);
  const group = store.group(m[1]);
  if (!group) return json(res, 404, { error: "no such channel" });
  if (group.dm) return json(res, 400, { error: "bot-to-bot channels keep one canonical conversation" });
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json(res, 400, { error: "body must be a JSON object" });
  }
  // Archive, snooze and folder are a bot thread's too (server/threads/thread-folders.ts).
  const allowed = new Set(["title", "pinned", "turnTimeoutMinutes", "archivedAt", "snoozedUntil", "projectId"]);
  if (Object.keys(body).some((key) => !allowed.has(key))) return json(res, 400, { error: "unsupported channel thread setting" });
  // A person conversation has no turns, so no turn limit.
  if (group.peopleDm && Object.prototype.hasOwnProperty.call(body, "turnTimeoutMinutes")) return json(res, 400, { error: "a conversation between two people has no turn limit", code: "people_dm" });
  const existing = store.groupTaskByThread(group.id, m[2]);
  if (!existing) return json(res, 404, { error: "no such channel task" });
  const organization = parseThreadOrganization(body, (projectId) => Boolean(store.groupProject(group.id, projectId)));
  if (!organization.ok) return json(res, 400, { error: organization.error });
  const { pinned: _pinnedField, ...organizing } = organization.patch;
  const filing = Object.keys(organizing).length > 0;
  const pinning = body.pinned !== undefined;
  const renaming = body.title !== undefined;
  const limiting = Object.prototype.hasOwnProperty.call(body, "turnTimeoutMinutes");
  if (!pinning && !renaming && !limiting && !filing) return json(res, 400, { error: "unsupported channel thread setting" });
  if (pinning && typeof body.pinned !== "boolean") return json(res, 400, { error: "pinned must be a boolean" });
  if (renaming && typeof body.title !== "string") return json(res, 400, { error: "title must be a string" });
  const parsedLimit = limiting ? parseConversationTurnTimeout(body.turnTimeoutMinutes) : null;
  if (parsedLimit && !parsedLimit.ok) return json(res, 400, { error: parsedLimit.error });
  // Echoing the current title lets a newer client pin on an older server
  // without the old handler turning a missing title into "Untitled".
  // That echo is not a rename. A real rename stays blocked while working.
  const titleChange = renaming && body.title !== existing.title;
  const notYours = titleChange ? cloudThreadRefusal(auth, m[2]) : null;
  if (notYours) return json(res, 403, { error: notYours });
  // A longer limit applies to the next turn, so it can be saved while
  // this one is still running. A rename still waits.
  if (titleChange && groupThreadIsWorking(group.id, m[2])) {
    return json(res, 409, { error: "this task is running — stop it first" });
  }
  let task = existing;
  if (filing) {
    const filed = store.patchGroupTask(group.id, m[2], organizing);
    if (!filed) return json(res, 404, { error: "no such channel task" });
    task = filed;
  }
  if (limiting && parsedLimit?.ok) {
    const limited = store.setGroupTaskTurnTimeout(group.id, m[2], parsedLimit.minutes);
    if (!limited) return json(res, 404, { error: "no such channel task" });
    task = limited;
  }
  if (pinning) {
    const pinned = store.setGroupTaskPinned(group.id, m[2], body.pinned === true);
    if (!pinned) return json(res, 404, { error: "no such channel task" });
    task = pinned;
  }
  if (titleChange) {
    const renamed = store.renameGroupTask(group.id, m[2], body.title);
    if (!renamed) return json(res, 404, { error: "no such channel task" });
    task = renamed;
  }
  return json(res, 200, { task });
}

export async function deleteGroupTask(deps: GroupsHttpDeps, ctx: RouteContext, _scratch: GroupsHttpScratch): Promise<typeof PASS | void> {
  const {
    res,
    path,
    method,
    auth,
    json,
  } = ctx;
  const {
    store,
    peopleDmProjection,
    groupReaderId,
    phoneHasThread,
    peopleDmForgetThread,
    defaultPage,
    viewerForApproval,
    projectGroupTranscript,
    groupWithThread,
    groupThreadIsWorking,
    stagedSkillCleanupsForThread,
    clearLastReply,
    cancelTeamSetupResumesForThread,
    clearTurnDigestState,
    revokeInternalCapabilitiesForThread,
    rejectDeletedThreadSkillStages,
  } = deps;
  const m = path.match(/^\/api\/groups\/([\w-]+)\/tasks\/([\w-]+)$/);
  if (!(m && method === "DELETE")) return PASS;
  const group = store.group(m[1]);
  if (!group) return json(res, 404, { error: "no such channel" });
  if (group.dm) return json(res, 400, { error: "bot-to-bot channels keep one canonical conversation" });
  if (phoneHasThread(m[2])) {
    return json(res, 409, { error: "this task is securely saving a credential — try again when it finishes" });
  }
  if (groupThreadIsWorking(group.id, m[2])) {
    return json(res, 409, { error: "this task is running — stop it first" });
  }
  if (!store.groupTaskByThread(group.id, m[2])) return json(res, 404, { error: "no such channel task" });
  const notYours = cloudThreadRefusal(auth, m[2]);
  if (notYours) return json(res, 403, { error: notYours });
  const stagedSkillCleanups = stagedSkillCleanupsForThread(m[2]);
  clearLastReply(m[2]);
  cancelTeamSetupResumesForThread(m[2]);
  const updated = store.deleteGroupTask(group.id, m[2]);
  if (!updated) return json(res, 400, { error: "a channel keeps at least one task" });
  clearTurnDigestState(m[2]);
  revokeInternalCapabilitiesForThread(m[2]);
  rejectDeletedThreadSkillStages(stagedSkillCleanups);
  if (updated.peopleDm) {
    peopleDmForgetThread(m[2]);
    return json(res, 200, { group: peopleDmProjection(updated, groupReaderId(auth), true, { limit: defaultPage, viewer: viewerForApproval(auth) }) });
  }
  return json(res, 200, { group: projectGroupTranscript(groupWithThread(updated), viewerForApproval(auth)) });
}
