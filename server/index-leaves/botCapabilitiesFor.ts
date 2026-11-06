// @ts-nocheck
/** botCapabilitiesFor (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createBotCapabilitiesFor(getHost: () => Host): any {
function botCapabilitiesFor(auth: RequestAuth, botId: string, engineId: string | undefined) {
  const host = getHost();
  const { sessionPrincipal } = host;

  const bot = host.store.bot(botId);
  const level = bot ? host.viewerBotLevel(auth, bot) : null;
  if (!bot || (level === null && !host.orgAdminCaller(auth))) return { ok: false, status: 404, error: "no such bot", code: "not_found" };
  const principal = host.IDENTITY.kind === "perspicax" ? sessionPrincipal(auth)?.trim().toLowerCase() || undefined : undefined;
  const mayChange = host.IDENTITY.kind !== "perspicax"
    ? auth.kind !== "session" || auth.scopes.includes("admin")
    : level === "owner" || level === "manage" || host.orgAdminCaller(auth);
  return host.botCapabilitiesAs(bot, engineId, { ...(principal ? { principal } : {}), mayChange, marketplace: host.marketplaceViewer(auth) });

}
  return botCapabilitiesFor;
}
