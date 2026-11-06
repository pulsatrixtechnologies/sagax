// @ts-nocheck
/** forgetConfidentialBrowser (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createForgetConfidentialBrowser(getHost: () => Host): any {
async function forgetConfidentialBrowser(threadId: string) {
  const host = getHost();
  const { browserEngineEncryptionKey, browserEngineStatus, clearBrowserSessionState } = host;

  const session = host.confidentialBrowserSessions.get(threadId);
  if (!session) return;
  host.confidentialBrowserSessions.delete(threadId);
  host.usedBrowserSessions.delete(session);
  const engine = browserEngineStatus();
  if (engine.kind !== "ready") return;
  const closed = await clearBrowserSessionState(engine.binaryPath, session, {
    env: { PATH: host.augmentedPath() }, encryptionKey: browserEngineEncryptionKey()
  });
  if (closed) await host.browserRuntime.close(session);
  else console.warn(`confidential browser ${session}: could not close its session; run agent-browser --session ${session} close on this server`);

}
  return forgetConfidentialBrowser;
}
