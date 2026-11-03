// Address guard for checks that open a connection, plus the port policy and
// the typed-target rule those checks will use. DNS and MX lookups do not
// connect, so they do not call guardConnectTarget; they still refuse internal
// names before any query. No operator allow-list: a private address is refused.
import { isIP } from "node:net";

import { isIpv4Literal, isIpv6Literal } from "../../shared/net-tools/target.ts";
import { isPublicDomainAddress } from "../custom-domain.ts";
import { blockedAddressReason } from "../media/media-proxy-guard.ts";

export interface ConnectGuardOk {
  ok: true;
  /** The address to connect to. Callers must not look the name up again. */
  pinned: string;
  addresses: string[];
}

export interface ConnectGuardNo {
  ok: false;
  code: "target.refused_address";
  reason: string;
  address: string;
}

export type ConnectGuard = ConnectGuardOk | ConnectGuardNo;

/** Why an address is not a public unicast target, or null when it is. */
export function publicAddressRefusal(address: string): string | null {
  const blocked = blockedAddressReason(address);
  if (blocked) return blocked;
  // blockedAddressReason allows some ranges the domain list still excludes.
  if (!isPublicDomainAddress(address)) return "reserved";
  return null;
}

function dedupe(addresses: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const address of addresses) {
    if (seen.has(address)) continue;
    seen.add(address);
    out.push(address);
  }
  return out;
}

/**
 * Every resolved address must be public. One private address refuses the name.
 * `lookup` is called once; connect to `pinned` and never resolve again, or a
 * rebinding name can swap the address after the check. Production callers pass
 * a lookup that uses the configured public resolvers, not the system resolver.
 */
export async function guardConnectTarget(host: string, lookup: (host: string) => Promise<string[]>): Promise<ConnectGuard> {
  const bare = host.replace(/^\[|\]$/g, "");
  let addresses: string[];
  if (isIpv4Literal(bare) || isIpv6Literal(bare) || isIP(bare) !== 0) {
    addresses = [bare];
  } else {
    try {
      addresses = dedupe(await lookup(host));
    } catch {
      return { ok: false, code: "target.refused_address", reason: "unresolved", address: "" };
    }
  }
  if (addresses.length === 0) return { ok: false, code: "target.refused_address", reason: "unresolved", address: "" };
  for (const address of addresses) {
    const reason = publicAddressRefusal(address);
    if (reason) return { ok: false, code: "target.refused_address", reason, address };
  }
  return { ok: true, pinned: addresses[0]!, addresses };
}

export const PORT_CONNECT_TIMEOUT_MS = 3_000;
export const PORT_MAX_EXPLICIT = 10;
export const PORT_MAX_PARALLEL = 5;

/** About twenty ports, grouped the way a technician asks for them. No ranges. */
export const PORT_PRESETS = {
  web: [80, 443, 8080, 8443],
  mail: [25, 465, 587, 110, 995, 143, 993],
  remote: [22, 3389, 5900],
  files: [21, 445, 139, 2049],
  databases: [1433, 3306, 5432, 27017, 6379],
} as const;

export type PortPreset = keyof typeof PORT_PRESETS;

export type PortSelection =
  | { ok: true; ports: number[] }
  | { ok: false; code: "target.invalid" | "target.bad_port" };

function isPreset(value: string): value is PortPreset {
  return Object.prototype.hasOwnProperty.call(PORT_PRESETS, value);
}

/** A preset or an explicit list, never both. At most ten explicit ports. */
export function parsePortSelection(input: { preset?: string; ports?: readonly number[] }): PortSelection {
  const hasPreset = input.preset !== undefined;
  const hasPorts = input.ports !== undefined;
  if (hasPreset && hasPorts) return { ok: false, code: "target.invalid" };
  if (hasPreset) {
    if (!isPreset(input.preset!)) return { ok: false, code: "target.invalid" };
    return { ok: true, ports: [...PORT_PRESETS[input.preset!]] };
  }
  if (!hasPorts) return { ok: false, code: "target.invalid" };
  const unique: number[] = [];
  const seen = new Set<number>();
  for (const port of input.ports!) {
    if (!Number.isInteger(port) || port < 1 || port > 65_535) return { ok: false, code: "target.bad_port" };
    if (seen.has(port)) continue;
    seen.add(port);
    unique.push(port);
  }
  if (unique.length === 0 || unique.length > PORT_MAX_EXPLICIT) return { ok: false, code: "target.invalid" };
  return { ok: true, ports: unique };
}

/**
 * A bot may open ports only on a host the person typed in this turn.
 * A parent of two or more labels counts, so a name under the typed domain
 * matches. Without a public-suffix list a two-label suffix such as "co.uk"
 * also matches: the gap is accepted until a list is vendored.
 * The character before the match is not a name character, and the character
 * after is not a name character or a dot, so a longer host does not match
 * and "host:443" does.
 */
export function hostAppearsInText(host: string, text: string): boolean {
  const bare = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (bare.includes(":")) return tokenAt(text, bare);
  const labels = bare.split(".");
  for (let start = 0; start < labels.length; start++) {
    const candidate = labels.slice(start).join(".");
    if (!candidate.includes(".")) continue;
    if (tokenAt(text, candidate)) return true;
  }
  return false;
}

function tokenAt(text: string, needle: string): boolean {
  const hay = text.toLowerCase();
  const pin = needle.toLowerCase();
  let from = 0;
  while (from <= hay.length - pin.length) {
    const at = hay.indexOf(pin, from);
    if (at < 0) return false;
    const before = at === 0 ? "" : hay[at - 1]!;
    const after = hay[at + pin.length] ?? "";
    const beforeOk = before === "" || !/[a-z0-9-]/.test(before);
    const afterOk = after === "" || !/[a-z0-9.-]/.test(after);
    if (beforeOk && afterOk) return true;
    from = at + 1;
  }
  return false;
}

/** People always pass. A bot passes only when the host was typed. */
export function typedTargetAllows(by: "bot" | "person", host: string, personText: string | undefined): boolean {
  if (by === "person") return true;
  return hostAppearsInText(host, personText ?? "");
}
