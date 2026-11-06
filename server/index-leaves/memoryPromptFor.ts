// @ts-nocheck
/** memoryPromptFor (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createMemoryPromptFor(getHost: () => Host): any {
function memoryPromptFor(bot: BotRecord, opts: { managedWrites?: boolean; fileTools?: boolean; withholdHostTools?: boolean; audience?: MemoryDestination } = {}) {
  const host = getHost();

  return memorySystemPrompt(bot.id, {
    ...opts,
    enabled: bot.memoryEnabled !== false,
    company: bot.memoryEnabled === false ? undefined : host.companyTextForBots({
      ownerKey: host.store.botOwnerKey(bot),
      bots: host.store.bots.map((item) => ({ id: item.id, ownerKey: host.store.botOwnerKey(item) })),
      read: (id) => host.companyMemory.get(id)
    })
  });

}
  return memoryPromptFor;
}
