// @ts-nocheck
/** makeThreadConfidential (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createMakeThreadConfidential(getHost: () => Host): any {
function makeThreadConfidential(botId: string, threadId: string) {
  const host = getHost();
  const { DATA_DIR } = host;

  host.store.makeTaskConfidential(botId, threadId);
  // words held for routing keep no copy once the thread is confidential
  host.routableSteers.forgetThread(threadId);
  host.memoryUpkeep.dropThread(threadId);
  void host.scrubThreadDecisions(DATA_DIR, threadId).catch(host.reportBackgroundError);
  // its settled teammate work (runtime.db) keeps no words of it
  host.forgetConfidentialCoordination(threadId);
  // the engines' own transcripts of it so far (server/engines/engine-transcripts.ts):
  // the next turn starts a new session, its own transcript replayed
  host.forgetThreadEngineSessions(botId, threadId, "made confidential");

}
  return makeThreadConfidential;
}
