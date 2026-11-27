// Agents, threads and close for internal session routes (#1383).
// Dispatch order stays in createInternalSessionsRoutes.
import { backgroundOrigin } from "../../shared/background-threads.ts";
import { peerStatus, peerStatusWords, reachablePeers } from "../peers/peer-roster.ts";
import { queuedThreadPosition } from "../turns/steer-queue.ts";
import type { InternalRouteContext } from "./internal-route.ts";
import type { InternalSessionsBot, InternalSessionsDeps, InternalSessionsTask } from "./internal-sessions-types.ts";
import { PASS } from "./table.ts";

/** What list_threads says a thread is doing. A closed thread is closed even
 * when its activity flag was never cleared (#5011). A thread that is busy
 * again (picked back up) is still running. */
export function threadListState(
  task: { activity?: string; closedBy?: unknown },
  flags: { awaiting: boolean; busy: boolean; queued: boolean },
): "running" | "waiting-on-you" | "queued" | "idle" | "closed" {
  if (task.closedBy && !flags.busy) return "closed";
  if (task.activity === "waiting-on-you" || flags.awaiting) return "waiting-on-you";
  if (flags.busy) return "running";
  if (flags.queued) return "queued";
  if (task.closedBy) return "closed";
  return "idle";
}

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
  // reach — the threads the caller itself opened. #5366: a Full-access
  // bot also lists every person-facing thread of those peers (so Dispatch
  // can clean up), never a routine run, AI-client or bot-hidden task.
  // State is read the way the sidebar reads it, so the bot and the person agree.
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
    const seen = new Set<string>();
    const stateOf = (bot: InternalSessionsBot, task: InternalSessionsTask) =>
      threadListState(task, {
        awaiting: deps.awaitingAnswer(task.threadId),
        busy: deps.threadBusy(bot.id, task.threadId),
        queued: queuedThreadPosition(bot.id, task.threadId) !== null || deps.activeDirect(task.threadId),
      });
    // A confidential thread is listed in itself only: its title is words too.
    const listable = (threadId: string) => Boolean(threadId) && (threadId === fromThreadId || !deps.isConfidentialThread(threadId));
    const push = (bot: InternalSessionsBot, task: InternalSessionsTask, own: boolean) => {
      if (!task.threadId || !listable(task.threadId) || seen.has(task.threadId)) return;
      seen.add(task.threadId);
      rows.push({
        threadId: task.threadId, botId: bot.id, botName: bot.name, title: task.title || "Untitled",
        state: stateOf(bot, task), unread: task.unread === true, openedAt: task.openedBy?.at ?? task.createdAt,
        delegationId: task.openedBy?.delegationId, own,
      });
    };
    for (const task of deps.tasks(from.id)) push(from, task, true);
    const fullAccess = from.approvalMode === "full" || from.chiefOfStaff === true;
    for (const peer of reachablePeers(deps.bots(), from)) {
      for (const task of deps.tasks(peer.id)) {
        if (task.openedBy?.botId === from.id) {
          push(peer, task, false);
          continue;
        }
        if (!fullAccess) continue;
        const origin = backgroundOrigin({
          ...task,
          personWrote: task.askedAt !== undefined && task.openedBy?.kind !== "agent" ? true : undefined,
        });
        if (origin === "routine-run" || origin === "routine-results" || origin === "ai-client" || origin === "bot-hidden") continue;
        push(peer, task, false);
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
