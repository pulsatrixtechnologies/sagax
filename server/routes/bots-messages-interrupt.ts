/**
 * POST /api/bots/:id/interrupt (#1388 B3).
 * Never imports server/index.ts.
 */
import { pinVoiceInterrupt } from "../voice/voice-call-duplex.ts";
import type { BotsMessagesRouteDeps } from "./bots-messages-deps.ts";
import { PASS, type RouteContext, type RouteHandler } from "./table.ts";

async function handleInterrupt(deps: BotsMessagesRouteDeps, ctx: RouteContext): Promise<typeof PASS | void> {
  const { req, res, path, method, auth, json, readBody } = ctx;
  const {
    activeGroupTurnForBot, botForThread, cancelDirectTurnDispatch, cancelGroupTurnOperations, closeOpenApprovals,
    directTurnDispatchClaims, liveVoiceUtteranceByThread, registry, requirePinnedClientThread, revokeInternalCapabilitiesForThread,
    routeThreadId, routines, scopedThreadViewer, stopDirectThreadByPerson, store, videoGenerations, viewerBotLevel,
  } = deps;
  let m: RegExpMatchArray | null = null;

  m = path.match(/^\/api\/bots\/([\w-]+)\/interrupt$/);
  if (m && method === "POST") {
    const bot = store.bot(m[1]);
    if (!bot) return json(res, 404, { error: "no such bot" });
    const rawBody = await readBody(req);
    if (rawBody !== null && (typeof rawBody !== "object" || Array.isArray(rawBody))) {
      return json(res, 400, { error: "body must be a JSON object" });
    }
    const body = rawBody ?? {};
    requirePinnedClientThread(auth, req, bot.id, body.threadId);
    if (body.expectedUtteranceId !== undefined && (typeof body.expectedUtteranceId !== "string" || !/^[\w-]+$/.test(body.expectedUtteranceId))) {
      return json(res, 400, { error: "expectedUtteranceId must be an utterance id" });
    }
    const expectedUtteranceId = typeof body.expectedUtteranceId === "string" ? body.expectedUtteranceId : undefined;
    // Organization server: a person stops their own thread only, never
    // the bot's work for someone else (another person's thread, a room,
    // the owner's routine). The owner keeps the whole-bot stop.
    const stopper = scopedThreadViewer();
    if (stopper && !(viewerBotLevel(auth, bot) === "owner")) {
      const own = routeThreadId(bot, body.threadId);
      if (expectedUtteranceId && pinVoiceInterrupt({
        expectedUtteranceId,
        liveUtteranceId: liveVoiceUtteranceByThread.get(own),
      }) === "skip") {
        return json(res, 200, { ok: true, skipped: true });
      }
      const run = routines!.activeBotRunForBot(bot.id);
      if (run?.threadId === own) await routines!.cancelRun(run.id);
      else await stopDirectThreadByPerson(bot.id, own, expectedUtteranceId);
      return json(res, 200, { ok: true });
    }
    if (stopper && body.threadId !== undefined) routeThreadId(bot, body.threadId);
    const expectedThreadId = body.threadId;
    if (expectedThreadId !== undefined && (typeof expectedThreadId !== "string" || !/^[\w-]+$/.test(expectedThreadId))) {
      return json(res, 400, { error: "threadId must be a task id" });
    }
    if (expectedUtteranceId && pinVoiceInterrupt({
      expectedUtteranceId,
      liveUtteranceId: liveVoiceUtteranceByThread.get(typeof expectedThreadId === "string" ? expectedThreadId : bot.threadId),
    }) === "skip") {
      return json(res, 200, { ok: true, skipped: true });
    }
    // Explicit thread targets never fall through to another routine or
    // channel just because it belongs to the same bot.
    if (typeof expectedThreadId === "string" && store.taskByThread(bot.id, expectedThreadId)) {
      const routine = routines!.activeBotRunForBot(bot.id);
      if (routine?.threadId === expectedThreadId) await routines!.cancelRun(routine.id);
      else await stopDirectThreadByPerson(bot.id, expectedThreadId, expectedUtteranceId);
      return json(res, 200, { ok: true });
    }
    const directClaim = directTurnDispatchClaims.get(bot.threadId);
    const routineRun = routines!.activeBotRunForBot(bot.id);
    if (routineRun) {
      if (expectedThreadId !== undefined && routineRun.threadId !== expectedThreadId) {
        return json(res, 409, { error: "this bot is running a routine in another conversation" });
      }
      cancelDirectTurnDispatch(bot.id, routineRun.threadId ?? expectedThreadId);
      if (routineRun.threadId) {
        revokeInternalCapabilitiesForThread(routineRun.threadId);
      }
      await routines!.cancelRun(routineRun.id);
      return json(res, 200, { ok: true });
    }
    const instance = registry.get((botForThread(bot.id, expectedThreadId ?? bot.threadId) ?? bot).modelSelection.instanceId);
    // a bot busy in a ROOM is running on the room's thread — stopping it
    // from its own chat must reach that turn, not just the 1:1 thread
    const busyGroup = activeGroupTurnForBot(bot.id);
    if (busyGroup) {
      if (expectedThreadId !== undefined && busyGroup.threadId !== expectedThreadId) {
        return json(res, 409, { error: `this bot is working in channel ${busyGroup.group.name}` });
      }
      videoGenerations.cancelThread(busyGroup.threadId, bot.id);
      cancelGroupTurnOperations(busyGroup.group.id, busyGroup.threadId);
      revokeInternalCapabilitiesForThread(busyGroup.threadId);
      await instance?.adapter.interruptTurn(busyGroup.threadId).catch(() => {});
      closeOpenApprovals(busyGroup.threadId);
      return json(res, 200, { ok: true });
    }
    if (
      expectedThreadId !== undefined &&
      !busyGroup &&
      bot.threadId !== expectedThreadId &&
      directClaim?.threadId !== expectedThreadId
    ) {
      return json(res, 409, { error: "the bot switched tasks before it could be interrupted" });
    }
    await stopDirectThreadByPerson(bot.id, expectedThreadId ?? bot.threadId, expectedUtteranceId);
    return json(res, 200, { ok: true });
  }
  return PASS;
}

export function createBotsMessagesInterruptRoutes(deps: BotsMessagesRouteDeps): RouteHandler {
  return (ctx) => handleInterrupt(deps, ctx);
}
