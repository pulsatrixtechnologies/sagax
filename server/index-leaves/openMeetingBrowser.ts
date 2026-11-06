// @ts-nocheck
/** openMeetingBrowser (#1388). Pure move from server/index.ts. */
import { agentBrowserIntegration, describeBrowserEngine, prepareBrowserSessionState } from "../browser/browser-engine.ts";
export type Host = Record<string, any>;

export function createOpenMeetingBrowser(getHost: () => Host): any {
async function openMeetingBrowser(_botId: string, meetingId: string) {
  const host = getHost();
  const { browserEngineEncryptionKey, browserEngineStatus, closeBrowserSession } = host;

  const status = browserEngineStatus();
  if (status.kind !== "ready") throw new Error(describeBrowserEngine(status));
  const session = `meeting-${meetingId.replace(/[^A-Za-z0-9]/g, "").slice(0, 24)}`;
  // A guest browser: no saved sign-in, nothing restored, nothing kept.
  const spec = agentBrowserIntegration({
    binaryPath: status.binaryPath,
    session,
    encryptionKey: browserEngineEncryptionKey(),
    persistent: false,
    env: { ...process.env, PATH: host.augmentedPath() },
    egressPort: await host.browserEgress.open(session),
    meetingMedia: true
  });
  host.usedBrowserSessions.set(session, spec);
  await prepareBrowserSessionState(status.binaryPath, session, { env: spec.env, persistent: false });
  const call = (name: string, args: Record<string, unknown>, timeoutMs: number) => host.browserRuntime.harnessCall(session, spec, name, args, timeoutMs);
  const failed = (result: unknown) => Boolean(result && typeof result === "object" && (result as { isError?: unknown }).isError === true);
  return {
    open: async (url) => {
      // Remote audio must play without a click for the capture to hear it.
      const result = await call("agent_browser_open", { url, extraArgs: ["--autoplay-policy=no-user-gesture-required"] }, 90_000);
      if (failed(result)) throw new Error("the meeting page did not open");
    },
    eval: async (script, timeoutMs = 15_000) => {
      try { return host.parseEvalJson(await call("agent_browser_eval", { script, timeoutMs }, timeoutMs + 15_000)); }
      catch { return null; }
    },
    click: async (selector) => {
      try { return !failed(await call("agent_browser_click", { selector }, 30_000)); }
      catch { return false; }
    },
    close: async () => {
      await host.browserRuntime.close(session).catch(() => undefined);
      await closeBrowserSession(spec.command, host.browserRuntimeEnv({ ...spec.env, AGENT_BROWSER_SESSION: session })).catch(() => false);
      host.usedBrowserSessions.delete(session);
    }
  };

}
  return openMeetingBrowser;
}
