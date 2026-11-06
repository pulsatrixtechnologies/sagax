// @ts-nocheck
/** startBotBoat (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createStartBotBoat(getHost: () => Host): any {
async function startBotBoat(bot: BotRecord) {
  const host = getHost();

  let b = await host.boat.findBoat(host.cfg, bot.id);
  const lifecycleOf = () => host.boat.boatTurnLifecycleAction(typeof b?.state === "string" ? b.state : null);
  let lifecycle = lifecycleOf();
  if (lifecycle === "provision") {
    host.broadcast({ kind: "computer", botId: bot.id, state: "provisioning", place: "cloud" });
    await host.boat.provisionBoat(host.cfg, bot.id, bot.name);
    b = await host.boat.findBoat(host.cfg, bot.id);
    lifecycle = lifecycleOf();
  }
  // an archived boat answers every action with an error until it resumes —
  // wake it here, once, instead of letting the agent discover it one failed
  // tool call at a time.
  if (lifecycle === "wake") {
    host.broadcast({ kind: "computer", botId: bot.id, state: "waking", place: "cloud" });
    b = (await host.boat.readyBoat(host.cfg, bot.id)) ?? b;
    lifecycle = lifecycleOf();
  }
  return b && lifecycle === "attach" ? b : null;

}
  return startBotBoat;
}
