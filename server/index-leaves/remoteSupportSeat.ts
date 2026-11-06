// @ts-nocheck
/** remoteSupportSeat (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createRemoteSupportSeat(getHost: () => Host): any {
async function remoteSupportSeat(target: SupportWatchTarget) {
  const host = getHost();
  const { randomUUID } = host;

  const mcp = host.perspicaxMcp;
  const bot = host.store.bot(target.botId);
  if (!mcp || !bot) return null;
  let seat = host.remoteSupportSeats.get(target.code);
  if (!seat) {
    const generation = randomUUID();
    const ready = mcp.prepareTurn({
      threadId: target.threadId, generation, bot: { id: bot.id },
      speakerPrincipalId: target.principalId, speakerOrigin: "person",
      ownerPrincipalId: host.effectiveBotOwner(bot),
    })
      .then((plan) => plan.mounted.length > 0, () => false);
    seat = { generation, ready };
    host.remoteSupportSeats.set(target.code, seat);
  }
  if (await seat.ready) return seat.generation;
  host.dropRemoteSupportSeat(target);
  return null;

}
  return remoteSupportSeat;
}
