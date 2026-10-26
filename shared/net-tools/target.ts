// IT tools: what a person or a bot may name as a target, by syntax alone.
// The panel form and the server share it; the server then applies the
// address guard (server/net-tools/guard.ts) to whatever this accepts.
// Browser-safe: IDN names become ASCII through the WHATWG URL parser, which
// applies the same IDNA mapping as node:url domainToASCII.

export const NET_TARGET_REFUSALS = [
  "target.empty",
  "target.too_long",
  "target.invalid",
  "target.refused_name",
  "target.bad_port",
  "target.bad_url",
  "target.url_credentials",
] as const;

/** Why a target was refused: a finding code (findings.ts). */
export type NetTargetRefusal = (typeof NET_TARGET_REFUSALS)[number];

export type NetTargetKind = "domain" | "ipv4" | "ipv6";

export interface NetTarget {
  kind: NetTargetKind;
  /** Lower-case ASCII name, or the IP literal (IPv6 without brackets). */
  host: string;
  port?: number;
  /** http_headers only: the normalised URL. */
  url?: string;
}

export type NetTargetParse = { ok: true; target: NetTarget } | { ok: false; code: NetTargetRefusal };

export interface NetTargetOptions {
  /** What the input may be: a host (name or IP), a name only, a host with an
   * optional `:port`, or an http(s) URL. Default "host". */
  accept?: "host" | "domain" | "host_port" | "url";
  /** DNS lookups may name service labels such as `_dmarc.example.com`. */
  underscoreLabels?: boolean;
  /** The server's own public names, refused like internal ones. */
  ownNames?: readonly string[];
}

const MAX_NAME = 253;
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const SERVICE_LABEL = /^_?[a-z0-9](?:[a-z0-9_-]{0,61}[a-z0-9])?$/;
const IPV4 = /^(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
/** Suffixes of names that never leave a private network. */
const REFUSED_SUFFIXES = ["localhost", "local", "internal", "home.arpa", "lan"];

export function isIpv4Literal(value: string): boolean {
  return IPV4.test(value);
}

export function isIpv6Literal(value: string): boolean {
  if (!value.includes(":") || !/^[0-9a-f:.]+$/i.test(value)) return false;
  try {
    return new URL(`http://[${value}]/`).hostname.length > 2;
  } catch {
    return false;
  }
}

/** The ASCII form of a name, or undefined when it is not a valid name. */
function asciiName(name: string): string | undefined {
  if ([...name].every((char) => char.charCodeAt(0) < 0x80)) return name;
  try {
    const host = new URL(`http://${name}/`).hostname;
    return host && !host.includes("%") ? host : undefined;
  } catch {
    return undefined;
  }
}

/** True for internal, local and single-label names, and the server's own. */
export function isRefusedName(name: string, ownNames: readonly string[] = []): boolean {
  const host = name.toLowerCase().replace(/\.$/, "");
  if (!host.includes(".")) return true;
  if (REFUSED_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))) return true;
  return ownNames.some((own) => {
    const mine = own.toLowerCase().replace(/\.$/, "");
    return mine !== "" && (host === mine || host.endsWith(`.${mine}`));
  });
}

function parseHost(raw: string, options: NetTargetOptions): NetTargetParse {
  let host = raw.trim().toLowerCase();
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  if (!host) return { ok: false, code: "target.empty" };
  if (isIpv4Literal(host)) return options.accept === "domain" ? { ok: false, code: "target.invalid" } : { ok: true, target: { kind: "ipv4", host } };
  if (isIpv6Literal(host)) {
    if (options.accept === "domain") return { ok: false, code: "target.invalid" };
    return { ok: true, target: { kind: "ipv6", host: new URL(`http://[${host}]/`).hostname.slice(1, -1) } };
  }
  if (host.endsWith(".")) host = host.slice(0, -1);
  const ascii = asciiName(host);
  if (ascii === undefined) return { ok: false, code: "target.invalid" };
  if (ascii.length > MAX_NAME) return { ok: false, code: "target.too_long" };
  const label = options.underscoreLabels ? SERVICE_LABEL : LABEL;
  const labels = ascii.split(".");
  if (labels.some((part) => !label.test(part))) return { ok: false, code: "target.invalid" };
  // a numeric top-level label is an address written wrongly, not a name
  if (/^\d+$/.test(labels[labels.length - 1])) return { ok: false, code: "target.invalid" };
  if (isRefusedName(ascii, options.ownNames)) return { ok: false, code: "target.refused_name" };
  return { ok: true, target: { kind: "domain", host: ascii } };
}

function parsePort(value: string): number | undefined {
  if (!/^\d{1,5}$/.test(value)) return undefined;
  const port = Number(value);
  return port >= 1 && port <= 65_535 ? port : undefined;
}

function parseHostPort(raw: string, options: NetTargetOptions): NetTargetParse {
  const value = raw.trim();
  const bracketed = /^\[([^\]]+)\](?::(.*))?$/.exec(value);
  let host = value;
  let port: string | undefined;
  if (bracketed) {
    host = bracketed[1];
    port = bracketed[2];
  } else if (value.split(":").length === 2) {
    [host, port] = value.split(":");
  }
  const parsed = parseHost(host, { ...options, accept: "host" });
  if (!parsed.ok || port === undefined) return parsed;
  const number = parsePort(port);
  return number === undefined ? { ok: false, code: "target.bad_port" } : { ok: true, target: { ...parsed.target, port: number } };
}

function parseUrl(raw: string, options: NetTargetOptions): NetTargetParse {
  const value = raw.trim();
  // a bare host means its https site
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return { ok: false, code: "target.bad_url" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, code: "target.bad_url" };
  if (url.username || url.password) return { ok: false, code: "target.url_credentials" };
  const parsed = parseHost(url.hostname, { ...options, accept: "host" });
  if (!parsed.ok) return parsed;
  url.hash = "";
  return { ok: true, target: { ...parsed.target, ...(url.port ? { port: Number(url.port) } : {}), url: url.toString() } };
}

/** Parse a target by syntax alone. Never resolves a name. */
export function parseNetTarget(input: unknown, options: NetTargetOptions = {}): NetTargetParse {
  if (typeof input !== "string" || !input.trim()) return { ok: false, code: "target.empty" };
  if (input.length > 2_048) return { ok: false, code: "target.too_long" };
  switch (options.accept ?? "host") {
    case "url": return parseUrl(input, options);
    case "host_port": return parseHostPort(input, options);
    default: return parseHost(input, options);
  }
}
