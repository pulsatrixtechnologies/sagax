// Addresses the built-in browser must not open from a bot's MCP call.
// http and https on a public address are allowed. file:, loopback,
// link-local and cloud metadata (including the Azure WireServer) are not.

import { isIP } from "node:net";

import { isPublicDomainAddress } from "../custom-domain.ts";

const BLOCKED_NAMES = new Set(["localhost", "metadata.google.internal"]);

/** Why this tools/call must not run, or null when every URL in it is allowed.
 * A value that is not a URL is left alone. */
export function browserNavigationRefusal(value: unknown): string | null {
  for (const raw of collectUrls(value)) {
    let url: URL;
    try { url = new URL(raw); } catch { continue; }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return "The browser only opens http and https addresses.";
    }
    const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
    if (BLOCKED_NAMES.has(host) || host.endsWith(".localhost")) {
      return "The browser does not open this computer's own services or a cloud metadata address.";
    }
    if (isIP(host) && !isPublicDomainAddress(host)) {
      return "The browser does not open this computer's own services or a cloud metadata address.";
    }
  }
  return null;
}

function collectUrls(value: unknown, depth = 0, out: string[] = []): string[] {
  if (depth > 8 || value == null) return out;
  if (typeof value === "string") {
    if (/^[a-z][a-z0-9+.-]*:/i.test(value)) out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectUrls(item, depth + 1, out);
    return out;
  }
  if (typeof value === "object") {
    for (const child of Object.values(value as Record<string, unknown>)) collectUrls(child, depth + 1, out);
  }
  return out;
}
