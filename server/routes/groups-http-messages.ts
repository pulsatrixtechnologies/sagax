// POST /api/groups/:id/messages (#1383). Each handler matches its own path and returns PASS otherwise.
import type { GroupCommandRoute } from "../../shared/harness-commands.ts";
import { isStopIntent } from "../../shared/stop-intent.ts";
import { admit } from "../admission.ts";
import { requestSource } from "../auth/request-auth.ts";
import { typedCommandForTurn, unavailableCommandError } from "../harness-commands.ts";
import { cancelledChatFollowup } from "../messages/message-db.ts";
import { acceptedSendMatch, parseSendId, sendFingerprint } from "../messages/send-idempotency.ts";
import { speakerFor } from "../request-speaker.ts";
import { queueChannelMessage, queuedChannelMessage } from "../rooms/channel-queue.ts";
import { channelViewerId } from "../rooms/channel-visibility.ts";
import { misuseRefusal } from "../safety/misuse-guardrails.ts";
import { safetyHttpRefusal } from "../safety/safety-review.ts";
import type { BotRecord } from "../store.ts";
import { extractTurnImages } from "../turns/turn-images.ts";
import type { GroupsHttpDeps, GroupsHttpScratch } from "./groups-http-types.ts";
import { PASS, type RouteContext } from "./table.ts";

export async function postGroupMessages(deps: GroupsHttpDeps, ctx: RouteContext, _scratch: GroupsHttpScratch): Promise<typeof PASS | void> {
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
    isPerspicax,
    groupThreadIsWorking,
    applyRoomHoldsFromMessage,
    groupPostAllowed,
    misuseActor,
    usageTriggerFor,
    assertSpendCap,
    stopGroupThreads,
    groupEngineCommandRoute,
    harnessCommandSource,
    harnessCommandSpeaker,
    harnessCommands,
    desktopManaged,
    runSend,
    notifyRoomMentions,
    messageSender,
    startGroupTurn,
    resolveReplyTarget,
    sendPeopleDmMessage,
  } = deps;
  const m = path.match(/^\/api\/groups\/([\w-]+)\/messages$/);
  if (!(m && method === "POST")) return PASS;
  const body = await readBody(req);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json(res, 400, { error: "body must be a JSON object" });
  }
  const text = String(body.text ?? "").trim();
  if (!text) return json(res, 400, { error: "text required" });
  const group = store.group(m[1]);
  if (!group) return json(res, 404, { error: "no such group" });
  // Slice 4: a read-only member of a shared section reads its rooms only.
  if (isPerspicax && !groupPostAllowed(group, channelViewerId(auth))) {
    return json(res, 403, { error: "you may read this channel, not post in it", code: "read_only" });
  }
  if (group.peopleDm) return json(res, 202, sendPeopleDmMessage(group, auth, text, body.sendId, body.replyToId, body.threadId));
  const groupSpeaker = speakerFor(auth);
  const groupMisuseActor = misuseActor(groupSpeaker.origin === "person" ? groupSpeaker.principalId : undefined, groupSpeaker.origin);
  const groupThreadId = typeof body.threadId === "string" ? body.threadId : group.threadId;
  const groupMisuse = misuseRefusal(text, { ...groupMisuseActor, surface: "message", threadId: groupThreadId });
  if (groupMisuse) return json(res, groupMisuse.status, { error: groupMisuse.message, code: groupMisuse.code, ...(groupMisuse.reason ? { reason: groupMisuse.reason } : {}) });
  const groupSafety = safetyHttpRefusal({ text, surface: "message", triage: groupMisuseActor.triage, ...(groupMisuseActor.principalId ? { principalId: groupMisuseActor.principalId } : {}), threadId: groupThreadId });
  if (groupSafety) return json(res, groupSafety.status, { error: groupSafety.message, code: groupSafety.code });
  if (body.mode !== undefined && body.mode !== "chat" && body.mode !== "goal") {
    return json(res, 400, { error: "mode must be chat or goal" });
  }
  const channelMode: "chat" | "goal" = body.mode === "goal" ? "goal" : "chat";
  if (group.dm && channelMode === "goal") {
    return json(res, 400, { error: "goal mode is available in team channels, not bot-to-bot channels" });
  }
  if (body.threadId !== undefined && (typeof body.threadId !== "string" || !/^[\w-]+$/.test(body.threadId))) {
    return json(res, 400, { error: "threadId must be a task id" });
  }
  const threadId = body.threadId ?? group.threadId;
  const trigger = usageTriggerFor(auth);
  try {
    assertSpendCap();
  } catch (error) {
    return json(res, 409, { error: error instanceof Error ? error.message : String(error), code: "spend_cap" });
  }
  const ownsThread = group.dm
    ? group.threadId === threadId
    : Boolean(store.groupTaskByThread(group.id, threadId));
  if (!ownsThread) {
    return json(res, 409, { error: "the channel switched tasks before it could receive the message" });
  }
  // "stop" alone while this room thread works: POST /interrupt for that
  // thread (shared/stop-intent.ts), never a queued follow-up.
  if (isStopIntent(text) && groupThreadIsWorking(group.id, threadId)) {
    await stopGroupThreads(group, [threadId]);
    return json(res, 200, { ok: true, threadId, stopped: true });
  }
  // An engine command for one member that the chat cannot run is refused
  // before it is recorded, like in a 1:1 (server/harness-commands.ts).
  const commandRoute = groupEngineCommandRoute(group, text, group.memberIds.map((id) => store.bot(id)).filter((member): member is BotRecord => Boolean(member && !member.hidden)), channelMode);
  const commandBot = commandRoute ? store.bot(commandRoute.botId) : undefined;
  // Only a command that bot's engine lists narrows the responders.
  let engineCommandRoute: GroupCommandRoute | null = null;
  if (commandRoute && commandBot) {
    const typed = await typedCommandForTurn(extractTurnImages(commandRoute.commandText).text, harnessCommandSource(commandBot, threadId, { group, speaker: harnessCommandSpeaker(auth) }), harnessCommands);
    if (typed.kind === "unavailable") return json(res, 409, unavailableCommandError(typed));
    if (typed.kind === "engine") engineCommandRoute = commandRoute;
  }
  const sendId = parseSendId(body.sendId);
  const replyTo = resolveReplyTarget(threadId, body.replyToId);
  // Who is this "user"? On a headless server loopback is the owner by
  // design, and a bot's shell is a loopback caller too. A request with
  // no paired session and no browser origin cannot be told from a
  // script, so its message is stamped rather than trusted as typed —
  // the room's readers, its posting budget and its transcript all look
  // at that stamp — and the send is logged where the operator can see
  // it. The desktop app never gets here: its owner capability is
  // checked before this handler runs.
  const browserOrigin = typeof req.headers.origin === "string" && req.headers.origin.trim() !== "";
  const via: "api" | undefined =
    auth.kind === "loopback" && !desktopManaged && !browserOrigin ? "api" : undefined;
  if (via) {
    console.warn(`room message from ${requestSource(req)} through the local API (no session, no browser origin) into "${group.name}"`);
  }
  const receipt = await runSend(
    sendId ? `group:${group.id}:${threadId}:${sendId}` : undefined,
    sendFingerprint(text, replyTo?.id, channelMode),
    async () => {
      if (sendId) {
        if (cancelledChatFollowup("channel", group.id, threadId, sendId)) {
          throw Object.assign(new Error("this queued sendId was cancelled; send a new message to try again"), { status: 409 });
        }
        const accepted = acceptedSendMatch([...store.messagesFor(threadId)], sendId, text, replyTo?.id, channelMode);
        if (accepted.kind === "conflict") {
          throw Object.assign(new Error("sendId already belongs to another message"), { status: 409 });
        }
        if (accepted.kind === "match") {
          return { ok: true as const, threadId, message: accepted.message };
        }
        const queued = queuedChannelMessage(group.id, threadId, sendId);
        if (queued) {
          if (
            queued.text !== text ||
            queued.replyToId !== replyTo?.id ||
            queued.mode !== channelMode
          ) {
            throw Object.assign(new Error("sendId already belongs to another message"), { status: 409 });
          }
          return { ok: true as const, queued: true as const, queueId: queued.id, threadId };
        }
      }
      const current = store.group(group.id);
      if (!current) throw Object.assign(new Error("no such group"), { status: 404 });
      const ownsTarget = current.threadId === threadId || store.groupTasks(current.id).some((task) => task.threadId === threadId);
      if (!ownsTarget) {
        throw Object.assign(new Error("no such thread in channel"), {
          status: 404,
        });
      }
      if (channelMode === "chat") applyRoomHoldsFromMessage(current.id, text);
      const threadWorking = groupThreadIsWorking(current.id, threadId);
      const decision = admit("room", {}, { roomWorking: threadWorking, threadWorking });
      if (decision.action === "queue") {
        const queued = queueChannelMessage(current.id, threadId, text, {
          replyToId: replyTo?.id,
          sendId,
          mode: channelMode,
          via,
          sender: messageSender(auth),
          trigger,
        });
        notifyRoomMentions(current.id, threadId, text, auth);
        return { ok: true as const, queued: true as const, queueId: queued.id, threadId };
      }
      const message = startGroupTurn(current.id, text, replyTo, sendId, channelMode, undefined, { via, sender: messageSender(auth), trigger, commandRoute: engineCommandRoute, threadId });
      notifyRoomMentions(current.id, threadId, text, auth);
      return { ok: true as const, threadId, message };
    },
  );
  return json(res, 202, receipt);
}
