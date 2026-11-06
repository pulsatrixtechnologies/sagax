// @ts-nocheck
/** withPiModelServers (#1388). Pure move from server/index.ts. */
import { DATA_DIR } from "../config.ts";
import { modelServerAccess } from "../drivers/pi-model-servers.ts";
import { join } from "node:path";
export type Host = Record<string, any>;

export function createWithPiModelServers(getHost: () => Host): any {
async function withPiModelServers(access: TurnAccess, instance: { driverKind: string }, bot: BotRecord, speaker: TurnSpeaker): Promise<TurnAccess> {
  const host = getHost();
  if (instance.driverKind !== "piAgent" || !host.perspicaxDirectory) return access;
  const person = host.piTurnPerson(bot, speaker);
  const sub = person ? host.perspicaxSubOf(person) : null;
  if (!sub) return access;
  const result = await host.perspicaxDirectory.resolveModelServers(sub);
  if (!result.ok) return access;
  const { environment, servers } = modelServerAccess(result.servers);
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
