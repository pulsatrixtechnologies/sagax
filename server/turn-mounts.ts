// What a turn mounts, as small pure functions shared by the turn
// (server/index.ts) and the capabilities resolver (server/capabilities.ts,
// GET /api/bots/:id/capabilities). The turn calls them to build its
// integrations; the resolver calls the same ones to say what a bot
// receives, so the list and the turn cannot drift (test "a turn mounts
// exactly what the list says", server/capabilities.test.ts).
import type { McpServerSpec } from "./contracts.ts";
import { githubServersAsPerson, withGithubToken } from "./github-mcp-token.ts";
import { personalAuthHeaders, type GithubConnection, type PersonalMcpServer } from "./person-connections.ts";
import { claudePluginDirs } from "./plugin-turn.ts";
import { reservedMcpName } from "../shared/mcp-reserved-names.ts";

// ── this installation's MCP servers (config.json mcpServers) ─────────────

/** Organization server: a server-wide MCP server that is a command would
 * run on this host, where no person's tools run (withholdHostTools). It is
 * kept in config.json but never mounted; a person adds a command as their
 * own server instead (it runs in their server environment). */
export function withoutHostCommands<T extends Record<string, McpServerSpec>>(organization: boolean, servers: T): T {
  if (!organization) return servers;
  return Object.fromEntries(Object.entries(servers).filter(([, server]) => "url" in server)) as T;
}

/** The configured servers that may reach a bot's engine: the bot's own
 * selection (`configured`, config.ts customMcpServers), no host command on
 * an organization server, the organization's allow-list, then the sign-in
 * headers (`sign`, which never adds or drops a server). */
export function engineServerMcp<T extends Record<string, McpServerSpec>>(input: {
  configured: T;
  organization: boolean;
  filterPolicy: (servers: T) => T;
  sign?: (servers: T) => T;
}): T {
  const allowed = input.filterPolicy(withoutHostCommands(input.organization, input.configured));
  return input.sign ? input.sign(allowed) : allowed;
}

/** The bot's MCP servers as the turn's person (server/github-mcp-token.ts):
 * on an organization server each GitHub server carries that person's own
 * GitHub connection and is left out (githubWithheld) when they have none. */
export function serverMcpAsPerson<T extends Record<string, McpServerSpec>>(servers: T, input: { organization: boolean; githubToken: string | undefined }): { servers: T; githubWithheld: string[] } {
  if (!input.organization) return { servers: withGithubToken(servers, input.githubToken), githubWithheld: [] };
  const asPerson = githubServersAsPerson(servers, input.githubToken);
  return { servers: asPerson.servers, githubWithheld: asPerson.withheld };
}

// ── the person's own MCP servers (organization server) ────────────────────

export type PersonalMcpSkip = "off" | "name_taken" | "reserved" | "no_environment" | "needs_github" | "needs_token";

export type PersonalMcpCheck =
  | { mount: "stdio" }
  | { mount: "remote"; headers: Record<string, string> }
  | { skip: PersonalMcpSkip };

/** What can be told about one personal server before the turn's checks
 * that wait (the address check, an OAuth refresh): mounted as a command in
 * the person's environment, mounted as a remote server with these headers,
 * or skipped with a reason. A name the turn already uses is skipped (it
 * keeps the server it has); a reserved name is never mounted
 * (shared/mcp-reserved-names.ts). */
export function personalMcpPrecheck(name: string, server: PersonalMcpServer, ctx: {
  taken: (name: string) => boolean;
  hasEnvironment: boolean;
  github: GithubConnection | undefined;
}): PersonalMcpCheck {
  if (!server.enabled) return { skip: "off" };
  if (ctx.taken(name)) return { skip: "name_taken" };
  if (reservedMcpName(name)) return { skip: "reserved" };
  if (server.kind === "stdio") return ctx.hasEnvironment ? { mount: "stdio" } : { skip: "no_environment" };
  const headers = personalAuthHeaders(server, ctx.github);
  if (headers === null) return { skip: server.auth === "github" ? "needs_github" : "needs_token" };
  return { mount: "remote", headers };
}

// ── Perspicax Roles ───────────────────────────────────────────────────────

/** An engine-side server name for a profile: `perspicax_<slug or id>`,
 * [a-z0-9_], at most 40 characters, with a suffix on a collision. */
export function perspicaxServerName(label: string, taken: ReadonlySet<string>): string {
  const base = `perspicax_${label.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || "profile"}`.slice(0, 40);
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const suffix = `_${n}`;
    const candidate = `${base.slice(0, 40 - suffix.length)}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

// ── plugins ───────────────────────────────────────────────────────────────

/** The plugin folders a Claude turn loads with `--plugin-dir`: the bot's
 * enabled plugins, then the organization's Flow plugins (`orgDirs`, given
 * the bot's own so a plugin is never loaded twice). None for another
 * engine. */
export function turnPluginDirs(input: { driverKind: string; botDirs: readonly string[]; orgDirs: (own: readonly string[]) => string[] }): string[] {
  const own = claudePluginDirs(input.driverKind, input.botDirs);
  const org = input.driverKind === "claudeAgent" ? input.orgDirs(own) : [];
  return [...own, ...org];
}

/** The plugin folders whose skills, commands and agents another engine
 * reads through the turn prompt or managed discovery. None for Claude
 * (--plugin-dir). Every other engine qualifies: file engines by path, API
 * engines as whole files inline within the per-capability budget, with or
 * without skills_list and workspace_read (Q8 C). */
export function turnPluginPromptDirs(driverKind: string, botDirs: readonly string[]): string[] {
  if (driverKind === "claudeAgent") return [];
  return [...botDirs];
}
