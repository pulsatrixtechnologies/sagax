// @ts-nocheck
/** withPiModelServers (#1388). Pure move from server/index.ts. */
import { DATA_DIR } from "../config.ts";
import { modelServerAccess } from "../drivers/pi-model-servers.ts";
import { mergeModelServers } from "../pi-own-model-servers.ts";
import { piOwnServersFor } from "../pi-own-model-servers-access.ts";
import { join } from "node:path";
export type Host = Record<string, any>;

export function createWithPiModelServers(getHost: () => Host): any {
async function withPiModelServers(access: TurnAccess, instance: { driverKind: string }, bot: BotRecord, speaker: TurnSpeaker): Promise<TurnAccess> {
  const host = getHost();
  if (instance.driverKind !== "piAgent") return access;
  const person = host.piTurnPerson(bot, speaker);
  // #2983: the person's own servers, kept by this server, join Perspicax's
  const own = piOwnServersFor(true, person);
  const sub = host.perspicaxDirectory && person ? host.perspicaxSubOf(person) : null;
  let remote = [];
  if (sub) {
    const result = await host.perspicaxDirectory.resolveModelServers(sub);
    // an unreachable Perspicax leaves the person's pi home as the last turn wrote it
    if (!result.ok) return access;
    remote = result.servers;
  } else if (!own.length) return access;
  const { environment, servers } = modelServerAccess(mergeModelServers(remote, own));
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
