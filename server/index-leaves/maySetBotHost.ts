// @ts-nocheck
/** maySetBotHost (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createMaySetBotHost(getHost: () => Host): any {
function maySetBotHost(auth: RequestAuth, bot: BotRecord) {
  const host = getHost();
  const { atLeast } = host;

  // On an organization server the process itself is not the member. A bot
  // curling loopback must not move someone else's bot onto a computer.
  if (auth.kind === "loopback") return host.IDENTITY.kind !== "perspicax" && auth.trust !== "service";
  if (auth.kind !== "session") return false;
  if (host.callerBotsReadOnly(auth)) return false;
  return atLeast(host.viewerBotLevel(auth, bot), "edit");

}
  return maySetBotHost;
}
