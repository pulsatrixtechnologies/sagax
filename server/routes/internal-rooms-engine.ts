// POST /api/internal/run-with-engine (#1383). Matches this path itself and returns PASS otherwise.
import type { ModelSelection } from "../../shared/model-selection.ts";
import { newId } from "../contracts.ts";
import { chooseRelayEngine, relayOpening, relayResultText, relayThreadLevel } from "../run-with-engine.ts";
import { CONFIDENTIAL_PEER_REFUSED } from "../threads/confidential-threads.ts";
import { MAX_COMMS_DEPTH, type InternalRoomsCall } from "./internal-rooms-types.ts";
import { PASS } from "./table.ts";

export async function handleRunWithEngine(call: InternalRoomsCall): Promise<typeof PASS | void> {
  // start_thread: a bot opens a real thread — on itself for separate
  // work, or on a teammate as a handoff that should run on its own.
  // Never activates: a bot must not move what the person is looking at.
  // run_with_engine (server/run-with-engine.ts): one part of this bot's
  // work on another engine or model this turn's payer may use, in a
  // fresh thread of the same bot, for the same person, at the same
  // approval level; the result comes back to this call.

  const {
    res,
    path,
    method,
    json,
    internalCapability,
    readInternalBody,
    store,
    delegationWatch,
    threadStarters,
    connectorThread,
    peerSpeaker,
    cloudGuestDriven,
    botmailConfined,
    relayEnginesFor,
    openedThreadOwner,
    openerFrom,
    noteRelayParent,
    isRelayPart,
    askBotAndWait,
    externalCompletion,
    activeRoutineRunForThread,
    cfg,
    botTurnLimitLocal,
    approvalModeFor,
    mcpCallTimeoutMinutes,
    registry,
    delegatedThisTurn,
    requireActiveInternalCapability,
    internalSender,
  } = call;
  if (!(method === "POST" && path === "/api/internal/run-with-engine")) return PASS;
  const body = await readInternalBody();
  const from = internalSender;
  const fromThreadId = internalCapability.threadId;
  const owner = connectorThread(from.id, fromThreadId);
  if (!owner) return json(res, 403, { error: "source conversation does not belong to sender" });
  if (owner.group) return json(res, 409, { error: "run_with_engine works from a direct conversation only; in a room, use coordinate_bots with a teammate on that engine." });
  if (body.depth !== undefined && (!Number.isInteger(body.depth) || body.depth !== internalCapability.depth)) {
    return json(res, 403, { error: "the recursion depth does not match this turn" });
  }
  // The part itself never hands a part on again. A teammate's work turn
  // (depth 1, coordinate_bots) is no part: it may run its own part on
  // another engine, as its prompt says (production 2026-11-03 00:09 UTC: a teammate,
  // on an engine without Outlook, was refused this in 6 ms and its turn
  // ended in tool_error). Its part runs one level deeper and stops there.
  if (isRelayPart(fromThreadId) || internalCapability.depth > MAX_COMMS_DEPTH) {
    return json(res, 409, { error: "This turn is already a part run on another engine: do this work here." });
  }
  const message = typeof body.message === "string" ? body.message.trim() : "";
  const engineAsked = typeof body.engine === "string" ? body.engine : "";
  if (!message || !engineAsked.trim()) return json(res, 400, { error: "engine and message are required" });
  if (message.length > 20_000) return json(res, 400, { error: "message must be at most 20000 characters" });
  const threadLimit = botTurnLimitLocal(from, "threadsOpened");
  if (internalCapability.openedThreads >= threadLimit) {
    // V4: thread limit is an intended stop (200 non-isError), not a red 429.
    return json(res, 200, {
      applied: false,
      limit: true,
      message: `You have already opened ${threadLimit} threads this turn, which is the limit. Finish your turn and tell the person what is left.`,
    });
  }
  // nothing of a confidential conversation leaves it, even to the same bot elsewhere
  if (store.isConfidentialThread(fromThreadId)) return json(res, 403, { error: CONFIDENTIAL_PEER_REFUSED, code: "confidential_thread" });
  // the same person, the same credentials and routine lineage as this turn
  const speaker = peerSpeaker(from.id, fromThreadId);
  const confined = cloudGuestDriven(fromThreadId) || botmailConfined(fromThreadId);
  const engines = relayEnginesFor(from, speaker, confined);
  const current = store.projectBotForTask(from.id, fromThreadId)?.modelSelection ?? from.modelSelection;
  const choice = chooseRelayEngine({
    engine: engineAsked,
    ...(typeof body.model === "string" && body.model.trim() ? { model: body.model.trim() } : {}),
    engines,
    current: {
      instanceId: current.instanceId,
      model: current.model,
      ...(current.account ? { account: current.account } : {}),
    },
  });
  if (!choice.ok) return json(res, 200, { error: choice.error });
  // a level the engine cannot run becomes Ask in that thread (parentThreadModel)
  const relayLevel = relayThreadLevel({
    botLevel: approvalModeFor(from),
    fromDriver: registry.cliTarget(from.modelSelection.instanceId)?.driverKind,
    toDriver: choice.driverKind,
  });
  const rawTitle = typeof body.title === "string" ? body.title.replace(/\s+/g, " ").trim() : "";
  const title = (rawTitle || message.replace(/\s+/g, " ")).slice(0, 60).trim() || `On ${choice.engineLabel}`;
  // the part runs on the sign-in named (a second Grok account in its own folder)
  const selection: ModelSelection = { instanceId: choice.instanceId, model: choice.model, ...(choice.account ? { account: choice.account } : {}) };
  const task = store.createTask(from.id, title, false, undefined, { botId: from.id, name: from.name, at: Date.now() },
    relayLevel, openedThreadOwner(from, fromThreadId, from), selection, false, undefined, false);
  if (!task) return json(res, 500, { error: "couldn't open a thread for that part" });
  threadStarters.set(task.threadId, openerFrom(fromThreadId));
  noteRelayParent(task.threadId, fromThreadId);
  internalCapability.openedThreads += 1;
  store.appendMessage(fromThreadId, {
    role: "bot",
    kind: "activity",
    tool: { name: `Ran on ${choice.engineLabel} (${choice.model}): #${task.title}`, ok: true },
    threadRef: { botId: from.id, threadId: task.threadId, title: task.title },
  });
  const sourceTitle = store.taskByThread(from.id, fromThreadId)?.title ?? "";
  const waitMs = Math.max(5_000, Math.min(
    Number(process.env.SAGAX_RUN_WITH_ENGINE_WAIT_MS) || 300_000,
    mcpCallTimeoutMinutes(cfg) * 60_000 - 30_000,
  ));
  const outcome = await askBotAndWait(from.id, relayOpening({ engineLabel: choice.engineLabel, sourceTitle, message }),
    internalCapability.depth ?? 0, from.id, fromThreadId, task.threadId, { timeoutMs: waitMs, selfRelay: true });
  requireActiveInternalCapability();
  if (outcome.status === "timeout" && !delegationWatch.has(task.threadId)) {
    // still running: the result is delivered here when it settles
    const taskId = newId();
    delegationWatch.set(task.threadId, {
      toBotId: from.id,
      toBotName: from.name,
      taskId,
      sourceThreadId: fromThreadId,
      sourceBotId: from.id,
      routineRunId: activeRoutineRunForThread(fromThreadId)?.id,
      startedAtMs: Date.now() - waitMs,
      ...externalCompletion(internalCapability),
    });
    delegatedThisTurn(taskId);
    return json(res, 200, { timeout: true, taskId, engineLabel: choice.engineLabel, threadId: task.threadId });
  }
  const status = (outcome.status === "timeout" ? "reply" : outcome.status) as "reply" | "failed" | "error";
  return json(res, 200, {
    status,
    engineLabel: choice.engineLabel,
    model: choice.model,
    threadId: task.threadId,
    text: relayResultText({ engineLabel: choice.engineLabel, model: choice.model, status, text: outcome.text ?? "" }),
  });
}
