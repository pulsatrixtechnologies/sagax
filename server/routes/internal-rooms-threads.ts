// POST /api/internal/threads (#1383). Matches this path itself and returns PASS otherwise.
import { fitsOnOneLine } from "../../shared/bot-profile.ts";
import { signTurnHandle } from "../agent-api.ts";
import { parseAutoComputerTarget } from "../computer/auto-computer.ts";
import type { HandoffView } from "../coordinator.ts";
import { PEER_ACCESS_HELP, canAccessBot, peerAllowed, peerInScope, resolveTeammate } from "../peers/peer-roster.ts";
import { planPriorityWake, parseWakePriority, releasePriorityNow } from "../proactive/priority-wake.ts";
import type { Message } from "../store.ts";
import { CONFIDENTIAL_PEER_REFUSED } from "../threads/confidential-threads.ts";
import { resumeOpening, resumeRefusal, subagentRequest } from "../threads/subagent-threads.ts";
import { MAX_COMMS_DEPTH, type InternalRoomsCall } from "./internal-rooms-types.ts";
import { PASS } from "./table.ts";
import { sendStateOf } from "../../shared/send-receipt.ts";
import { openWorkEcho } from "../team-work/team-work.ts";
import { workLabel } from "../team-work/work-label.ts";

export async function handleInternalThreads(call: InternalRoomsCall): Promise<typeof PASS | void> {
  const {
    res,
    path,
    method,
    json,
    internalCapability,
    readInternalBody,
    req,
    store,
    coordinator,
    threadStarters,
    directRequestOwners,
    coordinationRequestId,
    connectorThread,
    peerReviewRequired,
    isUnattended,
    pollOnlyCaller,
    peerSpeaker,
    openedThreadOwner,
    openerFrom,
    parentThreadModel,
    privateThreads,
    startOrQueueOpenedThread,
    startParallelTask,
    turnOrigin,
    applyDelegatedLevel,
    coordinateTeammateThread,
    threadBusy,
    botAtThreadCapacity,
    activeGroupTurnForBot,
    idempotencyKeyOf,
    joinPerson,
    threadRefUrl,
    notePeerNotice,
    setReplyNotify,
    botMaxConcurrentThreadsLocal,
    botMaxParallelPerPersonLocal,
    botTurnLimitLocal,
    agentApiSecret,
    delegatedThisTurn,
    internalSender,
  } = call;
  if (!(method === "POST" && path === "/api/internal/threads")) return PASS;
  const body = await readInternalBody();
  const from = internalSender;
  const fromThreadId = internalCapability.threadId;
  const owner = connectorThread(from.id, fromThreadId);
  if (!owner) return json(res, 403, { error: "source conversation does not belong to sender" });
  if (
    body.depth !== undefined &&
    (!Number.isInteger(body.depth) || Number(body.depth) < 0 || body.depth !== internalCapability.depth)
  ) {
    return json(res, 403, { error: "the recursion depth does not match this turn" });
  }
  const title = String(body.title ?? "").trim();
  const message = String(body.message ?? "").trim();
  // sub-agents (parity D1, server/threads/subagent-threads.ts): resume one by id, or run one read-only
  const resumeId = typeof body.resumeThreadId === "string" ? body.resumeThreadId.trim() : "";
  const readOnly = body.readOnly === true;
  if (!message || (!title && !resumeId)) return json(res, 400, { error: "title and message are required" });
  if (title.length > 80) return json(res, 400, { error: "title must be at most 80 characters" });
  // the title is quoted into chips and the sidebar, one line each
  if (!fitsOnOneLine(title)) return json(res, 400, { error: "title must fit on one line" });
  const threadLimit = botTurnLimitLocal(from, "threadsOpened");
  if (internalCapability.openedThreads >= threadLimit) {
    // V4: thread limit is an intended stop (200 non-isError), not a red 429.
    return json(res, 200, {
      applied: false,
      limit: true,
      message: `You have already opened ${threadLimit} threads this turn, which is the limit. Do not retry: finish your turn and tell the person which threads you still wanted to open, so they can open them or ask you again.`,
    });
  }
  const toBotId = typeof body.toBotId === "string" && body.toBotId.trim() ? body.toBotId.trim() : from.id;
  const target = store.bot(toBotId);
  if (!target) return json(res, 404, { error: "no such bot" });
  // workspace: where a thread of this bot on Auto starts (sub-agents,
  // server/computer/auto-computer.ts). Checked again at each of its turns.
  const autoWorkspace = body.workspace === undefined || body.workspace === null || body.workspace === "" ? null : parseAutoComputerTarget(body.workspace);
  if (body.workspace !== undefined && body.workspace !== null && body.workspace !== "" && !autoWorkspace) {
    return json(res, 400, { error: "workspace must be this_computer, browser, cloud or local_vm" });
  }
  if (autoWorkspace && target.id !== from.id) {
    return json(res, 400, { error: "workspace is only for a thread on yourself: a teammate works where its own Workspace says" });
  }
  const oneWay = body.oneWay === true;
  // send_to_bot reply "resume" (#3246): the recipient's settled turn wakes
  // the sender here with a short return line. Anything else stays one-way.
  const resumeSender = oneWay && body.reply === "resume";
  const wakeAsked = parseWakePriority(body.priority);
  if (wakeAsked === "invalid") return json(res, 400, { error: "priority is now or normal." });
  if (oneWay && target.id === from.id) {
    return json(res, 409, { error: "send_to_bot is cross-bot only; to work on yourself, do it in this turn (start_thread opens a separate job where you have it)" });
  }
  // A thread on a teammate, asked by a turn on the runtime, is
  // coordinate_bots with thread "new" (upstream OpenMausBot): a fresh
  // thread on the teammate titled by the call, answered with the
  // hand-off's receipts. Without that route, teamwork stays refused.
  const teammateThread = internalCapability.roomCoordination && target.id !== from.id && !oneWay;
  if (teammateThread && !coordinateTeammateThread) {
    return json(res, 409, { error: "Use coordinate_bots for teamwork; it queues actual teammates and resumes you automatically." });
  }
  if (internalCapability.roomCoordination) {
    if (target.id === from.id && !internalCapability.ownThreadCreation) {
      return json(res, 409, { error: "Only a direct user request can open separate self-owned threads. Finish this assigned work here; use coordinate_bots for teammates." });
    }
  }
  // A folder is the target's own organisation; a name is what the
  // model has, an id is what the sidebar has, so accept either.
  const folder = typeof body.folder === "string" ? body.folder.trim() : "";
  let projectId: string | undefined;
  if (folder) {
    const project = (target.projects ?? []).find(
      (candidate) => candidate.id === folder || candidate.name.trim().toLowerCase() === folder.toLowerCase(),
    );
    if (!project) {
      const names = (target.projects ?? []).map((candidate) => candidate.name).join(", ");
      return json(res, 400, { error: `@${target.name} has no folder named "${folder}"${names ? ` — the folders are: ${names}` : " — it has no folders; leave folder out"}` });
    }
    projectId = project.id;
  }
  const sourceTitle = owner.group ? owner.group.name : (store.taskByThread(from.id, fromThreadId)?.title ?? "");
  if ((readOnly || resumeId) && target.id !== from.id) {
    return json(res, 400, { error: "read_only and thread_id are for a thread on yourself: a teammate works at its own level, in its own threads" });
  }
  if (teammateThread && coordinateTeammateThread) {
    // nothing of a confidential conversation goes to another bot
    if (store.isConfidentialThread(fromThreadId)) return json(res, 403, { error: CONFIDENTIAL_PEER_REFUSED, code: "confidential_thread" });
    return coordinateTeammateThread({
      botIds: [target.id], message, thread: "new", reply: "resume", title,
      ...(projectId ? { projectId } : {}),
    });
  }
  if (resumeId) {
    const resumed = store.taskByThread(from.id, resumeId);
    // named from here only as list_threads would name it (lending view,
    // confidential threads), and for the same person's work
    const visible = !store.isConfidentialThread(resumeId);
    const refused = resumeRefusal(resumed as never, from.id, fromThreadId, {
      visible, ...(privateThreads() ? { ownerPrincipalId: openedThreadOwner(from, fromThreadId, from) } : {}),
    });
    if (refused || !resumed) return json(res, refused?.status ?? 404, { error: refused?.error ?? "no such thread" });
    // nothing of a confidential conversation goes into one that is not
    if (store.isConfidentialThread(fromThreadId)) return json(res, 403, { error: CONFIDENTIAL_PEER_REFUSED, code: "confidential_thread" });
    // read-only narrows the thread for good: Ask, no standing grants
    if (readOnly) store.patchTask(from.id, resumed.threadId, { approvalMode: "ask", autoApprove: false, alwaysAllow: [] });
    internalCapability.openedThreads += 1;
    const chip: Omit<Message, "id" | "at"> = {
      role: "bot",
      kind: "activity",
      tool: { name: `Resumed thread #${resumed.title}`, ok: true },
      threadRef: { botId: from.id, threadId: resumed.threadId, title: resumed.title },
    };
    if (owner.group) chip.from = { botId: from.id, name: from.name, color: from.color };
    store.appendMessage(fromThreadId, chip);
    const outcome = await startOrQueueOpenedThread(from.id, resumed.threadId, resumeOpening(message, sourceTitle, readOnly), isUnattended(from.id, fromThreadId), turnOrigin(internalCapability), fromThreadId);
    return json(res, 201, {
      threadId: resumed.threadId, title: resumed.title, botId: from.id, botName: from.name, self: true, resumed: true,
      ...(readOnly ? { readOnly: true } : {}), ...outcome,
    });
  }
  // report_back: a parallel task of this conversation, whose card shows
  // here and whose result is posted back here (shared/parallel-tasks.ts).
  if (target.id === from.id && body.reportBack === true && !owner.group && store.taskByThread(from.id, fromThreadId)) {
    internalCapability.openedThreads += 1;
    const speaker = peerSpeaker(from.id, fromThreadId);
    try {
      const started = await startParallelTask({
        botId: from.id, threadId: fromThreadId, text: subagentRequest(message, readOnly), title, byBot: true,
        ...(readOnly ? { approvalMode: "ask" as const } : {}),
        speaker, principalId: speaker && typeof speaker === "object" && "principalId" in speaker ? (speaker as { principalId?: string }).principalId : undefined,
        ...(autoWorkspace ? { autoWorkspace } : {}),
      });
      return json(res, 201, {
        threadId: started.parallel.threadId, title: started.parallel.title, botId: from.id, botName: from.name,
        self: true, parallel: true, state: started.parallel.state, limit: botMaxParallelPerPersonLocal(from),
        ...(readOnly ? { readOnly: true } : {}),
        ...(autoWorkspace ? { workspace: autoWorkspace } : {}),
      });
    } catch (error) {
      return json(res, (error as { status?: number }).status ?? 409, { error: error instanceof Error ? error.message : String(error) });
    }
  }
  if (target.id === from.id) {
    const inherited = parentThreadModel(from.id, fromThreadId);
    // a thread a confidential conversation opens is confidential, its owner's
    const task = store.createTask(from.id, title, false, projectId, { botId: from.id, name: from.name, at: Date.now() },
      readOnly ? "ask" : inherited.approvalMode, openedThreadOwner(from, fromThreadId, from), inherited.modelSelection, false, undefined, store.isConfidentialThread(fromThreadId));
    if (!task) return json(res, 500, { error: "couldn't create that thread" });
    if (autoWorkspace) store.patchTask(from.id, task.threadId, { autoWorkspace });
    threadStarters.set(task.threadId, openerFrom(fromThreadId));
    internalCapability.openedThreads += 1;
    const chip: Omit<Message, "id" | "at"> = {
      role: "bot",
      kind: "activity",
      tool: { name: `Opened thread #${task.title}`, ok: true },
      threadRef: { botId: from.id, threadId: task.threadId, title: task.title },
    };
    if (owner.group) chip.from = { botId: from.id, name: from.name, color: from.color };
    store.appendMessage(fromThreadId, chip);
    // The first line is the bot's own words. Say so where the model
    // reads it, so a later turn in that thread never mistakes the
    // request for the person's.
    const opening = `[Thread you opened yourself${sourceTitle ? ` from #${sourceTitle}` : ""}. The request below is your own words, not the person's: do the work here and end with a clear result they can read.]\n\n${subagentRequest(message, readOnly)}`;
    const outcome = await startOrQueueOpenedThread(from.id, task.threadId, opening, isUnattended(from.id, fromThreadId), turnOrigin(internalCapability), fromThreadId);
    return json(res, 201, {
      threadId: task.threadId,
      title: task.title,
      botId: from.id,
      botName: from.name,
      self: true,
      limit: botMaxConcurrentThreadsLocal(from),
      ...(readOnly ? { readOnly: true } : {}),
      ...(autoWorkspace ? { workspace: autoWorkspace } : {}),
      ...outcome,
    });
  }
  // A peer thread is a handoff into a fresh thread: every gate the
  // classic handoff has applies unchanged, here at queue time and
  // again in the drain at dispatch time.
  const depth = internalCapability.depth ?? 0;
  if (!oneWay && depth >= MAX_COMMS_DEPTH) {
    return json(res, 200, { error: "thread chains are limited to one hop — open the thread on yourself, or do this one here" });
  }
  if (!canAccessBot(from, target) || target.hidden || !peerInScope(from, target)) {
    return json(res, 403, { error: `that bot belongs to another person or is unavailable. ${PEER_ACCESS_HELP}` });
  }
  if (!peerAllowed(from, target)) {
    return json(res, 403, { error: `that bot is not on this bot's allowed peers. ${PEER_ACCESS_HELP}` });
  }
  // nothing of a confidential conversation is handed to another bot
  if (store.isConfidentialThread(fromThreadId)) return json(res, 403, { error: CONFIDENTIAL_PEER_REFUSED, code: "confidential_thread" });
  const task = store.createTask(target.id, title, false, projectId, { botId: from.id, name: from.name, at: Date.now() }, undefined, openedThreadOwner(from, fromThreadId, target));
  if (!task) return json(res, 500, { error: "couldn't create that thread" });
  // The work is still for the person whose request the opener is on.
  threadStarters.set(task.threadId, openerFrom(fromThreadId));
  applyDelegatedLevel(
    from,
    fromThreadId,
    target,
    task.threadId,
    internalCapability.roomHandoffId ?? internalCapability.generation,
  );
  const sourceUrl = threadRefUrl({ botId: owner.group?.id ?? from.id, threadId: fromThreadId });
  const handed = oneWay
    ? `${message}\n\n[Source conversation](${sourceUrl}). This link grants no additional access and contains no copied transcript.`
    : message;
  // Lot 3 (docs/runtime-contract.md §9): a thread opened on a teammate
  // runs on the job runtime. send_to_bot (oneWay) is a one-way notice:
  // ownership moves to the teammate, nothing resumes the sender, it
  // survives the sender's failed turn and runs once. start_thread on a
  // peer is work whose result returns to the sender. Normal priority
  // starts when the sender's turn ends, priority now at once when a slot
  // is free (else first in the teammate's queue); a sender whose peer
  // comms need review waits for the person's card after its turn.
  const slotFree = !botAtThreadCapacity(target.id) && !activeGroupTurnForBot(target.id);
  const needsApproval = peerReviewRequired(from, fromThreadId);
  const wakePlan = planPriorityWake({
    asked: wakeAsked,
    applies: oneWay,
    slotFree,
    needsApproval,
    senderId: from.id,
    now: Date.now(),
  });
  const priorityFields = wakePlan.reported
    ? { priority: wakePlan.reported, ...(wakePlan.downgraded ? { downgraded: true } : {}) }
    : {};
  const address = { ...(owner.group ? { groupId: owner.group.id } : {}), threadId: fromThreadId, botId: from.id };
  const destination = { threadId: task.threadId, botId: target.id };
  // #3463: the piece of work, the step and the plan the sender named; a
  // bot named in the plan resolves like coordinate_bots' bot_ids
  const label = workLabel(body, (raw) => { const found = resolveTeammate(store.bots, from, raw); return "id" in found ? found.id : undefined; });
  const extra = { ...(wakePlan.reported === "now" ? { priority: "now" as const } : {}), ...(label ? { work: label } : {}) };
  let node: HandoffView;
  try {
    node = pollOnlyCaller(internalCapability)
      ? coordinator.enqueueExternal(address, destination, handed, false, oneWay ? "notify" : "work",
        idempotencyKeyOf(body, req.headers["idempotency-key"]), extra).node
      : coordinator.enqueue(address, internalCapability.generation, internalCapability.roomHandoffId, destination, target.id, handed, false, false,
        [...store.messagesFor(fromThreadId)].reverse().find(m => m.role === "user" && m.kind === "text")?.text ?? "", undefined,
        turnOrigin(internalCapability), oneWay ? "notify" : "work", joinPerson(fromThreadId), false, undefined,
        coordinationRequestId?.(fromThreadId) ?? directRequestOwners.get(fromThreadId)?.messageId, extra).node;
  } catch (error) {
    if (wakePlan.reported === "now") releasePriorityNow(from.id);
    // nothing will ever run there: take the row back before the person
    // sees a thread that goes nowhere
    store.deleteTask(target.id, task.threadId);
    return json(res, 200, { error: error instanceof Error ? error.message : String(error) });
  }
  if (node.threadId !== task.threadId) {
    // The same request already went out this turn: it keeps its thread.
    store.deleteTask(target.id, task.threadId);
  }
  const threadId = node.threadId;
  if (oneWay) notePeerNotice?.(threadId, fromThreadId);
  // send_to_bot notify false: the teammate's reply there lands without alerting anyone
  if (oneWay && body.notify === false) setReplyNotify?.(threadId, false);
  const openedTitle = store.taskByThread(target.id, threadId)?.title ?? task.title;
  if (threadId === task.threadId) {
    const chip: Omit<Message, "id" | "at"> = {
      role: "bot",
      kind: "activity",
      tool: { name: `Opened thread #${openedTitle} on ${target.name}`, ok: true, ...(oneWay ? { input: message } : {}) },
      threadRef: { botId: target.id, threadId, title: openedTitle },
      // #3246: « Sent to <Bot> » with the state of its thread, kept current
      // by the runtime (server/team/send-receipts.ts).
      ...(oneWay ? { sendReceipt: { id: node.id, senderId: from.id, botId: target.id, threadId,
        state: sendStateOf(node.status), ...(resumeSender ? { resume: true as const } : {}) } } : {}),
    };
    if (owner.group && !owner.group.dm) chip.from = { botId: from.id, name: from.name, color: from.color };
    store.appendMessage(fromThreadId, chip);
    store.setTaskOpenedBy(target.id, threadId, { botId: from.id, name: from.name, delegationId: node.id,
      // #3246: where the send came from, so send_status and reply "resume"
      // find the sender's conversation once its own turn is gone.
      ...(oneWay ? { threadId: fromThreadId, ...(resumeSender ? { reply: "resume" as const } : {}) } : {}),
      at: task.openedBy?.at ?? Date.now() });
    internalCapability.openedThreads += 1;
  }
  delegatedThisTurn(node.id);
  coordinator.tick();
  const current = coordinator.node(node.id) ?? node;
  // An honest forecast, not a promise: by the time it starts, the
  // target's slots are taken by whatever runs there plus the work
  // queued on it ahead of this one.
  const limit = botMaxConcurrentThreadsLocal(target);
  const running = store.tasks(target.id).filter((candidate) => threadBusy(target.id, candidate.threadId)).length;
  const ahead = coordinator.active().filter((pending) => pending.status === "queued" && pending.botId === target.id && pending.id !== node.id &&
    (pending.priority === "now" || current.priority !== "now")).length;
  const position = running + ahead + 1;
  const handle = signTurnHandle(agentApiSecret(), {
    agentId: target.id,
    threadId,
    messageId: null,
    issuedAt: Date.now(),
    callerId: from.id,
    callerKind: "bot",
  });
  return json(res, 201, {
    threadId,
    title: openedTitle,
    botId: target.id,
    botName: target.name,
    self: false,
    delegationId: node.id,
    approvalRequired: needsApproval && !current.approvalGranted,
    limit,
    ...(current.status === "running" ? { state: "running" } : position > limit ? { state: "queued", position: position - limit } : { state: "pending" }),
    ...(oneWay ? { handle } : {}),
    ...(resumeSender ? { reply: "resume" } : {}),
    ...priorityFields,
    // the names of the open pieces of work, so the next send reuses one
    ...(pollOnlyCaller(internalCapability) ? {} : openWorkEcho(coordinator.handedOutBy?.bind(coordinator), from.id, joinPerson(fromThreadId),
      (threadId) => store.isConfidentialThread(threadId))),
  });
}
