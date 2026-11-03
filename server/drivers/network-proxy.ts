// The proxy environment an engine process gets for a turn whose network
// traffic leaves through the person's computer (organization server, desktop
// bridge, server/desktop/desktop-egress.ts). The model API hosts, this server's own
// loopback and any base URL the engine is configured with stay direct.
import { egressEnvironment } from "../desktop/desktop-egress.ts";

export function networkProxyEnvironment(proxy: { url: string; noProxy: string[] }, env: Record<string, string | undefined>): Record<string, string> {
  const configured = [env.ANTHROPIC_BASE_URL, env.OPENAI_BASE_URL]
    .map((value) => { try { return value ? new URL(value).hostname : ""; } catch { return ""; } });
  return egressEnvironment(proxy.url, [...proxy.noProxy, ...configured]);
}
