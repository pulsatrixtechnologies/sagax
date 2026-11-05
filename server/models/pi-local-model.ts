// #1422: a pi model served by a local host (`omlx/<model>`, `ollama/<model>`...)
// runs on that machine's own server. It needs no key of the person who pays,
// and it is never swapped for a cloud model the person did not pick.
// On an organization server that machine is the server, shared by every
// member: the organization's engine list still applies to it (index.ts,
// orgEngineTurnRefusal), and each person's pi home stays their own
// (piLocalTurnAccess).
import { LOCAL_HOSTS } from "../drivers/local-inject.ts";
import { isModelServerProvider } from "../drivers/pi-model-servers.ts";

export function isPiLocalModel(driverKind: string | undefined, model: string | null | undefined): boolean {
  if (driverKind !== "piAgent" || !model) return false;
  const slash = model.indexOf("/");
  if (slash <= 0) return false;
  const provider = model.slice(0, slash);
  return LOCAL_HOSTS.some((host) => host.id === provider);
}

/** #2024: a pi model on a Perspicax model server (`px-org-<id>/<model>`,
 * `px-own-<id>/<model>`): Perspicax hands its key with the turn, so, as a
 * local host's, it needs no provider key of the person who pays. */
export function isPiModelServerModel(driverKind: string | undefined, model: string | null | undefined): boolean {
  if (driverKind !== "piAgent" || !model) return false;
  const slash = model.indexOf("/");
  return slash > 0 && isModelServerProvider(model.slice(0, slash));
}

/** A pi model the server serves without the payer's provider key: a local
 * host's (#1422) or a Perspicax model server's (#2024). */
export function isPiServedModel(driverKind: string | undefined, model: string | null | undefined): boolean {
  return isPiLocalModel(driverKind, model) || isPiModelServerModel(driverKind, model);
}

/** #1422: whether a missing-key refusal is lifted for the selection being
 * judged. Only that selection counts (a routing candidate, a backup, a
 * room's pick), never the bot's own model: a cloud model on pi keeps its
 * refusal on a bot whose own model is local, and a local candidate is lifted
 * on a bot whose own model is in the cloud. */
export function piLocalKeyRefusalLifted(cause: string | undefined, selection: { driverKind: string | undefined; model: string | null | undefined }): boolean {
  return cause === "no_credentials" && isPiServedModel(selection.driverKind, selection.model);
}
