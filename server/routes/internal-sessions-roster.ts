// Agents, threads and close for internal session routes (#1383).
// Dispatch order stays in createInternalSessionsRoutes.
import { peerStatus, peerStatusWords, reachablePeers } from "../peers/peer-roster.ts";
import { queuedThreadPosition } from "../turns/steer-queue.ts";
import type { InternalRouteContext } from "./internal-route.ts";
import type { InternalSessionsBot, InternalSessionsDeps, InternalSessionsTask } from "./internal-sessions-types.ts";
import { PASS } from "./table.ts";

export async function handleInternalSessionsRoster(
  deps: InternalSessionsDeps,
  ctx: InternalRouteContext,
  internalSender: InternalSessionsBot,
): Promise<typeof PASS | void> {
  const { res, path, method, json, capability } = ctx;
  if (method === "GET" && path === "/api/internal/agents") {
    const sender = internalSender;
    // title/description included so the caller can judge the team (who
    // does what, who has no job description yet). Every bot reads this
    // now, not just the Primary Bot, so it answers the same reachability
    // question the roster does — same peers, same order.
    const bots = reachablePeers(deps.bots(), sender)
      .map((b) => {
        const status = peerStatus(b.activity, b.busy);
        return {
          id: b.id,
          name: b.name,
          section: b.section?.trim() || "",
          model: b.modelSelection.model || "aucun moteur",
          busy: !!b.busy,
          status,
          statusText: peerStatusWords(status),
          title: b.title || undefined,
          description: b.description || undefined,
        };
      });
    return json(res, 200, { bots });
  }
  // Nothing else ever tells a bot a room id, so this is the discovery
  // half of post_to_room: it lists exactly the rooms that tool would
  // accept, resolved from the sender's own membership. A room a post
  // would be refused for gets no id — an id would only teach the model
  // to keep trying — but it is still NAMED, with the refusal it would
  // have met. Without that the bot can only say it is in no room at
  // all, while the person is looking at it in that very room.
  // list_threads: the caller's own threads, plus — on every peer it can
  // reach — only the threads the caller itself opened. A peer's other
  // threads are its own business (and the person's), so the scope is
  // "what you started", never "what that bot is doing". State is read
  // the way the sidebar reads it, so the bot and the person agree.
  if (method === "GET" && path === "/api/internal/threads") {
    const from = internalSender;
    const fromThreadId = capability.threadId;
    if (!deps.ownsThread(from.id, fromThreadId)) {
      return json(res, 403, { error: "source conversation does not belong to sender" });
    }
    const rows: Array<{
      threadId: string; botId: string; botName: string; title: string;
      state: "running" | "waiting-on-you" | "queued" | "idle" | "closed";
      unread: boolean; openedAt: number; delegationId?: string; own: boolean;
    }> = [];
    const stateOf = (bot: InternalSessionsBot, task: InternalSessionsTask) => {
      // A teammate that ended on a NEEDS INPUT question waits on the
      // person too, though its turn is over and nothing marks the task.
      if (task.activity === "waiting-on-you" || deps.awaitingAnswer(task.threadId)) return "waiting-on-you" as const;
      if (deps.threadBusy(bot.id, task.threadId)) return "running" as const;
      if (queuedThreadPosition(bot.id, task.threadId) !== null) return "queued" as const;
      if (deps.activeDirect(task.threadId)) return "queued" as const;
      if (task.closedBy) return "closed" as const;
      return "idle" as const;
    };
    // On a Cloud home a turn that may use the lent Mac sees only the
    // conversations the owner alone opened and wrote in: a title is words
    // too (cloudLendingView).
    const shown = (_threadId: string) => true;
    // A confidential thread is listed in itself only: its title is words too.
    const listable = (threadId: string) => threadId === fromThreadId || !deps.isConfidentialThread(threadId);
    for (const task of deps.tasks(from.id)) {
      if (!shown(task.threadId) || !listable(task.threadId)) continue;
      rows.push({
        threadId: task.threadId, botId: from.id, botName: from.name, title: task.title,
        state: stateOf(from, task), unread: task.unread === true, openedAt: task.openedBy?.at ?? task.createdAt,
        delegationId: task.openedBy?.delegationId, own: true,
      });
    }
    for (const peer of reachablePeers(deps.bots(), from)) {
      for (const task of deps.tasks(peer.id)) {
        if (task.openedBy?.botId !== from.id || !shown(task.threadId) || !listable(task.threadId)) continue;
        rows.push({
          threadId: task.threadId, botId: peer.id, botName: peer.name, title: task.title,
          state: stateOf(peer, task), unread: task.unread === true, openedAt: task.openedBy!.at,
          delegationId: task.openedBy.delegationId, own: false,
        });
      }
    }
    rows.sort((a, b) => b.openedAt - a.openedAt);
    return json(res, 200, { threads: rows.slice(0, 100) });
  }
  // close_thread: a bot tidies a thread it opened (or one of its own)
  // once its result has been read. Closing is the sidebar's idle state
  // plus a chip saying who closed it — never a deletion, which stays a
  // person's confirmed action, and never while the thread is running.
  const closeMatch = method === "POST" ? path.match(/^\/api\/internal\/threads\/([\w-]+)\/close$/) : null;
  if (closeMatch) {
    const from = internalSender;
    const fromThreadId = capability.threadId;
    if (!deps.ownsThread(from.id, fromThreadId)) {
      return json(res, 403, { error: "source conversation does not belong to sender" });
    }
    const threadId = closeMatch[1]!;
    const owner = [from, ...reachablePeers(deps.bots(), from)].find((bot) => deps.taskByThread(bot.id, threadId));
    const task = owner ? deps.taskByThread(owner.id, threadId) : undefined;
    if (!owner || !task) return json(res, 404, { error: "no such thread — call list_threads for the ones you can see" });
    if (owner.id !== from.id && task.openedBy?.botId !== from.id) {
      return json(res, 403, { error: "that thread is not yours to close — only the bot that opened it, or its own bot, can" });
    }
    if (threadId === fromThreadId) return json(res, 400, { error: "you cannot close the thread you are speaking in — finish your turn instead" });
    if (deps.awaitingAnswer(threadId)) {
      return json(res, 409, { error: `#${task.title} is waiting on the person's answer to its question; it continues once they reply there, so leave it open` });
    }
    if (deps.threadBusy(owner.id, threadId) || queuedThreadPosition(owner.id, threadId) !== null || deps.activeDirect(threadId)) {
      return json(res, 409, { error: `#${task.title} is still running — wait for it to finish (list_threads), or the person can stop it from the app` });
    }
    // Closing twice is not an error and leaves no second chip: the
    // thread is already folded away, so there is nothing more to do.
    if (task.closedBy) {
      return json(res, 200, { closed: true, alreadyClosed: true, threadId, title: task.title, botName: owner.name, closedBy: task.closedBy.name });
    }
    deps.appendMessage(threadId, {
      role: "bot",
      kind: "activity",
      from: { botId: from.id, name: from.name, color: from.color },
      tool: { name: `Closed by @${from.name}`, ok: true },
    });
    if (task.unread) deps.patchTask(owner.id, threadId, { unread: false });
    // The stamp is what the sidebar folds on and what list_threads
    // reports; the chip above is only the transcript's record of it.
    deps.setTaskClosedBy(owner.id, threadId, { botId: from.id, name: from.name, at: Date.now() });
    return json(res, 200, { closed: true, threadId, title: task.title, botName: owner.name });
  }
  return PASS;
}
