// What a turn mounts, as small pure functions shared by the turn
// (server/index.ts) and the capabilities resolver (server/capabilities/capabilities.ts,
// GET /api/bots/:id/capabilities). The turn calls them to build its
// integrations; the resolver calls the same ones to say what a bot
// receives, so the list and the turn cannot drift (test "a turn mounts
// exactly what the list says", server/capabilities/capabilities.test.ts).
import type { McpServerSpec } from "../contracts.ts";
import { githubServersAsPerson, isGithubMcpServer, withGithubToken } from "../github/github-mcp-token.ts";
import { mcpServerRunsHere } from "../mcp/mcp-platform.ts";
import { personalAuthHeaders, type GithubConnection, type PersonalMcpServer } from "../people/person-connections.ts";
import { claudePluginDirs } from "./plugin-turn.ts";
import { reservedMcpName } from "../../shared/mcp-reserved-names.ts";

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

/** The bot's MCP servers as the turn's person (server/github/github-mcp-token.ts):
 * on an organization server each GitHub server carries that person's own
 * GitHub connection and is left out (githubWithheld) when they have none. */
export function serverMcpAsPerson<T extends Record<string, McpServerSpec>>(servers: T, input: { organization: boolean; githubToken: string | undefined }): { servers: T; githubWithheld: string[] } {
  if (!input.organization) return { servers: withGithubToken(servers, input.githubToken), githubWithheld: [] };
  const asPerson = githubServersAsPerson(servers, input.githubToken);
  return { servers: asPerson.servers, githubWithheld: asPerson.withheld };
}

/** One plugin's URL server as the turn's person (#3385): the same rule as
 * serverMcpAsPerson, for a server a plugin declares. The GitHub plugin ships
 * `Authorization: Bearer ${GITHUB_PERSONAL_ACCESS_TOKEN}`; mounted as it was
 * read, the literal placeholder reached the remote server, which refused the
 * handshake (HTTP 400). Undefined: left out, the person has no GitHub
 * connection (organization server). Pure. */
export function pluginMcpAsPerson(name: string, spec: McpServerSpec, input: { organization: boolean; githubToken: () => string | undefined }): McpServerSpec | undefined {
  if (!isGithubMcpServer(spec)) return spec;
  const asPerson = serverMcpAsPerson({ [name]: spec }, { organization: input.organization, githubToken: input.githubToken() });
  return asPerson.githubWithheld.length ? undefined : asPerson.servers[name];
}

// ── the person's own MCP servers (organization server) ────────────────────

/** `not_here`: a command server that only runs on macOS (the iMessage
 * plugin): a personal command server always starts in the person's Linux
 * server environment, so it is hidden there (#3181). */
export type PersonalMcpSkip = "off" | "name_taken" | "reserved" | "no_environment" | "needs_github" | "needs_token" | "not_here";

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
  if (server.kind === "stdio" && !mcpServerRunsHere(name, server, { organization: true })) return { skip: "not_here" };
  if (server.kind === "stdio") return ctx.hasEnvironment ? { mount: "stdio" } : { skip: "no_environment" };
  // #3392: an address on GitHub saved with no sign-in goes as the person,
  // the rule of a plugin's GitHub server (#3385): their own GitHub
  // connection, or left out when they have none (githubWithheldPrompt).
  if (server.auth === "none") {
    const spec: McpServerSpec = { type: server.type, url: server.url, headers: {} };
    if (isGithubMcpServer(spec)) {
      const asPerson = pluginMcpAsPerson(name, spec, { organization: true, githubToken: () => ctx.github?.token });
      return asPerson && "url" in asPerson ? { mount: "remote", headers: asPerson.headers ?? {} } : { skip: "needs_github" };
    }
  }
  const headers = personalAuthHeaders(server, ctx.github);
  if (headers === null) return { skip: server.auth === "github" ? "needs_github" : "needs_token" };
  return { mount: "remote", headers };
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
