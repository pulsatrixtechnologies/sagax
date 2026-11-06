// @ts-nocheck
/** browserIntegration (#1388). Pure move from server/index.ts. */
import { noteBrowserOwner } from "../auth/web-bot-auth.ts";
import { browserEngineStatus, describeBrowserEngine, agentBrowserIntegration, browserEngineEncryptionKey, prepareBrowserSessionState } from "../browser/browser-engine.ts";
import { browserEgress } from "../browser/egress/registry.ts";
import { MY_CHROME_PROFILE } from "../browser/my-chrome/pilot.ts";
import { browserProfilePartitionTarget, browserEngineAttachCdpUrl, builtInBrowserEnabled } from "../config.ts";
import { augmentedPath } from "../env-path.ts";
import { harnessMcpTokenEnv } from "../harness-mcp-token.ts";
import { SPAWNED_PROXIES } from "../proxy-paths.ts";
export type Host = Record<string, any>;

export function createBrowserIntegration(getHost: () => Host): any {
async function browserIntegration(botId: string, requestedProfile: string | undefined, turn?: { threadId: string; generation: string }, sessionThreadId?: string) {
  const host = getHost();
  const profile = host.effectiveBrowserProfile(botId, requestedProfile);
  const status = browserEngineStatus();
  if (status.kind !== "ready") {
    if (!host.engineUnavailableLogged) {
      host.engineUnavailableLogged = true;
      console.warn(`${describeBrowserEngine(status)}; bots get no browser tools until it is installed`);
    }
    return null;
  }
  // A profile that no longer exists falls back to the bot's own session.
  const threadForSession = turn?.threadId ?? sessionThreadId;
  const confidential = Boolean(threadForSession && host.store.isConfidentialThread(threadForSession));
  // My Chrome: the person's own Chrome through the gate. Never saved to or
  // restored from disk; never in a confidential conversation (its own guest).
  const ownChrome = !confidential && profile === MY_CHROME_PROFILE;
  const profileTarget = !confidential && profile && profile !== "guest" && !ownChrome ? browserProfilePartitionTarget(host.cfg, profile) ?? host.personalProfileTarget(botId, profile) : null;
  const partitionId = confidential || profile === "guest" ? "guest" : ownChrome ? MY_CHROME_PROFILE : (profileTarget?.partitionId ?? "");
  const session = host.currentBrowserSession(botId, profile, threadForSession);
  const browserBot = host.store.bot(botId);
  noteBrowserOwner(session, host.IDENTITY.kind === "perspicax" && browserBot ? host.effectiveBotOwner(browserBot).toLowerCase() : null);
  const persistent = !confidential && profile !== "guest" && !ownChrome;
  let attachCdpUrl = browserEngineAttachCdpUrl(host.cfg) ?? undefined;
  if (ownChrome) {
    try { attachCdpUrl = await host.myChrome.urlFor(session, { hasShell: host.myChromeBotHasShell(botId) }); }
    catch { return null; }
  }
  const spec = agentBrowserIntegration({
      binaryPath: status.binaryPath,
      session,
      encryptionKey: browserEngineEncryptionKey(),
      persistent,
      env: { ...process.env, PATH: augmentedPath() },
      attachCdpUrl,
      // A Chrome attached over CDP is the person's own: no gate to put it behind
      // (My Chrome has its own: server/browser/my-chrome/gate.ts).
      ...(attachCdpUrl ? {} : { egressPort: await browserEgress.open(session) })
    });
  host.usedBrowserSessions.set(session, spec);
  host.browserSessionBots.set(session, botId);
  await prepareBrowserSessionState(status.binaryPath, session, { env: spec.env, persistent, isCurrent: () => {
    const current = host.store.bot(botId);
    return !!current && current.browser !== false && builtInBrowserEnabled(host.cfg)
      && host.currentBrowserSession(current.id, current.browserProfile, threadForSession) === session
      && (!turn || host.activeInternalGenerationByThread.get(turn.threadId) === turn.generation);
  } });
  if (!turn) return { profile: partitionId, session, spec, integration: spec };
  const token = host.mintInternalCapability({ botId, ...turn, browserSession: session,
    kind: "browser", depth: 0, skillAuthoring: false, createdBots: 0, openedThreads: 0 });
  return { profile: partitionId, session, spec, integration: {
    command: process.execPath, args: [SPAWNED_PROXIES.harnessMcp, "browser"], env: {
      ...host.AGENTS_NODE_FLAG, [harnessMcpTokenEnv("browser")]: token, SAGAX_HARNESS_URL: `http://127.0.0.1:${host.PORT}`
    }
  } };
}
  return browserIntegration;
}
