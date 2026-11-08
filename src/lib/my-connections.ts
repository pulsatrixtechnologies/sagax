// A person's own connections on an organization server (Settings > Mes
// connexions): their GitHub account and their own MCP servers
// (server/routes/person-connections.ts), and a bot's Claude Code plugins
// (server/routes/bot-plugins.ts). Nothing here ever holds a token the
// server sent: the server never sends one.
import { api } from "@/state/store";
import type { MarketplaceCredentialView } from "../../shared/github-credentials";

export type GithubStatus =
  | { state: "none"; deviceFlow: boolean }
  | { state: "pending"; deviceFlow: true; userCode: string; verificationUri: string; expiresAt: number }
  | { state: "connected"; deviceFlow: boolean; login: string; name?: string; scopes?: string[]; via: "device" | "token"; connectedAt: number; fineGrained?: boolean; orgAccessUrl?: string }
  /** Stored token refused by GitHub (401): Reconnect, never a healthy Connected. */
  | { state: "error"; deviceFlow: boolean; error: string; login?: string };

export type PersonalAuthState = "connected" | "ready" | "needs_sign_in" | "needs_github" | "needs_token" | "expired" | "error" | "no_environment";

export type PersonalServer =
  | { name: string; kind: "remote"; type: "http" | "sse"; url: string; domain: string; auth: "none" | "token" | "oauth" | "github"; headerName?: string; tokenConfigured: boolean; enabled: boolean; addedAt: number; authState: PersonalAuthState; authError?: string; authPending?: boolean; authClient?: "needed" }
  | { name: string; kind: "stdio"; command: string; args: string[]; envKeys: string[]; runsIn: "environment"; enabled: boolean; addedAt: number; authState: PersonalAuthState };

export interface MyConnections {
  github: GithubStatus;
  servers: PersonalServer[];
  /** This server gives each person a server environment (commands run there). */
  sandbox: boolean;
}

export const GITHUB_MCP_URL = "https://api.githubcopilot.com/mcp/";

export const loadMyConnections = () => api<MyConnections>("/api/me/connections");
export const startGithubDevice = () => api<{ userCode: string; verificationUri: string; expiresAt: number }>("/api/me/github/device", { method: "POST", body: "{}" });
export const connectGithubToken = (token: string) => api<{ github: GithubStatus }>("/api/me/github/token", { method: "POST", body: JSON.stringify({ token }) });
export const disconnectGithub = () => api<{ github: GithubStatus }>("/api/me/github", { method: "DELETE" });

export type NewPersonalServer =
  | { name: string; url: string; auth: "none" | "token" | "oauth" | "github"; token?: string; headerName?: string }
  | { name: string; command: string; args: string[]; env: Record<string, string> };

export const addPersonalServer = (server: NewPersonalServer) => api<{ servers: PersonalServer[] }>("/api/me/mcp/servers", { method: "POST", body: JSON.stringify(server) });
/** Plugins > Me > Add > Paste config: every server of the block is the person's own. */
export const importPersonalServers = (json: string) =>
  api<{ servers: PersonalServer[]; added: string[] }>("/api/me/mcp/servers/import", { method: "POST", body: JSON.stringify({ json }) });
/** Edit one: the add body; a token or variables left out are kept. */
export const updatePersonalServer = (name: string, server: NewPersonalServer) =>
  api<{ servers: PersonalServer[] }>(`/api/me/mcp/servers/${encodeURIComponent(name)}`, { method: "PUT", body: JSON.stringify(server) });
export const setPersonalServerEnabled = (name: string, enabled: boolean) =>
  api<{ servers: PersonalServer[] }>(`/api/me/mcp/servers/${encodeURIComponent(name)}`, { method: "PATCH", body: JSON.stringify({ enabled }) });
export const removePersonalServer = (name: string) => api<{ servers: PersonalServer[] }>(`/api/me/mcp/servers/${encodeURIComponent(name)}`, { method: "DELETE" });
export const startPersonalServerSignIn = (name: string, client?: { clientId: string; clientSecret?: string }) =>
  api<{ authorizationUrl: string; redirectUri: string }>(`/api/me/mcp/servers/${encodeURIComponent(name)}/oauth/start`, { method: "POST", body: JSON.stringify(client ?? {}) });
export const disconnectPersonalServer = (name: string) => api<{ servers: PersonalServer[] }>(`/api/me/mcp/servers/${encodeURIComponent(name)}/oauth/disconnect`, { method: "POST", body: "{}" });

/** A name for a server from its address or command: lowercase, safe. */
export function suggestServerName(source: string): string {
  let base = source.trim();
  try {
    const url = new URL(base);
    base = url.hostname.replace(/^(?:www|mcp|api)\./, "").split(".")[0] ?? "";
  } catch {
    base = base.split(/[\s/@]+/).filter(Boolean).pop() ?? "";
  }
  const name = base.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^[^a-z]+/, "").replace(/-+$/, "").slice(0, 32);
  return name || "server";
}

/** "KEY=value" lines into variables; a line without "=" is refused. */
export function parseEnvLines(text: string): { ok: true; env: Record<string, string> } | { ok: false; line: string } {
  const env: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const index = line.indexOf("=");
    if (index <= 0) return { ok: false, line };
    env[line.slice(0, index).trim()] = line.slice(index + 1);
  }
  return { ok: true, env };
}

/** Arguments typed on one line: spaces split them, quotes keep them whole. */
export function parseArgsLine(text: string): string[] {
  const out: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  for (const match of text.matchAll(pattern)) out.push(match[1] ?? match[2] ?? match[3] ?? "");
  return out;
}

// ── a bot's plugins (Connect apps, scope "For this bot") ─────────────────

/** What a plugin brings to a bot, by name. */
export interface PluginContents {
  agents: string[];
  commands: string[];
  skills: string[];
}

/** A marketplace of the installation's one list, with this bot's installs. */
export type MarketplaceVisibility = "private" | "org";

export interface MarketplaceListing {
  name: string;
  source: string;
  /** This bot picks a credential for it (never the token itself). */
  hasToken?: boolean;
  /** The credential it picks (absent: Automatic) and the one that read it last. */
  credential?: MarketplaceCredentialView;
  /** "private" (the person who added it) or "org" (shared with everyone) */
  visibility?: MarketplaceVisibility;
  /** this viewer added it, so may change its visibility */
  mine?: boolean;
  description?: string;
  addedAt: number;
  updatedAt: number;
  plugins: Array<{
    name: string; description?: string; version?: string; category?: string; homepage?: string; icon?: string; installed: boolean; external: boolean; contents?: PluginContents;
    /** #2759: converted from another format (Cursor), and what did not convert */
    convertedFrom?: string; notConverted?: string[];
    /** the version this bot has, when it differs from `version` */
    installedVersion?: string;
    /** the marketplace offers another version or other files: Install again updates in place */
    updateAvailable?: boolean;
  }>;
}

export interface InstalledPlugin {
  key: string;
  name: string;
  marketplace: string;
  description?: string;
  version?: string;
  enabled: boolean;
  removed: string[];
  declaredMcpServers: string[];
  /** the fields the plugin declares and this bot's values (server/plugins/plugin-config.ts) */
  config?: PluginConfigView;
}

export interface PluginConfigField {
  key: string;
  type: "string" | "number" | "boolean" | "directory" | "file";
  title: string;
  description?: string;
  sensitive: boolean;
  required: boolean;
  default?: string | number | boolean;
}
export interface PluginConfigView { fields: PluginConfigField[]; values: Record<string, string | number | boolean> }

export interface BotPluginsView {
  marketplaces: MarketplaceListing[];
  plugins: InstalledPlugin[];
  policy: { mode: "any" } | { mode: "list"; allow: string[] };
  engine: { loadsPlugins: boolean };
  canChange: boolean;
  /** after a remove from this bot: the marketplace also left the one list */
  sharedRemoved?: boolean;
}

export type PluginTarget = string | { scope: "me" };
export const PERSONAL_PLUGIN_TARGET: PluginTarget = { scope: "me" };
export const pluginsPath = (target: PluginTarget) => typeof target === "string" ? `/api/bots/${encodeURIComponent(target)}/plugins` : "/api/me/plugins";
export const loadBotPlugins = (botId: PluginTarget) => api<BotPluginsView>(pluginsPath(botId));
export const addMarketplace = (botId: PluginTarget, source: string, options: { ref?: string; credential?: string; visibility?: MarketplaceVisibility } = {}) =>
  api<BotPluginsView>(`${pluginsPath(botId)}/marketplaces`, {
    method: "POST", body: JSON.stringify({ source, ...(options.ref ? { ref: options.ref } : {}), ...(options.credential ? { credential: options.credential } : {}), ...(options.visibility ? { visibility: options.visibility } : {}) }), timeoutMs: 180_000,
  });
/** The credential of the one list this bot picks for a marketplace (null: Automatic). */
export const chooseMarketplaceCredential = (botId: PluginTarget, name: string, credential: string | null) =>
  api<BotPluginsView>(`${pluginsPath(botId)}/marketplaces/${encodeURIComponent(name)}/credential`, { method: "PUT", body: JSON.stringify({ credential }) });
/** Refusals of a private repository that a token (or a GitHub connection) fixes. */
export const MARKETPLACE_ACCESS_CODES = new Set(["private_needs_token", "not_found_or_no_access", "bad_token", "forbidden", "sso_required", "repository_unreadable", "org_not_covered"]);
export const updateMarketplace = (botId: PluginTarget, name: string) => api<BotPluginsView>(`${pluginsPath(botId)}/marketplaces/${encodeURIComponent(name)}/update`, { method: "POST", timeoutMs: 180_000 });
export const removeMarketplace = (botId: PluginTarget, name: string) => api<BotPluginsView>(`${pluginsPath(botId)}/marketplaces/${encodeURIComponent(name)}`, { method: "DELETE" });
export const installPlugin = (botId: PluginTarget, marketplace: string, plugin: string) =>
  api<BotPluginsView>(`${pluginsPath(botId)}/install`, { method: "POST", body: JSON.stringify({ marketplace, plugin }), timeoutMs: 180_000 });
export const setPluginEnabled = (botId: PluginTarget, key: string, enabled: boolean) =>
  api<BotPluginsView>(`${pluginsPath(botId)}/${encodeURIComponent(key)}`, { method: "PATCH", body: JSON.stringify({ enabled }) });
export const setPluginConfig = (botId: PluginTarget, key: string, values: Record<string, string | number | boolean>) =>
  api<BotPluginsView>(`${pluginsPath(botId)}/${encodeURIComponent(key)}/config`, { method: "PUT", body: JSON.stringify({ values }) });
export const uninstallPlugin = (botId: PluginTarget, key: string) => api<BotPluginsView>(`${pluginsPath(botId)}/${encodeURIComponent(key)}`, { method: "DELETE" });
