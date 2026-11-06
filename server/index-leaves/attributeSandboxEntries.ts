// @ts-nocheck
/** attributeSandboxEntries (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createAttributeSandboxEntries(getHost: () => Host): any {
async function attributeSandboxEntries(principalId: string, names: readonly string[]) {
  const host = getHost();

  // The first 200 entries only, the rest go to _unsorted (a root that messy
  // is mostly one bot's output). 2026-11-03 (audit S-5): every fragment in
  // ONE pass over messages, in the search worker, where this used to run up
  // to 400 synchronous full scans and block the server at its first start.
  const listed = names.slice(0, 200);
  let threads: Map<string, string[]>;
  try {
    threads = await host.threadsReferencingAsync(host.attributionFragments(listed));
  } catch (error) {
    // busy or interrupted: nothing is attributed, the entries go to _unsorted
    console.warn(`[workspace-tidy] attribution skipped: ${error instanceof Error ? error.message : String(error)}`);
    return new Map();
  }
  // 2026-11-03 (audit S-6): only this person's threads (the thread's owner,
  // else the bot owner) attribute an entry of this person's environment
  return host.attributeEntries(principalId, listed, threads, (threadId) => {
    const bot = host.store.botByThread(threadId);
    if (!bot) return undefined;
    const person = host.store.taskByThread(bot.id, threadId)?.ownerPrincipalId || host.effectiveBotOwner(bot);
    return person ? { botId: bot.id, person } : undefined;
  });

}
  return attributeSandboxEntries;
}
