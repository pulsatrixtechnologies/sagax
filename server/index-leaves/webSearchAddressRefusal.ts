// @ts-nocheck
/** webSearchAddressRefusal (#1388). Pure move from server/index.ts. */
import { defaultMediaProxyResolver, blockedAddressReason } from "../media/media-proxy-guard.ts";
import { isIP } from "node:net";
export type Host = Record<string, any>;

export function createWebSearchAddressRefusal(getHost: () => Host): any {
async function webSearchAddressRefusal(raw: string): Promise<string | null> {
  const host = getHost();
  if (host.IDENTITY.kind !== "perspicax") return null;
  let host: string;
  try { host = new URL(raw).hostname.replace(/^\[|\]$/g, ""); } catch { return "Enter the instance's address, starting with http:// or https://."; }
  const refused = "On an organization server, the SearXNG instance must be reachable on the public internet.";
  if (/^(?:localhost|.*\.localhost|.*\.local|.*\.internal)$/i.test(host)) return refused;
  let addresses: string[];
  try {
    addresses = isIP(host) ? [host] : (await defaultMediaProxyResolver(host)).map((entry) => entry.address);
  } catch {
    return "The SearXNG address could not be found.";
  }
  if (!addresses.length) return "The SearXNG address could not be found.";
  return addresses.some((address) => blockedAddressReason(address) !== null) ? refused : null;
}
  return webSearchAddressRefusal;
}
