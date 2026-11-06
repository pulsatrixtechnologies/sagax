// @ts-nocheck
/** updateChannel (#1388). Pure move from server/index.ts. */
import { memberIdsDropBot } from "../workers.ts";
import { applyHumanIds } from "../rooms/channel-membership.ts";
import { parseConversationTurnTimeout } from "../rooms/room-turn-timeout.ts";
export type Host = Record<string, any>;

export function createUpdateChannel(getHost: () => Host): any {
function updateChannel(groupId: string, value: unknown) {
  const host = getHost();

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw Object.assign(new Error("body must be a JSON object"), { status: 400 });
  }
  const body = value as Record<string, unknown>;

  const existing = host.store.group(groupId);
  if (!existing) throw Object.assign(new Error("no such room"), { status: 404 });
  if (body.memberIds !== undefined && host.phoneSecretSubmissions.hasGroup(existing.id)) {
    throw Object.assign(new Error("this channel is securely saving a credential — try again when it finishes"), { status: 409 });
  }
  // A bot leaving memberIds during a turn is applied. failTurn cancels the
  // held id. Bulletin and responder edits stay blocked, and so does a
  // memberIds change that does not remove anyone.
  const nextMemberIds = Array.isArray(body.memberIds) && body.memberIds.every((id) => typeof id === "string")
    ? body.memberIds as string[]
    : null;
  const dropsBot = nextMemberIds !== null && memberIdsDropBot({
    beforeMemberIds: existing.memberIds,
    afterMemberIds: nextMemberIds
  });
  if (
    host.channelTaskBlocked(existing) &&
    (
      body.defaultResponder !== undefined
      || body.bulletin !== undefined
      || (body.memberIds !== undefined && !dropsBot)
    )
  ) {
    throw Object.assign(new Error("this channel is working or waiting on you — finish that turn first"), { status: 409 });
  }
  const patch: Record<string, unknown> = {};
  if (body.name !== undefined) {
    if (typeof body.name !== "string") throw Object.assign(new Error("room name must be a string"), { status: 400 });
    const name = body.name.trim();
    if (!name) throw Object.assign(new Error("room name must not be empty"), { status: 400 });
    if (name.length > 100) throw Object.assign(new Error("room name must be at most 100 characters"), { status: 400 });
    patch.name = name;
  }
  if (body.bulletin !== undefined) {
    if (typeof body.bulletin !== "string") throw Object.assign(new Error("bulletin must be a string"), { status: 400 });
    if (body.bulletin.length > 12_000) {
      throw Object.assign(new Error("bulletin must be at most 12000 characters"), { status: 400 });
    }
    patch.bulletin = body.bulletin;
  }
  if (body.unread !== undefined) {
    if (typeof body.unread !== "boolean") throw Object.assign(new Error("unread must be true or false"), { status: 400 });
    patch.unread = body.unread;
  }
  if (body.pinned !== undefined) {
    if (typeof body.pinned !== "boolean") throw Object.assign(new Error("pinned must be true or false"), { status: 400 });
    patch.pinned = body.pinned || undefined;
  }
  // Whether @all tags every person in the room (server/rooms/room-mentions.ts).
  if (body.mentionAll !== undefined) {
    if (existing.dm || existing.peopleDm) throw Object.assign(new Error("only a room can let @all notify its people"), { status: 400 });
    if (typeof body.mentionAll !== "boolean") throw Object.assign(new Error("mentionAll must be true or false"), { status: 400 });
    patch.mentionAll = body.mentionAll || undefined;
  }
  if (body.memberIds !== undefined) {
    // A DM is the pair it was opened for; only real rooms have a roster.
    if (existing.dm) throw Object.assign(new Error("direct-message channels cannot change members"), { status: 400 });
    const peopleAfter = new Set((Array.isArray(body.humanIds) ? body.humanIds : existing.humanIds ?? []).filter((id): id is string => typeof id === "string" && id.trim() !== "").map((id) => id.trim().toLowerCase())).size;
    const roster = host.checkedMemberIds(body.memberIds, peopleAfter);
    if (!roster.ok) throw Object.assign(new Error(roster.error.replace("channel", "room")), { status: 400 });
    const audienceConflict = host.roomAudienceConflict(roster.memberIds, existing.memberIds);
    if (audienceConflict) throw Object.assign(new Error(audienceConflict), { status: 400 });
    const removedGoalLead = host.routines!.listRoutines().some(
      (routine) =>
        routine.enabled &&
        routine.target === "room-goal" &&
        routine.groupId === existing.id &&
        !roster.memberIds.includes(routine.botId),
    ) || host.routines!.listRuns().some(
      (run) =>
        run.target === "room-goal" &&
        run.groupId === existing.id &&
        ["queued", "running", "waiting"].includes(run.status) &&
        !roster.memberIds.includes(run.botId),
    );
    if (removedGoalLead) {
      throw Object.assign(new Error("pause or reassign this room's team-goal routine before removing its lead"), { status: 409 });
    }
    patch.memberIds = roster.memberIds;
  }
  if (body.humanIds !== undefined) {
    // The route authorized the actor (refuseHumanEdit) before this runs:
    // mapping an email may create its principal.
    if (!Array.isArray(body.humanIds) || body.humanIds.some((id) => typeof id !== "string" || id.length > 320)) {
      throw Object.assign(new Error("humanIds must be a list of user ids"), { status: 400 });
    }
    const applied = applyHumanIds({ dm: Boolean(existing.dm), humanIds: body.humanIds.map((id: string) => host.principalIdFor(id, host.principals)) });
    if (!applied.ok) throw Object.assign(new Error(applied.error), { status: 400 });
    patch.humanIds = applied.humanIds;
  }
  if (body.defaultResponder !== undefined) {
    const memberIds = (patch.memberIds as string[] | undefined) ?? existing.memberIds;
    const responder = host.checkedGroupResponder(body.defaultResponder, memberIds);
    if (!responder) throw Object.assign(new Error("invalid default responder"), { status: 400 });
    patch.defaultResponder = responder;
  }
  if (Object.prototype.hasOwnProperty.call(body, "turnTimeoutMinutes")) {
    if (!existing.dm) {
      throw Object.assign(new Error("set the turn limit on that conversation"), { status: 400 });
    }
    const parsed = parseConversationTurnTimeout(body.turnTimeoutMinutes);
    if (!parsed.ok) throw Object.assign(new Error(parsed.error), { status: 400 });
    patch.turnTimeoutMinutes = parsed.minutes;
  }
  if (body.cwd !== undefined) {
    if (existing.dm) throw Object.assign(new Error("direct-message channels cannot have a working folder"), { status: 400 });
    if (existing.pinnedCwd !== undefined) {
      throw Object.assign(new Error("the room's working folder is fixed after its first turn"), { status: 409 });
    }
    const checked = host.validateBotCwd(body.cwd);
    if (!checked.ok) throw Object.assign(new Error(checked.error), { status: 400 });
    patch.cwd = checked.cwd ?? undefined;
  }
  // one pinned message per room; null/"" clears. The id is not
  // validated against the transcript here — a pin whose message was
  // edited away or deleted simply resolves to nothing in the UI.
  if (body.pinnedMessageId !== undefined) {
    if (body.pinnedMessageId === null || body.pinnedMessageId === "") patch.pinnedMessageId = undefined;
    else if (typeof body.pinnedMessageId === "string" && /^[\w-]+$/.test(body.pinnedMessageId)) {
      patch.pinnedMessageId = body.pinnedMessageId;
    } else throw Object.assign(new Error("pinnedMessageId must be a message id"), { status: 400 });
  }
  // same contract as a bot's sidebar section: null/"" clears, 60 chars max
  if (body.section !== undefined) {
    if (body.section === null) {
      patch.section = undefined;
      patch.sectionId = undefined;
    } else if (typeof body.section !== "string") throw Object.assign(new Error("section must be a string"), { status: 400 });
    else {
      const trimmed = body.section.trim();
      if (!trimmed) {
        patch.section = undefined;
        patch.sectionId = undefined;
      } else if (trimmed.length > 60) throw Object.assign(new Error("section must be at most 60 characters"), { status: 400 });
      else {
        patch.section = trimmed;
        // #2045: stamp the owner's stable team id beside the display name.
        const owner = host.groupOwnerId(existing) || (typeof existing.createdBy === "string" ? existing.createdBy : "") || host.localPrincipalId();
        patch.sectionId = host.sectionChannels && owner ? host.sectionChannels.ensure(trimmed, owner).id : undefined;
      }
    }
  }
  // An admin's explicit "show this room to everyone its current bots allow":
  // the only way a room's floor widens (settleRoomFloor). Admin-only: a
  // member's PATCH is limited to display fields, and a Primary Bot's never has it.
  const resetAudience = body.resetAudience !== undefined;
  if (resetAudience) {
    if (body.resetAudience !== true) throw Object.assign(new Error("resetAudience must be true"), { status: 400 });
    patch.audienceFloor = undefined;
  }
  const beforeHumanIds = [...(existing.humanIds ?? [])];
  const beforeMemberIds = [...existing.memberIds];
  const turnWasOpen = host.channelTurnOpen(existing);
  const group = host.store.patchGroup(groupId, patch);
  if (resetAudience) host.audienceChanged();
  if (!group) throw Object.assign(new Error("no such room"), { status: 404 });
  if (turnWasOpen) host.failTurnIfMemberLeft(group, beforeHumanIds, beforeMemberIds);
  return group;

}
  return updateChannel;
}
