// A bot installs a plugin through act. The caller is the signed-in person.
// The plugin route is the permission check: the owner installs, anyone else
// is refused, and the refusal is the route's own plugins_owner_only.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { TurnFacts } from "../shared/bot-act.ts";
import { createBotActService } from "./bot-act.ts";
import { BotPluginError, type GitRunner } from "./bot-plugins.ts";
import { botPluginsWithMarketplaces } from "./testing/plugin-stores.ts";
import { json, readBody } from "./harness/http.ts";
import type { RequestAuth } from "./auth/request-auth.ts";
import { createBotPluginRoutes } from "./routes/bot-plugins.ts";
import { dispatchRoutes } from "./routes/table.ts";

const dirs: string[] = [];
const servers: Server[] = [];
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), "sagax-plugin-act-"));
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
  write(repo, ".claude-plugin/marketplace.json", JSON.stringify({
    name: "acme-tools",
    plugins: [{ name: "reviewer", source: "./plugins/reviewer" }],
  }));
  write(repo, "plugins/reviewer/.claude-plugin/plugin.json", JSON.stringify({ name: "reviewer" }));
  write(repo, "plugins/reviewer/skills/review/SKILL.md", "---\nname: review\ndescription: Review\n---\nBody");
  return repo;
}

function fakeGit(repos: Record<string, string>): GitRunner {
  return async (args) => {
    const url = args[args.indexOf("--") + 1]!;
    const into = args[args.indexOf("--") + 2]!;
    const from = repos[url];
    if (!from) throw new BotPluginError("The repository could not be fetched.", "repository_unreadable", 422);
    cpSync(from, into, { recursive: true });
  };
}

const member = (principalId: string): RequestAuth => ({
  kind: "session", via: "cookie", scopes: ["client"],
  session: { id: principalId, principalId, label: principalId, scopes: ["client"], createdAt: 0, expiresAt: 0, lastUsedAt: 0 } as never,
});

function facts(person: string): TurnFacts {
  return { automation: false, guest: false, requestUsable: true, senderUnproven: false, provenPerson: person, sharedServer: true };
}

async function boot() {
  const plugins = botPluginsWithMarketplaces({
    dataDir: temp(), git: fakeGit({ "https://github.com/acme/tools.git": marketplaceRepo() }), gitEnvironment: () => ({}), policy: () => undefined,
  });
  await plugins.addMarketplace("scout", { source: "acme/tools" }, "pr_owner");
  const routes = [createBotPluginRoutes<{ id: string; owner: string }>({
    plugins,
    bot: (id) => (id === "scout" ? { id: "scout", owner: "pr_owner" } : undefined),
    mayRead: () => true,
    mayChange: (auth, bot) => auth.kind === "session" && auth.session.principalId === bot.owner,
    actor: (auth) => (auth.kind === "session" ? auth.session.principalId : undefined),
    policy: () => undefined,
    engineLoadsPlugins: () => true,
  })];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const person = typeof req.headers["x-person"] === "string" ? req.headers["x-person"] : "";
    try {
      if (!await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth: member(person), json, readBody })) json(res, 404, {});
    } catch (error) {
      json(res, 500, { error: String(error) });
    }
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const service = createBotActService({
    now: () => 0,
    newId: () => "req-1",
    neededScope: () => "client",
    operatorAudience: () => "operator",
    sessionForPerson: (personKey) => ({ id: personKey, scopes: ["client"] }),
    async performRoute(actor, target) {
      const headers = new Headers({ accept: "application/json" });
      if (actor.kind === "person") headers.set("x-person", actor.personKey);
      let body: string | undefined;
      if (target.body !== undefined) {
        headers.set("content-type", "application/json");
        body = JSON.stringify(target.body);
      }
      const response = await fetch(`${base}${target.path}`, { method: target.method, headers, body });
      return { status: response.status, text: await response.text() };
    },
    broadcastUi: () => undefined,
    postCard: () => ({ messageId: "m" }),
    patchCard: () => undefined,
    findCard: () => null,
  });
  return { plugins, service };
}

describe("act installs a plugin as the signed-in person", () => {
  it("installs for the owner and refuses a person who cannot change plugins", async () => {
    const owner = await boot();
    const installed = await owner.service.handle({
      facts: facts("pr_owner"),
      raw: { plugins: { action: "install", botId: "scout", marketplace: "acme-tools", plugin: "reviewer" } },
      threadId: "t", botId: "scout", botName: "Scout", botColor: "green", mode: "full",
    });
    expect(installed.status).toBe(201);
    expect(owner.plugins.listPlugins("scout").map((plugin) => plugin.key)).toEqual(["reviewer@acme-tools"]);

    const other = await boot();
    const refused = await other.service.handle({
      facts: facts("pr_use"),
      raw: { plugins: { action: "install", botId: "scout", marketplace: "acme-tools", plugin: "reviewer" } },
      threadId: "t", botId: "scout", botName: "Scout", botColor: "green", mode: "full",
    });
    expect(refused.status).toBe(403);
    expect(String(refused.body.text ?? refused.body.error)).toContain("plugins_owner_only");
    expect(other.plugins.listPlugins("scout")).toEqual([]);
  });
});
