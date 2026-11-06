// POST /api/internal/post-to-room (#1383). Matches this path itself and returns PASS otherwise.
import { peerApprovalFailure, requestPeerApproval } from "../peers/peer-approval.ts";
import { decideRoomPost, emptyRoomPostBudget, type RoomPostAttempt } from "../rooms/room-post-budget.ts";
import type { Message } from "../store.ts";
import { ROOM_POST_MAX_CHARS, type InternalRoomsBot, type InternalRoomsCall, type InternalRoomsGroup } from "./internal-rooms-types.ts";
import { PASS } from "./table.ts";

export async function handlePostToRoom(call: InternalRoomsCall): Promise<typeof PASS | void> {
  // post_to_room: a bot puts ONE message into a room it belongs to,
  // without a turn being started for anyone. Everything about it is a
  // deliberate non-event:
  //
  //   role "bot", never "user". A user-role append is what the composer
  //   writes, and it re-enters responder selection — one tool call would
  //   become a round of real turns, which is the notification storm this
  //   whole surface exists to avoid.
  //
  //   no startGroupTurn and no queue kick. The post lands, the room is
  //   marked unread, the person reads it when they look. A bot wanting a
  //   reply has ask_bot and delegate_bot, both of which are accounted for.
  //
  //   membership from the record, never from the argument: the argument
  //   only says which room to look up.

  const {
    res,
    path,
    method,
    json,
    internalCapability,
    readInternalBody,
    store,
    approvalBus,
    roomPostBudgets,
    personAskAt,
    turnAttachmentsByTurn,
    liveTurnByThread,
    connectorThread,
    roomPostEligibility,
    lastHumanRoomMessageAt,
    peerReviewRequired,
    isUnattended,
    turnAttachmentKey,
    offerRoomPostToBots,
    proactiveHopsFromThread,
    botTurnLimitLocal,
    requireActiveInternalCapability,
    internalSender,
  } = call;
  if (!(method === "POST" && path === "/api/internal/post-to-room")) return PASS;
  const body = await readInternalBody();
  const from = internalSender;
  const fromThreadId = internalCapability.threadId;
  const owner = connectorThread(from.id, fromThreadId);
  if (!owner) return json(res, 403, { error: "source conversation does not belong to sender" });
  const groupId = String(body.groupId ?? "").trim();
  const message = String(body.message ?? "").trim();
  const attachVoiceNote = body.attachVoiceNote === true;
  if (body.attachVoiceNote !== undefined && typeof body.attachVoiceNote !== "boolean") {
    return json(res, 400, { error: "attachVoiceNote must be true or false" });
  }
  if (!groupId || !message) {
    return json(res, 400, { error: "post_to_room needs group_id (from list_rooms) and message" });
  }
  // One turn's worth of posts is a handful; past it the turn has
  // stopped reporting and started broadcasting. Counted per turn, on
  // top of the room's own budget below.
  const roomPostLimit = botTurnLimitLocal(from, "roomPosts");
  if ((internalCapability.roomPosts ?? 0) >= roomPostLimit) {
    return json(res, 429, { error: `You have already posted ${roomPostLimit} times this turn, which is the limit. Do not retry: finish your turn and say anything further to the user directly.` });
  }
  if (message.length > ROOM_POST_MAX_CHARS) {
    return json(res, 400, {
      error: `a room post is at most ${ROOM_POST_MAX_CHARS} characters — post the short version and keep the detail in your own reply`,
    });
  }
  let room = store.group(groupId);
  if (!room) return json(res, 404, { error: "no such room — call list_rooms and copy the exact id from the result" });
  // Posting into the room you are already speaking in is not a peer
  // message, it is your own reply arriving twice — and it feeds your
  // words back into the context the same turn is answering from.
  if (room.id === owner.group?.id) {
    return json(res, 409, { error: "you are already speaking in that room — say it in your reply instead" });
  }
  const eligibility = roomPostEligibility(from, room);
  if (!eligibility.ok) return json(res, eligibility.status, { error: eligibility.error });
  // The budget is read BEFORE any approval card and CHARGED only on
  // the path that actually appends. Reading it early is what stops a
  // bot in a loop turning that loop into a queue of cards for a person
  // to work through: the refusal lands on the bot, not in the inbox.
  // Charging it early would have been a lie in the other direction —
  // a denied card, a room deleted while the card was open, or a
  // roster change that ends the post all leave the room with nothing
  // in it, and a room that took no post must not be told it did. The
  // model would then be refused its retry with "you already posted
  // that", which is the one thing worse than a refusal: a false
  // receipt for a message nobody can read.
  const askBudget = (bot: InternalRoomsBot, group: InternalRoomsGroup) => {
    const attempt: RoomPostAttempt = {
      botId: bot.id,
      botName: bot.name,
      text: message,
      now: Date.now(),
    };
    // The person attending is whoever wrote last: in the room, or —
    // when the post was asked for in the sender's own conversation —
    // there. A room-sourced post has no such person; its room is the
    // conversation, and what a person wrote in it is already counted.
    const askedAt = owner.group ? undefined : personAskAt.get(fromThreadId);
    const spokeAt = Math.max(lastHumanRoomMessageAt(group) ?? -Infinity, askedAt ?? -Infinity);
    if (Number.isFinite(spokeAt)) attempt.lastHumanAt = spokeAt;
    return decideRoomPost(roomPostBudgets.get(group.id) ?? emptyRoomPostBudget(), attempt);
  };
  // A refusal is stored, an allowance is not: the budget a refusal
  // hands back never contains the attempt — it is the pruning, plus
  // the breaker if this call is what tripped it — so keeping it costs
  // the room nothing and losing it would let a ring re-form one call
  // later.
  const preflight = askBudget(from, room);
  if (!preflight.allowed) {
    roomPostBudgets.set(room.id, preflight.budget);
    return json(res, 429, { error: preflight.message });
  }
  let poster = from;
  if (peerReviewRequired(from, fromThreadId)) {
    // Same gate ask_bot carries, aimed at the room instead of a peer:
    // a bot the user asked to be consulted about must be consulted here
    // too, or the newest way to reach other bots is the one way round it.
    // full-access: peer-contact
    const verdict = await requestPeerApproval(
      approvalBus,
      from as never,
      { id: room.id, name: room.name },
      message,
      "post_to_room",
      fromThreadId,
    );
    requireActiveInternalCapability();
    if (verdict !== "allow") return json(res, 200, peerApprovalFailure(verdict));
    // The card may have been open for minutes. Re-read both records so a
    // roster change, a section move, or a deletion during that window
    // cannot be posted through on a stale decision.
    const freshFrom = store.bot(internalSender.id);
    const freshRoom = store.group(groupId);
    if (!freshFrom || !freshRoom) return json(res, 404, { error: "that bot or room no longer exists" });
    const stillEligible = roomPostEligibility(freshFrom, freshRoom);
    if (!stillEligible.ok) return json(res, stillEligible.status, { error: stillEligible.error });
    poster = freshFrom;
    room = freshRoom;
  }
  // The room's budget is charged here, against the records the append
  // below will actually use. Between the preflight and this line the
  // room may have taken another bot's post, so this decision — not the
  // preflight — is the one that can refuse.
  const decision = askBudget(poster, room);
  roomPostBudgets.set(room.id, decision.budget);
  if (!decision.allowed) return json(res, 429, { error: decision.message });
  // Unattended inheritance: the mark rides the sender, and reading it
  // here is also what keeps its window alive through a turn that only
  // posts — an aged-out mark would hand the next hop to auto-approve.
  const unattended = isUnattended(poster.id, internalCapability.threadId);
  // A room post is the one send path that bypasses the settling reply,
  // so an explicit attach flag — never a silent default — moves this
  // turn's parked voice note onto the posted message. The removal
  // matters twice over: the clip is delivered exactly once (the
  // settling reply no longer finds it parked), and it survives a turn
  // that dies after the post, because it is no longer parked cleanup's
  // to delete. The post text stands as the caption.
  let attachedVoiceNote = false;
  let stagedAttachments: NonNullable<Message["attachments"]> = [];
  let detachParkedAudio: (() => void) | undefined;
  if (attachVoiceNote) {
    const parkedKey = turnAttachmentKey(fromThreadId, liveTurnByThread.get(fromThreadId));
    const parked = turnAttachmentsByTurn.get(parkedKey) ?? [];
    const audio = parked.filter((attachment) => attachment.kind === "audio");
    if (!audio.length) {
      return json(res, 400, { error: "no voice note to attach — call send_voice_note in this turn first" });
    }
    stagedAttachments = audio.map((attachment) => ({
      kind: "audio" as const,
      path: attachment.path,
      mime: attachment.mime,
    }));
    attachedVoiceNote = true;
    // The parked set is mutated only after the append below lands.
    // Everything between is synchronous, so nothing can interleave,
    // and a persistence failure must leave the clip parked: the post
    // can then be retried, whereas a premature removal strands the
    // clip on disk attached to nothing — and the catalog already told
    // the model never to retry a refused post.
    detachParkedAudio = () =>
      turnAttachmentsByTurn.set(
        parkedKey,
        parked.filter((attachment) => attachment.kind !== "audio"),
      );
  }
  const posted = store.appendMessage(room.threadId, {
    role: "bot",
    kind: "text",
    text: message,
    from: { botId: poster.id, name: poster.name, color: poster.color },
    peerPost: unattended ? { unattended: true } : {},
    ...(attachedVoiceNote ? { attachments: stagedAttachments } : {}),
  });
  internalCapability.roomPosts = (internalCapability.roomPosts ?? 0) + 1;
  detachParkedAudio?.();
  store.patchGroup(room.id, { unread: true });
  // The same visibility contract the peer tools keep: whatever a bot
  // does elsewhere shows up in the conversation it is actually in.
  // The chip is settled — the post has already landed — and carries
  // the same link a "Messaged @X" chip does, which is what makes it a
  // receipt rather than a log line: linked chips stay visible with
  // tool calls off, and open the room they name.
  const chip: Omit<Message, "id" | "at"> = {
    role: "bot",
    kind: "activity",
    tool: { name: `Posted in ${room.name}`, ok: true },
    comm: { groupId: room.id, withBotId: poster.id, withName: room.name, withColor: poster.color },
  };
  if (owner.group) chip.from = { botId: poster.id, name: poster.name, color: poster.color };
  store.appendMessage(fromThreadId, chip);
  // 2026-10-30: the room's other bots may act on a post that names
  // them; a chain of bots waking each other stops at the hop limit.
  offerRoomPostToBots(room, poster, message, posted.id, Math.max(1, proactiveHopsFromThread(fromThreadId)));
  return json(res, 201, { ok: true, messageId: posted.id, roomName: room.name, attachedVoiceNote });
}
