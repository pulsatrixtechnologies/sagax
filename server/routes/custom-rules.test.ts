import { mkdtempSync, rmSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { CustomRuleStore } from "../custom-rules-store.ts";
import { json, readBody } from "../harness/http.ts";
import { requiredScope, type RequestAuth } from "../auth/request-auth.ts";
import { createCustomRuleRoutes } from "./custom-rules.ts";
import { dispatchRoutes } from "./table.ts";
import type { CustomRule, CustomRuleBinding, RuleProduct, TurnStart } from "../../shared/custom-rules.ts";

const servers: Server[] = [];
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

interface Options {
  /** who the request is; null is a bot or a local service */
  person: string | null;
  card?: (personId: string, card: { threadId: string; requestId: string }, rule: CustomRule) => "covered" | "not-covered" | null;
  binding?: (personId: string, card: { threadId: string; requestId: string }) => CustomRuleBinding | null | undefined;
  products?: (personId: string, botId: string | null) => RuleProduct[];
  turnStart?: (threadId: string) => TurnStart;
}

async function serve(options: Options) {
  const dir = mkdtempSync(join(tmpdir(), "sagax-custom-rules-"));
  dirs.push(dir);
  const file = join(dir, "custom-approval-rules.json");
  const store = new CustomRuleStore(file);
  const audits: string[] = [];
  const routes = [createCustomRuleRoutes({
    store,
    manager: () => options.person,
    ownedBots: (person) => person === "owner" ? [{ id: "bot-a", name: "Alpha" }, { id: "bot-b", name: "Beta" }] : [{ id: "bot-z", name: "Zed" }],
    ...(options.card ? { fromCard: options.card } : {}),
    ...(options.binding ? { bindingFor: options.binding } : {}),
    ...(options.products ? { products: options.products } : {}),
    ...(options.turnStart ? { turnStart: options.turnStart } : {}),
    audit: (row) => audits.push(row.action),
    home: "/Users/example",
  })];
  const auth: RequestAuth = { kind: "loopback", scopes: ["admin", "client"] } as RequestAuth;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json, readBody })) json(res, 404, {});
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/custom-rules`;
  const call = async (path: string, method = "GET", body?: unknown) => {
    const response = await fetch(`${base}${path}`, { method, ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() as any };
  };
  return { call, store, file, audits };
}

describe("custom rules routes", () => {
  it("names a product only as the bot's servers declare it, and pins it on the saved rule (#1220)", async () => {
    let declared: RuleProduct[] = [{ id: "acme_desk", name: "Acme Desk" }, { id: "example_chat" }];
    const { call, store } = await serve({ person: "owner", products: (_person, botId) => (botId === "bot-a" ? declared : []) });
    const listed = await call("?botId=bot-a");
    expect(listed.body.products).toEqual([{ id: "acme_desk", name: "Acme Desk" }, { id: "example_chat" }]);
    const saved = await call("", "POST", { text: "ne jamais écrire dans Acme Desk", botId: "bot-a" });
    expect(saved.body.rule).toMatchObject({ behavior: "deny", products: ["acme_desk"] });
    expect(saved.body.rule.compiled).toMatchObject({ recognized: true, products: ["acme_desk"] });
    // the product is no longer declared: the rule keeps it
    declared = [];
    expect((await call("?botId=bot-a")).body.rules[0].compiled.products).toEqual(["acme_desk"]);
    // new words with nothing declared keep the pins; with a declaration, they name their own
    await call(`/${saved.body.rule.id}`, "PATCH", { when: "écrire dans Acme Desk ou ailleurs" });
    expect(store.get("owner", saved.body.rule.id)?.products).toEqual(["acme_desk"]);
    declared = [{ id: "example_chat" }];
    await call(`/${saved.body.rule.id}`, "PATCH", { when: "écrire avec example chat" });
    expect(store.get("owner", saved.body.rule.id)?.products).toEqual(["example_chat"]);
    // a rule for every bot reads every bot's products; none declared, no pin
    const all = await call("", "POST", { text: "ne jamais écrire dans Acme Desk", botId: null });
    expect(all.body.rule.products).toBeUndefined();
  });

  it("are a client session's own routes, and never a bot's", async () => {
    expect(requiredScope("GET", "/api/custom-rules")).toBe("client");
    expect(requiredScope("POST", "/api/custom-rules")).toBe("client");
    expect(requiredScope("PATCH", "/api/custom-rules/crule_x")).toBe("client");
    const bot = await serve({ person: null });
    expect((await bot.call("", "POST", { when: "la lecture de fichiers", behavior: "allow", botId: null })).status).toBe(403);
    expect((await bot.call("")).status).toBe(403);
  });

  it("saves a sentence with its behavior, lists it for a bot, edits and removes it", async () => {
    const { call, file, audits } = await serve({ person: "owner" });
    const saved = await call("", "POST", { text: "toujours permettre la lecture de fichiers dans ~/Documents", botId: "bot-a" });
    expect(saved.status).toBe(201);
    expect(saved.body.rule).toMatchObject({ behavior: "allow", when: "la lecture de fichiers dans ~/Documents", botId: "bot-a", riskScope: [], enabled: true });
    expect(saved.body.rule.compiled).toMatchObject({ recognized: true, actions: ["read"], paths: ["~/Documents"] });
    // Windows has no Unix mode bits (Node reports 0o666)
    if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600);

    const ask = await call("", "POST", { text: "jamais d'envoi de courriel sans moi", botId: null });
    expect(ask.body.rule).toMatchObject({ behavior: "ask", when: "envoi de courriel", botId: null });

    // a rule for bot-b is not listed for bot-a; a rule for all bots is
    await call("", "POST", { when: "les paiements", behavior: "deny", botId: "bot-b" });
    const forA = await call("?botId=bot-a");
    expect(forA.body.rules.map((rule: CustomRule) => rule.when)).toEqual(["la lecture de fichiers dans ~/Documents", "envoi de courriel"]);
    expect((await call("?botId=bot-z")).status).toBe(404);

    const id = saved.body.rule.id as string;
    const patched = await call(`/${id}`, "PATCH", { behavior: "ask", riskScope: ["external-send"], enabled: false });
    // only an allow keeps a risk scope
    expect(patched.body.rule).toMatchObject({ behavior: "ask", riskScope: [], enabled: false });
    expect((await call(`/${id}`, "DELETE")).status).toBe(200);
    expect((await call(`/${id}`, "DELETE")).status).toBe(404);
    expect(audits).toEqual(["custom_rule.add", "custom_rule.add", "custom_rule.add", "custom_rule.update", "custom_rule.remove"]);
  });

  it("refuses another person's bot, an unknown risk kind, and empty words", async () => {
    const { call } = await serve({ person: "owner" });
    expect((await call("", "POST", { when: "x", behavior: "allow", botId: "bot-z" })).status).toBe(400);
    expect((await call("", "POST", { when: "la lecture", behavior: "allow", botId: null, riskScope: ["everything"] })).status).toBe(400);
    expect((await call("", "POST", { when: "   ", behavior: "allow", botId: null })).status).toBe(400);
    expect((await call("", "POST", { when: "la lecture", behavior: "maybe", botId: null })).status).toBe(400);
  });

  it("refuses a shell family allow, and accepts it as a deny or an exact command", async () => {
    const { call } = await serve({ person: "owner" });
    const refused = await call("", "POST", { when: "exécuter des commandes", behavior: "allow", botId: null });
    expect(refused.status).toBe(400);
    expect(refused.body.code).toBe("shell_family_allow");
    expect((await call("", "POST", { when: "exécuter des commandes", behavior: "deny", botId: null })).status).toBe(201);
    // an exact command is allowed only from its card
    const outside = await call("", "POST", { when: "la commande exacte `git status`", behavior: "allow", botId: null });
    expect(outside.status).toBe(400);
    expect(outside.body.code).toBe("exact_command_from_card");
    expect((await call("", "POST", { when: "la commande exacte `git status`", behavior: "deny", botId: null })).status).toBe(201);
    const ask = await call("", "POST", { when: "exécuter des commandes dans ~/Documents", behavior: "ask", botId: null });
    expect((await call(`/${ask.body.rule.id}`, "PATCH", { behavior: "allow" })).body.code).toBe("shell_family_allow");
  });

  it("final review: an exact command is bound to its card's bot and launch folder, and its bot never changes", async () => {
    const withCwd: CustomRuleBinding = { tool: "bash", command: "npm test", cwd: "/Users/example/proj", botId: "bot-a" };
    const { call } = await serve({ person: "owner", card: () => "covered", binding: (_person, card) => card.requestId === "no-cwd" ? { tool: "bash", command: "npm test", botId: "bot-a" } : withCwd });
    const exact = { when: "la commande exacte `npm test`", behavior: "allow", fromCard: { threadId: "t1", requestId: "r1" } };
    const allBots = await call("", "POST", { ...exact, botId: null });
    expect(allBots.body.code).toBe("exact_command_one_bot");
    const otherBot = await call("", "POST", { ...exact, botId: "bot-b" });
    expect(otherBot.body.code).toBe("exact_command_one_bot");
    const noCwd = await call("", "POST", { ...exact, botId: "bot-a", fromCard: { threadId: "t1", requestId: "no-cwd" } });
    expect(noCwd.status).toBe(409);
    expect(noCwd.body.code).toBe("exact_command_no_cwd");
    const saved = await call("", "POST", { ...exact, botId: "bot-a" });
    expect(saved.status).toBe(201);
    expect(saved.body.rule.binding).toEqual(withCwd);
    const moved = await call(`/${saved.body.rule.id}`, "PATCH", { botId: "bot-b" });
    expect(moved.body.code).toBe("exact_command_one_bot");
    expect((await call(`/${saved.body.rule.id}`, "PATCH", { botId: null })).body.code).toBe("exact_command_one_bot");
  });

  it("final review: a card refusal never changes or removes a rule the person already had", async () => {
    const { call, store } = await serve({ person: "owner", card: () => "not-covered" });
    const existing = store.add({ ownerId: "owner", botId: "bot-a", when: "l'envoi de courriels", behavior: "ask" });
    const refused = await call("", "POST", { when: "l'envoi de courriels", behavior: "allow", botId: "bot-a", fromCard: { threadId: "t1", requestId: "r1" } });
    expect(refused.status).toBe(409);
    expect(store.rulesOf("owner")).toEqual([existing]);
  });

  it("one person never reads or edits another person's rules", async () => {
    const owner = await serve({ person: "owner" });
    const saved = await owner.call("", "POST", { when: "la lecture de fichiers", behavior: "allow", botId: null });
    const other = await serve({ person: "zed" });
    // a separate store per server: copy the rule across to prove ownership filtering
    other.store.add({ ownerId: "owner", botId: null, when: "la lecture de fichiers", behavior: "allow" });
    expect((await other.call("")).body.rules).toEqual([]);
    expect((await other.call(`/${saved.body.rule.id}`, "PATCH", { behavior: "deny" })).status).toBe(404);
  });

  it("a rule made from a card is kept only when it covers that card", async () => {
    const decided: string[] = [];
    const { call, store } = await serve({
      person: "owner",
      card: (_person, card, rule) => {
        decided.push(`${card.requestId}:${rule.when}`);
        if (card.requestId === "gone") return null;
        return rule.riskScope.includes("external-send") ? "covered" : "not-covered";
      },
    });
    const refused = await call("", "POST", { when: "l'envoi de courriels", behavior: "allow", botId: "bot-a", fromCard: { threadId: "t1", requestId: "r1" } });
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe("rule_not_covering");
    expect(store.rulesOf("owner")).toEqual([]);
    const missing = await call("", "POST", { when: "l'envoi de courriels", behavior: "allow", botId: "bot-a", fromCard: { threadId: "t1", requestId: "gone" } });
    expect(missing.status).toBe(404);
    const kept = await call("", "POST", { when: "l'envoi de courriels", behavior: "allow", botId: "bot-a", riskScope: ["external-send"], fromCard: { threadId: "t1", requestId: "r1" } });
    expect(kept.status).toBe(201);
    expect(store.rulesOf("owner")).toHaveLength(1);
    expect(decided).toHaveLength(3);
  });

  it("saves who started the turn, and a send allowed from a routine card names the routine", async () => {
    const { call } = await serve({ person: "owner" });
    const saved = await call("", "POST", { when: "l'envoi de courriels", behavior: "ask", botId: null, startedBy: "delegation" });
    expect(saved.status).toBe(201);
    expect(saved.body.rule.startedBy).toBe("delegation");
    expect((await call("", "POST", { when: "la lecture de fichiers", behavior: "allow", botId: null, startedBy: "admin" })).status).toBe(400);
    const cleared = await call(`/${saved.body.rule.id}`, "PATCH", { startedBy: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.rule.startedBy).toBeUndefined();
    const stamped = await serve({ person: "owner", turnStart: () => "routine", card: () => "covered" });
    const send = await stamped.call("", "POST", { when: "l'envoi de courriels", behavior: "allow", botId: "bot-a", riskScope: ["external-send"], fromCard: { threadId: "t1", requestId: "r1" } });
    expect(send.status).toBe(201);
    expect(send.body.rule.startedBy).toBe("routine");
    const read = await stamped.call("", "POST", { when: "la lecture de fichiers", behavior: "allow", botId: "bot-a", fromCard: { threadId: "t1", requestId: "r2" } });
    expect(read.status).toBe(201);
    expect(read.body.rule.startedBy).toBeUndefined();
  });
});
