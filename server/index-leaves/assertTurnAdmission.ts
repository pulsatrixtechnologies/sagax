// @ts-nocheck
/** assertTurnAdmission (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createAssertTurnAdmission(getHost: () => Host): any {
function assertTurnAdmission(botId: string, threadId: string) {
  const host = getHost();

  if (host.threadBusy(botId, threadId)) throw Object.assign(new Error("this thread is already working — interrupt it first"), { status: 409, code: "thread_busy" });
  if (host.activeGroupTurnForBot(botId)) {
    throw Object.assign(new Error("the bot is already working in a channel — wait for it to finish"), { status: 409, code: "thread_busy" });
  }
  if (host.botAtThreadCapacity(botId, threadId)) {
    throw Object.assign(new Error(`this bot has reached its limit of ${botMaxConcurrentThreads(store.bot(botId), cfg)} parallel threads — wait for one to finish`), { status: 409, code: "thread_limit" });
  }

}
  return assertTurnAdmission;
}
