// @ts-nocheck
/** wipeConfidentialThread (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createWipeConfidentialThread(getHost: () => Host): any {
function wipeConfidentialThread(botId: string, threadId: string, attachmentNames: readonly string[], engineKeys: readonly string[]) {
  const host = getHost();
  const { ATTACHMENTS_DIR, DATA_DIR, TASK_WORKSPACES_DIR, dataEngine, rmSync, writeFileSync } = host;
  if (host.deletedConfidentialThreads.size >= 10_000) host.deletedConfidentialThreads.clear();
  host.deletedConfidentialThreads.add(threadId);
  // the engines' own transcripts of it (a caller deleting several threads
  // at once passes none and purges them together)
  if (engineKeys.length) host.purgeDeletedThreadEngines([{ threadId, keys: engineKeys }], "deleted");
  if (/^[A-Za-z0-9_-]{1,128}$/.test(botId) && /^[A-Za-z0-9_-]{1,128}$/.test(threadId)) {
    try {
      rmSync(join(TASK_WORKSPACES_DIR, botId, threadId), { recursive: true, force: true });
    } catch (error) {
      console.warn(`confidential thread: could not remove its folder (${error instanceof Error ? error.message : "unknown"})`);
    }
  }
  // the oversized tool results kept for it (both spellings of its folder)
  for (const dir of new Set([join(host.TOOL_RESULTS_DIR, threadId.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80)), join(host.TOOL_RESULTS_DIR, threadId.replace(/[^\w.-]/g, "_"))])) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* already gone */ }
  }
  for (const name of attachmentNames) {
    host.attachmentThreads.delete(name);
    if (host.threadsReferencing(name).length) continue;
    try {
      rmSync(join(ATTACHMENTS_DIR, name), { force: true });
      if (host.officeKind(name)) rmSync(host.officeMediaFolder(ATTACHMENTS_DIR, name), { recursive: true, force: true });
      rmSync(host.modelImageCopyPath(ATTACHMENTS_DIR, join(ATTACHMENTS_DIR, name)), { force: true });
    } catch { /* already gone */ }
  }
  host.memoryUpkeep.dropThread(threadId);
  host.confidentialMemoryPasses.forget(threadId);
  host.forgetConfidentialCoordination(threadId);
  // the next workspace backup rebuilds and vacuums its database copies:
  // this thread's words may still sit in free pages and index segments
  try { writeFileSync(join(DATA_DIR, CONFIDENTIAL_FORGOTTEN_MARKER), "", { mode: 0o600 }); } catch { /* the backup then strips by the roster only */ }
  void host.forgetConfidentialBrowser(threadId).catch(() => undefined);
  void host.scrubThreadDecisions(DATA_DIR, threadId).catch(host.reportBackgroundError);
  // its own Data database and sheet (data/scope.ts)
  const dataKey = threadScopeKeyFor(botId, threadId);
  try { host.dataSheets.deleteScope(dataKey); } catch { /* already gone */ }
  if (dataEngine.unavailable() === null) void dataEngine.deleteScope?.(dataKey).catch((error: unknown) => console.warn(`confidential thread: could not delete its Data (${error instanceof Error ? error.message : "unknown"})`));

}
  return wipeConfidentialThread;
}
