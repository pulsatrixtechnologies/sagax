// @ts-nocheck
/** createChannel (#1388). Pure move from server/index.ts. */
import { applyHumanIds } from "../rooms/channel-membership.ts";
export type Host = Record<string, any>;

export function createCreateChannel(getHost: () => Host): any {
function createChannel(value: unknown) {
  const host = getHost();
  const { deciderReady } = host;

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw Object.assign(new Error("channel must be a JSON object"), { status: 400 });
  }
  const body = value as Record<string, unknown>;

  const listedPeople = Array.isArray(body.humanIds) ? new Set(body.humanIds.filter((id): id is string => typeof id === "string" && id.trim() !== "").map((id) => id.trim().toLowerCase())).size : 0;
  const roster = host.checkedMemberIds(body.memberIds, listedPeople);
  if (!roster.ok) throw Object.assign(new Error(roster.error), { status: 400 });
  const { memberIds } = roster;
  const audienceConflict = host.roomAudienceConflict(memberIds);
  if (audienceConflict) throw Object.assign(new Error(audienceConflict), { status: 400 });
  if (body.name !== undefined && typeof body.name !== "string") {
    throw Object.assign(new Error("channel name must be a string"), { status: 400 });
  }
  const name = body.name?.trim() || (memberIds.length ? `${host.store.bot(memberIds[0])!.name} & co.` : "New group");
  if (name.length > 100) throw Object.assign(new Error("channel name must be at most 100 characters"), { status: 400 });
  let section: string | undefined;
  if (body.section !== undefined && body.section !== null) {
    if (typeof body.section !== "string") throw Object.assign(new Error("context must be a string"), { status: 400 });
    section = body.section.trim() || undefined;
    if (section && section.length > 60) {
      throw Object.assign(new Error("context must be at most 60 characters"), { status: 400 });
    }
  }
  let setup:
    | { bulletin: string; defaultResponder: GroupDefaultResponder }
    | undefined;
  if (body.setup !== undefined) {
    if (!body.setup || typeof body.setup !== "object" || Array.isArray(body.setup)) {
      throw Object.assign(new Error("setup must be an object"), { status: 400 });
    }
    const requested = body.setup as { bulletin?: unknown; defaultResponder?: unknown };
    // A room opened from a phone carries only who answers, like the desktop
    // remote client's { defaultResponder: mentions }: no instructions yet.
    const bulletin = requested.bulletin === undefined ? "" : requested.bulletin;
    if (typeof bulletin !== "string") {
      throw Object.assign(new Error("setup.bulletin must be a string"), { status: 400 });
    }
    if (bulletin.length > 12_000) {
      throw Object.assign(new Error("setup.bulletin must be at most 12000 characters"), { status: 400 });
    }
    const responder = host.checkedGroupResponder(requested.defaultResponder, memberIds);
    if (!responder) throw Object.assign(new Error("invalid setup.defaultResponder"), { status: 400 });
    setup = { bulletin, defaultResponder: responder };
  }
  let humanIds: string[] | undefined;
  if (body.humanIds !== undefined) {
    // The route authorized the actor (refuseHumanEdit) before this runs:
    // mapping an email may create its principal.
    if (!Array.isArray(body.humanIds) || body.humanIds.some((id) => typeof id !== "string" || id.length > 320)) {
      throw Object.assign(new Error("humanIds must be a list of user ids"), { status: 400 });
    }
    const applied = applyHumanIds({ dm: false, humanIds: body.humanIds.map((id: string) => host.principalIdFor(id, host.principals)) });
    if (!applied.ok) throw Object.assign(new Error(applied.error), { status: 400 });
    humanIds = applied.humanIds;
  }
  // A new room with no routing of its own starts on Auto while the decision
  // model is on for rooms; otherwise it gets today's default (first member).
  return host.store.createGroup(name, memberIds, false, section, setup ?? (deciderReady(host.cfg, "roomRouting") ? { defaultResponder: { kind: "auto" } } : undefined), humanIds);

}
  return createChannel;
}
