// @ts-nocheck
/** terminalAccessFor (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createTerminalAccessFor(getHost: () => Host): any {
function terminalAccessFor(principalId: string, botId: string) {
  const host = getHost();

  const person = principalId.trim().toLowerCase();
  const organization = host.IDENTITY.kind === "perspicax";
  if (!organization) {
    // Solo: the operator and nobody else.
    const operator = person === host.localPrincipalId().trim().toLowerCase();
    return { organization, admin: operator, ownsBot: operator };
  }
  const record = person ? host.principals.byId(person) : null;
  const admin = record?.local === true || record?.orgRole === "admin";
  const bot = host.store.bot(botId);
  const ownsBot = Boolean(bot && person && host.effectiveBotOwner(bot).trim().toLowerCase() === person);
  // 2026-10-19 the server's hosts also open for a person an admin
  // gave host.commands to in Perspicax (a person or a team).
  const serverHosts = !admin && Boolean(record) && record?.disabledAt === undefined && host.principalCan(person, "host.commands");
  return { organization, admin, ownsBot, serverHosts };

}
  return terminalAccessFor;
}
