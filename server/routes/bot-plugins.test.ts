// Connect apps, two install scopes on one marketplace list: the workspace's
// routes (/api/marketplaces, its managers only) and a bot's own
// (/api/bots/:id/plugins, the bot's owner or a person who manages it).
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { BotPluginError, BotPlugins, type GitRunner } from "../bot-plugins.ts";
import { json, readBody } from "../harness/http.ts";
import { PluginMarketplaces } from "../plugin-marketplaces.ts";
import type { RequestAuth } from "../request-auth.ts";
import { createBotPluginRoutes } from "./bot-plugins.ts";
import { createMarketplaceRoutes } from "./marketplaces.ts";
import { dispatchRoutes } from "./table.ts";

const dirs: string[] = [];
const servers: Server[] = [];
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), "sagax-plugin-scopes-"));
  dirs.push(dir);
  return dir;
};
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function write(root: string, path: string, content: string) {
  mkdirSync(join(root, path, ".."), { recursive: true });
  writeFileSync(join(root, path), content);
}

function marketplaceRepo(): string {
  const repo = temp();
  write(repo, ".claude-plugin/marketplace.json", JSON.stringify({ name: "acme-tools", plugins: [{ name: "reviewer", source: "./plugins/reviewer" }] }));
  write(repo, "plugins/reviewer/.claude-plugin/plugin.json", JSON.stringify({ name: "reviewer", userConfig: { team: { type: "string", title: "Team" }, token: { type: "string", title: "Token", sensitive: true } } }));
  write(repo, "plugins/reviewer/agents/critic.md", "---\nname: critic\n---\nCritic");
  write(repo, "plugins/reviewer/commands/review.md", "Review the diff");
  return repo;
}

const git: GitRunner = async (args) => {
  const url = args[args.indexOf("--") + 1]!;
  const into = args[args.indexOf("--") + 2]!;
  if (url !== "https://github.com/acme/tools.git") throw new BotPluginError("The repository could not be fetched.", "repository_unreadable", 422);
  cpSync(repo, into, { recursive: true });
};
let repo = "";

const session = (principalId: string): RequestAuth => ({
  kind: "session", via: "cookie", scopes: ["client"],
  session: { id: principalId, principalId, label: principalId, scopes: ["client"], createdAt: 0, expiresAt: 0, lastUsedAt: 0 } as never,
});

type Bot = { id: string; owner: string; managers: string[]; users: string[] };
const BOTS: Bot[] = [
  { id: "alice-bot", owner: "pr_alice", managers: [], users: ["pr_bob"] },
  { id: "bob-bot", owner: "pr_bob", managers: [], users: [] },
];
const ADMIN = "pr_admin";

async function boot() {
  repo = marketplaceRepo();
  const dataDir = temp();
  const shared = new PluginMarketplaces({ dataDir, git, gitEnvironment: () => ({}), policy: () => undefined, inUse: (name) => plugins.botsUsing(name) });
  const plugins: BotPlugins = new BotPlugins({ dataDir, marketplaces: shared, git, gitEnvironment: () => ({}), policy: () => undefined });
  const who = (auth: RequestAuth): string => (auth.kind === "session" ? auth.session.principalId ?? "" : "");
  const routes = [
    createBotPluginRoutes<Bot>({
      plugins,
      bot: (id) => BOTS.find((bot) => bot.id === id),
      mayRead: (auth, bot) => [bot.owner, ...bot.managers, ...bot.users, ADMIN].includes(who(auth)),
      mayChange: (auth, bot) => [bot.owner, ...bot.managers, ADMIN].includes(who(auth)),
      actor: (auth) => who(auth) || undefined,
      mayManageMarketplaces: (auth) => who(auth) === ADMIN,
      mayShareOrgWide: (auth) => who(auth) === ADMIN,
      policy: () => undefined,
      engineLoadsPlugins: () => true,
    }),
    createMarketplaceRoutes({
      store: shared,
      mayManage: (auth) => who(auth) === ADMIN,
      actor: (auth) => who(auth) || undefined,
      install: async (marketplace, plugin) => ({ status: 200, body: { plugin: shared.recordInstall(marketplace, plugin, { servers: [], skills: [] }) } }),
      uninstall: async (marketplace, plugin) => ({ status: 200, body: { plugin: shared.recordUninstall(marketplace, plugin) } }),
      update: async () => ({ status: 409, body: { error: "not in this test" } }),
      audit: () => undefined,
    }),
  ];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const person = typeof req.headers["x-person"] === "string" ? req.headers["x-person"] : "";
    try {
      if (!await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth: session(person), json, readBody })) json(res, 404, {});
    } catch (error) {
      json(res, 500, { error: String(error) });
    }
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (person: string, method: string, path: string, body?: unknown) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { "x-person": person, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() as Record<string, any> };
  };
  return { call, plugins, shared };
}

describe("org-wide sharing is admins only, on the bot route too", () => {
  it("refuses a non-admin owner who adds a bot marketplace with visibility=org (403), admin can, default stays private", async () => {
    const { call, shared } = await boot();
    // pr_alice owns alice-bot and may change its plugins, but is not an admin
    const over = await call("pr_alice", "POST", "/api/bots/alice-bot/plugins/marketplaces", { source: "acme/tools", visibility: "org" });
    expect(over.status).toBe(403);
    expect(over.body.code).toBe("marketplace_org_admin_only");
    expect(shared.record("acme-tools")).toBeUndefined();
    // the default (no visibility) is allowed and lands private
    const added = await call("pr_bob", "POST", "/api/bots/bob-bot/plugins/marketplaces", { source: "acme/tools" });
    expect(added.status).toBe(201);
    expect(shared.record("acme-tools")?.visibility).toBe("private");
  });

  it("lets an admin add a bot marketplace org-wide", async () => {
    const { call, shared } = await boot();
    const added = await call(ADMIN, "POST", "/api/bots/alice-bot/plugins/marketplaces", { source: "acme/tools", visibility: "org" });
    expect(added.status).toBe(201);
    expect(shared.record("acme-tools")?.visibility).toBe("org");
  });
});

describe("one marketplace list, two install scopes", () => {
  it("lists the workspace's marketplaces on every bot and installs a whole plugin on one bot only", async () => {
    const { call } = await boot();
    expect((await call(ADMIN, "POST", "/api/marketplaces", { source: "acme/tools" })).status).toBe(201);
    // everyone: the workspace install (MCP servers and skills)
    expect((await call(ADMIN, "POST", "/api/marketplaces/acme-tools/plugins/reviewer", {})).status).toBe(200);
    // for this bot: the same marketplace, read through the bot
    const listed = await call("pr_alice", "GET", "/api/bots/alice-bot/plugins");
    expect(listed.body.marketplaces.map((market: { name: string }) => market.name)).toEqual(["acme-tools"]);
    expect(listed.body.marketplaces[0].plugins[0]).toMatchObject({ name: "reviewer", installed: false, contents: { agents: ["critic"], commands: ["review"], skills: [] } });
    const installed = await call("pr_alice", "POST", "/api/bots/alice-bot/plugins/install", { marketplace: "acme-tools", plugin: "reviewer" });
    expect(installed.status).toBe(201);
    expect(installed.body.plugins.map((plugin: { key: string }) => plugin.key)).toEqual(["reviewer@acme-tools"]);
    expect((await call("pr_bob", "GET", "/api/bots/bob-bot/plugins")).body.plugins).toEqual([]);
    // the workspace list says one bot uses it, and refuses to drop it
    const workspace = await call(ADMIN, "GET", "/api/marketplaces");
    expect(workspace.body.marketplaces[0]).toMatchObject({ name: "acme-tools", bots: 1 });
  });

  it("saves a plugin's configuration for its bot's owner, never a secret, and refuses anyone else", async () => {
    const { call } = await boot();
    await call(ADMIN, "POST", "/api/marketplaces", { source: "acme/tools" });
    await call("pr_alice", "POST", "/api/bots/alice-bot/plugins/install", { marketplace: "acme-tools", plugin: "reviewer" });
    const listed = await call("pr_alice", "GET", "/api/bots/alice-bot/plugins");
    expect(listed.body.plugins[0].config.fields.map((field: { key: string }) => field.key)).toEqual(["team", "token"]);
    const saved = await call("pr_alice", "PUT", "/api/bots/alice-bot/plugins/reviewer@acme-tools/config", { values: { team: "Platform" } });
    expect(saved.status).toBe(200);
    expect(saved.body.plugin.config.values).toEqual({ team: "Platform" });
    const secret = await call("pr_alice", "PUT", "/api/bots/alice-bot/plugins/reviewer@acme-tools/config", { values: { token: "abc" } });
    expect(secret).toMatchObject({ status: 400, body: { code: "sensitive_field" } });
    expect((await call("pr_bob", "PUT", "/api/bots/alice-bot/plugins/reviewer@acme-tools/config", { values: { team: "x" } })).status).toBe(403);
  });

  it("lets a member change only the plugins of a bot they own or manage", async () => {
    const { call } = await boot();
    expect((await call("pr_bob", "POST", "/api/bots/bob-bot/plugins/marketplaces", { source: "acme/tools" })).status).toBe(201);
    // Bob uses Alice's bot: he reads its plugins, he does not change them
    const read = await call("pr_bob", "GET", "/api/bots/alice-bot/plugins");
    expect(read).toMatchObject({ status: 200, body: { canChange: false } });
    const refused = await call("pr_bob", "POST", "/api/bots/alice-bot/plugins/install", { marketplace: "acme-tools", plugin: "reviewer" });
    expect(refused).toMatchObject({ status: 403, body: { code: "plugins_owner_only" } });
    // a bot he cannot see at all is not there
    expect((await call("pr_carol", "GET", "/api/bots/bob-bot/plugins")).status).toBe(404);
    // his own bot: yes
    expect((await call("pr_bob", "POST", "/api/bots/bob-bot/plugins/install", { marketplace: "acme-tools", plugin: "reviewer" })).status).toBe(201);
    // the workspace routes stay with their managers
    expect((await call("pr_bob", "POST", "/api/marketplaces/acme-tools/plugins/reviewer", {})).status).toBe(403);
    expect((await call("pr_bob", "DELETE", "/api/marketplaces/acme-tools")).status).toBe(403);
  });

  it("removes a marketplace from a bot without taking it from everyone else", async () => {
    const { call, shared } = await boot();
    await call(ADMIN, "POST", "/api/marketplaces", { source: "acme/tools" });
    await call("pr_bob", "POST", "/api/bots/bob-bot/plugins/install", { marketplace: "acme-tools", plugin: "reviewer" });
    await call("pr_alice", "POST", "/api/bots/alice-bot/plugins/install", { marketplace: "acme-tools", plugin: "reviewer" });
    expect((await call(ADMIN, "DELETE", "/api/marketplaces/acme-tools")).body).toMatchObject({ code: "in_use" });
    // Bob did not add it: his bot's plugins go, the marketplace stays
    const bob = await call("pr_bob", "DELETE", "/api/bots/bob-bot/plugins/marketplaces/acme-tools");
    expect(bob.body).toMatchObject({ sharedRemoved: false, plugins: [] });
    expect(shared.list().map((market) => market.name)).toEqual(["acme-tools"]);
    // the admin removes Alice's bot's last use, and the marketplace with it
    const admin = await call(ADMIN, "DELETE", "/api/bots/alice-bot/plugins/marketplaces/acme-tools");
    expect(admin.body).toMatchObject({ sharedRemoved: true, marketplaces: [] });
  });
});
