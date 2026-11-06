// @ts-nocheck
/** revokeLegacyKey (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createRevokeLegacyKey(getHost: () => Host): any {
function revokeLegacyKey(bot: BotRecord, key: string) {
  const host = getHost();

  host.store.patchBot(bot.id, { alwaysAllow: (bot.alwaysAllow ?? []).filter((entry) => entry !== key) });
  for (const task of bot.tasks ?? []) {
    if (task.alwaysAllow?.includes(key)) host.store.patchTask(bot.id, task.threadId, { alwaysAllow: task.alwaysAllow.filter((entry) => entry !== key) });
  }
  const live = host.store.bot(bot.id);
  if (live) host.broadcast({ kind: "bot", bot: host.wireBot(live) });

}
  return revokeLegacyKey;
}
