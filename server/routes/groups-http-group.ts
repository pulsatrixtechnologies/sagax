// PATCH /api/groups/:id, POST /api/groups/:id/leave, POST /api/groups/:id/read, DELETE /api/groups/:id (#1383). Each handler matches its own path and returns PASS otherwise.
import { permissionRefusal } from "../../shared/permissions.ts";
import { clientGroupPatchViolation } from "../auth/request-auth.ts";
import { validateBotCwd } from "../bots/bot-cwd.ts";
import { cloudThreadRefusal } from "../cloud-thread-refusal.ts";
import { groupLeftLine, planGroupLeave } from "../groups/group-leave.ts";
import { groupPatchOwnerRefusal, mayDeleteGroup } from "../groups/group-ownership.ts";
import { deleteGroupMemory } from "../memory/group-memory.ts";
import { peopleDmForViewer, peopleDmPatchRefusal, peopleDmThreadUnreadPatch, peopleDmUnreadPatch } from "../people/people-dms.ts";
import { personDisplayName } from "../people/viewer-identity.ts";
import { channelViewerId } from "../rooms/channel-visibility.ts";
import { roomMentionReadPatch } from "../rooms/room-mentions.ts";
import { sectionKey } from "../store.ts";
import type { GroupsHttpDeps, GroupsHttpScratch } from "./groups-http-types.ts";
import { PASS, type RouteContext } from "./table.ts";

export async function patchGroup(deps: GroupsHttpDeps, ctx: RouteContext, _scratch: GroupsHttpScratch): Promise<typeof PASS | void> {
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
    knowsPersonThreads,
    publicGroupState,
    refusePlacedBots,
    isPerspicax,
    refuseHumanEdit,
    groupOwnerRuleApplies,
    groupActor,
    effectiveBotOwner,
    companionRequest,
    callerCan,
    roomSectionMoveRefusal,
    recordRoomMove,
    updateChannel,
    memberFolderRefusal,
    memberFolderPrincipal,
    broadcast,
  } = deps;
  const m = path.match(/^\/api\/groups\/([\w-]+)$/);
  if (!(m && method === "PATCH")) return PASS;
  const body = await readBody(req);
  const existingGroup = store.group(m[1]);
  if (existingGroup?.peopleDm) {
    const field = peopleDmPatchRefusal(body);
    if (field) return json(res, 400, { error: `a conversation between two people cannot change "${field}"`, code: "people_dm" });
    // read or unread for the person marking it only
    const reader = groupReaderId(auth);
    if (reader && body && typeof body === "object" && typeof (body as { unread?: unknown }).unread === "boolean") {
      const { unread, ...rest } = body as { unread: boolean };
      // Marked read: every thread is read for them. Marked unread: the
      // conversation is (its row's dot), as before threads.
      let marked = store.patchGroup(existingGroup.id, unread ? peopleDmUnreadPatch(existingGroup, reader, true) : peopleDmThreadUnreadPatch(existingGroup, reader, false));
      if (marked && Object.keys(rest).length > 0) marked = updateChannel(existingGroup.id, rest);
      if (!marked) return json(res, 404, { error: "no such room" });
      broadcast({ kind: "group", group: publicGroupState(marked) });
      return json(res, 200, { group: peopleDmProjection(marked, reader, knowsPersonThreads(req)) });
    }
  }
  // A bot-to-bot dm keeps its existing member refusal. Placement checks
  // apply only when this patch adds a bot to a channel.
  if (existingGroup && !existingGroup.dm && Array.isArray(body?.memberIds)) {
    const placed = refusePlacedBots(auth, body.memberIds, new Set(existingGroup.memberIds));
    if (placed) return json(res, 403, { error: placed, code: "bot_place_owner_only" });
  }
  // Organization server: only the group's owner changes its settings;
  // anyone listed may still leave it (server/groups/group-ownership.ts).
  const ownerRule = Boolean(existingGroup && !existingGroup.dm && groupOwnerRuleApplies(auth));
  if (existingGroup && ownerRule) {
    const refusal = groupPatchOwnerRefusal(existingGroup, body, groupActor(auth), (botId) => {
      const bot = store.bot(botId);
      return bot ? effectiveBotOwner(bot) : undefined;
    });
    if (refusal) return json(res, 403, { error: refusal, code: "not_group_owner" });
  }
  const humans = refuseHumanEdit(auth, body, existingGroup?.humanIds ?? [], ownerRule);
  if (humans) { const code = humans.startsWith("unknown team") ? "unknown_team" : humans.startsWith("unknown person") ? "unknown_person" : "not_channel_editor"; return json(res, code === "not_channel_editor" ? 403 : 400, { error: humans, code }); }
  // A paired phone's companion edits a room like a member session does.
  if ((auth.kind === "session" && !auth.scopes.includes("admin")) || companionRequest(req, auth)) {
    // The owner of an organization group also picks its default responder,
    // and its working folder with folders.roomWorkingFolder (2026-10-09).
    const folder = ownerRule && isPerspicax && callerCan(auth, "folders.roomWorkingFolder");
    const field = clientGroupPatchViolation(body, ownerRule ? ["defaultResponder", "mentionAll", ...(folder ? ["cwd"] : [])] : []);
    if (field === "cwd" && ownerRule && isPerspicax) return json(res, 403, { ...permissionRefusal("folders.roomWorkingFolder"), field });
    if (field) return json(res, 403, { error: `forbidden: this session may rename or mark a room, not change "${field}" (needs the admin scope)` });
  }
  const movesSection = existingGroup && body && typeof body === "object" && !Array.isArray(body) && "section" in body;
  if (movesSection) {
    const refusal = roomSectionMoveRefusal(auth, existingGroup, (body as { section?: unknown }).section);
    if (refusal) return json(res, 403, { error: refusal, code: "not_allowed" });
  }
  const fromSection = sectionKey(existingGroup?.section);
  // On a Cloud home a room's name and bulletin are its opener's (or the owner's).
  const renamed = store.group(m[1]);
  if (renamed && body && typeof body === "object" &&
    ((body.name !== undefined && body.name !== renamed.name) || (body.bulletin !== undefined && body.bulletin !== (renamed.bulletin ?? "")))) {
    const notYours = cloudThreadRefusal(auth, renamed.threadId);
    if (notYours) return json(res, 403, { error: notYours });
  }
  // #1098 (isolation): a member's room folder stays in their own roots
  const roomFolder = (body as { cwd?: unknown } | null)?.cwd;
  if (typeof roomFolder === "string" && roomFolder.trim()) {
    const checkedRoom = validateBotCwd(roomFolder);
    const outside = checkedRoom.ok ? memberFolderRefusal(memberFolderPrincipal(auth), checkedRoom.cwd) : null;
    if (outside) return json(res, 403, { ...outside, field: "cwd" });
  }
  const fromSectionId = typeof existingGroup?.sectionId === "string" ? existingGroup.sectionId : undefined;
  let group = updateChannel(m[1], body);
  if (movesSection) {
    const toSectionId = typeof group.sectionId === "string" ? group.sectionId : undefined;
    recordRoomMove(group.id, fromSection, sectionKey(group.section), fromSectionId, toSectionId);
  }
  // A room marked read by a person reads their @ tag too (server/rooms/room-mentions.ts).
  const reader = groupReaderId(auth);
  if ((body as { unread?: unknown } | null)?.unread === false) {
    const mentionRead = roomMentionReadPatch(group, reader);
    if ("unreadFor" in mentionRead) group = store.patchGroup(group.id, mentionRead) ?? group;
  }
  return json(res, 200, { group: peopleDmForViewer(publicGroupState(group), reader) });
}

export async function postGroupLeave(deps: GroupsHttpDeps, ctx: RouteContext, _scratch: GroupsHttpScratch): Promise<typeof PASS | void> {
  // #1480: a person leaves a group they were added to, on their own. Only
  // their own membership: the session names who leaves, never the body.

  const {
    res,
    path,
    method,
    auth,
    json,
  } = ctx;
  const {
    store,
    groupVisible,
    phoneHasGroup,
    groupActor,
    effectiveBotOwner,
    botGrants,
    principalById,
    channelTurnOpen,
    failTurnIfMemberLeft,
    broadcast,
  } = deps;
  const m = path.match(/^\/api\/groups\/([\w-]+)\/leave$/);
  if (!(m && method === "POST")) return PASS;
  const group = store.group(m[1]);
  if (!group || !groupVisible(group, channelViewerId(auth))) return json(res, 404, { error: "no such group" });
  const actor = groupActor(auth);
  if (!actor.id || actor.id.startsWith("anon:")) return json(res, 403, { error: "only a signed-in person can leave a group", code: "no_person" });
  const plan = planGroupLeave(group, actor, {
    ownerOf: (botId) => {
      const bot = store.bot(botId);
      return bot ? effectiveBotOwner(bot) : undefined;
    },
    shared: (botId) => {
      const bot = store.bot(botId);
      return Boolean(bot && botGrants(bot).length > 0);
    },
  });
  if (!plan.ok) return json(res, plan.status, { error: plan.error, code: plan.code });
  if (plan.removedBotIds.length && phoneHasGroup(group.id)) {
    return json(res, 409, { error: "this group is securely saving a credential — try again when it finishes", code: "busy" });
  }
  const name = personDisplayName(principalById(actor.id)) || actor.email || "";
  store.appendMessage(group.threadId, groupLeftLine(actor.id, name, Date.now()));
  const beforeHumanIds = [...(group.humanIds ?? [])];
  const beforeMemberIds = [...group.memberIds];
  const turnWasOpen = channelTurnOpen(group);
  const left = store.patchGroup(group.id, {
    humanIds: plan.humanIds,
    memberIds: plan.memberIds,
    ...(plan.createdBy ? { createdBy: plan.createdBy } : {}),
  });
  if (!left) return json(res, 404, { error: "no such group" });
  // a turn waiting on a bot that left with them ends, as a roster edit does
  if (turnWasOpen) failTurnIfMemberLeft(left, beforeHumanIds, beforeMemberIds);
  // their own devices drop the group: they no longer see its frames
  broadcast({ kind: "group.left", roomId: group.id, audience: actor.id });
  return json(res, 200, { ok: true, ...(plan.createdBy ? { owner: plan.createdBy } : {}), removedBotIds: plan.removedBotIds });
}

export async function postGroupRead(deps: GroupsHttpDeps, ctx: RouteContext, _scratch: GroupsHttpScratch): Promise<typeof PASS | void> {
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
    knowsPersonThreads,
    publicGroupState,
    broadcast,
    notePushRead,
    actorPrincipalId,
    readCursor,
    peopleDmThreadOf,
  } = deps;
  const m = path.match(/^\/api\/groups\/([\w-]+)\/read$/);
  if (!(m && method === "POST")) return PASS;
  // A conversation between two people is read by the person reading it,
  // never for the other one (server/people/people-dms.ts).
  const existing = store.group(m[1]);
  const reader = groupReaderId(auth);
  // A person conversation: `{ threadId }` reads that thread for the
  // reader; no thread (a client from before threads) reads them all.
  const readBodyValue = existing?.peopleDm ? await readBody(req).catch(() => null) : null;
  const readThread = existing?.peopleDm && readBodyValue && typeof readBodyValue === "object" && !Array.isArray(readBodyValue)
    ? (readBodyValue as { threadId?: unknown }).threadId
    : undefined;
  const readThreadId = existing?.peopleDm && readThread !== undefined ? peopleDmThreadOf(existing, readThread) : undefined;
  const group = store.patchGroup(m[1], existing?.peopleDm && reader ? peopleDmThreadUnreadPatch(existing, reader, false, readThreadId) : { unread: false, ...roomMentionReadPatch(existing, reader), ...(existing ? readCursor(existing.threadId) : {}) });
  if (!group) return json(res, 404, { error: "no such room" });
  // somebody saw it: no push for this conversation (server/push/decide.ts)
  notePushRead(reader ?? actorPrincipalId(auth), readThreadId ?? group.threadId);
  broadcast({ kind: "group", group: publicGroupState(group) });
  return json(res, 200, { group: group.peopleDm ? peopleDmProjection(group, reader, knowsPersonThreads(req)) : peopleDmForViewer(publicGroupState(group), reader) });
}

export async function deleteGroup(deps: GroupsHttpDeps, ctx: RouteContext, _scratch: GroupsHttpScratch): Promise<typeof PASS | void> {
  const {
    res,
    path,
    method,
    auth,
    json,
  } = ctx;
  const {
    store,
    phoneHasGroup,
    groupOwnerRuleApplies,
    groupActor,
    disableRoutinesForGroup,
    groupIsWorking,
    stagedSkillCleanupsForThread,
    clearLastReply,
    cancelTeamSetupResumesForThread,
    clearTurnDigestState,
    rejectDeletedThreadSkillStages,
  } = deps;
  const m = path.match(/^\/api\/groups\/([\w-]+)$/);
  if (!(m && method === "DELETE")) return PASS;
  const group = store.group(m[1]);
  if (!group) return json(res, 404, { error: "no such room" });
  if (groupOwnerRuleApplies(auth) && !group.dm) {
    // The owner, or an organization admin moderating.
    if (!mayDeleteGroup(group, groupActor(auth))) return json(res, 403, { error: "forbidden: only the group's owner can delete it", code: "not_group_owner" });
  } else if (auth.kind === "session" && !auth.scopes.includes("admin")) {
    return json(res, 403, { error: "forbidden: deleting a channel needs the admin scope", code: "channel_delete_admin_only" });
  }
  if (phoneHasGroup(group.id)) {
    return json(res, 409, { error: "this channel is securely saving a credential — try again when it finishes" });
  }
  if (groupIsWorking(group)) {
    return json(res, 409, { error: "this channel is working — stop that turn first" });
  }
  const threadIds = new Set([group.threadId, ...(group.tasks ?? []).map((task) => task.threadId)]);
  const stagedSkillCleanups = [...threadIds].flatMap(stagedSkillCleanupsForThread);
  for (const threadId of threadIds) {
    cancelTeamSetupResumesForThread(threadId);
    clearLastReply(threadId);
    clearTurnDigestState(threadId);
  }
  disableRoutinesForGroup(group.id);
  store.deleteGroup(group.id);
  deleteGroupMemory(group.id);
  rejectDeletedThreadSkillStages(stagedSkillCleanups);
  return json(res, 200, { ok: true });
}
