// Rooms, session-search and session-read for internal session routes (#1383).
import { recallMessages, recentMessages, readMessageText } from "../messages/message-db.ts";
import type { MemoryDestination } from "../memory/memory-audience.ts";
import { webhookPostText } from "../peers/peer-provenance.ts";
import { claimRecallCrossings, recallCrossingLabel } from "../recall/recall-disclosure.ts";
import { sessionMemoryHitFor } from "../recall/recall.ts";
import { parseSince, parseUntil } from "../recent-work.ts";
import { searchMemoryFiles } from "../workspace/workspace.ts";
import type { InternalRouteContext } from "./internal-route.ts";
import type { InternalSessionsBot, InternalSessionsDeps, InternalSessionsGroup } from "./internal-sessions-types.ts";
import { PASS } from "./table.ts";

/** Truncation for session_read message bodies. */
const SESSION_READ_MAX_CHARS = 8_000;

function discloseRecall(deps: InternalSessionsDeps, bot: InternalSessionsBot, roomThreadId: string, sourceThreadIds: readonly string[]): void {
  const crossing = claimRecallCrossings(roomThreadId, sourceThreadIds);
  if (!crossing.count) return;
  deps.appendMessage(roomThreadId, {
    role: "bot",
    kind: "activity",
    from: { botId: bot.id, name: bot.name, color: bot.color },
    tool: { name: recallCrossingLabel(bot.name, crossing.count), ok: true },
  });
}

export async function handleInternalSessionsRecall(
  deps: InternalSessionsDeps,
  ctx: InternalRouteContext,
  internalSender: InternalSessionsBot,
): Promise<typeof PASS | void> {
  const { res, path, method, json, capability, url } = ctx;
  if (method === "GET" && path === "/api/internal/rooms") {
    const from = internalSender;
    const fromThreadId = capability.threadId;
    if (!deps.ownsThread(from.id, fromThreadId)) {
      return json(res, 403, { error: "source conversation does not belong to sender" });
    }
    const rooms: Array<{ id: string; name: string; members: string[] }> = [];
    const unpostable: Array<{ name: string; reason: string }> = [];
    for (const group of deps.groups()) {
      if (group.dm || !group.memberIds.includes(from.id)) continue;
      const eligibility = deps.roomPostEligibility(from, group);
      if (!eligibility.ok) {
        unpostable.push({ name: group.name, reason: eligibility.error });
        continue;
      }
      rooms.push({
        id: group.id,
        name: group.name,
        members: group.memberIds
          .map((id) => deps.bot(id))
          .filter((member): member is InternalSessionsBot => Boolean(member))
          .map((member) => member.name),
      });
    }
    return json(res, 200, { rooms: rooms.slice(0, 50), unpostable: unpostable.slice(0, 50) });
  }
  // session_search: ranked recall over the calling bot's OWN threads,
  // every task included. Own-bot only, on purpose — a bot's transcripts
  // are its notebook the same way MEMORY.md is (section-context.ts draws
  // that line), and search across bots would be an isolation change.
  // Announce in the room that a bot reached outside it. Silent when the
  // room has already been told about that thread, so a bot searching
  // three times in one turn leaves one chip per source, not per search.
  if (method === "GET" && path === "/api/internal/session-search") {
    const fromBotId = String(url!.searchParams.get("fromBotId") ?? "");
    const from = deps.bot(fromBotId);
    if (!from) return json(res, 403, { error: "unknown sender" });
    const fromThreadId = capability.threadId;
    if (!deps.ownsThread(from.id, fromThreadId)) {
      return json(res, 403, { error: "source conversation does not belong to sender" });
    }
    const q = String(url!.searchParams.get("q") ?? "").trim();
    // A recall by time needs no words: "what happened since yesterday"
    // is the standup question, and it has no keyword.
    const now = Date.now();
    const sinceRaw = url!.searchParams.get("since");
    const untilRaw = url!.searchParams.get("until");
    const since = sinceRaw ? parseSince(sinceRaw, now) : null;
    const until = untilRaw ? parseUntil(untilRaw, now) : null;
    if (sinceRaw && since === null) return json(res, 400, { error: "since must be a date, or a span like 24h, 3d, today, yesterday" });
    if (untilRaw && until === null) return json(res, 400, { error: "until must be a date, or a span like 24h, 3d, today, yesterday" });
    if (!q && since === null) return json(res, 400, { error: "q or since is required" });
    const range = since !== null || until !== null
      ? { ...(since !== null ? { since } : {}), ...(until !== null ? { until } : {}) }
      : undefined;
    const rawLimit = Number(url!.searchParams.get("limit"));
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.trunc(rawLimit), 25) : 12;
    // Memory files ride along by default: the bot's own notes are as
    // much its notebook as its transcripts, and scoped the same way —
    // the caller's own bot, never another's. A recall by time alone
    // has no words to match a file with.
    const scope = url!.searchParams.get("scope") ?? "all";
    if (scope !== "all" && scope !== "conversations" && scope !== "memory") {
      return json(res, 400, { error: "scope must be all, conversations, or memory" });
    }
    const searchPlace = deps.groupByThread(fromThreadId);
    // A room or a group is wider than the person's own file. A line
    // stamped for the person does not come out. A line with no stamp stays.
    const searchAudience: MemoryDestination | undefined = searchPlace ? { kind: "room", id: searchPlace.id } : undefined;
    const foundMemory = scope === "conversations" || !q || from.memoryEnabled === false ? [] : searchMemoryFiles(from.id, q, limit);
    const memoryHits = searchAudience
      ? foundMemory.flatMap((hit) => {
        const shown = sessionMemoryHitFor(from.id, hit, searchAudience);
        return shown ? [shown] : [];
      })
      : foundMemory;
    if (scope === "memory") return json(res, 200, { hits: [], memoryHits });
    // Own threads: the bot's main chat and tasks, and the rooms it is a
    // member of with their tasks — conversations it already saw in full.
    // Still own-bot: another bot's threads never enter this list.
    const roomByThread = new Map<string, InternalSessionsGroup>();
    for (const group of deps.groups()) {
      // A room fewer people can see than this bot stays out of its recall
      // (bot-visibility.ts roomFeeds): its lines would otherwise reach them.
      if (!group.memberIds.includes(from.id) || !deps.roomFeedsBot(group, from)) continue;
      roomByThread.set(group.threadId, group);
      for (const task of group.tasks ?? []) roomByThread.set(task.threadId, group);
    }
    // Organization server: the person of this turn's own threads only.
    const recallAllow = deps.privateRecallFilter(from, fromThreadId);
    const ownThreads = [...new Set([from.threadId, ...(from.tasks ?? []).map((task) => task.threadId), ...roomByThread.keys()])].filter((id): id is string => Boolean(id))
      // On a Cloud home a turn that may use the lent Mac searches only the
      // conversations the owner alone opened and wrote in.
      .filter((id) => !recallAllow || recallAllow(id));
    // A room is the only place a recall can be a disclosure, and only a
    // private chat is one: in a 1:1 the user already owns every thread
    // the bot can reach, and a room's lines were said in the open.
    const inRoom = Boolean(deps.groupByThread(fromThreadId));
    const found = q ? recallMessages(q, ownThreads, limit, range) : recentMessages(ownThreads, range ?? {}, limit);
    const hits = found.map((hit) => {
      const room = roomByThread.get(hit.threadId);
      return {
        ...hit,
        task: room
          ? (room.tasks ?? []).find((task) => task.threadId === hit.threadId)?.title
          : deps.taskByThread(from.id, hit.threadId)?.title,
        ...(room ? { room: room.name } : {}),
        current: hit.threadId === fromThreadId,
        crossed: inRoom && !room && hit.threadId !== fromThreadId,
      };
    });
    if (inRoom) {
      discloseRecall(deps, from, fromThreadId, hits.filter((hit) => hit.crossed).map((hit) => hit.threadId));
    }
    return json(res, 200, { hits, memoryHits });
  }
  // session_read: the whole message behind a session_search hit. Same
  // own-bot scope — a message id from another bot's thread reads as
  // missing, not as forbidden, so the id space leaks nothing.
  if (method === "GET" && path === "/api/internal/session-read") {
    const fromBotId = String(url!.searchParams.get("fromBotId") ?? "");
    const from = deps.bot(fromBotId);
    if (!from) return json(res, 403, { error: "unknown sender" });
    const fromThreadId = capability.threadId;
    if (!deps.ownsThread(from.id, fromThreadId)) {
      return json(res, 403, { error: "source conversation does not belong to sender" });
    }
    const threadId = String(url!.searchParams.get("threadId") ?? "").trim();
    const messageId = String(url!.searchParams.get("messageId") ?? "").trim();
    if (!threadId || !messageId) return json(res, 400, { error: "threadId and messageId are required" });
    const readAllow = deps.privateRecallFilter(from, fromThreadId);
    const own = (threadId === from.threadId || Boolean(deps.taskByThread(from.id, threadId))) &&
      (!readAllow || readAllow(threadId));
    const message = own ? readMessageText(threadId, messageId) : null;
    if (!message) return json(res, 404, { error: "no such message in your conversations" });
    const readInRoom = Boolean(deps.groupByThread(fromThreadId));
    const readCrossed = readInRoom && threadId !== fromThreadId;
    if (readCrossed) discloseRecall(deps, from, fromThreadId, [threadId]);
    // An outside app wrote a webhook line: read back with its note, never as the bot's own words.
    const readText = message.webhook ? webhookPostText(from.name, message.text) : message.text;
    return json(res, 200, {
      ...message,
      crossed: readCrossed,
      text: readText.length > SESSION_READ_MAX_CHARS ? `${readText.slice(0, SESSION_READ_MAX_CHARS)}…` : readText,
      task: deps.taskByThread(from.id, threadId)?.title,
    });
  }
  return PASS;
}
