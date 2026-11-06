// @ts-nocheck
/** requestedTaskBot (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createRequestedTaskBot(getHost: () => Host): any {
function requestedTaskBot(botId: string, rawThreadId: unknown) {
  const host = getHost();

  const profile = host.store.bot(botId);
  if (!profile) throw Object.assign(new Error("no such bot"), { status: 404 });
  if (rawThreadId !== undefined && (typeof rawThreadId !== "string" || !/^[\w-]+$/.test(rawThreadId))) {
    throw Object.assign(new Error("threadId must be a task id"), { status: 400 });
  }
  // Organization server: the viewer's own thread, never someone else's.
  const threadId = host.routeThreadId(profile, rawThreadId);
  const task = host.store.projectBotForTask(botId, threadId);
  if (!task) throw Object.assign(new Error("no such task"), { status: 404 });
  return task;

}
  return requestedTaskBot;
}
