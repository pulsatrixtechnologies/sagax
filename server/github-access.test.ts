// Private GitHub plugins and skills (server/github-access.ts,
// server/bot-plugins.ts, server/marketplace-tokens.ts): a fake GitHub
// answers 404 without a token and 200 with the right one; every refusal
// names its real cause; the token rides a header, never the argv or a file;
// a bot's own plugin skills, commands and agents reach its turns.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

import { githubAccessFailure, githubSkillFetch, probeGithubRepo, type GithubCredential } from "./github-access.ts";
import { BotPluginError, BotPlugins, type GitRunner } from "./bot-plugins.ts";
import { botPluginsWithMarketplaces } from "./testing/plugin-stores.ts";
import { MarketplaceTokens, WORKSPACE_TOKEN_KEY } from "./marketplace-tokens.ts";
import { fetchSkillFromSource } from "./skill-fetch.ts";
import { pluginTurnFiles, pluginTurnPrompt } from "./plugin-turn.ts";
import { createBotPluginRoutes } from "./routes/bot-plugins.ts";
import { createMarketplaceRoutes, type MarketplaceRouteDeps } from "./routes/marketplaces.ts";
import { PluginMarketplaces } from "./plugin-marketplaces.ts";
import { dispatchRoutes } from "./routes/table.ts";
import { json, readBody } from "./harness/http.ts";
import type { RequestAuth } from "./request-auth.ts";

const servers: Server[] = [];
const dirs: string[] = [];
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), "sagax-gh-access-"));
  dirs.push(dir);
  return dir;
};
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** api.github.com for acme/private: 404 without a token (as GitHub hides
 * a private repository), 200 with "good", 401 with "bad", 403 SAML with
 * "sso", and a rate limit with "limited". */
async function fakeGithub(): Promise<{ origin: string; seen: string[] }> {
  const seen: string[] = [];
  const server = createServer((req, res) => {
    const auth = String(req.headers.authorization ?? "");
    seen.push(`${req.method} ${req.url} ${auth ? auth.replace(/Bearer .*/, "Bearer ***") : "-"}`);
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    const send = (status: number, body: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { "content-type": "application/json", ...headers });
      res.end(JSON.stringify(body));
    };
    if (token === "bad") return send(401, { message: "Bad credentials" });
    if (token === "sso") return send(403, { message: "Resource protected by organization SAML enforcement." }, { "x-github-sso": "required; url=https://github.com/orgs/acme/sso?authorization_request=abc" });
    if (token === "limited") return send(403, { message: "API rate limit exceeded" }, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1790000000" });
    const isPrivate = req.url?.startsWith("/repos/acme/private");
    if (isPrivate && token !== "good-token-123") return send(404, { message: "Not Found" });
    if (req.url === "/repos/acme/private" || req.url === "/repos/acme/public") return send(200, { full_name: "acme/x", private: isPrivate });
    if (req.url?.startsWith("/repos/acme/private/contents/")) {
      const path = req.url.slice("/repos/acme/private/contents/".length).split("?")[0];
      if (path === "") return send(200, [{ type: "dir", name: "skills", path: "skills" }]);
      if (path === "skills") return send(200, [{ type: "dir", name: "digest", path: "skills/digest" }]);
      if (path === "skills/digest") return send(200, [{ type: "file", name: "SKILL.md", path: "skills/digest/SKILL.md", download_url: "https://raw.githubusercontent.com/acme/private/main/skills/digest/SKILL.md" }]);
    }
    if (req.url === "/raw/digest") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("---\nname: digest\ndescription: Weekly digest\n---\nWrite it.\n");
      return;
    }
    return send(404, { message: "Not Found" });
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { origin, seen };
}

const env = (origin: string) => ({ ...process.env, SAGAX_GITHUB_API_ORIGIN: origin });

describe("why GitHub refuses", () => {
  it("maps 404, 401, SAML 403, rate limit and a missing scope to their own cause and fix", () => {
    const headers = (values: Record<string, string> = {}) => new Headers(values);
    const person: GithubCredential = { token: "t", via: "person" };
    expect(githubAccessFailure({ status: 404, headers: headers() }, "acme/private", null)).toMatchObject({ code: "private_needs_token", fix: "connect_or_token" });
    expect(githubAccessFailure({ status: 404, headers: headers() }, "acme/private", person)).toMatchObject({ code: "not_found_or_no_access", fix: "check_access" });
    expect(githubAccessFailure({ status: 401, headers: headers() }, "acme/private", { token: "t", via: "marketplace" })).toMatchObject({ code: "bad_token", fix: "replace_token" });
    expect(githubAccessFailure({ status: 403, headers: headers({ "x-github-sso": "required; url=https://github.com/orgs/acme/sso?x=1" }) }, "acme/private", person))
      .toMatchObject({ code: "sso_required", fix: "authorize_sso", ssoUrl: "https://github.com/orgs/acme/sso?x=1" });
    expect(githubAccessFailure({ status: 403, headers: headers({ "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1790000000" }) }, "acme/private", null))
      .toMatchObject({ code: "rate_limited", status: 429, fix: "wait", resetAt: 1_790_000_000_000 });
    expect(githubAccessFailure({ status: 403, headers: headers() }, "acme/private", person)).toMatchObject({ code: "forbidden", fix: "token_scope" });
    // The person's own token on another owner's repository: the organization is named.
    const fine: GithubCredential = { token: "github_pat_x", via: "person", login: "jc" };
    const org = githubAccessFailure({ status: 404, headers: headers() }, "goxtechnologies/repo", fine);
    expect(org).toMatchObject({ code: "org_not_covered", fix: "reconnect_with_orgs", organization: "goxtechnologies" });
    expect(org!.message).toContain("does not cover the organization goxtechnologies");
    expect(org!.message).toContain("fine-grained");
    expect(org!.message).not.toContain("github_pat_x");
    expect(githubAccessFailure({ status: 403, headers: headers() }, "pulsatrixtechnologies/repo", { token: "gho_x", via: "person", login: "jc" }))
      .toMatchObject({ code: "org_not_covered", organization: "pulsatrixtechnologies" });
    // Their own account's repository stays a plain 404.
    expect(githubAccessFailure({ status: 404, headers: headers() }, "JC/private", fine)).toMatchObject({ code: "not_found_or_no_access" });
    expect(githubAccessFailure({ status: 200, headers: headers() }, "acme/private", null)).toBeNull();
  });

  it("asks GitHub which credential reads the repository, in order, and why none does", async () => {
    const github = await fakeGithub();
    const options = { env: env(github.origin) };
    expect(await probeGithubRepo({ owner: "acme", repo: "private" }, [], options)).toMatchObject({ ok: false, failure: { code: "private_needs_token" } });
    expect(await probeGithubRepo({ owner: "acme", repo: "private" }, [{ token: "good-token-123", via: "person" }], options))
      .toMatchObject({ ok: true, credential: { via: "person" } });
    // the marketplace token is refused, the organization's reads it
    expect(await probeGithubRepo({ owner: "acme", repo: "private" }, [{ token: "bad", via: "marketplace" }, { token: "good-token-123", via: "organization" }], options))
      .toMatchObject({ ok: true, credential: { via: "organization" } });
    expect(await probeGithubRepo({ owner: "acme", repo: "private" }, [{ token: "sso", via: "person" }, { token: "bad", via: "marketplace" }], options))
      .toMatchObject({ ok: false, failure: { code: "sso_required" } });
    // a public repository reads even when every token is refused
    expect(await probeGithubRepo({ owner: "acme", repo: "public" }, [{ token: "bad", via: "person" }], options)).toMatchObject({ ok: true, credential: null });
    expect(github.seen.every((line) => !line.includes("good-token-123"))).toBe(true);
  });

  it("a private skill imports with the connection, and fails with its cause without it", async () => {
    const github = await fakeGithub();
    const routed: typeof fetch = (input, init) => {
      const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
      const local = url.hostname === "api.github.com" ? `${github.origin}${url.pathname}${url.search}`
        : url.hostname === "raw.githubusercontent.com" ? `${github.origin}/raw/digest` : url.toString();
      return fetch(local, init);
    };
    const without = await fetchSkillFromSource("https://github.com/acme/private", githubSkillFetch([], routed, env(github.origin)));
    expect(without).toMatchObject({ error: expect.stringContaining("GitHub answered 404 for acme/private: it is private") });
    const withToken = await fetchSkillFromSource("https://github.com/acme/private", githubSkillFetch([{ token: "good-token-123", via: "person" }], routed, env(github.origin)));
    expect("skills" in withToken && withToken.skills[0]?.files[0]?.content).toContain("name: digest");
  });
});

function marketplaceRepo(): string {
  const repo = temp();
  const write = (path: string, content: string) => {
    mkdirSync(join(repo, path, ".."), { recursive: true });
    writeFileSync(join(repo, path), content);
  };
  write(".claude-plugin/marketplace.json", JSON.stringify({ name: "acme-private", plugins: [{ name: "reviewer", source: "./plugins/reviewer" }] }));
  write("plugins/reviewer/skills/review/SKILL.md", "---\nname: review\ndescription: Review code\n---\nReview.\n");
  write("plugins/reviewer/commands/ship.md", "---\ndescription: Ship the release\n---\nShip.\n");
  write("plugins/reviewer/agents/critic.md", "---\nname: critic\ndescription: A strict code critic\n---\nCriticize.\n");
  write("plugins/reviewer/hooks/hooks.json", "{}");
  return repo;
}

function vaultKey() {
  const key = randomBytes(32);
  return () => ({ kind: "key" as const, key });
}

async function plugins(options: { person?: string } = {}) {
  const github = await fakeGithub();
  const dataDir = temp();
  const runs: Array<{ args: string[]; env: Record<string, string> }> = [];
  const repo = marketplaceRepo();
  const git: GitRunner = async (args, run) => {
    runs.push({ args, env: run.env });
    // git reads with the header the probe chose: no header, no clone
    const header = run.env.GIT_CONFIG_VALUE_0 ?? "";
    const token = header.startsWith("AUTHORIZATION: basic ") ? Buffer.from(header.slice(21), "base64").toString().split(":")[1] : "";
    if (token !== "good-token-123") throw new BotPluginError("The git host did not let Sagax read this repository.", "repository_unreadable", 422, "connect_or_token");
    cpSync(repo, args[args.indexOf("--") + 2]!, { recursive: true });
  };
  const tokens = new MarketplaceTokens(dataDir, vaultKey());
  const store = botPluginsWithMarketplaces({
    dataDir, git, gitEnvironment: () => ({}), tokens, policy: () => undefined,
    credentials: () => (options.person ? [{ token: options.person, via: "person" as const }] : []),
    probe: (repoName, credentials) => probeGithubRepo(repoName, credentials, { env: env(github.origin) }),
  });
  return { store, tokens, runs, dataDir, github };
}

describe("a bot's private marketplace", () => {
  it("names the cause without a token, then adds with one, keeps it encrypted, and never puts it on the argv", async () => {
    const { store, tokens, runs, dataDir } = await plugins();
    await expect(store.addMarketplace("bot-1", { source: "acme/private" }, "pr_a")).rejects.toMatchObject({ code: "private_needs_token", fix: "connect_or_token", status: 422 });
    expect(runs).toHaveLength(0);
    await expect(store.addMarketplace("bot-1", { source: "acme/private", token: "bad" }, "pr_a")).rejects.toMatchObject({ code: "bad_token" });
    expect(tokens.sourcesFor("bot-1").size).toBe(0);
    const added = await store.addMarketplace("bot-1", { source: "https://github.com/acme/private", token: "good-token-123" }, "pr_a");
    expect(added).toMatchObject({ name: "acme-private", source: "acme/private", hasToken: true });
    expect(runs.at(-1)!.args.join(" ")).not.toContain("good-token-123");
    expect(runs.at(-1)!.env).toMatchObject({ GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader", GIT_TERMINAL_PROMPT: "0" });
    // at rest: encrypted, never in the one marketplace list's state
    expect(readFileSync(join(dataDir, "marketplace-tokens.enc"), "utf8")).not.toContain("good-token-123");
    expect(readFileSync(join(dataDir, "marketplaces", "state.json"), "utf8")).not.toContain("good-token-123");
    // Update reads with the saved token; another bot has none
    await store.updateMarketplace("bot-1", "acme-private", undefined);
    expect(tokens.get("bot-2", "acme/private")).toBeUndefined();
    await store.install("bot-1", { marketplace: "acme-private", plugin: "reviewer" }, undefined);
    expect(readFileSync(join(dataDir, "bot-plugins", "bot-1", "state.json"), "utf8")).not.toContain("good-token-123");
    await store.removeMarketplace("bot-1", "acme-private");
    expect(tokens.sourcesFor("bot-1").size).toBe(0);
  });

  it("reads with the person's GitHub connection when there is no marketplace token", async () => {
    const { store, tokens } = await plugins({ person: "good-token-123" });
    expect(await store.addMarketplace("bot-1", { source: "acme/private" }, "pr_a")).toMatchObject({ hasToken: false });
    expect(tokens.sourcesFor("bot-1").size).toBe(0);
  });

  it("the routes take a token on add, set and remove it, and answer the cause with its fix", async () => {
    const { store } = await plugins();
    const owner: RequestAuth = { kind: "session", via: "cookie", scopes: ["client"], session: { id: "s", principalId: "pr_a", label: "a", scopes: ["client"], createdAt: 0, expiresAt: 0, lastUsedAt: 0 } as never };
    const routes = [createBotPluginRoutes<{ id: string }>({
      plugins: store, bot: (id) => (id === "bot-1" ? { id } : undefined), mayRead: () => true, mayChange: () => true,
      actor: () => "pr_a", policy: () => undefined, engineLoadsPlugins: () => true,
    })];
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (!await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth: owner, json, readBody })) json(res, 404, {});
    });
    servers.push(server);
    await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/bots/bot-1/plugins`;
    const call = async (method: string, path: string, body?: unknown) => {
      const response = await fetch(`${base}${path}`, { method, headers: { "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: response.status, body: await response.json() as Record<string, any> };
    };
    const refused = await call("POST", "/marketplaces", { source: "acme/private" });
    expect(refused).toMatchObject({ status: 422, body: { code: "private_needs_token", fix: "connect_or_token" } });
    expect(refused.body.error).toContain("Connect your GitHub account");
    expect((await call("POST", "/marketplaces", { source: "acme/private", token: "no spaces allowed" })).body.code).toBe("invalid_token");
    const added = await call("POST", "/marketplaces", { source: "acme/private", token: "good-token-123" });
    expect(added.status).toBe(201);
    expect(JSON.stringify(added.body)).not.toContain("good-token-123");
    expect(added.body.marketplaces[0]).toMatchObject({ name: "acme-private", hasToken: true });
    expect((await call("DELETE", "/marketplaces/acme-private/token")).body.marketplaces[0].hasToken).toBe(false);
    expect((await call("PUT", "/marketplaces/acme-private/token", { token: "good-token-123" })).body.marketplaces[0].hasToken).toBe(true);
  });
});

describe("the installation's private marketplace (Connect apps, Everyone)", () => {
  async function workspace() {
    const github = await fakeGithub();
    const dataDir = temp();
    const repo = marketplaceRepo();
    const runs: Array<{ args: string[]; env: Record<string, string> }> = [];
    const git: GitRunner = async (args, run) => {
      runs.push({ args, env: run.env });
      const header = run.env.GIT_CONFIG_VALUE_0 ?? "";
      const token = header.startsWith("AUTHORIZATION: basic ") ? Buffer.from(header.slice(21), "base64").toString().split(":")[1] : "";
      if (token !== "good-token-123") throw new BotPluginError("The git host did not let Sagax read this repository.", "repository_unreadable", 422, "connect_or_token");
      cpSync(repo, args[args.indexOf("--") + 2]!, { recursive: true });
    };
    const tokens = new MarketplaceTokens(dataDir, vaultKey());
    const marketplaces = new PluginMarketplaces({ dataDir, git, gitEnvironment: () => ({}), policy: () => undefined, inUse: () => [] });
    const store = new BotPlugins({
      dataDir, git, marketplaces, gitEnvironment: () => ({}), tokens, policy: () => undefined, credentials: () => [],
      probe: (repoName, credentials) => probeGithubRepo(repoName, credentials, { env: env(github.origin) }),
    });
    const audits: Array<Parameters<MarketplaceRouteDeps["audit"]>[1]> = [];
    const ADMIN: RequestAuth = { kind: "loopback", scopes: ["admin", "client"] };
    const MANAGER: RequestAuth = { kind: "loopback", trust: "service", scopes: ["admin", "client"] };
    const routes = [createMarketplaceRoutes({
      store: marketplaces, mayManage: () => true, actor: () => "pr_admin",
      install: async () => ({ status: 200, body: {} }), uninstall: async () => ({ status: 200, body: {} }), update: async () => ({ status: 200, body: {} }),
      audit: (_auth, row) => { audits.push(row); },
      workspace: store,
      mayManageTokens: (caller) => caller.kind === "loopback" && caller.trust !== "service",
    })];
    let caller: RequestAuth = ADMIN;
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (!await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth: caller, json, readBody })) json(res, 404, {});
    });
    servers.push(server);
    await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/marketplaces`;
    const call = async (as: RequestAuth, method: string, path: string, body?: unknown) => {
      caller = as;
      const response = await fetch(`${base}${path}`, { method, headers: { "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: response.status, body: await response.json() as Record<string, any> };
    };
    return { store, tokens, audits, runs, dataDir, call, ADMIN, MANAGER };
  }

  it("an admin adds it with a token kept for everyone, never sent back, and audited", async () => {
    const { tokens, audits, runs, dataDir, call, ADMIN, MANAGER } = await workspace();
    expect(await call(ADMIN, "POST", "", { source: "acme/private" })).toMatchObject({ status: 422, body: { code: "private_needs_token" } });
    // a manager who is not an admin may not keep a token for everyone
    expect(await call(MANAGER, "POST", "", { source: "acme/private", token: "good-token-123" })).toMatchObject({ status: 403, body: { code: "marketplace_token_admin_only" } });
    expect(tokens.sourcesFor(WORKSPACE_TOKEN_KEY).size).toBe(0);
    const added = await call(ADMIN, "POST", "", { source: "acme/private", token: "good-token-123" });
    expect(added.status).toBe(201);
    expect(JSON.stringify(added.body)).not.toContain("good-token-123");
    expect(added.body.marketplace).toMatchObject({ name: "acme-private", hasToken: true });
    expect(runs.at(-1)!.args.join(" ")).not.toContain("good-token-123");
    expect(readFileSync(join(dataDir, "marketplace-tokens.enc"), "utf8")).not.toContain("good-token-123");
    expect(tokens.get(WORKSPACE_TOKEN_KEY, "acme/private")).toBe("good-token-123");
    expect(audits.at(-1)).toEqual({ action: "marketplace.token_set", target: { kind: "marketplace", id: "acme-private", name: "acme-private" }, after: { scope: "workspace", source: "acme/private" } });
    expect(JSON.stringify(audits)).not.toContain("good-token-123");
    // refresh reads with it; the listing says a token is kept, never which
    expect((await call(MANAGER, "POST", "/acme-private/refresh")).body.marketplaces[0]).toMatchObject({ hasToken: true });
    expect(await call(MANAGER, "DELETE", "/acme-private/token")).toMatchObject({ status: 403 });
    expect(await call(ADMIN, "PUT", "/acme-private/token", { token: "two words" })).toMatchObject({ status: 400, body: { code: "invalid_token" } });
    const removed = await call(ADMIN, "DELETE", "/acme-private/token");
    expect(removed.body.marketplaces[0]).toMatchObject({ hasToken: false });
    expect(audits.at(-1)).toMatchObject({ action: "marketplace.token_remove", before: { scope: "workspace" } });
    expect(await call(ADMIN, "POST", "/acme-private/refresh")).toMatchObject({ status: 422, body: { code: "private_needs_token" } });
    const put = await call(ADMIN, "PUT", "/acme-private/token", { token: "good-token-123" });
    expect(put.body.marketplaces[0]).toMatchObject({ hasToken: true });
    expect(JSON.stringify(put.body)).not.toContain("good-token-123");
    // Remove takes the token with it
    expect((await call(ADMIN, "DELETE", "/acme-private")).status).toBe(200);
    expect(tokens.sourcesFor(WORKSPACE_TOKEN_KEY).size).toBe(0);
  });

  it("a bot without its own token reads the marketplace with everyone's, and keeps none of its own", async () => {
    const { store, tokens, call, ADMIN } = await workspace();
    await call(ADMIN, "POST", "", { source: "acme/private", token: "good-token-123" });
    await store.updateMarketplace("bot-1", "acme-private", "pr_member");
    expect(store.listMarketplaces("bot-1")[0]).toMatchObject({ name: "acme-private", hasToken: false });
    expect(tokens.sourcesFor("bot-1").size).toBe(0);
    store.forgetBot("bot-1");
    expect(tokens.get(WORKSPACE_TOKEN_KEY, "acme/private")).toBe("good-token-123");
  });
});

describe("a bot's own plugins in its turns", () => {
  it("lists the installed plugin's skills, commands and agents for an engine other than Claude, never its hooks", async () => {
    const { store } = await plugins({ person: "good-token-123" });
    await store.addMarketplace("bot-1", { source: "acme/private" }, "pr_a");
    await store.install("bot-1", { marketplace: "acme-private", plugin: "reviewer" }, "pr_a");
    const dirs = store.pluginDirs("bot-1");
    expect(dirs).toHaveLength(1);
    const files = pluginTurnFiles(dirs);
    expect(files.map((file) => [file.kind, file.name])).toEqual([["skill", "review"], ["command", "ship"], ["agent", "critic"]]);
    const prompt = pluginTurnPrompt({ driverKind: "codex", integrationsOff: false, files });
    expect(prompt).toContain("agent critic: A strict code critic.");
    expect(prompt).toContain("skill review: Review code.");
    expect(prompt).not.toContain("hooks");
    // Claude loads the folder itself (--plugin-dir); another bot has none
    expect(pluginTurnPrompt({ driverKind: "claudeAgent", integrationsOff: false, files })).toBe("");
    expect(store.pluginDirs("bot-2")).toEqual([]);
  });
});
