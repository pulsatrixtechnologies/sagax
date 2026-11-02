// Lot B (upstream only-me / MCP personal cluster): a personal MCP key must
// never land in the shared installation config. Personal servers live in the
// person store (server/person-connections.ts); shared ones in
// cfg.mcpServers / installation-capabilities.enc. These helpers refuse
// cross-writes, blank personal headers on shared creates, and mark scope so
// shared probes and team edits skip the person store.
import { isRemoteMcpServer, type StoredMcpServer } from "./mcp-registry.ts";

export const PERSONAL_HEADER_REFUSAL =
  "Personal MCP header values cannot be saved in shared configuration. Save your key in your personal connection.";

export const PERSONAL_SHARED_NAME_REFUSAL =
  "That name is already one of your personal MCP servers. Remove it under Settings > Connections, or pick another name for the shared server.";

export const SHARED_PERSONAL_NAME_REFUSAL =
  "That name is already a shared MCP server for this installation. Pick another name for your personal connection.";

export const AMBIGUOUS_PERSONAL_HEADERS_REFUSAL =
  "Personal MCP connections support one header. Remove the extra headers before saving.";

/** Scope on a listed MCP server: installation = shared org config; person =
 * the caller's own store (listed via /api/me, never mixed into shared writes). */
export type McpConnectionScope = "installation" | "person";

export function mcpConnectionScope(name: string, personalNames: ReadonlySet<string> | readonly string[]): McpConnectionScope {
  const set = personalNames instanceof Set ? personalNames : new Set(personalNames);
  return set.has(name) ? "person" : "installation";
}

/** Non-empty header values on a stored remote server (after parse). */
export function nonEmptyHeaderValues(server: StoredMcpServer): string[] {
  if (!isRemoteMcpServer(server)) return [];
  return Object.values(server.headers).filter((value) => value !== "");
}

/** Refuse saving personal header secrets into shared installation config.
 * Blank header names (keys with "") stay allowed so the shared row can name
 * the header while the value lives in the person store. */
export function personalHeaderRefusal(
  name: string,
  server: StoredMcpServer,
  personalNames: ReadonlySet<string> | readonly string[],
): string | null {
  if (mcpConnectionScope(name, personalNames) !== "person") return null;
  if (!isRemoteMcpServer(server)) return null;
  if (nonEmptyHeaderValues(server).length === 0) return null;
  return PERSONAL_HEADER_REFUSAL;
}

/** More than one non-empty personal header is ambiguous: the person store
 * keeps a single token header. */
export function ambiguousPersonalHeaderRefusal(
  name: string,
  server: StoredMcpServer,
  personalNames: ReadonlySet<string> | readonly string[],
): string | null {
  if (mcpConnectionScope(name, personalNames) !== "person") return null;
  if (!isRemoteMcpServer(server)) return null;
  if (nonEmptyHeaderValues(server).length <= 1) return null;
  return AMBIGUOUS_PERSONAL_HEADERS_REFUSAL;
}

/** Shared create/import: do not take over a name the person already owns. */
export function personalSharedNameRefusal(
  name: string,
  personalNames: ReadonlySet<string> | readonly string[],
): string | null {
  return mcpConnectionScope(name, personalNames) === "person" ? PERSONAL_SHARED_NAME_REFUSAL : null;
}

/** Personal create: do not collide with an installation-wide server name. */
export function sharedPersonalNameRefusal(
  name: string,
  sharedNames: ReadonlySet<string> | readonly string[],
): string | null {
  const set = sharedNames instanceof Set ? sharedNames : new Set(sharedNames);
  return set.has(name) ? SHARED_PERSONAL_NAME_REFUSAL : null;
}

/** Blank every header value while keeping the header names (defer shared
 * headers until personal setup succeeds). */
export function blankHeaderValues(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.keys(headers).map((key) => [key, ""]));
}

/** Shared OAuth / app probes never dial a person-scoped name. */
export function skipPersonalInSharedProbe(
  name: string,
  personalNames: ReadonlySet<string> | readonly string[],
): boolean {
  return mcpConnectionScope(name, personalNames) === "person";
}

/** Known installation-scoped edit: skip the personal connection lookup. */
export function shouldLookupPersonalConnection(
  scope: McpConnectionScope | string | undefined,
): boolean {
  if (scope === "installation" || scope === "team") return false;
  // person or unknown: fail closed and consult the person store
  return true;
}

/** Union of personal MCP names across principals (for shared probes). A
 * principal whose store cannot be read contributes nothing. */
export function collectPersonalMcpNames(
  principalIds: readonly string[],
  serversOf: (principalId: string) => Record<string, unknown>,
): Set<string> {
  const out = new Set<string>();
  for (const id of principalIds) {
    let servers: Record<string, unknown>;
    try {
      servers = serversOf(id);
    } catch {
      continue;
    }
    for (const name of Object.keys(servers)) out.add(name);
  }
  return out;
}
