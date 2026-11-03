// Destination guard of the media proxy (/api/media/proxy/<token>).
//
// The upstream URL of a proxied video comes from a bot, so the server must not
// fetch whatever it names: loopback, private networks, link-local, the cloud
// metadata endpoints and other non-public addresses are refused unless the
// operator allows them in SAGAX_MEDIA_PROXY_ALLOW_HOSTS. The check runs on
// every address the name resolves to, the connection then goes to the address
// that was checked (no second lookup a rebinding DNS could answer
// differently), and redirects are followed by hand with the same check on
// each hop (streamProxiedMedia).
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

export const ALLOW_HOSTS_ENV = "SAGAX_MEDIA_PROXY_ALLOW_HOSTS";

export type BlockReason =
  | "scheme"
  | "port"
  | "unresolved"
  | "loopback"
  | "unspecified"
  | "link-local"
  | "metadata"
  | "private"
  | "cgnat"
  | "ula"
  | "multicast"
  | "reserved"
  | "ipv4-mapped"
  | "too-many-redirects";

/** Refusal of a destination. Its message names the reason and the host, never the path, query or a token. */
export class MediaProxyBlockedError extends Error {
  readonly reason: BlockReason;
  readonly host: string;
  constructor(reason: BlockReason, host: string) {
    super(`media proxy destination refused: ${reason} (${host})`);
    this.name = "MediaProxyBlockedError";
    this.reason = reason;
    this.host = host;
  }
}

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export type MediaProxyResolver = (hostname: string) => Promise<ResolvedAddress[]>;

interface Cidr {
  family: 4 | 6;
  base: bigint;
  bits: number;
}

export interface MediaProxyPolicy {
  /** Exact host names (lower case, no trailing dot). */
  hosts: Set<string>;
  /** Suffixes from `*.example.com` entries (stored as `.example.com`). */
  suffixes: string[];
  cidrs: Cidr[];
}

// ---------------------------------------------------------------- addresses

function ipv4ToBigInt(ip: string): bigint {
  return ip.split(".").reduce((acc, part) => (acc << 8n) | BigInt(Number(part)), 0n);
}

/** Expand an IPv6 literal (with an optional dotted IPv4 tail) to 128 bits. */
function ipv6ToBigInt(ip: string): bigint {
  let text = ip.toLowerCase();
  const zone = text.indexOf("%");
  if (zone >= 0) text = text.slice(0, zone);
  const lastColon = text.lastIndexOf(":");
  const tail = text.slice(lastColon + 1);
  if (tail.includes(".")) {
    const v4 = ipv4ToBigInt(tail);
    text = `${text.slice(0, lastColon + 1)}${(v4 >> 16n).toString(16)}:${(v4 & 0xffffn).toString(16)}`;
  }
  const [head, rest] = text.split("::") as [string, string | undefined];
  const left = head ? head.split(":") : [];
  const right = rest === undefined ? [] : rest ? rest.split(":") : [];
  const fill = rest === undefined ? 0 : 8 - left.length - right.length;
  const groups = [...left, ...Array<string>(fill).fill("0"), ...right];
  return groups.reduce((acc, group) => (acc << 16n) | BigInt(parseInt(group || "0", 16)), 0n);
}

function toBigInt(ip: string, family: 4 | 6): bigint {
  return family === 4 ? ipv4ToBigInt(ip) : ipv6ToBigInt(ip);
}

function parseCidr(text: string): Cidr | null {
  const [addr, bitsText] = text.split("/") as [string, string | undefined];
  const family = isIP(addr);
  if (family !== 4 && family !== 6) return null;
  const max = family === 4 ? 32 : 128;
  const bits = bitsText === undefined ? max : Number(bitsText);
  if (!Number.isInteger(bits) || bits < 0 || bits > max) return null;
  return { family, base: toBigInt(addr, family), bits };
}

function inCidr(value: bigint, family: 4 | 6, cidr: Cidr): boolean {
  if (cidr.family !== family) return false;
  const width = family === 4 ? 32n : 128n;
  const shift = width - BigInt(cidr.bits);
  return value >> shift === cidr.base >> shift;
}

function cidrs(entries: Array<[string, BlockReason]>): Array<[Cidr, BlockReason]> {
  return entries.map(([text, reason]) => [parseCidr(text)!, reason]);
}

// Order matters: the first match names the reason (metadata before link-local).
const BLOCKED_V4 = cidrs([
  ["169.254.169.254/32", "metadata"],
  ["168.63.129.16/32", "metadata"],
  ["0.0.0.0/32", "unspecified"],
  ["0.0.0.0/8", "reserved"],
  ["127.0.0.0/8", "loopback"],
  ["169.254.0.0/16", "link-local"],
  ["10.0.0.0/8", "private"],
  ["172.16.0.0/12", "private"],
  ["192.168.0.0/16", "private"],
  ["100.64.0.0/10", "cgnat"],
  ["192.0.0.0/24", "reserved"],
  ["192.0.2.0/24", "reserved"],
  ["192.88.99.0/24", "reserved"],
  ["198.18.0.0/15", "reserved"],
  ["198.51.100.0/24", "reserved"],
  ["203.0.113.0/24", "reserved"],
  ["224.0.0.0/4", "multicast"],
  ["240.0.0.0/4", "reserved"],
]);

const BLOCKED_V6 = cidrs([
  ["fd00:ec2::254/128", "metadata"],
  ["::/128", "unspecified"],
  ["::1/128", "loopback"],
  ["::ffff:0:0/96", "ipv4-mapped"],
  ["::/96", "ipv4-mapped"],
  ["64:ff9b::/96", "ipv4-mapped"],
  ["64:ff9b:1::/48", "reserved"],
  ["100::/64", "reserved"],
  ["fe80::/10", "link-local"],
  ["fec0::/10", "reserved"],
  ["fc00::/7", "ula"],
  ["ff00::/8", "multicast"],
  ["2001::/32", "reserved"],
  ["2001:10::/28", "reserved"],
  ["2001:20::/28", "reserved"],
  ["2001:db8::/32", "reserved"],
  ["2002::/16", "reserved"],
]);
const GLOBAL_UNICAST_V6 = parseCidr("2000::/3")!;

/** Why an address must not be fetched, or null when it is a public unicast address. */
export function blockedAddressReason(address: string): BlockReason | null {
  const ip = stripBrackets(address);
  const family = isIP(ip);
  if (family !== 4 && family !== 6) return "unresolved";
  const value = toBigInt(ip, family);
  for (const [cidr, reason] of family === 4 ? BLOCKED_V4 : BLOCKED_V6) {
    if (inCidr(value, family, cidr)) return reason;
  }
  if (family === 6 && !inCidr(value, 6, GLOBAL_UNICAST_V6)) return "reserved";
  return null;
}

function stripBrackets(host: string): string {
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

function normalizeHost(host: string): string {
  return stripBrackets(host.trim().toLowerCase()).replace(/\.$/, "");
}

// ------------------------------------------------------------------- policy

/**
 * Parse SAGAX_MEDIA_PROXY_ALLOW_HOSTS: entries separated by commas or spaces,
 * each a host name (`glitcho.lan`), a wildcard (`*.tail1234.ts.net`, sub-domains
 * only), an IP address or a CIDR (`192.168.1.0/24`, `fd7a:115c:a1e0::/48`).
 * Unknown entries are ignored. Empty means nothing private is allowed.
 */
export function parseMediaProxyAllowList(raw: string | undefined): MediaProxyPolicy {
  const policy: MediaProxyPolicy = { hosts: new Set(), suffixes: [], cidrs: [] };
  for (const entry of (raw ?? "").split(/[\s,]+/)) {
    const text = entry.trim().toLowerCase();
    if (!text) continue;
    const cidr = parseCidr(stripBrackets(text));
    if (cidr) {
      policy.cidrs.push(cidr);
      continue;
    }
    if (text.startsWith("*.") && text.length > 2) {
      policy.suffixes.push(normalizeHost(text.slice(1)));
      continue;
    }
    if (/^[a-z\d]([a-z\d-]*[a-z\d])?(\.[a-z\d]([a-z\d-]*[a-z\d])?)*\.?$/.test(text)) policy.hosts.add(normalizeHost(text));
  }
  return policy;
}

let cachedRaw: string | undefined;
let cachedPolicy: MediaProxyPolicy | null = null;

/** The policy from the environment, parsed again only when the variable changes. */
export function mediaProxyPolicyFromEnv(env: NodeJS.ProcessEnv = process.env): MediaProxyPolicy {
  const raw = env[ALLOW_HOSTS_ENV] ?? "";
  if (!cachedPolicy || raw !== cachedRaw) {
    cachedRaw = raw;
    cachedPolicy = parseMediaProxyAllowList(raw);
  }
  return cachedPolicy;
}

function hostAllowed(host: string, policy: MediaProxyPolicy): boolean {
  const name = normalizeHost(host);
  if (policy.hosts.has(name)) return true;
  return policy.suffixes.some((suffix) => name.endsWith(suffix) && name.length > suffix.length);
}

function addressAllowed(address: string, policy: MediaProxyPolicy): boolean {
  const ip = stripBrackets(address);
  const family = isIP(ip);
  if (family !== 4 && family !== 6) return false;
  const value = toBigInt(ip, family);
  if (policy.cidrs.some((cidr) => inCidr(value, family, cidr))) return true;
  // An IPv4-mapped IPv6 address is allowed when its IPv4 is.
  if (family === 6 && value >> 32n === 0xffffn) {
    return policy.cidrs.some((cidr) => inCidr(value & 0xffffffffn, 4, cidr));
  }
  return false;
}

function isLocalName(host: string): boolean {
  const name = normalizeHost(host);
  return name === "localhost" || name.endsWith(".localhost");
}

/**
 * Synchronous check of a URL without DNS, for the playlist rewrite: false when
 * the scheme is not http(s), or the host is an IP literal or `localhost` that
 * the policy does not allow. A host name passes here; the proxy checks what it
 * resolves to when it fetches it.
 */
export function mediaUrlMayBeProxied(url: URL, policy: MediaProxyPolicy = mediaProxyPolicyFromEnv()): boolean {
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const host = url.hostname;
  if (hostAllowed(host, policy)) return true;
  const ip = stripBrackets(host);
  if (isIP(ip)) return blockedAddressReason(ip) === null || addressAllowed(ip, policy);
  return !isLocalName(host);
}

/** True when the browser cannot fetch the URL by itself (a literal non-public host). */
export function isNonPublicLiteralHost(hostname: string): boolean {
  if (isLocalName(hostname)) return true;
  const ip = stripBrackets(hostname);
  return isIP(ip) !== 0 && blockedAddressReason(ip) !== null;
}

export const defaultMediaProxyResolver: MediaProxyResolver = async (hostname) => {
  const found = await dnsLookup(hostname, { all: true, verbatim: true });
  return found
    .filter((entry) => entry.family === 4 || entry.family === 6)
    .map((entry) => ({ address: entry.address, family: entry.family as 4 | 6 }));
};

/**
 * Check a destination before the proxy connects to it, and return the address
 * to connect to. Every address the name resolves to must be public (or
 * allowed): one private answer refuses the whole name, so a resolver cannot
 * slip a private address in beside a public one. The port must be 80 or 443
 * unless the host is allowed by name or every address by CIDR.
 */
export async function checkMediaDestination(
  url: URL,
  policy: MediaProxyPolicy = mediaProxyPolicyFromEnv(),
  resolver: MediaProxyResolver = defaultMediaProxyResolver,
): Promise<ResolvedAddress> {
  const host = normalizeHost(url.hostname);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new MediaProxyBlockedError("scheme", host);
  const byName = hostAllowed(host, policy);
  let addresses: ResolvedAddress[];
  const literal = isIP(host);
  if (literal === 4 || literal === 6) {
    addresses = [{ address: host, family: literal }];
  } else {
    if (isLocalName(host) && !byName) throw new MediaProxyBlockedError("loopback", host);
    try {
      addresses = await resolver(host);
    } catch {
      throw new MediaProxyBlockedError("unresolved", host);
    }
    if (addresses.length === 0) throw new MediaProxyBlockedError("unresolved", host);
  }
  let allByCidr = true;
  for (const entry of addresses) {
    const viaCidr = addressAllowed(entry.address, policy);
    if (!viaCidr) allByCidr = false;
    if (viaCidr) continue;
    const reason = blockedAddressReason(entry.address);
    // A host allowed by name may be private, never a cloud metadata endpoint.
    if (reason && (!byName || reason === "metadata")) throw new MediaProxyBlockedError(reason, host);
  }
  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
  if (port !== 80 && port !== 443 && !byName && !allByCidr) throw new MediaProxyBlockedError("port", host);
  return addresses[0]!;
}

/** One server log line for a refusal: reason and host only, never the path, query or token. */
export function logMediaProxyRefusal(error: MediaProxyBlockedError): void {
  console.warn(`[media-proxy] destination refused: ${error.reason} (host ${error.host}); allow it with ${ALLOW_HOSTS_ENV} if intended`);
}
