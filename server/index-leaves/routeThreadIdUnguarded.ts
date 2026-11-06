// @ts-nocheck
/** routeThreadIdUnguarded (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createRouteThreadIdUnguarded(getHost: () => Host): any {
function routeThreadIdUnguarded(bot: BotRecord, rawThreadId: unknown, action: ThreadAction) {
  const host = getHost();

  if (rawThreadId !== undefined && rawThreadId !== null && (typeof rawThreadId !== "string" || !/^[\w-]+$/.test(rawThreadId))) {
    throw Object.assign(new Error("threadId must be a task id"), { status: 400 });
  }
  const viewerId = host.scopedThreadViewer();
  if (typeof rawThreadId === "string") {
    if (viewerId && host.store.taskByThread(bot.id, rawThreadId) && !host.botThreadReadable(bot, rawThreadId, viewerId, action)) {
      throw Object.assign(new Error("no such task"), { status: 404 });
    }
    return rawThreadId;
  }
  // No thread named (a phone's share sheet, a relay, an older client): the
  // person's one conversation (shared/single-stream.ts), never whatever
  // thread the bot happened to be left on.
  if (!viewerId) return host.conversationOrStart(bot) ?? bot.threadId;
  const mine = host.conversationThreadFor(bot, viewerId) ?? host.ensureViewerThread(bot, viewerId);
  if (!mine) throw Object.assign(new Error("no such task"), { status: 404 });
  return mine;

}
  return routeThreadIdUnguarded;
}
