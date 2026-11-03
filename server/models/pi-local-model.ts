// #1422: a pi model served by a local host (`omlx/<model>`, `ollama/<model>`...)
// runs on that machine's own server. It needs no key of the person who pays,
// and it is never swapped for a cloud model the person did not pick.
// On an organization server that machine is the server, shared by every
// member: the organization's engine list still applies to it (index.ts,
// orgEngineTurnRefusal), and each person's pi home stays their own
// (piLocalTurnAccess).
import { LOCAL_HOSTS } from "../drivers/local-inject.ts";

export function isPiLocalModel(driverKind: string | undefined, model: string | null | undefined): boolean {
  if (driverKind !== "piAgent" || !model) return false;
  const slash = model.indexOf("/");
  if (slash <= 0) return false;
  const provider = model.slice(0, slash);
  return LOCAL_HOSTS.some((host) => host.id === provider);
}

/** #1422: whether a missing-key refusal is lifted for the selection being
 * judged. Only that selection counts (a routing candidate, a backup, a
 * room's pick), never the bot's own model: a cloud model on pi keeps its
 * refusal on a bot whose own model is local, and a local candidate is lifted
 * on a bot whose own model is in the cloud. */
export function piLocalKeyRefusalLifted(cause: string | undefined, selection: { driverKind: string | undefined; model: string | null | undefined }): boolean {
  return cause === "no_credentials" && isPiLocalModel(selection.driverKind, selection.model);
}
