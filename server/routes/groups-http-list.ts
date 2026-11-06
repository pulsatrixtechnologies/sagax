// GET /api/groups, POST /api/groups (#1383). Each handler matches its own path and returns PASS otherwise.
import { memberGroup } from "../bots/bot-visibility.ts";
import { peopleDmForViewer } from "../people/people-dms.ts";
import type { GroupsHttpDeps, GroupsHttpScratch } from "./groups-http-types.ts";
import { PASS, type RouteContext } from "./table.ts";

export async function getGroups(deps: GroupsHttpDeps, ctx: RouteContext, scratch: GroupsHttpScratch): Promise<typeof PASS | void> {
  // ── channels (persisted internally as groups) ───────────────────────

  const {
    req,
    res,
    path,
    method,
    auth,
    json,
  } = ctx;
  const { visible, viewerId } = scratch;
  const {
    store,
    groupVisible,
    peopleDmProjection,
    groupReaderId,
    knowsPersonThreads,
    publicGroupState,
  } = deps;
  if (!(method === "GET" && path === "/api/groups")) return PASS;
  return json(res, 200, {
    groups: store.groups.filter((g) => visible.group(g.id) && groupVisible(g, viewerId)).map((g) => {
      const room = g.peopleDm ? peopleDmProjection(g, groupReaderId(auth), knowsPersonThreads(req)) : peopleDmForViewer(publicGroupState(g), groupReaderId(auth));
      return visible.everything ? room : memberGroup(room);
    }),
  });
}

export async function postGroups(deps: GroupsHttpDeps, ctx: RouteContext, scratch: GroupsHttpScratch): Promise<typeof PASS | void> {
  const {
    req,
    res,
    path,
    method,
    auth,
    json,
    readBody,
  } = ctx;
  const { visible } = scratch;
  const {
    store,
    publicGroupState,
    refusePlacedBots,
    isPerspicax,
    channelActorRole,
    refuseHumanEdit,
    createChannel,
    withCreatorListed,
    channelActorId,
    mayPlaceRoomIn,
    recordRoomPlacement,
  } = deps;
  if (!(method === "POST" && path === "/api/groups")) return PASS;
  const body = await readBody(req);
  if (Array.isArray(body?.memberIds)) {
    const placed = refusePlacedBots(auth, body.memberIds, new Set());
    if (placed) return json(res, 403, { error: placed, code: "bot_place_owner_only" });
  }
  // On an organization server the creator owns the new room, so a member
  // may name coworkers they can see in the directory (#1061).
  const memberCreates = isPerspicax && auth.kind === "session" && channelActorRole(auth) === "member";
  const humans = refuseHumanEdit(auth, body, [], memberCreates);
  if (humans) { const bad = humans.startsWith("unknown team") || humans.startsWith("unknown person"); return json(res, bad ? 400 : 403, { error: humans, code: humans.startsWith("unknown team") ? "unknown_team" : bad ? "unknown_person" : "not_channel_editor" }); }
  // A member may only put bots they can see in a room: the room would
  // otherwise show them a restricted bot (bot-visibility.ts).
  const hiddenMember = Array.isArray(body?.memberIds) ? body.memberIds.find((id: unknown) => typeof id === "string" && store.bot(id) && !visible.bot(id)) : undefined;
  if (hiddenMember) return json(res, 400, { error: `unknown channel member: ${String(hiddenMember)}` });
  const created = createChannel(withCreatorListed(auth, body));
  const creatorId = isPerspicax ? channelActorId(auth) : "";
  const group = (creatorId && store.patchGroup(created.id, { createdBy: creatorId })) || created;
  // Created in a section by one of its members: the section opens it.
  if (group.section && mayPlaceRoomIn(auth, group.section)) recordRoomPlacement(group.section, group.id);
  return json(res, 201, { group: { ...publicGroupState(group), messages: [] } });
}
