// DELETE /api/groups/:id/queue/:queueId, POST /api/groups/:id/queue/:queueId/steer, POST /api/groups/:id/interrupt (#1383). Each handler matches its own path and returns PASS otherwise.
import { admit } from "../admission.ts";
import { cloudThreadRefusal } from "../cloud-thread-refusal.ts";
import type { SteerOutcome } from "../contracts.ts";
import { promptWithReply } from "../messages/replies.ts";
import { cancelChannelMessage, headChannelGroup, holdChannelQueue, resolveHeldReplyTarget, restoreHeldChannelQueue, settleHeldChannelQueueHead } from "../rooms/channel-queue.ts";
import { channelViewerId } from "../rooms/channel-visibility.ts";
import { extractTurnImages } from "../turns/turn-images.ts";
import type { GroupsHttpDeps, GroupsHttpScratch } from "./groups-http-types.ts";
import { PASS, type RouteContext } from "./table.ts";

export async function deleteGroupQueueItem(deps: GroupsHttpDeps, ctx: RouteContext, _scratch: GroupsHttpScratch): Promise<typeof PASS | void> {
  const {
    res,
    path,
    method,
    json,
  } = ctx;
  const { store } = deps;
  const m = path.match(/^\/api\/groups\/([\w-]+)\/queue\/([\w-]+)$/);
  if (!(m && method === "DELETE")) return PASS;
  const group = store.group(m[1]);
  if (!group) return json(res, 404, { error: "no such group" });
  if (!cancelChannelMessage(group.id, m[2])) {
    return json(res, 404, { error: "no such queued message" });
  }
  return json(res, 200, { ok: true });
}

export async function postGroupQueueSteer(deps: GroupsHttpDeps, ctx: RouteContext, _scratch: GroupsHttpScratch): Promise<typeof PASS | void> {
  // Steer a queued room message into the RUNNING room turn (no interrupt).
  // Only the head steers — room queues drain one item at a time — and the
  // engine that receives it is the thread's live speaker. A room whose
  // running driver cannot steer keeps its queue, exactly like an incapable
  // 1:1 engine; this never ends the running turn.

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
    groupIsWorking,
    groupPostAllowed,
    resolveReplyTarget,
    groupSpeakerBotId,
    runningTurnInstance,
    drainQueuedChannelSends,
    profileName,
  } = deps;
  const m = path.match(/^\/api\/groups\/([\w-]+)\/queue\/([\w-]+)\/steer$/);
  if (!(m && method === "POST")) return PASS;
  const body = await readBody(req);
  if (body !== null && (typeof body !== "object" || Array.isArray(body))) {
    return json(res, 400, { error: "body must be a JSON object" });
  }
  const threadId = typeof body?.threadId === "string" ? body.threadId : undefined;
  if (threadId !== undefined && !/^[\w-]+$/.test(threadId)) {
    return json(res, 400, { error: "threadId must be a task id" });
  }
  const group = store.group(m[1]);
  if (!group) return json(res, 404, { error: "no such room" });
  // Steering posts into the room's running turn: a read-only member of a
  // shared section may not, exactly as they may not post.
  if (isPerspicax && !groupPostAllowed(group, channelViewerId(auth))) {
    return json(res, 403, { error: "you may read this channel, not post in it", code: "read_only" });
  }
  const targetThreadId = threadId ?? group.threadId;
  const ownsThread = group.dm
    ? group.threadId === targetThreadId
    : Boolean(store.groupTaskByThread(group.id, targetThreadId));
  if (!ownsThread) {
    return json(res, 409, { error: "the channel switched tasks before it could receive the message" });
  }
  // Steering folds words into the running room turn; who pressed Steer
  // does not re-book that turn (its sender was captured when it started).
  const current = store.group(group.id);
  if (!current) return json(res, 404, { error: "no such room" });
  // Which engine owns the running room turn on this thread? The same
  // resolution the room's own Stop uses: the live speaker, else the busy
  // bot on the channel's main thread.
  const speakerBotId =
    groupSpeakerBotId(targetThreadId) ??
    (targetThreadId === current.threadId ? current.busyBotId : undefined);
  const speaker = speakerBotId ? store.bot(speakerBotId) : undefined;
  const instance = speaker ? runningTurnInstance(speaker, targetThreadId) : undefined;
  // Lift the queue atomically: the room settling can drain it as the
  // next follow-up, or this request can steer its head into the live
  // turn — never both for the same words.
  const held = holdChannelQueue(current.id, targetThreadId, m[2]);
  if (!held) return json(res, 404, { error: "no such queued message" });
  // M2: the head may be a coalesced group (one sender's contiguous
  // burst); Steer folds that whole group into the live turn as one.
  const headGroup = headChannelGroup(held.items);
  const [head] = headGroup;
  // A live steer has no image side channel — the same rule as the
  // 1:1 queue: attachment words wait for a real turn where central
  // admission can hand the images to the engine.
  if (headGroup.some((item) => {
    const resolved = extractTurnImages(item.text);
    return resolved.images.length > 0 || resolved.videos.length > 0;
  })) {
    restoreHeldChannelQueue(held);
    return json(res, 200, { ok: true, queued: true, threadId: targetThreadId });
  }
  const decision = admit("room-steer", {
    speakerPresent: Boolean(speaker),
    engineCanSteer: Boolean(instance?.adapter.capabilities.queueing && instance.adapter.steer),
    isQueueHead: Boolean(head && head.id === m[2]),
  });
  if (decision.action === "refuse") {
    restoreHeldChannelQueue(held);
    return json(res, 409, { error: "only the first queued message can steer" });
  }
  if (decision.action === "queue") {
    restoreHeldChannelQueue(held);
    return json(res, 200, { ok: true, queued: true, threadId: targetThreadId });
  }
  // A reply target that cannot be resolved restores the held queue
  // before the request fails — the room's normal drain keeps the head.
  const replyTo = resolveHeldReplyTarget(held, resolveReplyTarget);
  // Each burst line keeps its own reply relationship: the fold renders
  // per-item reply context (the head through the helper above, the rest
  // resolved here) so a mixed burst does not inherit the head's quote
  // or drop its own. A target that cannot be resolved restores the held
  // queue before the request fails, mirroring the helper's contract.
  const speakerName = profileName();
  let foldedPrompt: string;
  try {
    foldedPrompt = headGroup
      .map((item, index) =>
        promptWithReply(
          item.text,
          index === 0
            ? replyTo
            : item.replyToId
              ? resolveReplyTarget(targetThreadId, item.replyToId)
              : undefined,
          speakerName,
        ),
      )
      .join("\n\n");
  } catch (error) {
    restoreHeldChannelQueue(held);
    throw error;
  }
  // steer was offered only when a live speaker instance could take it;
  // the check carries that invariant to the type system.
  const steered: SteerOutcome = instance?.adapter.steer
    ? await instance.adapter
        .steer(targetThreadId, foldedPrompt)
        .catch((): SteerOutcome => "indeterminate")
    : "refused";
  // The steer was awaited adapter work: re-read every ownership
  // invariant before writing anything, exactly like the 1:1 path. A
  // speaker change, a channel switch, or a settled room restores the
  // queue instead of recording words the new turn never saw.
  const after = store.group(current.id);
  const afterSpeakerBotId = after
    ? groupSpeakerBotId(targetThreadId) ??
      (targetThreadId === after.threadId ? after.busyBotId : undefined)
    : undefined;
  // "indeterminate" (timeout after delivery, lost transport, a settle
  // race) never restores: the words may already be folded into the turn
  // that was live when they were sent, and replaying them into a new
  // turn would run them twice. Record them once — even under a new
  // speaker — and settle the head.
  const delivered = steered !== "refused";
  if (after && delivered && (steered === "indeterminate" || afterSpeakerBotId === speakerBotId)) {
    const messages = headGroup.map((item) => store.appendMessage(targetThreadId, {
      role: "user",
      kind: "text",
      text: item.text,
      replyToId: item.replyToId,
      sendId: item.sendId,
      channelMode: item.mode,
      queueId: item.id,
      via: item.via,
      steered: true,
      sender: item.sender,
    }));
    settleHeldChannelQueueHead(held);
    return json(res, 200, {
      ok: true,
      steered: true,
      threadId: targetThreadId,
      messages,
      queueIds: headGroup.map((item) => item.id),
    });
  }
  if (steered === "indeterminate" && !after) {
    // The room vanished while the answer was lost: settle the head so a
    // restart cannot replay words the dead turn may already have run.
    settleHeldChannelQueueHead(held);
    return json(res, 404, { error: "no such room" });
  }
  restoreHeldChannelQueue(held);
  // The room may have settled while the steer was refused; a queue that
  // is now drainable must not strand behind a missed settle.
  if (after && !groupIsWorking(after)) drainQueuedChannelSends();
  return json(res, 200, { ok: true, queued: true, threadId: targetThreadId });
}

export async function postGroupInterrupt(deps: GroupsHttpDeps, ctx: RouteContext, _scratch: GroupsHttpScratch): Promise<typeof PASS | void> {
  const {
    req,
    res,
    path,
    method,
    json,
    readBody,
  } = ctx;
  const { store, stopGroupThreads, activeGroupOperations } = deps;
  const m = path.match(/^\/api\/groups\/([\w-]+)\/interrupt$/);
  if (!(m && method === "POST")) return PASS;
  const group = store.group(m[1]);
  if (!group) return json(res, 404, { error: "no such room" });
  const rawBody = await readBody(req);
  if (rawBody !== null && (typeof rawBody !== "object" || Array.isArray(rawBody))) {
    return json(res, 400, { error: "body must be a JSON object" });
  }
  const body = rawBody ?? {};
  if (body.threadId !== undefined && (typeof body.threadId !== "string" || !/^[\w-]+$/.test(body.threadId))) {
    return json(res, 400, { error: "threadId must be a task id" });
  }
  if (body.threadId !== undefined) {
    const ownsThread = group.dm
      ? body.threadId === group.threadId
      : Boolean(store.groupTaskByThread(group.id, body.threadId));
    if (!ownsThread) {
      return json(res, 409, { error: "the channel switched tasks before it could be interrupted" });
    }
  }
  const activeOperations = activeGroupOperations(group.id).filter((operation) => !operation.cancelled);
  // Without an explicit task, Stop means the room's live operation—not
  // merely whichever task the UI was showing when a detached routine
  // began. There is normally one operation; cancel every active thread
  // defensively so no queued handoff survives a room-level stop.
  const targetThreadIds = body.threadId !== undefined
    ? [body.threadId]
    : activeOperations.length > 0
      ? [...new Set(activeOperations.map((operation) => operation.threadId))]
      : [group.threadId];
  await stopGroupThreads(group, targetThreadIds);
  return json(res, 200, { ok: true });
}

/** POST /api/groups/:id/members/:botId/compact: "Compact now" for one bot in a room (#2204 port). */
export async function postGroupMemberCompact(deps: GroupsHttpDeps, ctx: RouteContext, _scratch: GroupsHttpScratch): Promise<typeof PASS | void> {
  const { res, path, method, json, auth } = ctx;
  const m = path.match(/^\/api\/groups\/([\w-]+)\/members\/([\w-]+)\/compact$/);
  if (!(m && method === "POST")) return PASS;
  const { store, roomMemberContexts, publicGroupState, broadcast } = deps;
  const group = store.group(m[1]);
  if (!group) return json(res, 404, { error: "no such room" });
  if (!group.memberIds.includes(m[2])) return json(res, 404, { error: "that bot is not in this room" });
  const notYours = cloudThreadRefusal(auth, group.threadId);
  if (notYours) return json(res, 403, { error: notYours });
  if (!roomMemberContexts.request(group.threadId, m[2])) {
    return json(res, 409, { error: "this bot has no measured context in this room yet" });
  }
  const visible = publicGroupState(store.group(group.id) ?? group);
  broadcast({ kind: "group", group: visible });
  return json(res, 202, { ok: true, threadId: group.threadId, group: visible });
}
