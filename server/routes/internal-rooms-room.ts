// POST /api/internal/create-room and POST /api/internal/manage-room (#1383). Matches this path itself and returns PASS otherwise.
import { z } from "zod";
import { roomRecruitIds } from "../peers/peer-roster.ts";
import { redactSecretsInText } from "../redact.ts";
import { sectionKey } from "../store.ts";
import type { InternalRoomsCall } from "./internal-rooms-types.ts";
import { PASS } from "./table.ts";

export async function handleCreateOrManageRoom(call: InternalRoomsCall): Promise<typeof PASS | void> {
  const {
    res,
    path,
    method,
    json,
    internalCapability,
    readInternalBody,
    store,
    connectorThread,
    peerReviewRequired,
    createChannel,
    updateChannel,
    cfg,
    botTurnLimitLocal,
    effectiveBotOwner,
    IDENTITY,
    deciderReady,
  } = call;
  if (!(method === "POST" && (path === "/api/internal/create-room" || path === "/api/internal/manage-room"))) return PASS;
  const body = await readInternalBody();
  const chief = store.bot(internalCapability.botId)!;
  if (chief.hidden || !chief.chiefOfStaff || !connectorThread(chief.id, internalCapability.threadId)) {
    return json(res, 403, { error: "only an active Primary Bot can manage rooms" });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json(res, 400, { error: "room request must be a JSON object" });
  }
  // ponytail: no new room-administration approval flow. Fail closed for
  // chiefs whose peer changes need review; add a proposal card if needed.
  if (peerReviewRequired(chief, internalCapability.threadId)) {
    return json(res, 403, { error: "peer approval is required; ask the user to make this room change" });
  }
  // Section labels are a permission boundary, not bot-owned organization.
  // A Primary Bot may not recruit excluded peers or acquire a foreign transcript.
  // #1098 lets it message every bot of its person past its peer list; a
  // room still honors that list (roomRecruitIds, #1366).
  const allowedIds = new Set(roomRecruitIds(store.bots, chief));
  const allowedRoster = (ids: string[]) => ids.includes(chief.id) && ids.every((id) => allowedIds.has(id));
  if (body.section !== undefined && (typeof body.section !== "string" || sectionKey(body.section) !== sectionKey(chief.section))) {
    return json(res, 403, { error: "rooms must stay in your own section; ask the user to move them" });
  }
  if (path === "/api/internal/create-room") {
    const roomLimit = botTurnLimitLocal(chief, "roomsCreated");
    if ((internalCapability.createdRooms ?? 0) >= roomLimit) {
      return json(res, 429, { error: `you can create at most ${roomLimit} rooms in one turn` });
    }
    const parsed = z.object({
      fromBotId: z.string().optional(), fromThreadId: z.string().optional(),
      name: z.string().trim().min(1).max(100), memberIds: z.array(z.string()).min(1).max(100),
      section: z.string().optional(), bulletin: z.string().max(12_000).optional(),
    }).strict().safeParse(body);
    if (!parsed.success) return json(res, 400, { error: "provide a room name, memberIds, and optional bulletin (at most 12000 characters)" });
    const memberIds = [...new Set([chief.id, ...parsed.data.memberIds])];
    if (!allowedRoster(memberIds)) {
      return json(res, 403, { error: "include yourself and only active, allowed peers from list_bots" });
    }
    // Organization server: a room is read through humanIds (channel.read),
    // so the person whose Primary Bot opens it must be listed or the room
    // shows only in search. Solo keeps the unlisted room (one viewer).
    const roomOwnerId = IDENTITY.kind === "perspicax" ? effectiveBotOwner(chief) : "";
    const created = createChannel({
      name: redactSecretsInText(parsed.data.name), memberIds, section: chief.section,
      ...(roomOwnerId ? { humanIds: [roomOwnerId] } : {}),
      setup: {
        bulletin: redactSecretsInText(parsed.data.bulletin ?? ""),
        // The Primary Bot leads; on Auto it is the fallback when the decision model is unsure.
        defaultResponder: deciderReady(cfg, "roomRouting") ? { kind: "auto", fallbackBotId: chief.id } : { kind: "member", botId: chief.id },
      },
    });
    const group = (roomOwnerId && store.patchGroup(created.id, { createdBy: roomOwnerId })) || created;
    internalCapability.createdRooms = (internalCapability.createdRooms ?? 0) + 1;
    return json(res, 201, { id: group.id, name: group.name, section: group.section || "General", memberIds: group.memberIds, memberCount: group.memberIds.length });
  }
  const parsed = z.object({
    fromBotId: z.string().optional(), fromThreadId: z.string().optional(),
    roomId: z.string(), action: z.enum(["add_members", "remove_members", "set_members", "rename", "set_bulletin"]),
    memberIds: z.array(z.string()).min(1).max(100).optional(),
    name: z.string().trim().min(1).max(100).optional(), bulletin: z.string().max(12_000).optional(),
  }).strict().safeParse(body);
  if (!parsed.success) return json(res, 400, { error: "provide roomId and a supported room action; section moves are user-only" });
  const room = store.group(parsed.data.roomId);
  if (!room || room.dm || sectionKey(room.section) !== sectionKey(chief.section) || !allowedRoster(room.memberIds)) {
    return json(res, 403, { error: "you can only manage rooms in your own section you belong to with allowed peers from list_bots" });
  }
  const { action, memberIds, name, bulletin } = parsed.data;
  const patch: Record<string, unknown> = {};
  if (action === "rename") {
    if (name === undefined) return json(res, 400, { error: "rename requires a name" });
    patch.name = redactSecretsInText(name);
  } else if (action === "set_bulletin") {
    if (bulletin === undefined) return json(res, 400, { error: "set_bulletin requires bulletin text; use an empty string to clear it" });
    patch.bulletin = redactSecretsInText(bulletin);
  } else {
    if (!memberIds || memberIds.some((id) => !allowedIds.has(id))) {
      return json(res, 403, { error: "memberIds must name only yourself or active, allowed peers from list_bots" });
    }
    const next = action === "add_members" ? [...new Set([...room.memberIds, ...memberIds])]
      : action === "remove_members" ? room.memberIds.filter((id) => !memberIds.includes(id)) : memberIds;
    if (!allowedRoster(next)) return json(res, 403, { error: "keep yourself in the room; only the user can remove its managing Primary Bot" });
    patch.memberIds = next;
  }
  const updated = updateChannel(room.id, patch);
  return json(res, 200, { ok: true, memberIds: updated.memberIds, memberCount: updated.memberIds.length, message: `Updated room “${updated.name}”.` });
}
