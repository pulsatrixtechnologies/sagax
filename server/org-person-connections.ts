// An organization admin lists and revokes one person's own connections
// (Settings > the person panel, Connexions):
//
//   GET  /api/org/people/<principalId>/connections
//        { principalId, paused, connections: [github | mcp | plugin] }
//   POST /api/org/people/<principalId>/connections/revoke
//        { all: true } | { kind: "mcp", name } | { kind: "github" }
//        | { kind: "plugin", botId, key }
//
// Admin scope, `orgAdminCaller` (never in CLIENT_ALLOW). A solo server
// answers 403 `identity_perspicax`. Revoking deletes the stored credential,
// stops a running MCP child that uses it, and is audited (`connections.revoke`)
// when something was actually removed. No answer carries a token, an env
// value, arguments, a device code or a filesystem path.
import { z } from "zod";

import type { InstalledBotPlugin } from "./bot-plugins.ts";
import type { GithubStatus } from "./github-connect.ts";
import type { PersonalMcpServer } from "./person-connections.ts";
import { isPrincipalId } from "./principals.ts";
import type { RequestAuth } from "./request-auth.ts";
import { PASS, type RouteHandler } from "./routes/table.ts";

export type OrgConnection =
  | { kind: "github"; state: "connected" | "pending"; login?: string; name?: string; via?: "device" | "token"; scopes?: string[]; createdAt?: number }
  | { kind: "mcp"; name: string; mcpKind: "remote" | "stdio"; detail: string; createdAt: number; enabled: boolean; auth?: string; lastUsedAt?: number }
  | { kind: "plugin"; botId: string; botName: string; key: string; name: string; marketplace: string; createdAt: number; enabled: boolean };

export interface OrgConnectionListing {
  principalId: string;
  /** Saved, not mounted: Perspicax `sagax_integrations` is off for this person. */
  paused: boolean;
  connections: OrgConnection[];
}

export type RemovedConnection =
  | { kind: "github"; name?: string }
  | { kind: "mcp"; name: string }
  | { kind: "plugin"; botId: string; key: string; name: string };

export interface OrgPersonPluginBot {
  botId: string;
  botName: string;
  plugins: InstalledBotPlugin[];
}

export interface OrgPersonConnectionsDeps {
  /** 2026-10-19: whether this caller may act on this person (a person an
   * admin gave people.manage never acts on an admin). Absent: yes. */
  mayActOn?(auth: RequestAuth, principalId: string): boolean;
  /** An organization server (`SAGAX_IDENTITY=perspicax`). */
  organization: boolean;
  isAdmin(auth: RequestAuth): boolean;
  person(principalId: string): { id: string } | null;
  /** Their own connections are saved and not usable. */
  paused(principalId: string): boolean;
  githubStatus(principalId: string): GithubStatus;
  servers(principalId: string): Record<string, PersonalMcpServer>;
  /** A live stdio session's last frame, when one is still open. */
  lastUsed(principalId: string, server: string): number | undefined;
  plugins(principalId: string): OrgPersonPluginBot[];
  /** Stop MCP children in this person's server environment. */
  stopMcp(principalId: string, server?: string): void;
  /** Delete one MCP server and its OAuth sign-in. False when it was already gone. */
  removeMcp(principalId: string, name: string): Promise<boolean>;
  /** Cancel a device flow and delete the GitHub token. `removed` is false when there was none. */
  disconnectGithub(principalId: string): Promise<{ removed: boolean; login?: string }>;
  /** Uninstall one plugin on a bot this person owns. False when it is not theirs or already gone. */
  removePlugin(principalId: string, botId: string, key: string): Promise<boolean>;
  audit(auth: RequestAuth, principalId: string, removed: RemovedConnection[]): void;
}

const PATH = /^\/api\/org\/people\/(pr_[A-Za-z0-9_.:-]{1,117})\/connections(\/revoke)?$/;

const revokeBody = z.union([
  z.object({ all: z.literal(true) }).strict(),
  z.object({ kind: z.literal("mcp"), name: z.string().min(1).max(64) }).strict(),
  z.object({ kind: z.literal("github") }).strict(),
  z.object({ kind: z.literal("plugin"), botId: z.string().min(1).max(80), key: z.string().min(1).max(200) }).strict(),
]);

function remoteDetail(url: string): string {
  try { return new URL(url).hostname; } catch { return ""; }
}

/** Names, kind and dates only. A token, env value, argument, device code or path never leaves here. */
export function orgConnectionListing(input: {
  principalId: string;
  paused: boolean;
  github: GithubStatus;
  servers: Record<string, PersonalMcpServer>;
  lastUsed: (name: string) => number | undefined;
  plugins: OrgPersonPluginBot[];
}): OrgConnectionListing {
  const connections: OrgConnection[] = [];
  if (input.github.state === "connected") {
    connections.push({
      kind: "github", state: "connected", login: input.github.login, via: input.github.via, createdAt: input.github.connectedAt,
      ...(input.github.name ? { name: input.github.name } : {}),
      ...(input.github.scopes ? { scopes: input.github.scopes } : {}),
    });
  } else if (input.github.state === "pending") {
    connections.push({ kind: "github", state: "pending" });
  }
  for (const [name, server] of Object.entries(input.servers).sort(([a], [b]) => a.localeCompare(b))) {
    const lastUsedAt = input.lastUsed(name);
    if (server.kind === "stdio") {
      connections.push({
        kind: "mcp", name, mcpKind: "stdio", detail: server.command, createdAt: server.addedAt, enabled: server.enabled,
        ...(lastUsedAt !== undefined ? { lastUsedAt } : {}),
      });
      continue;
    }
    connections.push({
      kind: "mcp", name, mcpKind: "remote", detail: remoteDetail(server.url), createdAt: server.addedAt, enabled: server.enabled, auth: server.auth,
      ...(lastUsedAt !== undefined ? { lastUsedAt } : {}),
    });
  }
  const plugins = input.plugins.flatMap((bot) => bot.plugins.map((plugin) => ({ bot, plugin })))
    .sort((a, b) => a.bot.botName.localeCompare(b.bot.botName) || a.plugin.key.localeCompare(b.plugin.key));
  for (const { bot, plugin } of plugins) {
    connections.push({
      kind: "plugin", botId: bot.botId, botName: bot.botName, key: plugin.key, name: plugin.name,
      marketplace: plugin.marketplace, createdAt: plugin.installedAt, enabled: plugin.enabled,
    });
  }
  return { principalId: input.principalId, paused: input.paused, connections };
}

export function createOrgPersonConnectionRoutes(deps: OrgPersonConnectionsDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    const match = PATH.exec(path);
    if (!match) return PASS;
    const principalId = match[1]!.toLowerCase();
    const revoke = Boolean(match[2]);
    res.setHeader("cache-control", "private, no-store");
    if ((revoke && method !== "POST") || (!revoke && method !== "GET")) return json(res, 405, { error: "method not allowed" });
    if (!deps.organization) {
      return json(res, 403, { error: "Person connections are listed on an organization server only.", code: "identity_perspicax" });
    }
    if (!deps.isAdmin(auth)) {
      return json(res, 403, { error: "Only an organization admin can do this.", code: "not_org_admin" });
    }
    if (!isPrincipalId(principalId) || !deps.person(principalId)) return json(res, 404, { error: "no such person" });
    if (deps.mayActOn && !deps.mayActOn(auth, principalId)) return json(res, 403, { error: "Only an organization admin can act on an admin's connections.", code: "target_is_admin" });
    if (!revoke) {
      try {
        return json(res, 200, orgConnectionListing({
          principalId, paused: deps.paused(principalId), github: deps.githubStatus(principalId),
          servers: deps.servers(principalId), lastUsed: (name) => deps.lastUsed(principalId, name), plugins: deps.plugins(principalId),
        }));
      } catch {
        return json(res, 503, { error: "This person's connections could not be read.", code: "store_unavailable" });
      }
    }
    let raw: unknown = null;
    try { raw = await readBody(req); } catch { raw = null; }
    const outcome = await revokeOrgConnections(deps, principalId, raw);
    if (outcome.removed.length) deps.audit(auth, principalId, outcome.removed);
    return json(res, outcome.status, outcome.body);
  };
}

/** The revoke of one person's connections, shared by the session route and
 * the console's `POST people/{principal}/connections/revoke`: what was
 * removed (for the caller's audit row) and the answer. */
export async function revokeOrgConnections(
  deps: Pick<OrgPersonConnectionsDeps, "servers" | "plugins" | "stopMcp" | "removeMcp" | "disconnectGithub" | "removePlugin">,
  principalId: string,
  raw: unknown,
): Promise<{ status: number; body: Record<string, unknown>; removed: RemovedConnection[] }> {
  const parsed = revokeBody.safeParse(raw);
  const removed: RemovedConnection[] = [];
  if (!parsed.success) return { status: 400, body: { error: "Send { all: true } or one connection.", code: "invalid_body" }, removed };
  const finish = (status: number, body: Record<string, unknown>) => ({ status, body, removed });
  try {
    if ("all" in parsed.data) {
      deps.stopMcp(principalId);
      const github = await deps.disconnectGithub(principalId);
      if (github.removed) removed.push({ kind: "github", ...(github.login ? { name: github.login } : {}) });
      for (const name of Object.keys(deps.servers(principalId)).sort()) {
        if (await deps.removeMcp(principalId, name)) removed.push({ kind: "mcp", name });
      }
      for (const bot of deps.plugins(principalId)) {
        for (const plugin of bot.plugins) {
          if (await deps.removePlugin(principalId, bot.botId, plugin.key)) {
            removed.push({ kind: "plugin", botId: bot.botId, key: plugin.key, name: plugin.name });
          }
        }
      }
      return finish(200, { removed });
    }
    if (parsed.data.kind === "mcp") {
      if (!Object.hasOwn(deps.servers(principalId), parsed.data.name)) return finish(404, { error: "No connection with that name.", code: "not_found" });
      deps.stopMcp(principalId, parsed.data.name);
      if (!await deps.removeMcp(principalId, parsed.data.name)) return finish(404, { error: "No connection with that name.", code: "not_found" });
      removed.push({ kind: "mcp", name: parsed.data.name });
      return finish(200, { removed });
    }
    if (parsed.data.kind === "github") {
      const github = await deps.disconnectGithub(principalId);
      if (!github.removed) return finish(404, { error: "No connection with that name.", code: "not_found" });
      deps.stopMcp(principalId);
      removed.push({ kind: "github", ...(github.login ? { name: github.login } : {}) });
      return finish(200, { removed });
    }
    if (parsed.data.kind !== "plugin") return finish(400, { error: "Send { all: true } or one connection.", code: "invalid_body" });
    const { botId, key } = parsed.data;
    const bot = deps.plugins(principalId).find((entry) => entry.botId === botId);
    const plugin = bot?.plugins.find((entry) => entry.key === key);
    if (!bot || !plugin) return finish(404, { error: "No connection with that name.", code: "not_found" });
    if (!await deps.removePlugin(principalId, bot.botId, plugin.key)) return finish(404, { error: "No connection with that name.", code: "not_found" });
    removed.push({ kind: "plugin", botId: bot.botId, key: plugin.key, name: plugin.name });
    return finish(200, { removed });
  } catch {
    return finish(500, { error: "The connection could not be removed." });
  }
}
