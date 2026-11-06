// @ts-nocheck
/** settleMemberAutoLevelsFor (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createSettleMemberAutoLevelsFor(getHost: () => Host): any {
function settleMemberAutoLevelsFor(botIds: readonly string[], why: string) {
  const host = getHost();

  const reset = host.settleMemberAutoLevels(botIds);
  const total = reset.bots.length + reset.threads.length;
  if (!total) return;
  console.log(`organization: ${total} saved Auto or Auto-accept edits level(s) of members' bots set back to Ask (${reset.bots.length} bot default(s), ${reset.threads.length} thread(s), ${why}); automatic levels are off for members' bots`);
  for (const botId of new Set([...reset.bots, ...reset.threads.map((thread) => thread.botId)])) {
    const bot = host.store.bot(botId);
    if (bot) host.broadcast({ kind: "bot", bot: host.publicBot(bot) });
  }

}
  return settleMemberAutoLevelsFor;
}
