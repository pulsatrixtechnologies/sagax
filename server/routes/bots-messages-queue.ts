/**
 * Queue delete, parallel-task stop, and steer-into-running-turn (#1388 B3).
 * Never imports server/index.ts.
 */
import { randomUUID } from "node:crypto";
import { notePersonWrote } from "../team-work/person-note.ts";

import type { SteerOutcome } from "../contracts.ts";
import {
  cloudGuestSendRefusal,
  cloudThreadRefusal,
} from "../cloud-thread-refusal.ts";
import { DATA_DIR } from "../config.ts";
import { recordHeldSteer } from "../turns/held-steers.ts";
import { spokenLineFields } from "../voice/live-call-record.ts";
import {
  cancelSteeredMessage,
  holdSteeredQueue,
  restoreHeldSteeredQueue,
  settleHeldSteeredQueue,
} from "../turns/steer-queue.ts";
import { extractTurnImages } from "../turns/turn-images.ts";
import { voiceCallSteerPrompt } from "../voice/voice-call-prompt.ts";
import { reopenCancelledPress } from "../widgets/chat-widgets.ts";
import type { BotsMessagesRouteDeps } from "./bots-messages-deps.ts";
import { PASS, type RouteContext, type RouteHandler } from "./table.ts";

async function handleQueueDelete(deps: BotsMessagesRouteDeps, ctx: RouteContext): Promise<typeof PASS | void> {
  const { req, res, path, method, auth, json, readBody } = ctx;
  const { requirePinnedClientThread, requestedTaskBot, store } = deps;
  let m: RegExpMatchArray | null = null;

  m = path.match(/^\/api\/bots\/([\w-]+)\/queue\/([\w-]+)$/);
  if (m && method === "DELETE") {
    const body = await readBody(req);
    requirePinnedClientThread(auth, req, m[1], body?.threadId);
    const bot = requestedTaskBot(m[1], body?.threadId);
    const queueId = m[2];
    if (!cancelSteeredMessage(bot.id, queueId, bot.threadId)) {
      return json(res, 404, { error: "no such queued message" });
    }
    // The words never reached the bot. If they were the answer to a
    // widget, it takes an answer again.
    reopenCancelledPress(store, bot.threadId, queueId);
    return json(res, 200, { ok: true });
  }
  return PASS;
}

async function handleParallelStop(deps: BotsMessagesRouteDeps, ctx: RouteContext): Promise<typeof PASS | void> {
  const { res, path, method, auth, json } = ctx;
  const { routeThreadId, stopParallelTask, store } = deps;
  let m: RegExpMatchArray | null = null;

  // Stop one parallel task (shared/parallel-tasks.ts): its running turn,
  // or its place in line. The conversation it answers gets the outcome.
  m = path.match(/^\/api\/bots\/([\w-]+)\/parallel\/([\w-]+)\/stop$/);
  if (m && method === "POST") {
    const bot = store.bot(m[1]);
    if (!bot) return json(res, 404, { error: "no such bot" });
    const taskThreadId = routeThreadId(bot, m[2], "thread.post");
    const notYours = cloudThreadRefusal(auth, taskThreadId);
    if (notYours) return json(res, 403, { error: notYours });
    const outcome = await stopParallelTask(bot.id, taskThreadId);
    if (outcome === "not_pending") return json(res, 404, { error: "no running or waiting parallel task there" });
    return json(res, 200, { ok: true, outcome });
  }
  return PASS;
}

async function handleQueueSteer(deps: BotsMessagesRouteDeps, ctx: RouteContext): Promise<typeof PASS | void> {
  const { req, res, path, method, auth, json, readBody } = ctx;
  const {
    DESKTOP_MANAGED, clearUnattended, drainQueuedSends, handoffs, requirePinnedClientThread,
    requestedTaskBot, runningTurnInstance, store,
  } = deps;
  let m: RegExpMatchArray | null = null;

  // Steer a queued message into the RUNNING turn (no interrupt). Engines
  // without a live steer keep the queue; this never ends the current turn.
  m = path.match(/^\/api\/bots\/([\w-]+)\/queue\/([\w-]+)\/steer$/);
  if (m && method === "POST") {
    const body = await readBody(req);
    requirePinnedClientThread(auth, req, m[1], body?.threadId);
    const bot = requestedTaskBot(m[1], body?.threadId);
    // Steered words reach the running turn like a sent line, so a Cloud
    // guest steers only in a conversation it started (as it sends).
    const steerRefusal = cloudGuestSendRefusal(auth, bot.threadId);
    if (steerRefusal) return json(res, 403, { error: steerRefusal });
    // Pressing Steer folds the queued words into the running turn. It does
    // not re-book that turn to whoever pressed it, and the words keep the
    // sender they were queued with.
    // Lift the whole queue atomically: a settle racing this request can
    // drain it as a follow-up, or this request can steer it into the live
    // turn — never both for the same words.
    const held = holdSteeredQueue(bot.id, bot.threadId, m[2]);
    if (!held) return json(res, 404, { error: "no such queued message" });
    // A live steer has no image side channel. Attachment words wait for a
    // real turn where central admission can hand the images to the engine.
    if (held.items.some((item: any) => {
      const resolved = extractTurnImages(item.text);
      return resolved.images.length > 0 || resolved.videos.length > 0;
    })) {
      restoreHeldSteeredQueue(held);
      return json(res, 200, { ok: true, queued: true, threadId: bot.threadId });
    }
    const currentAtStart = store.projectBotForTask(bot.id, bot.threadId);
    const instance = currentAtStart?.busy ? runningTurnInstance(currentAtStart, bot.threadId) : undefined;
    // words said on a call keep their call mark when they join the turn
    const prompt = held.items.map((item: any) => voiceCallSteerPrompt(item.prompt, item.voiceCall)).join("\n\n");
    const steerTarget = handoffs.current(bot.threadId);
    let steered: SteerOutcome = "refused";
    const steerId = randomUUID();
    if (currentAtStart?.busy && instance?.adapter.capabilities.queueing && instance.adapter.steer) {
      steered = await instance.adapter
        .steer(bot.threadId, prompt, { steerId })
        .catch((): SteerOutcome => "indeterminate");
    }
    // The steer was awaited adapter work: re-read every ownership
    // invariant before writing anything, exactly like the live-send path.
    const current = store.projectBotForTask(bot.id, bot.threadId);
    // "indeterminate" never restores: the words may already be folded into
    // the turn that was live when they were sent, and replaying them into
    // a fresh follow-up turn would run them twice. Record them whenever
    // the destination still exists, busy or not.
    if (
      (steered === "steered" && current?.busy ||
        steered === "indeterminate" && current) &&
      store.taskByThread(bot.id, bot.threadId)
    ) {
      if (auth.kind === "session" || DESKTOP_MANAGED) clearUnattended(bot.threadId);
      const messages = held.items.map((item: any) => store.appendMessage(bot.threadId, {
        role: "user",
        kind: "text",
        text: item.text,
        replyToId: item.replyToId,
        sendId: item.sendId,
        ...(item.dataContext ? { dataContext: item.dataContext } : {}),
        queueId: item.messageId,
        peerAsk: item.peerAsk,
        steered: true,
        sender: item.sender,
        ...(item.voiceCall ? { voiceCall: item.voiceCall } : {}),
        ...spokenLineFields(item.via, item.callId),
      }));
      // Words a person queued are written here once steered in, as once a
      // drained turn starts with them (startTurn); a bot's own never are.
      const asked = messages.filter((_, index) => !held.items[index]?.unattended && !held.items[index]?.peerAsk).at(-1);
      if (asked) {
        store.setTaskAskedAt(bot.id, bot.threadId, asked.at);
        // #3461: the bot that opened this thread is told what the person wrote
        notePersonWrote({ botId: bot.id, threadId: bot.threadId, text: asked.text ?? "", at: asked.at });
      }
      // Offered to the next turn again unless the person stops this one.
      // one steer carried them all: the engine taking it in takes them all
      for (const message of messages) {
        handoffs.steered(bot.threadId, steerTarget, instance?.instanceId, message.id, steerId);
        try {
          recordHeldSteer(DATA_DIR, {
            botId: bot.id, threadId: bot.threadId, messageId: message.id,
            text: typeof message.text === "string" ? message.text : "", at: message.at,
          });
        } catch (error) {
          console.warn(`held-steers: could not record steered queue: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      const queueIds = held.items.map((item: any) => item.messageId);
      settleHeldSteeredQueue(held);
      return json(res, 200, { ok: true, steered: true, threadId: bot.threadId, messages, queueIds });
    }
    if (steered === "indeterminate") {
      // No destination is left: settle so a restart cannot replay words a
      // dead turn may already have run.
      settleHeldSteeredQueue(held);
      if (!store.taskByThread(bot.id, bot.threadId)) {
        throw Object.assign(new Error("the target task no longer exists"), { status: 409 });
      }
      throw Object.assign(new Error("no such bot"), { status: 404 });
    }
    restoreHeldSteeredQueue(held);
    // The turn may have settled while the steer was refused; a queue that
    // is now drainable must not strand behind a missed settle.
    if (current && !current.busy) drainQueuedSends();
    return json(res, 200, { ok: true, queued: true, threadId: bot.threadId });
  }
  return PASS;
}

export function createBotsMessagesQueueDeleteRoutes(deps: BotsMessagesRouteDeps): RouteHandler {
  return (ctx) => handleQueueDelete(deps, ctx);
}

export function createBotsMessagesParallelStopRoutes(deps: BotsMessagesRouteDeps): RouteHandler {
  return (ctx) => handleParallelStop(deps, ctx);
}

export function createBotsMessagesQueueSteerRoutes(deps: BotsMessagesRouteDeps): RouteHandler {
  return (ctx) => handleQueueSteer(deps, ctx);
}
