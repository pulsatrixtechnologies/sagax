// @ts-nocheck
/** attachBotBoat (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createAttachBotBoat(getHost: () => Host): any {
async function attachBotBoat(bot: BotRecord, owner: TurnOwner, start: { budgetMs: number; onSeated: () => void }) {
  const host = getHost();

  // Claim before any network await so setup itself cannot race another turn.
  await host.bindTurnComputer(owner, `computer:box-bot:${bot.id}`, true);
  start.onSeated();
  const machine = await host.withinBudget(host.startBotBoat(bot), start.budgetMs, host.CLOUD_COMPUTER_DID_NOT_START);
  if (!machine) return null;
  await host.bindTurnComputer(owner, `computer:box:${machine.id}`);
  return {
    boxId: machine.id as string,
    capture: () => host.boat.screenshotBoat(host.cfg, bot.id, machine.id)
  };

}
  return attachBotBoat;
}
