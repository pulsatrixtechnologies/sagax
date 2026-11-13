// @ts-nocheck
/** startParallelTask (#1388). Pure move from server/index.ts. */
import { join } from "node:path";
import { parallelAdmission, parallelBrief, parallelResourceBlocked, parallelTaskTitle, prepareParallelWorkspace } from "../parallel-tasks.ts";
export type Host = Record<string, any>;

export function createStartParallelTask(getHost: () => Host): any {
async function startParallelTask(input: {
  botId: string;
  threadId: string;
  text: string;
  replyTo?: Message;
  sendId?: string;
  sender?: ResolvedSender;
  trigger?: UsageTrigger;
  speaker?: TurnSpeaker;
  /** The asker's key for the per-person limit (absent: the operator). */
  principalId?: string;
  /** The bot itself opened it (start_thread with report_back). */
  byBot?: boolean;
  /** The task's name, when the bot gave one. */
  title?: string;
  /** Org audit actor. */
  auth?: RequestAuth;
  /** Live call: the request was said on the call. */
  voiceCall?: Message["voiceCall"];
  /** #4216: said on a call whose voice runs on the server (Message.via, Message.callId). */
  via?: "call";
  callId?: string;
  /** start_thread `workspace`: where its Auto turns start. */
  autoWorkspace?: AutoComputerTarget;
  /** start_thread `read_only` (server/threads/subagent-threads.ts): never wider than Ask. */
  approvalMode?: "ask";
  /** route_message parallel: the person's row already in the conversation
   * (steered into the running turn) becomes the request line; no second row. */
  existingRequestId?: string;
  /** The files or records it writes (route_message): one queue per resource. */
  resources?: string[];
}): Promise<{ ok: true; threadId: string; message: Message; parallel: { threadId: string; title: string; state: ParallelTaskState; cardMessageId: string } }> {
  const host = getHost();
  const { DATA_DIR, appendAdminAction, approvalModeFor, botMaxParallelPerPerson, ensureTaskWorkspace, hasQueuedSteeredMessages, queueSteeredMessage } = host;
  const bot = host.store.bot(input.botId);
  const parentTask = bot ? host.store.taskByThread(bot.id, input.threadId) : undefined;
  if (!bot || !parentTask) throw Object.assign(new Error("the target task no longer exists"), { status: 409 });
  if (parentTask.parallelOf && !input.byBot) {
    // A task of a task would answer into a conversation nobody is reading.
    throw Object.assign(new Error("this conversation is already a parallel task; send it here or in the main conversation"), { status: 409, code: "parallel_nested" });
  }
  const limit = botMaxParallelPerPerson(bot, host.cfg);
  const admission = parallelAdmission({
    tasks: host.store.tasks(bot.id),
    principalId: input.principalId,
    limit,
    queued: (id) => !host.threadBusy(bot.id, id) && hasQueuedSteeredMessages(bot.id, id)
  });
  if (admission.action === "refuse") {
    throw Object.assign(new Error(`you already have ${admission.running} parallel tasks running and ${admission.waiting} waiting on this bot; wait for one to finish`), { status: 409, code: "parallel_limit" });
  }
  const title = input.title?.trim() || parallelTaskTitle(input.text);
  const inherited = host.parentThreadModel(bot.id, input.threadId);
  // #1169/#1170: it follows the bot's level like its conversation, unless
  // that conversation holds an exception (a delegated Full), which it shares.
  const parentOwnFull = parentTask.approvalOwn !== undefined && approvalModeFor(parentTask) === "full";
  const childLevel = input.approvalMode ?? inherited.approvalMode ?? (parentOwnFull ? "full" : undefined);
  const child = host.store.createTask(bot.id, title, false, parentTask.projectId, undefined,
    childLevel,
    parentTask.ownerPrincipalId, inherited.modelSelection ?? parentTask.modelSelection,
    // a parallel task of a confidential conversation is confidential too, its owner's
    false, undefined, parentTask.confidential === true,
    input.approvalMode ? "thread" : inherited.approvalMode ? "engine" : parentOwnFull ? parentTask.approvalOwn : undefined);
  if (!child) throw Object.assign(new Error("couldn't create the parallel task"), { status: 500 });
  // Where it works: a worktree of the conversation's repository, else the
  // same folder (the brief says it is shared), else its own task folder.
  const parentProjected = host.store.projectBotForTask(bot.id, input.threadId) ?? bot;
  const parentCwd = parentTask.cwd !== undefined ? parentTask.cwd : parentProjected.cwd;
  const workspace = await prepareParallelWorkspace({
    parentCwd, privateRoot: join(DATA_DIR, "task-workspaces"), root: join(DATA_DIR, "parallel-worktrees"), botId: bot.id, threadId: child.threadId
  });
  // A worktree is the task's folder; otherwise it keeps its own private one
  // (never the conversation's: two turns never share a working folder).
  host.store.patchTask(bot.id, child.threadId, {
    cwd: workspace.kind === "worktree" ? workspace.cwd : ensureTaskWorkspace(bot.id, child.threadId),
    ...(input.autoWorkspace ? { autoWorkspace: input.autoWorkspace } : {})
  });
  const now = Date.now();
  // The request line, in the conversation the person is reading. A task the
  // bot opened has no person's words to show: its card is the anchor.
  const existingRequest = input.existingRequestId
    ? host.store.patchMessage(input.threadId, input.existingRequestId, {
      steered: false,
      parallelTask: { threadId: child.threadId, title, requestMessageId: input.existingRequestId, role: "request" }
    })
    : null;
  const request = input.byBot ? null : existingRequest ?? host.store.appendMessage(input.threadId, {
    role: "user",
    kind: "text",
    text: input.text,
    replyToId: input.replyTo?.id,
    sendId: input.sendId,
    ...(input.sender ? { sender: input.sender } : {}),
    ...(input.voiceCall ? { voiceCall: input.voiceCall } : {}),
    ...host.spokenLineFields(input.via, input.callId),
    parallelTask: { threadId: child.threadId, title, requestMessageId: "", role: "request" }
  });
  if (request && !existingRequest) {
    host.store.patchMessage(input.threadId, request.id, {
      parallelTask: { threadId: child.threadId, title, requestMessageId: request.id, role: "request" }
    });
  }
  const card = host.store.appendMessage(input.threadId, {
    role: "bot",
    kind: "activity",
    tool: { name: `Parallel task #${title}`, ok: true },
    threadRef: { botId: bot.id, threadId: child.threadId, title },
    parallelTask: { threadId: child.threadId, title, requestMessageId: request?.id ?? "", role: "card", state: "queued", startedAt: now }
  });
  const anchorId = request?.id ?? card.id;
  if (!request) host.patchParallelCard(input.threadId, card.id, { requestMessageId: card.id });
  host.store.setTaskParallelOf(bot.id, child.threadId, {
    threadId: input.threadId, messageId: anchorId, cardMessageId: card.id, at: now,
    ...(input.principalId ? { principalId: input.principalId } : {}),
    ...(input.byBot ? { byBot: true } : {}),
    ...(input.resources?.length ? { resources: input.resources } : {}),
    ...(input.existingRequestId ? { routed: true } : {})
  });
  if (host.IDENTITY.kind === "perspicax") {
    appendAdminAction(DATA_DIR, {
      category: "bot",
      action: "task.parallel_start",
      target: host.auditBotTarget(bot.id),
      after: { threadId: child.threadId, conversation: input.threadId, ...(input.byBot ? { byBot: true } : {}) },
      actor: input.auth ? host.orgAuditActor(input.auth) : { kind: "worker" }
    });
  }
  const recent: BriefLine[] = host.store.activePath(input.threadId)
    .filter((message) => message.id !== anchorId && message.kind === "text" && message.text?.trim()
      && (message.role === "user" || message.role === "bot") && !message.parallelTask)
    .slice(-6)
    .map((message) => ({ role: message.role === "user" ? "user" as const : "bot" as const, text: message.text!, ...(message.sender?.name ? { name: message.sender.name } : {}) }));
  const brief = parallelBrief({
    request: host.promptWithReply(input.text, input.replyTo, input.sender?.name || host.cfg.profile?.name?.trim() || "User"),
    conversationTitle: parentTask.title,
    recent,
    workspace,
    personName: input.sender?.name || host.cfg.profile?.name?.trim() || "The person",
    byBot: input.byBot,
    ...(host.voiceCalls.active(input.threadId) ? { history: host.callHandoffHistory(bot, input.threadId, anchorId) } : {})
  });
  const reply = (state: ParallelTaskState) => ({
    ok: true as const, threadId: input.threadId, message: host.store.messagesFor(input.threadId).find((m) => m.id === anchorId) ?? request ?? card,
    parallel: { threadId: child.threadId, title, state, cardMessageId: card.id }
  });
  // Another pending task holds one of its resources: it waits in that
  // resource's line (parallelResourceBlocked), and the drain starts it after.
  const resourceBusy = parallelResourceBlocked({ task: host.store.taskByThread(bot.id, child.threadId)!, tasks: host.store.tasks(bot.id), busy: (id) => host.threadBusy(bot.id, id) });
  const mustQueue = admission.action === "queue" || resourceBusy || host.botAtThreadCapacity(bot.id) || Boolean(host.activeGroupTurnForBot(bot.id));
  if (mustQueue) {
    queueSteeredMessage(bot.id, child.threadId, input.text, {
      prompt: brief, reason: "capacity", sender: input.sender, trigger: input.trigger, speaker: input.speaker,
      ...(input.byBot ? { unattended: host.isUnattended(bot.id, input.threadId) } : {})
    });
    return reply("queued");
  }
  const userMessage = host.store.appendMessage(child.threadId, {
    role: "user", kind: "text", text: input.text, ...(input.sender ? { sender: input.sender } : {})
  });
  try {
    await host.startTurn(bot.id, brief, {
      threadId: child.threadId, userMessage, excludeMessageIds: [userMessage.id],
      sender: input.sender, trigger: input.trigger, speaker: input.speaker,
      ...(input.byBot ? { unattended: host.isUnattended(bot.id, input.threadId), autoWorker: true } : {}),
      onTurnSettled: () => host.settleParallelFallback(child.threadId)
    });
  } catch (error) {
    host.settleParallelTask(child.threadId, { ok: false, reply: "", why: error instanceof Error ? error.message : String(error) });
    return reply("failed");
  }
  host.patchParallelCard(input.threadId, card.id, { state: "running" });
  return reply("running");

}
  return startParallelTask;
}
