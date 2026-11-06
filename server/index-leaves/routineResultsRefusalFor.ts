// @ts-nocheck
/** routineResultsRefusalFor (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createRoutineResultsRefusalFor(getHost: () => Host): any {
function routineResultsRefusalFor(auth: RequestAuth, body: unknown) {
  const host = getHost();

  const resultsThreadId = body && typeof body === "object" && typeof (body as { resultsThreadId?: unknown }).resultsThreadId === "string"
    ? (body as { resultsThreadId: string }).resultsThreadId : null;
  if (!resultsThreadId) return null;
  // No routine comes from, or reports into, a confidential thread
  // (server/threads/confidential-threads.ts): its runs would work as the bot
  // owner, in their environment.
  if (host.store.isConfidentialThread(resultsThreadId)) return "No routine can be created from a confidential thread. Set it up from an ordinary thread.";
  return host.cloudThreadRefusal(auth, resultsThreadId);

}
  return routineResultsRefusalFor;
}
