// @ts-nocheck
/** asPlaceFailure (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createAsPlaceFailure(getHost: () => Host): any {
async function asPlaceFailure(   error: unknown, place: Surface, source: PlaceSource, bot: { id: string; name: string }, backend: "box" | "vps" = "box", ) {
  const host = getHost();
  const { PlaceUnavailableError, placeUnavailable } = host;

  if (error instanceof host.DirectTurnSetupCancelled || error instanceof host.ComputerWaitParked || error instanceof PlaceUnavailableError) return error;
  const failure = error instanceof Error ? error : new Error(String(error));
  const cause = failure.message.trim().replace(/[\s.]+$/, "");
  if (place !== "cloud" || backend === "vps") {
    return placeUnavailable(place, {
      state: "place-failed", params: { bot: bot.name, cause: `${cause.charAt(0).toUpperCase()}${cause.slice(1)}.` }, source
    }, false);
  }
  // A Boat refusal keeps the provider's own status and code (boat.ts
  // boatRefusal); a failed read of the account keeps its status.
  const { boatCode, boatStatus, status } = failure as { boatCode?: unknown; boatStatus?: unknown; status?: unknown };
  const providerStatus = typeof boatStatus === "number" ? boatStatus : typeof status === "number" ? status : undefined;
  const read = host.cloudRefusal({
    message: failure.message,
    ...(typeof boatCode === "string" ? { code: boatCode } : {}),
    ...(providerStatus !== undefined ? { status: providerStatus } : {})
  }, host.boat.boatAccount(host.cfg)?.included === true);
  const row: PlaceRow = { state: read.state, params: { bot: bot.name, ...read.params }, source };
  if (row.state === "cc-at-once") row.params.holders = await host.cloudComputerHolders(bot.id);
  return placeUnavailable(place, row, false);

}
  return asPlaceFailure;
}
