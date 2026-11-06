// @ts-nocheck
/** withPiModelServers (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createWithPiModelServers(getHost: () => Host): any {
async function withPiModelServers(access: TurnAccess, instance: { driverKind: string }, bot: BotRecord, speaker: TurnSpeaker) {
  const host = getHost();
  const { DATA_DIR } = host;

  if (instance.driverKind !== "piAgent" || !host.perspicaxDirectory) return access;
  const person = host.piTurnPerson(bot, speaker);
  const sub = person ? host.perspicaxSubOf(person) : null;
  if (!sub) return access;
  const result = await host.perspicaxDirectory.resolveModelServers(sub);
  if (!result.ok) return access;
  const { environment, servers } = host.modelServerAccess(result.servers);
  const engineHome = access.via === "org-key" && servers.length && person ? join(DATA_DIR, "principals", person, "piAgent-key") : access.engineHome;
  return {
    ...access,
    ...(Object.keys(environment).length ? { environment: { ...access.environment, ...environment } } : {}),
    piModelServers: servers,
    ...(engineHome ? { engineHome } : {}),
  };

}
  return withPiModelServers;
}
