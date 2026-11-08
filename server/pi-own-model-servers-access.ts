// #2983: the person's own pi model servers on a turn and in the picker.
// One store per process, under DATA_DIR (server/pi-own-model-servers.ts).
import type { TurnAccessInput } from "./contracts.ts";
import { DATA_DIR } from "./config.ts";
import { modelServerAccess, type ModelServer } from "./drivers/pi-model-servers.ts";
import { ownModelServers, PiOwnModelServersStore, type OwnServerScope } from "./pi-own-model-servers.ts";

let shared: PiOwnModelServersStore | null = null;

export function piOwnModelServersStore(): PiOwnModelServersStore {
  shared ??= new PiOwnModelServersStore(DATA_DIR);
  return shared;
}

/** Solo: the server's own list. Organization: the member's, none without one. */
export function ownServerScope(organization: boolean, person: string | null | undefined): OwnServerScope | null {
  if (!organization) return {};
  const id = person?.trim().toLowerCase();
  return id ? { principalId: id } : null;
}

/** A person's own servers as pi model servers; none when the store cannot be read. */
export function piOwnServersFor(organization: boolean, person: string | null | undefined): ModelServer[] {
  const scope = ownServerScope(organization, person);
  if (!scope) return [];
  try {
    return ownModelServers(piOwnModelServersStore().list(scope));
  } catch {
    return [];
  }
}

/** A solo pi turn with own servers: models.json names them (the list
 * replaces earlier ones), their keys ride this turn's environment only.
 * Without one, and on any other engine, no access, as before. */
export function soloPiTurnAccess(instance: { driverKind?: string }): TurnAccessInput | undefined {
  if (instance.driverKind !== "piAgent") return undefined;
  const { environment, servers } = modelServerAccess(piOwnServersFor(false, null));
  if (!servers.length) return undefined;
  return { via: "server", identity: "server", ...(Object.keys(environment).length ? { environment } : {}), piModelServers: servers };
}
