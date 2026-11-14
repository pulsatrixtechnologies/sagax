// 2026-10-29: the Kubernetes API of a managed cluster (AKS)
// answers on a public IP that changes at each cluster start, and the
// `kubernetes` Service IP is translated to that public IP before the CNI
// evaluates the NetworkPolicy, so 10.0.0.0/8 in the deny list does not keep a
// sandbox off the control plane. SAGAX_SANDBOX_K8S_DENY_HOSTS names the API
// (its FQDN, or IPv4 addresses): the provisioner resolves it at start and
// every minute, and every sandbox NetworkPolicy denies each address as a /32.
// 2026-11-14 (issue 503): unset, nothing is denied here, on purpose. The pod's
// KUBERNETES_SERVICE_HOST is the `kubernetes` Service ClusterIP, the address
// the policy never sees, so it is no default. The Azure adapter sets the API
// FQDN (OpenTofu output api_server_fqdn) and ships a placeholder this parser
// refuses, so a rebuild left unfilled stops at start instead of running open.
import { lookup as dnsLookup } from "node:dns/promises";
import { isIPv4 } from "node:net";

export const DENY_HOSTS_TICK_MS = 60_000;
const MAX_HOSTS = 8;
const HOSTNAME = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;

/** The hosts whose addresses no sandbox may reach; empty when unset. */
export function denyHostsFromEnv(env: NodeJS.ProcessEnv): string[] {
  const raw = env.SAGAX_SANDBOX_K8S_DENY_HOSTS?.trim() ?? "";
  if (!raw) return [];
  const hosts = [...new Set(raw.split(/[\s,]+/).filter(Boolean).map((host) => host.toLowerCase()))];
  if (hosts.length > MAX_HOSTS) throw new Error(`SAGAX_SANDBOX_K8S_DENY_HOSTS takes at most ${MAX_HOSTS} hosts`);
  for (const host of hosts) {
    if (!isIPv4(host) && !HOSTNAME.test(host)) throw new Error(`SAGAX_SANDBOX_K8S_DENY_HOSTS: ${host} is not a host name or an IPv4 address`);
  }
  return hosts;
}

export type DenyLookup = (host: string) => Promise<string[]>;

/** IPv4 addresses of a host, from the system resolver. */
export const systemDenyLookup: DenyLookup = async (host) => {
  if (isIPv4(host)) return [host];
  const found = await dnsLookup(host, { all: true, family: 4 });
  return found.map((entry) => entry.address);
};

/** Every IPv4 address of the hosts as a sorted /32 list. A host with no
 * address is an error: the caller keeps its last list rather than open. */
export async function resolveDenyHosts(hosts: readonly string[], lookup: DenyLookup = systemDenyLookup): Promise<string[]> {
  const cidrs = new Set<string>();
  for (const host of hosts) {
    const addresses = (await lookup(host)).filter((address) => isIPv4(address));
    if (addresses.length === 0) throw new Error(`${host} resolved to no IPv4 address`);
    for (const address of addresses) cidrs.add(`${address}/32`);
  }
  return [...cidrs].sort();
}
