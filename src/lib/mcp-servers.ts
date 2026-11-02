// The app-wide MCP server list (Plugins → MCP servers), shared by every
// place that shows it per bot, such as the Access section's switches.
// One fetch, cached for the window; `refresh` after
// the Plugins panel changes the list.
import { useEffect, useSyncExternalStore } from "react";

import { api } from "@/state/store";

/** What the server says about a connector's sign-in (server/mcp-oauth.ts). */
export type McpAuthState = "none" | "required" | "connected" | "expired" | "error";

export interface McpServerSummary {
  name: string;
  enabled: boolean;
  /** its saved sign-ins, the default account first; absent with one or none */
  accounts?: Array<{ id: string; label?: string; connected: boolean }>;
  /** absent when the server did not say: a local command has no sign-in */
  auth?: McpAuthState;
  /** Lot B: installation = shared org config; person = only-me (skip personal key writes into shared). */
  scope?: "installation" | "person";
}

/** A server as the list route answers it (or as already summed up). */
interface McpServerInput {
  name: string;
  enabled: boolean;
  accounts?: Array<{ id: string; label?: string; auth?: string; connected?: boolean }>;
  auth?: string;
  scope?: "installation" | "person";
}

const AUTH_STATES: readonly McpAuthState[] = ["none", "required", "connected", "expired", "error"];

function authState(value: string | undefined): McpAuthState | undefined {
  return AUTH_STATES.find((state) => state === value);
}

function summary(server: McpServerInput): McpServerSummary {
  const accounts = (server.accounts ?? []).map((account) => ({
    id: account.id,
    ...(account.label ? { label: account.label } : {}),
    connected: account.connected ?? account.auth === "connected",
  }));
  const auth = authState(server.auth);
  const scope = server.scope === "installation" || server.scope === "person" ? server.scope : undefined;
  return {
    name: server.name,
    enabled: Boolean(server.enabled),
    ...(accounts.length > 1 ? { accounts } : {}),
    ...(auth ? { auth } : {}),
    ...(scope ? { scope } : {}),
  };
}

let cached: { servers: McpServerSummary[] | null; error: boolean } = { servers: null, error: false };
let inflight: Promise<McpServerSummary[]> | null = null;
let generation = 0;
const listeners = new Set<() => void>();
const snapshot = () => cached;
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

/** Publish an authoritative read or mutation result without another request. */
export function updateMcpServers(servers: McpServerInput[]): void {
  generation += 1;
  inflight = null;
  cached = { servers: servers.map(summary), error: false };
  for (const listener of listeners) listener();
}

export function loadMcpServers(force = false): Promise<McpServerSummary[]> {
  if (!force && cached.servers && !cached.error) return Promise.resolve(cached.servers);
  if (!force && inflight) return inflight;
  const requestGeneration = ++generation;
  inflight = api("/api/mcp/servers")
    .then((result) => {
      if (requestGeneration === generation) updateMcpServers(result.servers ?? []);
      return cached.servers ?? [];
    })
    .catch(() => {
      if (requestGeneration === generation) {
        cached = { ...cached, error: true };
        for (const listener of listeners) listener();
      }
      return cached.servers ?? [];
    })
    .finally(() => {
      if (requestGeneration === generation) inflight = null;
    });
  return inflight;
}

/** The list, or null until the first load settles. Re-renders when any
 * caller refreshes it. */
export function useMcpServers(): { servers: McpServerSummary[] | null; error: boolean; refresh: () => Promise<McpServerSummary[]> } {
  const current = useSyncExternalStore(subscribe, snapshot, snapshot);
  useEffect(() => {
    // Keep the instant cached view, but pick up edits from another window
    // or the config CLI whenever Access is opened again.
    void loadMcpServers(true);
  }, []);
  return { ...current, refresh: () => loadMcpServers(true) };
}

/** A connector's name with a repeated word folded once: "github-github" is
 * the same connector as "github" (src/lib/installed-model.ts readableName
 * does this for the installed list). Compared, never shown. */
function connectorKey(name: string): string {
  const words = name.trim().toLowerCase().split(/[-_\s]+/).filter(Boolean);
  const kept = words.filter((word, index) => index === 0 || word !== words[index - 1]);
  return kept.join("-");
}

/** A sign-in that still needs the person wins over one that does not, so
 * folding two rows never hides an Authenticate. */
const AUTH_RANK: Record<McpAuthState, number> = { required: 4, expired: 3, error: 2, none: 1, connected: 0 };

/** One row per connector. A marketplace plugin that names its server after
 * itself ("github" and "github-github") lists the same connector twice;
 * the first name stays, and the row that still needs a sign-in wins. */
export function dedupeConnectors(servers: readonly McpServerSummary[]): McpServerSummary[] {
  const seen = new Map<string, McpServerSummary>();
  const order: string[] = [];
  for (const server of servers) {
    const key = connectorKey(server.name);
    const known = seen.get(key);
    if (!known) {
      order.push(key);
      seen.set(key, server);
      continue;
    }
    const rank = (entry: McpServerSummary) => (entry.auth ? AUTH_RANK[entry.auth] : -1);
    if (rank(server) > rank(known)) seen.set(key, { ...server, name: known.name });
  }
  return order.map((key) => seen.get(key)!);
}

/** The servers a bot actually mounts: its own list when it has one (names
 * that no longer exist fall away), else every enabled server. Mirrors
 * server/config.ts customMcpServers so the controls and the turn agree. */
export function mcpServersForBot(all: McpServerSummary[], own: string[] | null | undefined): McpServerSummary[] {
  const enabled = all.filter((server) => server.enabled);
  if (own == null) return enabled;
  return enabled.filter((server) => own.includes(server.name));
}

/** A bot's account choices after picking `account` for `server`: the
 * default account is the absence of a choice, and no choice left is null
 * (how a clear travels over PATCH). */
export function withMcpAccount(current: Record<string, string> | null | undefined, server: string, account: string): Record<string, string> | null {
  const next = { ...current };
  if (account === "default") delete next[server];
  else next[server] = account;
  return Object.keys(next).length ? next : null;
}

/** The account a bot uses on a server: its choice while that account is
 * still saved, else the default one. */
export function mcpAccountFor(server: McpServerSummary, choices: Record<string, string> | null | undefined): string {
  const chosen = choices?.[server.name];
  return chosen && server.accounts?.some((account) => account.id === chosen) ? chosen : "default";
}
