// @ts-nocheck
/** forgetTemporaryBrowser (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createForgetTemporaryBrowser(getHost: () => Host): any {
async function forgetTemporaryBrowser(botId: string) {
  const host = getHost();
  const { browserEngineEncryptionKey, browserEngineStatus, clearBrowserSessionState } = host;

  const session = host.temporaryBrowserSessions.get(botId);
  if (!session) return;
  host.temporaryBrowserSessions.delete(botId);
  host.usedBrowserSessions.delete(session);
  const engine = browserEngineStatus();
  if (engine.kind !== "ready") return;
  const closed = await clearBrowserSessionState(engine.binaryPath, session, {
    env: { PATH: host.augmentedPath() }, encryptionKey: browserEngineEncryptionKey()
  });
  if (closed) await host.browserRuntime.close(session);
  else console.warn(`temporary browser ${session}: could not close its session; run agent-browser --session ${session} close on this server`);

}
  return forgetTemporaryBrowser;
}
