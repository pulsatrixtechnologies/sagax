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
import { createBotActService } from "./bots/bot-act.ts";
import { BotPluginError, type GitRunner } from "./bots/bot-plugins.ts";
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

const pulledReads = { count: 0 };

async function boot(options: { repos?: Record<string, string>; sources?: string[]; pulledAt?: ReadonlyMap<string, number> } = {}) {
  const plugins = botPluginsWithMarketplaces({
    dataDir: temp(), git: fakeGit(options.repos ?? { "https://github.com/acme/tools.git": marketplaceRepo() }), gitEnvironment: () => ({}), policy: () => undefined,
  });
  for (const source of options.sources ?? ["acme/tools"]) await plugins.addMarketplace("scout", { source }, "pr_owner");
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
    async performRoute(actor, target, _confirmed, maxChars = 8000) {
      const headers = new Headers({ accept: "application/json" });
      if (actor.kind === "person") headers.set("x-person", actor.personKey);
      let body: string | undefined;
      if (target.body !== undefined) {
        headers.set("content-type", "application/json");
        body = JSON.stringify(target.body);
      }
      const url = new URL(`${base}${target.path}`);
      for (const [key, value] of Object.entries(target.query ?? {})) url.searchParams.append(key, value);
      const response = await fetch(url, { method: target.method, headers, body });
      // the server's own loopback cuts at the size it is asked for
      return { status: response.status, text: (await response.text()).slice(0, maxChars) };
    },
    broadcastUi: () => undefined,
    postCard: () => ({ messageId: "m" }),
    patchCard: () => undefined,
    findCard: () => null,
    ...(options.pulledAt ? { marketplacesPulledAt: () => { pulledReads.count += 1; return options.pulledAt!; } } : {}),
  });
  return { plugins, service, base };
}

/** #3637: a marketplace of `count` plugins, each with a long description. */
function bigMarketplaceRepo(name: string, count: number): string {
  const repo = temp();
  const plugins = Array.from({ length: count }, (_, index) => ({
    name: `${name}-plugin-${index}`,
    source: `./plugins/p${index}`,
    version: "1.0.0",
    category: "tools",
    description: `Plugin number ${index} of ${name}: ${"it does a useful thing for the person. ".repeat(4)}`,
  }));
  write(repo, ".claude-plugin/marketplace.json", JSON.stringify({ name, plugins }));
  for (let index = 0; index < count; index += 1) {
    write(repo, `plugins/p${index}/.claude-plugin/plugin.json`, JSON.stringify({ name: `${name}-plugin-${index}`, version: "1.0.0" }));
    write(repo, `plugins/p${index}/skills/s/SKILL.md`, "---\nname: s\ndescription: S\n---\nBody");
  }
  return repo;
}

async function bootBig(options: { pulledAt?: ReadonlyMap<string, number> } = {}) {
  const names = ["alpha-market", "beta-market", "gamma-market"];
  const repos = Object.fromEntries(names.map((name) => [`https://github.com/acme/${name}.git`, bigMarketplaceRepo(name, 200)]));
  const booted = await boot({ repos, sources: names.map((name) => `acme/${name}`), ...options });
  return { ...booted, names };
}

const act = (service: Awaited<ReturnType<typeof boot>>["service"], plugins: Record<string, unknown>) => service.handle({
  facts: facts("pr_owner"),
  raw: { plugins: { botId: "scout", ...plugins } },
  threadId: "t", botId: "scout", botName: "Scout", botColor: "green", mode: "full",
});

/** What the model reads: the proxy's own cut (agents-tools/core.ts act). */
const modelText = (result: { body: Record<string, unknown> }) => String(result.body.text ?? result.body.error ?? "").slice(0, 8000);

// three clones of 200 plugins each: slow on a busy machine
describe("what a bot reads from its plugins tool (#3637)", { timeout: 90_000 }, () => {
  it("lists the installed plugins and one line per marketplace, whole, under the limit", async () => {
    const { service, plugins, names } = await bootBig({ pulledAt: new Map([["beta-market", Date.UTC(2026, 10, 10, 12)]]) });
    await plugins.install("scout", { marketplace: "gamma-market", plugin: "gamma-market-plugin-150" }, "pr_owner");
    const reads = pulledReads.count;
    const listed = await act(service, { action: "list" });
    expect(listed.status).toBe(200);
    // the last-pull dates come from one read per listing, not one per marketplace
    expect(pulledReads.count - reads).toBe(1);
    const text = modelText(listed);
    expect(text.length).toBeLessThan(8000);
    const answer = JSON.parse(text) as { installed: Array<Record<string, unknown>>; marketplaces: string[]; more?: unknown };
    expect(answer.installed).toEqual([expect.objectContaining({ key: "gamma-market-plugin-150@gamma-market", marketplace: "gamma-market", version: "1.0.0", enabled: true })]);
    expect(answer.marketplaces).toHaveLength(3);
    for (const name of names) expect(answer.marketplaces.some((line) => line.startsWith(`${name}:`) && line.includes("200 plugins"))).toBe(true);
    expect(answer.marketplaces.find((line) => line.startsWith("beta-market:"))).toContain("pulled 2026-11-10T12:00:00.000Z");
    expect(answer.marketplaces.every((line) => /token (yes|no)/.test(line))).toBe(true);
    // the catalog is asked on demand, never dumped
    expect(text).not.toContain("alpha-market-plugin-0");
    expect(answer.more).toBeUndefined();
  });

  it("names an update waiting and the offered version on an installed plugin", async () => {
    const shaped = await import("./bots/bot-plugins-answer.ts");
    const listing = {
      marketplaces: [{ name: "alpha-market", source: "acme/alpha-market", hasToken: false, visibility: "org", mine: true, addedAt: 0, updatedAt: 0,
        plugins: [{ name: "alpha-market-plugin-3", version: "1.1.0", installed: true, installedVersion: "1.0.0", updateAvailable: true, external: false }] }],
      plugins: [{ key: "alpha-market-plugin-3@alpha-market", name: "alpha-market-plugin-3", marketplace: "alpha-market", version: "1.0.0", enabled: true }],
    };
    const text = shaped.shapePluginAnswer({ kind: "route", method: "GET", path: "/api/bots/scout/plugins" }, JSON.stringify(listing));
    expect(JSON.parse(text).installed[0]).toMatchObject({ updateAvailable: true, offeredVersion: "1.1.0", version: "1.0.0" });
  });

  it("pages one marketplace's catalog with a clear marker, and filters it", async () => {
    const { service } = await bootBig();
    const first = JSON.parse(modelText(await act(service, { action: "list", marketplace: "beta-market" }))) as {
      marketplace: string; total: number; plugins: Array<{ name: string }>; more?: { offset: number; left: number; how: string };
    };
    expect(first.marketplace.startsWith("beta-market:")).toBe(true);
    expect(first.total).toBe(200);
    expect(first.plugins.length).toBeGreaterThan(0);
    expect(first.plugins.length).toBeLessThan(200);
    expect(first.more).toMatchObject({ offset: first.plugins.length, left: 200 - first.plugins.length });
    expect(first.more!.how).toContain("offset");
    const second = JSON.parse(modelText(await act(service, { action: "list", marketplace: "beta-market", offset: first.more!.offset }))) as { plugins: Array<{ name: string }> };
    expect(second.plugins[0]!.name).toBe(`beta-market-plugin-${first.plugins.length}`);
    const filtered = JSON.parse(modelText(await act(service, { action: "list", marketplace: "beta-market", filter: "plugin-19" }))) as { matched: number; plugins: Array<{ name: string }>; more?: unknown };
    expect(filtered.plugins.map((plugin) => plugin.name)).toEqual(["beta-market-plugin-19", ...Array.from({ length: 10 }, (_, index) => `beta-market-plugin-19${index}`)]);
    expect(filtered.matched).toBe(11);
    expect(filtered.more).toBeUndefined();
    const unknown = await act(service, { action: "list", marketplace: "nowhere" });
    expect(modelText(unknown)).toContain("alpha-market");
  });

  it("answers an install with the installed plugin, never the marketplaces array", async () => {
    const { service } = await bootBig();
    const installed = await act(service, { action: "install", marketplace: "alpha-market", plugin: "alpha-market-plugin-7" });
    expect(installed.status).toBe(201);
    const answer = JSON.parse(modelText(installed)) as Record<string, unknown>;
    expect(answer.plugin).toMatchObject({ key: "alpha-market-plugin-7@alpha-market", version: "1.0.0" });
    expect(answer).not.toHaveProperty("marketplaces");
    expect(modelText(installed).length).toBeLessThan(2000);
  });

  it("says what it left out when a listing still has to be cut", async () => {
    const shaped = await import("./bots/bot-plugins-answer.ts");
    const marketplaces = Array.from({ length: 120 }, (_, index) => ({
      name: `market-${index}`, source: `https://example.com/a/very/long/path/to/a/marketplace/repository/number-${index}.git`, hasToken: false, visibility: "org", mine: false, addedAt: 0, updatedAt: 0, plugins: [],
    }));
    const text = shaped.shapePluginAnswer({ kind: "route", method: "GET", path: "/api/bots/scout/plugins" }, JSON.stringify({ marketplaces, plugins: [] }));
    expect(text.length).toBeLessThan(8000);
    const answer = JSON.parse(text) as { marketplaces: string[]; more: { offset: number; left: Record<string, number>; how: string } };
    expect(answer.marketplaces.length).toBeLessThan(120);
    expect(answer.more).toMatchObject({ offset: answer.marketplaces.length, left: { marketplaces: 120 - answer.marketplaces.length, installed: 0 } });
    const next = JSON.parse(shaped.shapePluginAnswer({ kind: "route", method: "GET", path: "/api/bots/scout/plugins", query: { offset: String(answer.more.offset) } }, JSON.stringify({ marketplaces, plugins: [] }))) as { marketplaces: string[] };
    expect(next.marketplaces[0]!.startsWith(`market-${answer.more.offset}:`)).toBe(true);
  });

  /** #3637 review: follow `more` from a plain list to the end. */
  async function walk(listing: Record<string, unknown>) {
    const shaped = await import("./bots/bot-plugins-answer.ts");
    const pages: Array<{ text: string; marketplaces: string[]; installed: Array<{ key: string }>; more?: { offset: number; how: string } }> = [];
    let offset: number | undefined;
    do {
      const target = { kind: "route" as const, method: "GET", path: "/api/bots/scout/plugins", ...(offset ? { query: { offset: String(offset) } } : {}) };
      const text = shaped.shapePluginAnswer(target, JSON.stringify(listing));
      pages.push({ text, ...JSON.parse(text) });
      offset = pages.at(-1)!.more?.offset;
      expect(pages.length).toBeLessThan(100);
    } while (offset !== undefined);
    return { pages, max: shaped.BOT_PLUGIN_ANSWER_MAX };
  }

  const market = (index: number, plugins: unknown[] = []) => ({
    name: `market-${index}`, source: `https://example.com/acme/marketplace-number-${index}.git`, hasToken: index % 2 === 0, visibility: "org", mine: false, addedAt: 0, updatedAt: 0, plugins,
  });

  it("puts every marketplace line first and pages 60 installed plugins, each once", async () => {
    const installed = Array.from({ length: 60 }, (_, index) => ({
      key: `a-rather-long-plugin-name-number-${index}@market-${index % 3}`, name: `a-rather-long-plugin-name-number-${index}`, marketplace: `market-${index % 3}`,
      version: "12.3.4", enabled: index % 4 !== 0, installedAt: 0, updatedAt: 0, removed: [], declaredMcpServers: [],
      ...(index % 5 === 0 ? { marketplacePull: { pulled: false, code: "bad_token", fix: "connect_or_token", clonedAt: "2026-11-01T00:00:00.000Z" } } : {}),
    }));
    const catalog = (marketIndex: number) => installed.filter((plugin) => plugin.marketplace === `market-${marketIndex}`)
      .map((plugin) => ({ name: plugin.name, version: "12.4.0", installed: true, installedVersion: "12.3.4", updateAvailable: true, external: false }));
    const { pages, max } = await walk({ marketplaces: [0, 1, 2].map((index) => market(index, catalog(index))), plugins: installed, canChange: true });
    // fits its budget, so it is under every 8000 cut by construction, and never the generic cut note
    expect(max).toBeLessThan(8000);
    for (const page of pages) {
      expect(page.text.length).toBeLessThanOrEqual(max);
      expect(page.text).not.toContain("[Cut by Sagax");
    }
    expect(pages.length).toBeGreaterThan(1);
    expect(pages[0]!.marketplaces).toHaveLength(3);
    expect(pages.slice(1).every((page) => page.marketplaces.length === 0)).toBe(true);
    const keys = pages.flatMap((page) => page.installed.map((plugin) => plugin.key));
    expect(keys).toEqual(installed.map((plugin) => plugin.key));
    expect(pages[0]!.installed[0]).toMatchObject({ updateAvailable: true, offeredVersion: "12.4.0", marketplacePull: { code: "bad_token" } });
  });

  it("reaches all 50 marketplaces by paging", async () => {
    const { pages, max } = await walk({ marketplaces: Array.from({ length: 50 }, (_, index) => market(index)), plugins: [] });
    const lines = pages.flatMap((page) => page.marketplaces);
    expect(lines.map((line) => line.split(":")[0])).toEqual(Array.from({ length: 50 }, (_, index) => `market-${index}`));
    for (const page of pages) expect(page.text.length).toBeLessThanOrEqual(max);
  });

  it("leaves the person's own listing route answer whole", async () => {
    const { base } = await bootBig();
    const response = await fetch(`${base}/api/bots/scout/plugins`, { headers: { "x-person": "pr_owner" } });
    const listing = await response.json() as { marketplaces: Array<{ plugins: unknown[] }> };
    expect(listing.marketplaces).toHaveLength(3);
    expect(listing.marketplaces.every((market) => market.plugins.length === 200)).toBe(true);
  });
});

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
