// @ts-nocheck
/** threadWarmRequest (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createThreadWarmRequest(getHost: () => Host): any {
function threadWarmRequest(auth: RequestAuth, botId: string, body: Record<string, unknown>): { status: number; body: Record<string, unknown> } {
  const host = getHost();
  const { DATA_DIR, assertWithinBudget } = host;
  const bot = host.store.bot(botId);
  if (!bot) return { status: 404, body: { error: "no such bot" } };
  const denied = host.warmBotAccessRefusal(host.viewerBotLevel(auth, bot), {
    adminScope: auth.scopes.includes("admin"),
    orgAdmin: host.orgAdminCaller(auth),
  });
  if (denied) return denied;
  if (host.delegatedRequest()) host.routeThreadId(bot, body.threadId);
  if (typeof body.threadId !== "string" || !/^[\w-]+$/.test(body.threadId)) return { status: 400, body: { error: "threadId must be a task id" } };
  const threadId = host.routeThreadId(bot, body.threadId);
  const notYours = host.cloudGuestSendRefusal(auth, threadId);
  if (notYours) return { status: 403, body: { error: notYours } };
  if (!host.store.taskByThread(bot.id, threadId)) return { status: 200, body: { warm: "skipped" } };
  try {
    assertWithinBudget(host.cfg, DATA_DIR);
  } catch {
    return { status: 200, body: { warm: "skipped" } };
  }
  // 2026-10-26: the person is typing: wake their cloud computer now, so the
  // bot's first command does not wait for the cluster or a node
  // (server/sandbox/sandbox-typing-prewake.ts). Opening the conversation never does.
  if (body.typing === true) host.prewakeComputerWhileTyping(bot.id, host.actorPrincipalId(auth));
  // files sealed at rest start opening for the coming turn (server/encryption/content-at-rest.ts)
  host.openForComingTurn(bot.id, threadId);
  return { status: 200, body: { warm: host.prewarmThread(bot.id, threadId, host.actorPrincipalId(auth) || "local", { speaker: host.speakerFor(auth), ...(body.typing === true ? { primeCache: true } : {}) }) } };

}
  return threadWarmRequest;
}
