// Public transcript search (#1388 slice P3):
//   GET /api/search?q=&limit=&threadId=
//
// Literal substring scans run in a bounded read-only worker. Hits resolve to
// the owning bot/room; rows belonging to deleted conversations drop. After the
// await, authorization and visibility are checked again against current state.
import type { IncomingMessage } from "node:http";

import type { SearchHit } from "../message-search-query.ts";
import type { RequestAuth } from "../request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface SearchRouteBot {
  id: string;
  name: string;
}

export interface SearchRouteGroup {
  id: string;
  name: string;
}

export interface SearchVisibleSet {
  everything: boolean;
  thread(threadId: string): boolean;
}

export interface SearchRouteDeps {
  botByThread(threadId: string): SearchRouteBot | null | undefined;
  groupByThread(threadId: string): SearchRouteGroup | null | undefined;
  taskByThread(botId: string, threadId: string): { title?: string } | null | undefined;
  groupTaskByThread(groupId: string, threadId: string): { title?: string } | null | undefined;
  activePath(threadId: string): ReadonlyArray<{ id: string }>;
  messagesFor(threadId: string): ReadonlyArray<{ id: string }>;
  /** Current visibility for this auth + path (pre-await). */
  visibleFor(auth: RequestAuth, path: string): SearchVisibleSet;
  viewerId(auth: RequestAuth): string | undefined;
  privateThreads(): boolean;
  searchMessages(query: string, limit: number, threadId?: string): Promise<SearchHit[]>;
  /** Hosted workspace re-check after the scan; null means ok. */
  authorizeWorkspace?(req: IncomingMessage, auth: RequestAuth): Promise<{ status: number; error: string } | null>;
  /** Re-resolve auth after the scan (revocation / audience edit). */
  resolveAuth(req: IncomingMessage, url: URL): { auth: RequestAuth | null; status: number; error: string };
  /** Visibility from a freshly resolved auth. */
  visibleNow(auth: RequestAuth, path: string): SearchVisibleSet;
  channelFilterViewerId(auth: RequestAuth): string | undefined;
  /** Bot/group/channel visibility for a hit under the current viewer. */
  hitVisibleNow(threadId: string, viewerId: string | undefined): boolean;
  /** Access-card rows that belong to someone else stay hidden. */
  privateRowHidden(message: unknown, viewer: unknown): boolean;
  viewerForApproval(auth: RequestAuth): unknown;
}

export function createSearchRoutes(deps: SearchRouteDeps): RouteHandler {
  return async ({ req, res, url, path, method, auth, json }) => {
    if (!(method === "GET" && path === "/api/search")) return PASS;

    const q = url.searchParams.get("q") ?? "";
    const rawLimit = url.searchParams.get("limit");
    const limit = rawLimit ? Math.min(Math.max(Number(rawLimit) || 0, 1), 100) : 40;
    const threadId = url.searchParams.get("threadId")?.trim() || undefined;
    const visible = deps.visibleFor(auth, path);
    const viewerId = deps.viewerId(auth);
    if (threadId && ((!deps.botByThread(threadId) && !deps.groupByThread(threadId)) || !visible.thread(threadId))) {
      return json(res, 404, { error: "no such conversation" });
    }
    // whether each hit sits on its thread's visible branch — a click on
    // one that does not has to switch versions first (and only then)
    const activePaths = new Map<string, Set<string>>();
    const onActivePath = (hitThreadId: string, messageId: string) => {
      let ids = activePaths.get(hitThreadId);
      if (!ids) activePaths.set(hitThreadId, (ids = new Set(deps.activePath(hitThreadId).map((m) => m.id))));
      return ids.has(messageId);
    };
    // A member who may not see every bot: look further, then keep only
    // hits in conversations they can open.
    const found = await deps.searchMessages(
      q,
      visible.everything && !(viewerId && deps.privateThreads()) ? limit : Math.min(limit * 10, 1_000),
      threadId,
    );
    // A scan may outlive a revocation or audience edit. Authorize again
    // after the await, and resolve visibility from current store state.
    if (deps.authorizeWorkspace && auth.kind === "session") {
      const failure = await deps.authorizeWorkspace(req, auth);
      if (failure) return json(res, failure.status, { error: failure.error });
    }
    const current = deps.resolveAuth(req, url);
    if (!current.auth) return json(res, current.status, { error: current.error });
    const currentVisible = deps.visibleNow(current.auth, path);
    if (threadId && !currentVisible.thread(threadId)) return json(res, 404, { error: "no such conversation" });
    const searchViewerId = deps.channelFilterViewerId(current.auth);
    const hits = found
      .filter((hit) => currentVisible.thread(hit.threadId) && deps.hitVisibleNow(hit.threadId, searchViewerId)
        // the index holds text and tool rows only; an access card that ever
        // matched would still reach its own person only
        && (hit.kind !== "access" || !deps.privateRowHidden(
          deps.messagesFor(hit.threadId).find((row) => row.id === hit.messageId),
          deps.viewerForApproval(current.auth!),
        )))
      .slice(0, limit)
      .map((hit) => {
        const bot = deps.botByThread(hit.threadId);
        const group = bot ? undefined : deps.groupByThread(hit.threadId);
        if (!bot && !group) return null;
        const active = onActivePath(hit.threadId, hit.messageId);
        if (bot) {
          const task = deps.taskByThread(bot.id, hit.threadId);
          return { ...hit, botId: bot.id, name: bot.name, task: task?.title, onActivePath: active };
        }
        if (group) {
          const task = deps.groupTaskByThread(group.id, hit.threadId);
          return { ...hit, groupId: group.id, name: group.name, task: task?.title, onActivePath: active };
        }
        return null;
      })
      .filter((hit): hit is NonNullable<typeof hit> => hit !== null);
    return json(res, 200, { hits });
  };
}
