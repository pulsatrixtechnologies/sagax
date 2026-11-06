// @ts-nocheck
/** webhookDelegateRefusal (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createWebhookDelegateRefusal(getHost: () => Host): any {
function webhookDelegateRefusal(auth: RequestAuth, webhookIds: string[], body: unknown): { status: number; error: string; code: string } | null {
  const host = getHost();

  if (host.IDENTITY.kind !== "perspicax" || auth.kind !== "session" || auth.scopes.includes("admin")) return null;
  const refusal = { status: 403, error: "Only an organization admin can manage a webhook on an admin's bot or a Microsoft trigger.", code: "target_is_admin" };
  const record = body && typeof body === "object" && !Array.isArray(body) ? body as { botId?: unknown; source?: unknown } : null;
  const hooks = webhookIds.map((id) => host.webhooks.list().find((hook) => hook.id === id));
  // 2026-10-28: a member without server.settings
  // manages webhooks of their own bots, or of a bot shared with them at run
  // (the right that runs a bot's routines), and nobody else's. A webhook of
  // a bot they may not aim at is "not found", the same as a missing one; a
  // body may not point a webhook at such a bot either.
  if (!host.callerCan(auth, "server.settings")) {
    const notFound = { status: 404, error: "no such webhook", code: "no_such_webhook" };
    for (const hook of hooks) if (hook && !host.webhookBotAimable(auth, hook.botId)) return notFound;
    if (record && typeof record.botId === "string" && !host.webhookBotAimable(auth, record.botId)) return { status: 404, error: "no such bot", code: "no_such_bot" };
  }
  const botIds = [
    ...hooks.map((hook) => hook?.botId),
    ...(record && typeof record.botId === "string" ? [record.botId] : []),
  ];
  if (hooks.some((hook) => hook?.source?.graph)) return refusal;
  const source = record?.source && typeof record.source === "object" ? record.source as { graph?: unknown } : null;
  if (source?.graph) return refusal;
  for (const botId of botIds) {
    if (typeof botId !== "string") continue;
    const bot = host.store.bot(botId);
    if (!bot || !host.mayActOnPerson(auth, host.effectiveBotOwner(bot))) return refusal;
  }
  return null;

}
  return webhookDelegateRefusal;
}
