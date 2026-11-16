// @ts-nocheck
/** makeThreadConfidential (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

type CarrierTask = { threadId: string; resumeCursors?: Record<string, unknown>; engineSessions?: readonly string[]; carriedThreads?: readonly string[] };

/** Whether a thread's engine session may hold words of `threadId`: its
 * prompt carried that thread since the session started (unknown on a thread
 * whose turns predate the record: counted), and it holds a session or runs a
 * turn right now (one that has not announced its session yet). */
function carries(task: CarrierTask, threadId: string, busy: boolean): boolean {
  const holds = busy || Object.keys(task.resumeCursors ?? {}).length > 0 || (task.engineSessions?.length ?? 0) > 0;
  return holds && task.threadId !== threadId && (task.carriedThreads === undefined || task.carriedThreads.includes(threadId));
}

export function createMakeThreadConfidential(getHost: () => Host): any {
function makeThreadConfidential(botId: string, threadId: string) {
  const host = getHost();
  const { DATA_DIR } = host;

  // Every other conversation of this bot whose engine session may already
  // carry this thread's words: the "Earlier topics" block of a stream turn
  // (its title and digest) and the "Recent work" lines ride in the volatile
  // half, inside the session's own history, and a later turn only sends a
  // section without them. Read before the change drops its stream mark.
  // A carrier running a turn right now (a parallel task, a routine run,
  // another topic) keeps its process to the end of that turn.
  const busy = new Set((host.store.tasks(botId) ?? []).filter((task) => host.threadBusy(botId, task.threadId)).map((task) => task.threadId));
  const carriers = (host.store.tasks(botId) ?? [])
    .filter((task) => carries(task, threadId, busy.has(task.threadId)))
    .map((task) => task.threadId);
  host.store.makeTaskConfidential(botId, threadId);
  // words held for routing keep no copy once the thread is confidential
  host.routableSteers.forgetThread(threadId);
  host.memoryUpkeep.dropThread(threadId);
  void host.scrubThreadDecisions(DATA_DIR, threadId).catch(host.reportBackgroundError);
  // its settled teammate work (runtime.db) keeps no words of it
  host.forgetConfidentialCoordination(threadId);
  // the engines' own transcripts of it so far (server/engines/engine-transcripts.ts),
  // and those of the conversations that carried it (#4407): each next turn
  // starts a new session, its own transcript replayed, with a prompt that no
  // longer holds this thread
  host.forgetThreadEngineSessions(botId, [threadId, ...carriers], "made confidential");
  // a busy carrier's process is not released under its running turn, and
  // that turn may still write its session: its sessions are forgotten again
  // before its next turn starts (server/turns/start-turn-setup.ts), so that
  // turn never reuses nor resumes the session that holds this thread
  for (const carrier of carriers) if (busy.has(carrier)) host.store.markForgetSessionsAtNextTurn(botId, carrier);
  // a room this bot is in keeps no cursor of its own: its idle processes
  // close now, and its next turn there starts on a new session, so one busy
  // right now does not carry its history on either
  for (const group of host.store.groups ?? []) {
    if (!group.memberIds?.includes(botId)) continue;
    for (const roomThread of [group.threadId, ...(group.tasks ?? []).map((task) => task.threadId)]) {
      host.releaseThreadEngines(roomThread);
      host.roomMemberContexts.forgetSession(roomThread, botId);
    }
  }

}
  return makeThreadConfidential;
}
