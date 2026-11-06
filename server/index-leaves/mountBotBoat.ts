// @ts-nocheck
/** mountBotBoat (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createMountBotBoat(getHost: () => Host): any {
function mountBotBoat(   bot: BotRecord,   owner: TurnOwner,   opts: {     /** Where this place came from: a start that fails is read as its one      * line and one way on (shared/place-view.ts), in a thread and a room      * alike, before the claim rejects. */     source?: PlaceSource;     onClaimed: (capture: () => Promise<{ png: string; format: string }>) => void;     onRejected?: (failure: string, error?: unknown) => void;   }, ) {
  const host = getHost();

  const slot: AutoVmClaimSlot = {
    owner,
    lazy: true,
    startsComputer: true,
    label: "the cloud computer",
    // A call waits on the start like on any claim (COMPUTER_CALL_WAIT_MS);
    // one that runs out finds the start still going and waits again, inside
    // the start's own budget. Until this turn has the computer to itself
    // another conversation does, and a call is told so (the gate's
    // contention text); from then on the claim is starting it.
    onRejected: opts.onRejected,
    claim: async () => {
      let attached: Awaited<ReturnType<typeof host.attachBotBoat>>;
      try {
        attached = await host.attachBotBoat(bot, owner, {
          budgetMs: host.CLOUD_COMPUTER_START_BUDGET_MS,
          onSeated: () => { slot.pendingReason = host.CLOUD_COMPUTER_STARTING; }
        });
        if (!attached) throw new Error("the cloud computer could not be created or reached");
      } catch (error) {
        throw opts.source ? await host.asPlaceFailure(error, "cloud", opts.source, bot, "box") : error;
      }
      slot.boxId = attached.boxId;
      opts.onClaimed(attached.capture);
    }
  };
  host.autoVmClaims.set(owner.threadId, slot);
  return host.cloudComputerTools(bot.id, owner, null);

}
  return mountBotBoat;
}
