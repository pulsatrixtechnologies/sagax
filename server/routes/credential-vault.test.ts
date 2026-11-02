import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { botVaultPrincipal, vaultHandle } from "../../shared/credential-vault.ts";
import type { SecretRequestCardData } from "../../shared/wire.ts";
import { CredentialVault, LOCAL_VAULT_PRINCIPAL } from "../credential-vault.ts";
import { json, readBody } from "../harness/http.ts";
import { OnePassword } from "../onepassword.ts";
import { requiredScope, type RequestAuth } from "../request-auth.ts";
import { TOOL_POLICY_ROWS } from "../tool-policy.generated.ts";
import { createCredentialVaultRoutes, vaultPrincipalFor, vaultRequestCard } from "./credential-vault.ts";
import { createCredentialVaultInternalRoutes } from "./credential-vault-internal.ts";
import { dispatchInternalRoutes } from "./internal-route.ts";
import { dispatchRoutes } from "./table.ts";

// Fake values only.
const FAKE_PASSWORD = "fake-route-Pa55word";
const FAKE_SEED = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

const cleanups: Array<() => unknown> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function serve(options: {
  principal?: string | null;
  exportGate?: Parameters<typeof createCredentialVaultRoutes>[0]["exportGate"];
  importGate?: Parameters<typeof createCredentialVaultRoutes>[0]["importGate"];
  exportBlocked?: () => boolean;
  browser?: Parameters<typeof createCredentialVaultRoutes>[0]["browser"];
  purchaseStepUp?: Parameters<typeof createCredentialVaultRoutes>[0]["purchaseStepUp"];
  resumeFails?: boolean;
  onePassword?: OnePassword;
} = {}) {
  const dir = mkdtempSync(join(tmpdir(), "sagax-vault-routes-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const vault = new CredentialVault(dir, () => ({ kind: "key", key: Buffer.alloc(32, 5) }));
  const cards = new Map<string, SecretRequestCardData>();
  const resumed: Array<{ messageId: string; outcome: string; prompt: string }> = [];
  const audits: Array<{ action: string; detail: Record<string, unknown> }> = [];
  const routes = [createCredentialVaultRoutes({
    vault,
    audit: (action, _auth, detail) => { audits.push({ action, detail }); },
    ...(options.exportGate ? { exportGate: options.exportGate } : {}),
    ...(options.importGate ? { importGate: options.importGate } : {}),
    ...(options.exportBlocked ? { exportBlocked: options.exportBlocked } : {}),
    ...(options.browser ? { browser: options.browser } : {}),
    ...(options.purchaseStepUp ? { purchaseStepUp: options.purchaseStepUp } : {}),
    onePassword: options.onePassword ?? new OnePassword({ env: {}, exec: async () => { throw new Error("absent"); }, organization: () => false }),
    principal: () => options.principal === undefined ? LOCAL_VAULT_PRINCIPAL : options.principal,
    botExists: (id) => id === "bot-a",
    cards: {
      find: (_botId, threadId, messageId) => cards.get(`${threadId}:${messageId}`) ?? null,
      patch: (_botId, threadId, messageId, secret) => { cards.set(`${threadId}:${messageId}`, secret); },
      resume: (_botId, threadId, messageId, outcome, prompt) => {
        if (options.resumeFails) return false;
        const card = cards.get(`${threadId}:${messageId}`)!;
        cards.set(`${threadId}:${messageId}`, { ...card, ...(outcome === "provided" ? { provided: true } : { dismissed: true }), resumed: true });
        resumed.push({ messageId, outcome, prompt });
        return true;
      },
    },
  })];
  const auth: RequestAuth = { kind: "loopback", scopes: ["admin", "client"] };
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const handled = await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json, readBody });
    if (!handled) json(res, 404, { from: "inline" });
  });
  cleanups.push(() => new Promise((done) => server.close(done)));
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(base + path, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await response.text();
    return { status: response.status, text, body: text ? JSON.parse(text) : null };
  };
  return { vault, cards, resumed, audits, call };
}

const login = { kind: "login", name: "Example", username: "ada.fake@example.test", password: FAKE_PASSWORD, totpSeed: FAKE_SEED, domains: ["example.test"], notes: "fake private note" };

describe("credential vault routes", () => {
  it("creates, lists, edits and deletes without ever answering a value", async () => {
    const { call } = await serve();
    const created = await call("POST", "/api/me/credentials", login);
    expect(created.status).toBe(201);
    const id = created.body.item.id as string;
    const listed = await call("POST", "/api/me/credentials/list", {});
    expect(listed.body.items).toHaveLength(1);
    expect(listed.body.onePassword).toEqual({ available: false, reason: "absent" });
    const patched = await call("PATCH", `/api/me/credentials/${id}`, { name: "Renamed" });
    expect(patched.body.item).toMatchObject({ name: "Renamed", hasPassword: true, hasTotp: true });
    for (const answer of [created, listed, patched]) {
      expect(answer.text).not.toContain(FAKE_PASSWORD);
      expect(answer.text).not.toContain(FAKE_SEED);
      expect(answer.text).not.toContain("fake private note");
    }
    // Reads are POSTs: a loopback GET (any local process) gets nothing.
    expect((await call("GET", "/api/me/credentials/list")).status).toBe(405);
    expect((await call("GET", `/api/me/credentials/${id}/notes`)).status).toBe(405);
    expect((await call("POST", `/api/me/credentials/${id}/notes`, {})).body).toEqual({ notes: "fake private note" });
    expect((await call("DELETE", `/api/me/credentials/${id}`)).status).toBe(200);
    expect((await call("POST", "/api/me/credentials/list", {})).body.items).toEqual([]);
  });

  it("allows a bot always from Settings, refuses a once grant there, and revokes", async () => {
    const { call } = await serve();
    const id = (await call("POST", "/api/me/credentials", login)).body.item.id as string;
    expect((await call("POST", `/api/me/credentials/${id}/grants`, { botId: "bot-x", mode: "always" })).status).toBe(404);
    expect((await call("POST", `/api/me/credentials/${id}/grants`, { botId: "bot-a", mode: "once" })).status).toBe(400);
    const allowed = await call("POST", `/api/me/credentials/${id}/grants`, { botId: "bot-a", mode: "always" });
    expect(allowed.body.item.grants).toMatchObject([{ botId: "bot-a", mode: "always" }]);
    const revoked = await call("DELETE", `/api/me/credentials/${id}/grants/bot-a`);
    expect(revoked.body.item.grants).toEqual([]);
  });

  it("answers a request card once or always, only for the person it was made for", async () => {
    const { call, cards, resumed, vault } = await serve();
    const id = (await call("POST", "/api/me/credentials", login)).body.item.id as string;
    cards.set("t1:m1", vaultRequestCard({ principalId: LOCAL_VAULT_PRINCIPAL, botName: "Ada", domain: "example.test" }));
    cards.set("t1:m2", vaultRequestCard({ principalId: "pr_someone_else", botName: "Ada", domain: "example.test" }));
    expect((await call("POST", "/api/bots/bot-a/vault-cards/m2/grant", { threadId: "t1", itemId: id, mode: "always" })).status).toBe(403);
    const once = await call("POST", "/api/bots/bot-a/vault-cards/m1/grant", { threadId: "t1", itemId: id, mode: "once" });
    expect(once.status).toBe(200);
    expect(vault.granted(LOCAL_VAULT_PRINCIPAL, id, "bot-a", "t1")).toBe(true);
    expect(vault.granted(LOCAL_VAULT_PRINCIPAL, id, "bot-a", "t2")).toBe(false);
    expect(resumed).toHaveLength(1);
    // The bot is told the handle and the fields, never a value.
    expect(resumed[0]!.prompt).toContain(vaultHandle(id));
    expect(resumed[0]!.prompt).toContain("password");
    expect(resumed[0]!.prompt).not.toContain(FAKE_PASSWORD);
    expect(cards.get("t1:m1")).toMatchObject({ provided: true, vault: { itemId: id, mode: "once" } });
    // An answered card cannot be answered again.
    expect((await call("POST", "/api/bots/bot-a/vault-cards/m1/grant", { threadId: "t1", itemId: id, mode: "always" })).status).toBe(409);

    // A new login saved from a card, allowed always.
    cards.set("t1:m3", vaultRequestCard({ principalId: LOCAL_VAULT_PRINCIPAL, botName: "Ada", domain: "other.test" }));
    const saved = await call("POST", "/api/bots/bot-a/vault-cards/m3/grant", { threadId: "t1", mode: "always", item: { kind: "login", name: "Other", password: FAKE_PASSWORD, domains: ["other.test"] } });
    expect(saved.status).toBe(200);
    expect(saved.text).not.toContain(FAKE_PASSWORD);
    expect(vault.granted(LOCAL_VAULT_PRINCIPAL, saved.body.item.id, "bot-a", "t9")).toBe(true);

    cards.set("t1:m4", vaultRequestCard({ principalId: LOCAL_VAULT_PRINCIPAL, botName: "Ada", domain: "x.test" }));
    expect((await call("POST", "/api/bots/bot-a/vault-cards/m4/dismiss", { threadId: "t1" })).body).toEqual({ dismissed: true });
    expect(resumed.at(-1)).toMatchObject({ outcome: "dismissed" });
  });

  it("lends a login typed on the card for this turn only, never saved (2026-10-29)", async () => {
    const { call, cards, resumed, vault, audits } = await serve();
    cards.set("t1:l1", vaultRequestCard({ principalId: LOCAL_VAULT_PRINCIPAL, botName: "Ada", domain: "example.test" }));
    const item = { kind: "login", name: "example.test", username: "ada", password: FAKE_PASSWORD, domains: ["example.test"] };
    expect((await call("POST", "/api/bots/bot-a/vault-cards/l1/grant", { threadId: "t1", mode: "always", item, turnOnly: true })).status).toBe(400);
    const lent = await call("POST", "/api/bots/bot-a/vault-cards/l1/grant", { threadId: "t1", mode: "once", item, turnOnly: true });
    expect(lent.status).toBe(200);
    expect(lent.text).not.toContain(FAKE_PASSWORD);
    expect(vault.list(LOCAL_VAULT_PRINCIPAL)).toEqual([]);
    const id = lent.body.item.id as string;
    expect(vault.granted(LOCAL_VAULT_PRINCIPAL, id, "bot-a", "t1")).toBe(true);
    expect(resumed.at(-1)!.prompt).toContain("for this turn only");
    expect(resumed.at(-1)!.prompt).not.toContain(FAKE_PASSWORD);
    expect(cards.get("t1:l1")).toMatchObject({ provided: true, vault: { turnOnly: true, mode: "once" } });
    expect(audits.at(-1)).toMatchObject({ action: "credentials.grant", detail: { mode: "turn" } });
    vault.turnPhase("t1", "started");
    vault.turnPhase("t1", "ended");
    expect(vault.granted(LOCAL_VAULT_PRINCIPAL, id, "bot-a", "t1")).toBe(false);
  });

  it("adds the asked site to a login only when the person ticks it, with Always, for another address of its own site (port of OpenMausBot #2929's card save target)", async () => {
    const { call, cards, vault, audits, resumed } = await serve();
    const id = (await call("POST", "/api/me/credentials", login)).body.item.id as string;
    const card = (key: string, domain: string) => cards.set(`t1:${key}`, vaultRequestCard({ principalId: LOCAL_VAULT_PRINCIPAL, botName: "Ada", domain }));
    // Not ticked: the login keeps its sites, the bot is allowed, its fill there will be refused.
    card("s1", "accounts.example.test");
    expect((await call("POST", "/api/bots/bot-a/vault-cards/s1/grant", { threadId: "t1", itemId: id, mode: "once" })).status).toBe(200);
    expect(vault.item(LOCAL_VAULT_PRINCIPAL, id)!.domains).toEqual(["example.test"]);
    // Ticked with a one-time grant: refused, nothing is added for good.
    card("s2", "accounts.example.test");
    expect((await call("POST", "/api/bots/bot-a/vault-cards/s2/grant", { threadId: "t1", itemId: id, mode: "once", addSite: true })).body).toMatchObject({ code: "add_site_once" });
    // A look-alike, a wildcard, a shared hosting name: never added, whatever the card says.
    for (const domain of ["examp1e.test", "example.test.evil.test", "*.example.test", "evil.github.io"]) {
      cards.set("t1:bad", { ...vaultRequestCard({ principalId: LOCAL_VAULT_PRINCIPAL, botName: "Ada", domain: "x.test" }), vault: { principalId: LOCAL_VAULT_PRINCIPAL, domain } });
      const refused = await call("POST", "/api/bots/bot-a/vault-cards/bad/grant", { threadId: "t1", itemId: id, mode: "always", addSite: true });
      expect(refused.status, domain).toBe(400);
    }
    expect(vault.item(LOCAL_VAULT_PRINCIPAL, id)!.domains).toEqual(["example.test"]);
    // Ticked with Always on another address of the same site: added, audited without the site.
    card("s3", "accounts.example.test");
    const added = await call("POST", "/api/bots/bot-a/vault-cards/s3/grant", { threadId: "t1", itemId: id, mode: "always", addSite: true });
    expect(added.status).toBe(200);
    expect(vault.item(LOCAL_VAULT_PRINCIPAL, id)!.domains).toEqual(["example.test", "accounts.example.test"]);
    expect(audits.at(-1)).toMatchObject({ action: "credentials.grant", detail: { addedSite: true } });
    expect(JSON.stringify(audits)).not.toContain("accounts.example.test");
    expect(resumed.at(-1)!.prompt).toContain("accounts.example.test");
    expect(JSON.stringify(resumed)).not.toContain(FAKE_PASSWORD);
    // A card that names no site, or a new login, has nothing to add.
    cards.set("t1:s4", vaultRequestCard({ principalId: LOCAL_VAULT_PRINCIPAL, botName: "Ada", name: "Example" }));
    expect((await call("POST", "/api/bots/bot-a/vault-cards/s4/grant", { threadId: "t1", itemId: id, mode: "always", addSite: true })).status).toBe(400);
    card("s5", "login.example.test");
    expect((await call("POST", "/api/bots/bot-a/vault-cards/s5/grant", { threadId: "t1", mode: "always", addSite: true, item: { kind: "login", name: "N", password: FAKE_PASSWORD, domains: ["example.test"] } })).status).toBe(400);
  });

  it("lets the person sign in themselves: the browser is armed first, emptied at Done, and the bot resumes with no handle and no value", async () => {
    const calls: string[] = [];
    let armRefusal: string | null = "A bot ran a script in this browser";
    let clearRefusal: string | null = "Give the browser back to the bot";
    let armed = false;
    const browser = {
      armForPerson: async (botId: string, threadId: string) => { calls.push(`arm:${botId}:${threadId}`); if (!armRefusal) armed = true; return armRefusal; },
      clearAfterPerson: async (botId: string, threadId: string) => { calls.push(`clear:${botId}:${threadId}`); return clearRefusal; },
      armedForPerson: async () => armed,
      endForPerson: async (botId: string, threadId: string) => { calls.push(`end:${botId}:${threadId}`); armed = false; },
    };
    const { call, cards, resumed, vault, audits } = await serve({ browser });
    const id = (await call("POST", "/api/me/credentials", login)).body.item.id as string;
    cards.set("t1:p1", vaultRequestCard({ principalId: LOCAL_VAULT_PRINCIPAL, botName: "Ada", domain: "example.test" }));
    cards.set("t1:p2", vaultRequestCard({ principalId: "pr_someone_else", botName: "Ada", domain: "example.test" }));
    expect((await call("POST", "/api/bots/bot-a/vault-cards/p2/self-start", { threadId: "t1" })).status).toBe(403);
    expect((await call("POST", "/api/bots/bot-a/vault-cards/p2/signed-in", { threadId: "t1" })).status).toBe(403);
    // Done before the browser was armed: refused, nothing settles.
    expect((await call("POST", "/api/bots/bot-a/vault-cards/p1/signed-in", { threadId: "t1" })).body).toMatchObject({ code: "not_armed" });
    // A browser where a bot ran a script is refused until it restarts.
    expect((await call("POST", "/api/bots/bot-a/vault-cards/p1/self-start", { threadId: "t1" })).body).toMatchObject({ code: "browser_not_clean" });
    armRefusal = null;
    expect((await call("POST", "/api/bots/bot-a/vault-cards/p1/self-start", { threadId: "t1" })).body).toEqual({ armed: true });
    expect((await call("POST", "/api/bots/bot-a/vault-cards/p1/self-status", { threadId: "t1" })).body).toEqual({ armed: true });
    // Done while the person still holds the browser: nothing settles.
    expect((await call("POST", "/api/bots/bot-a/vault-cards/p1/signed-in", { threadId: "t1" })).body).toMatchObject({ code: "browser_busy" });
    expect(resumed).toHaveLength(0);
    clearRefusal = null;
    expect((await call("POST", "/api/bots/bot-a/vault-cards/p1/signed-in", { threadId: "t1" })).body).toEqual({ signedIn: true });
    expect(calls).toEqual(["arm:bot-a:t1", "arm:bot-a:t1", "clear:bot-a:t1", "clear:bot-a:t1", "end:bot-a:t1"]);
    expect(cards.get("t1:p1")).toMatchObject({ dismissed: true, resumed: true, vault: { signedInSelf: true } });
    expect(resumed.at(-1)!.prompt).toContain("signed in to example.test themselves");
    expect(resumed.at(-1)!.prompt).not.toContain("cred_");
    expect(audits.at(-1)).toEqual({ action: "credentials.signed_in", detail: { botId: "bot-a" } });
    expect(vault.granted(LOCAL_VAULT_PRINCIPAL, id, "bot-a", "t1")).toBe(false);
    expect((await call("POST", "/api/bots/bot-a/vault-cards/p1/signed-in", { threadId: "t1" })).status).toBe(409);
  });

  it("ends a person's own sign-in when a login is granted from the card instead", async () => {
    const ended: string[] = [];
    const { call, cards } = await serve({ browser: { armForPerson: async () => null, clearAfterPerson: async () => null, armedForPerson: async () => true, endForPerson: async (botId, threadId) => { ended.push(`${botId}:${threadId}`); } } });
    const id = (await call("POST", "/api/me/credentials", login)).body.item.id as string;
    cards.set("t1:g1", vaultRequestCard({ principalId: LOCAL_VAULT_PRINCIPAL, botName: "Ada", domain: "example.test" }));
    expect((await call("POST", "/api/bots/bot-a/vault-cards/g1/self-start", { threadId: "t1" })).status).toBe(200);
    expect((await call("POST", "/api/bots/bot-a/vault-cards/g1/grant", { threadId: "t1", itemId: id, mode: "once" })).status).toBe(200);
    expect(ended).toEqual(["bot-a:t1"]);
  });

  it("marks a card signed in only once the bot was resumed, and refuses without a browser", async () => {
    const failing = await serve({ resumeFails: true, browser: { armForPerson: async () => null, clearAfterPerson: async () => null, armedForPerson: async () => true, endForPerson: async () => {} } });
    failing.cards.set("t1:q1", vaultRequestCard({ principalId: LOCAL_VAULT_PRINCIPAL, botName: "Ada", domain: "example.test" }));
    expect((await failing.call("POST", "/api/bots/bot-a/vault-cards/q1/signed-in", { threadId: "t1" })).status).toBe(409);
    expect(failing.cards.get("t1:q1")!.vault!.signedInSelf).toBeUndefined();
    expect(failing.audits.some((row) => row.action === "credentials.signed_in")).toBe(false);
    const none = await serve();
    none.cards.set("t1:q2", vaultRequestCard({ principalId: LOCAL_VAULT_PRINCIPAL, botName: "Ada", domain: "example.test" }));
    expect((await none.call("POST", "/api/bots/bot-a/vault-cards/q2/self-start", { threadId: "t1" })).body).toMatchObject({ code: "no_browser" });
  });

  it("connects Shop Pay or Link without echoing a number, on the person's own route", async () => {
    const { call, audits } = await serve();
    const pan = "4242424242424242";
    expect((await call("POST", "/api/me/credentials/wallets", { wallet: "other_wallet", chosen: true })).status).toBe(400);
    const linked = await call("POST", "/api/me/credentials/wallets", { wallet: "link", chosen: true, pan, note: pan });
    expect(linked.status).toBe(200);
    expect(linked.text).not.toContain(pan);
    expect(linked.body.wallets.link).toMatchObject({ chosen: true, ready: false });
    expect(linked.body.wallets.shop_pay.chosen).toBe(false);
    expect(linked.body.wallets.link.missing).toContain("link-cli spend-request create");
    expect(JSON.stringify(audits)).not.toContain(pan);
    expect(audits.at(-1)).toEqual({ action: "credentials.wallet", detail: { wallet: "link", chosen: true } });
    const listed = await call("POST", "/api/me/credentials/list", {});
    expect(listed.text).not.toContain(pan);
    expect(listed.body.wallets.link.chosen).toBe(true);
    expect(requiredScope("POST", "/api/me/credentials/wallets")).toBe("client");
  });

  it("refuses a caller with no person, and keeps the routes member scope and off for agents", async () => {
    const { call } = await serve({ principal: null });
    expect((await call("POST", "/api/me/credentials/list", {})).status).toBe(403);
    for (const [method, path] of [["POST", "/api/me/credentials/list"], ["POST", "/api/me/credentials"], ["POST", "/api/me/credentials/wallets"], ["PATCH", "/api/me/credentials/abcdef012345"], ["POST", "/api/bots/b1/vault-cards/m1/grant"]] as const) {
      expect(requiredScope(method, path), `${method} ${path}`).toBe("client");
    }
    expect(requiredScope("GET", "/api/me/credentials/list")).toBe("admin");
    // No agent tool may grant itself a login or read the vault.
    const rows = TOOL_POLICY_ROWS.filter((row) => row.route.includes("credentials") && row.route.includes("/api/me") || row.route.includes("vault-cards"));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row).toMatchObject({ tier: "admin", defaultEnabled: false });
  });
});

describe("whose vault a request reads", () => {
  const loopback: RequestAuth = { kind: "loopback", scopes: ["admin", "client"] };
  const service: RequestAuth = { kind: "loopback", scopes: ["client"], trust: "service" };
  const session = (principalId?: string) => ({ kind: "session", via: "cookie", scopes: ["client"], session: { id: "s1", ...(principalId ? { principalId } : {}) } }) as unknown as RequestAuth;
  const solo = { organization: false, desktop: false, loopbackOptIn: false, localPrincipal: "local" };
  it("never maps a person onto the team vault namespace", () => {
    const org = { ...solo, organization: true };
    expect(vaultPrincipalFor(session("bot:payroll"), org)).toBeNull();
    expect(vaultPrincipalFor(session("pr_a"), org)).toBe("pr_a");
  });
  it("answers loopback only on the desktop or with the operator's opt-in, never a service caller", () => {
    expect(vaultPrincipalFor(loopback, solo)).toBeNull();
    expect(vaultPrincipalFor(loopback, { ...solo, desktop: true })).toBe("local");
    expect(vaultPrincipalFor(loopback, { ...solo, loopbackOptIn: true })).toBe("local");
    expect(vaultPrincipalFor(service, { ...solo, desktop: true, loopbackOptIn: true })).toBeNull();
    expect(vaultPrincipalFor(session(), solo)).toBe("local");
  });
  it("on an organization server, answers the signed-in person only", () => {
    const org = { ...solo, organization: true, desktop: true, loopbackOptIn: true };
    expect(vaultPrincipalFor(loopback, org)).toBeNull();
    expect(vaultPrincipalFor(session("PR_Alice"), org)).toBe("pr_alice");
    expect(vaultPrincipalFor(session(), org)).toBeNull();
  });
});

describe("request_login internal route", () => {
  it("returns a granted handle at once, or posts a card", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-vault-internal-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const vault = new CredentialVault(dir, () => ({ kind: "key", key: Buffer.alloc(32, 6) }));
    const item = vault.create(LOCAL_VAULT_PRINCIPAL, login);
    const posted: SecretRequestCardData[] = [];
    const ended: string[] = [];
    const routes = [createCredentialVaultInternalRoutes({
      vault,
      principalForThread: () => LOCAL_VAULT_PRINCIPAL,
      botName: () => "Ada",
      postCard: (_botId, _threadId, secret) => { posted.push(secret); return `m${posted.length}`; },
      endPersonSignIn: async (botId, threadId) => { ended.push(`${botId}:${threadId}`); },
    })];
    const ask = async (body: Record<string, unknown>) => {
      let answer: { status: number; body: unknown } | null = null;
      const res = { headersSent: false, writableEnded: false } as unknown as Parameters<typeof dispatchInternalRoutes>[1]["res"];
      await dispatchInternalRoutes(routes, {
        res, path: "/api/internal/credentials/request", method: "POST",
        json: ((_res: unknown, status: number, value: unknown) => { answer = { status, body: value }; }) as never,
        capability: { botId: "bot-a", threadId: "t1", generation: "g" },
        readBody: async () => body,
      });
      return answer!;
    };
    expect((await ask({})).status).toBe(400);
    expect((await ask({ domain: "not a site!" })).status).toBe(400);
    const first = await ask({ domain: "example.test", reason: "to read the invoice" });
    expect(first.status).toBe(201);
    expect(posted[0]).toMatchObject({ target: "vaultLogin", vault: { domain: "example.test", principalId: LOCAL_VAULT_PRINCIPAL } });
    // A newer card replaces the open one: a person's own sign-in begun from it ends.
    expect(ended).toEqual(["bot-a:t1"]);
    vault.grant(LOCAL_VAULT_PRINCIPAL, item.id, { botId: "bot-a", mode: "always" });
    const second = await ask({ domain: "example.test" });
    expect(second).toMatchObject({ status: 200, body: { granted: [{ handle: vaultHandle(item.id), name: "Example", domains: ["example.test"], fields: ["username", "password", "totp"] }] } });
    expect(JSON.stringify(second)).not.toContain(FAKE_PASSWORD);
    expect(posted).toHaveLength(1);
  });
});

describe("team bot login needs the owner's card", () => {
  it("posts a card to the bot owner, and the card grants once or always", async () => {
    const { call, cards, vault } = await serve({ principal: "pr_owner" });
    const team = botVaultPrincipal("bot-a");
    const shared = vault.createForTeamBot("bot-a", { kind: "login", name: "Shared SSO", username: "t@example.test", password: FAKE_PASSWORD, domains: ["sso.example.test"] });
    const posted: SecretRequestCardData[] = [];
    const routes = [createCredentialVaultInternalRoutes({
      vault,
      principalForThread: () => "pr_member",
      botOwner: () => "pr_owner",
      botName: () => "Ada",
      postCard: (_botId, _threadId, secret) => { posted.push(secret); return `m${posted.length}`; },
    })];
    const ask = async () => {
      let answer: { status: number; body: unknown } | null = null;
      const res = { headersSent: false, writableEnded: false } as unknown as Parameters<typeof dispatchInternalRoutes>[1]["res"];
      await dispatchInternalRoutes(routes, {
        res, path: "/api/internal/credentials/request", method: "POST",
        json: ((_res: unknown, status: number, value: unknown) => { answer = { status, body: value }; }) as never,
        capability: { botId: "bot-a", threadId: "t1", generation: "g" },
        readBody: async () => ({ domain: "sso.example.test" }),
      });
      return answer!;
    };
    // Not allowed at creation: the first request posts a card for the owner.
    expect((await ask()).status).toBe(201);
    expect(posted[0]).toMatchObject({ vault: { principalId: "pr_owner", team: true, teamItems: [{ id: shared.id, name: "Shared SSO" }] } });
    expect(JSON.stringify(posted[0])).not.toContain(FAKE_PASSWORD);
    expect(vault.granted(team, shared.id, "bot-a", "t1")).toBe(false);

    cards.set("t1:team1", posted[0]!);
    cards.set("t1:team2", { ...posted[0]!, vault: { ...posted[0]!.vault!, principalId: "pr_member" } });
    expect((await call("POST", "/api/bots/bot-a/vault-cards/team2/grant", { threadId: "t1", itemId: shared.id, mode: "once" })).status).toBe(403);
    // Only an item the card listed; nothing created through a team card.
    expect((await call("POST", "/api/bots/bot-a/vault-cards/team1/grant", { threadId: "t1", itemId: "zzzzzzzzzzzz", mode: "once" })).status).toBe(400);
    expect((await call("POST", "/api/bots/bot-a/vault-cards/team1/grant", { threadId: "t1", mode: "once", item: { kind: "login", name: "x", domains: ["a.test"] } })).status).toBe(400);
    const once = await call("POST", "/api/bots/bot-a/vault-cards/team1/grant", { threadId: "t1", itemId: shared.id, mode: "once" });
    expect(once.status).toBe(200);
    expect(vault.granted(team, shared.id, "bot-a", "t1")).toBe(true);
    expect(vault.granted(team, shared.id, "bot-a", "t2")).toBe(false);
    // Now the handle comes back at once in this conversation.
    expect(await ask()).toMatchObject({ status: 200, body: { granted: [{ handle: vaultHandle(shared.id) }] } });
  });
});

describe("import and export routes", () => {
  const items = [
    { kind: "login", name: "Imported", username: "kim.fake@example.test", password: FAKE_PASSWORD, totpSeed: FAKE_SEED, domains: ["https://Imported.example.test/login"], extra: "dropped" },
    { kind: "note", name: "Imported note", notes: "fake imported note", domains: [] },
  ];

  it("imports parsed items, merges or leaves duplicates, and audits counts only", async () => {
    const { call, audits, vault } = await serve();
    const first = await call("POST", "/api/me/credentials/import", { format: "chrome-csv", duplicates: "skip", items });
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ created: 2, merged: 0, duplicates: 0, inFile: 0, overLimit: 0, refused: 0 });
    expect(vault.list(LOCAL_VAULT_PRINCIPAL).map((item) => item.domains)).toEqual([["imported.example.test"], []]);
    const again = await call("POST", "/api/me/credentials/import", { format: "chrome-csv", duplicates: "skip", items });
    expect(again.body).toMatchObject({ created: 0, merged: 0, duplicates: 2 });
    const merged = await call("POST", "/api/me/credentials/import", { format: "bitwarden-json", duplicates: "merge", items: [{ ...items[0], password: "fake-new-pass", domains: ["imported.example.test", "www.imported.example.test"] }] });
    expect(merged.body).toMatchObject({ created: 0, merged: 1 });
    expect(vault.list(LOCAL_VAULT_PRINCIPAL)[0]!.domains).toEqual(["imported.example.test", "www.imported.example.test"]);
    const bad = await call("POST", "/api/me/credentials/import", { format: "chrome-csv", duplicates: "skip", items: [{ kind: "login", name: "Bad seed", username: "u", totpSeed: "not base32 !", domains: ["bad.example.test"] }] });
    expect(bad.body).toMatchObject({ created: 0, refused: 1 });
    for (const answer of [first, again, merged, bad]) expect(answer.text).not.toContain(FAKE_PASSWORD);
    expect(audits.filter((row) => row.action === "credentials.import")).toHaveLength(4);
    const auditText = JSON.stringify(audits);
    for (const value of [FAKE_PASSWORD, FAKE_SEED, "fake-new-pass", "kim.fake@example.test", "Imported", "imported.example.test", "fake imported note"]) expect(auditText).not.toContain(value);
  });

  it("refuses an import the gate refuses (a bot acting for its person)", async () => {
    const { call, vault } = await serve({ importGate: () => ({ status: 403, body: { code: "not_person" } }) });
    expect((await call("POST", "/api/me/credentials/import", { format: "chrome-csv", duplicates: "skip", items })).body).toEqual({ code: "not_person" });
    expect(vault.list(LOCAL_VAULT_PRINCIPAL)).toEqual([]);
  });

  it("refuses a malformed import", async () => {
    const { call } = await serve();
    expect((await call("POST", "/api/me/credentials/import", { format: "word", duplicates: "skip", items: [] })).status).toBe(400);
    expect((await call("POST", "/api/me/credentials/import", { format: "chrome-csv", duplicates: "all", items: [] })).status).toBe(400);
    expect((await call("POST", "/api/me/credentials/import", { format: "chrome-csv", duplicates: "skip", items: [{ kind: "card", name: "x" }] })).status).toBe(400);
    expect((await call("GET", "/api/me/credentials/import")).status).toBe(405);
  });

  it("exports only past the gate, with a plaintext acknowledgement, and audits without content", async () => {
    let refuse = true;
    const asked: unknown[] = [];
    const { call, audits, vault } = await serve({
      exportGate: (_auth, input) => {
        asked.push(input);
        return refuse ? { status: 403, body: { error: "Confirm this change with your security key.", code: "step_up_required", target: { kind: "settings", action: "credentials.export", detail: { format: input.format } } } } : null;
      },
    });
    vault.create(LOCAL_VAULT_PRINCIPAL, login);
    expect((await call("POST", "/api/me/credentials/export", { format: "chrome-csv" })).body).toMatchObject({ code: "acknowledge_required" });
    expect((await call("POST", "/api/me/credentials/export", { format: "pdf", acknowledge: "plaintext" })).status).toBe(400);
    const refused = await call("POST", "/api/me/credentials/export", { format: "bitwarden-json", acknowledge: "plaintext" });
    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({ code: "step_up_required", target: { action: "credentials.export" } });
    expect(refused.text).not.toContain(FAKE_PASSWORD);
    refuse = false;
    const answered = await call("POST", "/api/me/credentials/export", { format: "bitwarden-json", acknowledge: "plaintext", stepUp: "ceremony-id" });
    expect(answered.status).toBe(200);
    expect(answered.body.items).toEqual([{ kind: "login", name: "Example", username: "ada.fake@example.test", password: FAKE_PASSWORD, totpSeed: FAKE_SEED, notes: "fake private note", domains: ["example.test"] }]);
    expect(answered.body.onePassword).toBe(0);
    expect(asked.at(-1)).toEqual({ format: "bitwarden-json", stepUp: "ceremony-id" });
    const exports = audits.filter((row) => row.action === "credentials.export");
    expect(exports).toEqual([{ action: "credentials.export", detail: { format: "bitwarden-json", count: 1, referencesLeftOut: 0, notInFormat: 0 } }]);
  });

  it("answers a purchase only with the security key when the person chose money (parity A12, #648 and #932)", async () => {
    let refuse = true;
    const asked: Array<{ detail: Record<string, unknown>; stepUp: unknown }> = [];
    const { call, vault } = await serve({
      purchaseStepUp: (_auth, detail, stepUp) => {
        asked.push({ detail, stepUp });
        return refuse ? { status: 403, body: { code: "step_up_required", target: { kind: "settings", action: "purchase.allow", detail } } } : null;
      },
    });
    const saved = vault.create(LOCAL_VAULT_PRINCIPAL, { kind: "card", name: "Shop card", card: { pan: "4242424242424242", cvv: "123", expMonth: 12, expYear: 2030, holder: "Ada Lovelace" } });
    const opened = vault.openPurchase(LOCAL_VAULT_PRINCIPAL, { botId: "bot-a", threadId: "thread-1", pageUrl: "https://shop.example.test/pay", amount: "4", currency: "USD", cardId: saved.id });
    const path = `/api/me/credentials/purchases/${opened.listing.id}/answer`;
    const refused = await call("POST", path, { decision: "once" });
    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({ code: "step_up_required", target: { action: "purchase.allow" } });
    expect(refused.text).not.toContain("4242424242424242");
    // nothing was answered: the purchase still waits
    expect(vault.pendingPurchases(LOCAL_VAULT_PRINCIPAL).map((row) => row.id)).toEqual([opened.listing.id]);
    refuse = false;
    const answered = await call("POST", path, { decision: "once", stepUp: "ceremony-id" });
    expect(answered.status).toBe(200);
    expect(asked.at(-1)).toEqual({ detail: { purchaseId: opened.listing.id, decision: "once" }, stepUp: "ceremony-id" });
    expect(vault.pendingPurchases(LOCAL_VAULT_PRINCIPAL)).toEqual([]);
  });

  it("refuses every export when the organization turned exports off, before the gate, and says so in the list (2026-10-18)", async () => {
    let blocked = true;
    let gateAsked = 0;
    const { call, vault, audits } = await serve({ exportBlocked: () => blocked, exportGate: () => { gateAsked += 1; return null; } });
    vault.create(LOCAL_VAULT_PRINCIPAL, login);
    expect((await call("POST", "/api/me/credentials/list", {})).body.exportBlocked).toBe(true);
    for (const format of ["chrome-csv", "bitwarden-csv", "bitwarden-json"]) {
      const refused = await call("POST", "/api/me/credentials/export", { format, acknowledge: "plaintext", stepUp: "ceremony-id" });
      expect(refused.status).toBe(403);
      expect(refused.body).toMatchObject({ code: "export_blocked_by_org" });
      expect(refused.text).not.toContain(FAKE_PASSWORD);
    }
    expect(gateAsked).toBe(0);
    expect(audits.filter((row) => row.action === "credentials.export")).toEqual([]);
    // imports are not affected
    expect((await call("POST", "/api/me/credentials/import", { format: "chrome-csv", duplicates: "skip", items: [] })).status).toBe(200);
    blocked = false;
    expect((await call("POST", "/api/me/credentials/list", {})).body).not.toHaveProperty("exportBlocked");
    expect((await call("POST", "/api/me/credentials/export", { format: "chrome-csv", acknowledge: "plaintext" })).status).toBe(200);
  });

  it("refuses an export where no gate is wired, and keeps both routes member scope and off for agents", async () => {
    const { call, vault } = await serve();
    vault.create(LOCAL_VAULT_PRINCIPAL, login);
    const answer = await call("POST", "/api/me/credentials/export", { format: "chrome-csv", acknowledge: "plaintext" });
    expect(answer.status).toBe(403);
    expect(answer.text).not.toContain(FAKE_PASSWORD);
    for (const path of ["/api/me/credentials/import", "/api/me/credentials/export"]) {
      expect(requiredScope("POST", path)).toBe("client");
      expect(requiredScope("GET", path)).toBe("admin");
      for (const row of TOOL_POLICY_ROWS.filter((entry) => entry.route === path)) expect(row).toMatchObject({ tier: "admin", defaultEnabled: false });
    }
  });
});

describe("1Password per request on the card (parité R10, ligne 82)", () => {
  // Fake 1Password: two items for example.test, one for elsewhere.test. No
  // value is ever listed; a read would be `item get`, which this test never
  // answers.
  const fakeOp = (reads: string[][]) => new OnePassword({
    env: { HOME: "/tmp" },
    organization: () => false,
    locate: async () => "/opt/homebrew/bin/op",
    exec: async (_binary, args) => {
      reads.push(args);
      if (args[0] === "--version") return "2.30.0";
      if (args[0] === "account") return JSON.stringify([{ url: "my.1password.example" }]);
      if (args[0] === "item" && args[1] === "list") {
        return JSON.stringify([
          { id: "aaaa1111", title: "Example work", category: "LOGIN", vault: { id: "vlt1", name: "Travail" }, urls: [{ href: "https://example.test/login" }] },
          { id: "bbbb2222", title: "Example admin", category: "LOGIN", vault: { id: "vlt2", name: "Perso" }, urls: [{ href: "https://admin.example.test" }] },
          { id: "cccc3333", title: "Elsewhere", category: "LOGIN", vault: { id: "vlt1", name: "Travail" }, urls: [{ href: "https://elsewhere.test" }] },
        ]);
      }
      throw new Error("unexpected 1Password call");
    },
  });

  it("lists the site's 1Password items by name and vault, never a value", async () => {
    const reads: string[][] = [];
    const { call, cards } = await serve({ onePassword: fakeOp(reads) });
    cards.set("t1:m1", vaultRequestCard({ principalId: LOCAL_VAULT_PRINCIPAL, botName: "Ada", domain: "example.test" }));
    const listed = await call("POST", "/api/bots/bot-a/vault-cards/m1/onepassword", { threadId: "t1" });
    expect(listed.status).toBe(200);
    expect(listed.body.available).toBe(true);
    expect(listed.body.items.map((item: { title: string }) => item.title)).toEqual(["Example work", "Example admin"]);
    expect(listed.body.items[0]).toMatchObject({ vaultName: "Travail", domains: ["example.test"] });
    expect(reads.some((args) => args.includes("--reveal") || args[1] === "get")).toBe(false);
  });

  it("allows one request from a 1Password item, reusing its reference", async () => {
    const { call, cards, resumed, vault } = await serve({ onePassword: fakeOp([]) });
    cards.set("t1:m1", vaultRequestCard({ principalId: LOCAL_VAULT_PRINCIPAL, botName: "Ada", domain: "example.test" }));
    cards.set("t1:m2", vaultRequestCard({ principalId: LOCAL_VAULT_PRINCIPAL, botName: "Ada", domain: "example.test" }));
    const once = await call("POST", "/api/bots/bot-a/vault-cards/m1/grant", { threadId: "t1", mode: "once", onePassword: { vaultId: "vlt1", itemId: "aaaa1111" } });
    expect(once.status).toBe(200);
    expect(once.body.item).toMatchObject({ name: "Example work", source: "1password" });
    const id = once.body.item.id as string;
    expect(vault.granted(LOCAL_VAULT_PRINCIPAL, id, "bot-a", "t1")).toBe(true);
    expect(vault.granted(LOCAL_VAULT_PRINCIPAL, id, "bot-a", "t2")).toBe(false);
    expect(cards.get("t1:m1")).toMatchObject({ provided: true, vault: { itemName: "Example work", mode: "once", onePassword: true } });
    expect(resumed[0]!.prompt).toContain("1Password");
    // the item's own title never reaches the bot
    expect(resumed[0]!.prompt).not.toContain("Example work");
    const again = await call("POST", "/api/bots/bot-a/vault-cards/m2/grant", { threadId: "t1", mode: "once", onePassword: { vaultId: "vlt1", itemId: "aaaa1111" } });
    expect(again.body.item.id).toBe(id);
    expect(vault.list(LOCAL_VAULT_PRINCIPAL)).toHaveLength(1);
  });

  it("refuses an item of another site, a forged id or an unavailable 1Password", async () => {
    const { call, cards } = await serve({ onePassword: fakeOp([]) });
    cards.set("t1:m1", vaultRequestCard({ principalId: LOCAL_VAULT_PRINCIPAL, botName: "Ada", domain: "example.test" }));
    expect((await call("POST", "/api/bots/bot-a/vault-cards/m1/grant", { threadId: "t1", mode: "once", onePassword: { vaultId: "vlt1", itemId: "cccc3333" } })).status).toBe(404);
    expect((await call("POST", "/api/bots/bot-a/vault-cards/m1/grant", { threadId: "t1", mode: "once", onePassword: { vaultId: "../x", itemId: "aaaa1111" } })).status).toBe(404);
    expect((await call("POST", "/api/bots/bot-a/vault-cards/m1/grant", { threadId: "t1", mode: "always", addSite: true, onePassword: { vaultId: "vlt1", itemId: "aaaa1111" } })).status).toBe(400);
    const off = await serve();
    off.cards.set("t1:m1", vaultRequestCard({ principalId: LOCAL_VAULT_PRINCIPAL, botName: "Ada", domain: "example.test" }));
    expect((await off.call("POST", "/api/bots/bot-a/vault-cards/m1/onepassword", { threadId: "t1" })).body).toMatchObject({ available: false, items: [] });
    expect((await off.call("POST", "/api/bots/bot-a/vault-cards/m1/grant", { threadId: "t1", mode: "once", onePassword: { vaultId: "vlt1", itemId: "aaaa1111" } })).status).toBe(409);
  });

  it("allows a 1Password item once only, from the card or Settings (review of #954)", async () => {
    const { call, cards, vault } = await serve({ onePassword: fakeOp([]) });
    cards.set("t1:m1", vaultRequestCard({ principalId: LOCAL_VAULT_PRINCIPAL, botName: "Ada", domain: "example.test" }));
    const always = await call("POST", "/api/bots/bot-a/vault-cards/m1/grant", { threadId: "t1", mode: "always", onePassword: { vaultId: "vlt1", itemId: "aaaa1111" } });
    expect(always.body).toMatchObject({ code: "onepassword_once_only" });
    const once = await call("POST", "/api/bots/bot-a/vault-cards/m1/grant", { threadId: "t1", mode: "once", onePassword: { vaultId: "vlt1", itemId: "aaaa1111" } });
    const id = once.body.item.id as string;
    cards.set("t1:m2", vaultRequestCard({ principalId: LOCAL_VAULT_PRINCIPAL, botName: "Ada", domain: "example.test" }));
    expect((await call("POST", "/api/bots/bot-a/vault-cards/m2/grant", { threadId: "t1", mode: "always", itemId: id })).body).toMatchObject({ code: "onepassword_once_only" });
    expect((await call("POST", `/api/me/credentials/${id}/grants`, { botId: "bot-a", mode: "always" })).body).toMatchObject({ code: "onepassword_once_only" });
    expect(vault.list(LOCAL_VAULT_PRINCIPAL)[0]!.grants).toEqual([expect.objectContaining({ mode: "once" })]);
  });

  it("a 1Password grant is one sign-in: it ends a minute after its first fill (review of #954)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-vault-single-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    let now = 1_000_000;
    const vault = new CredentialVault(dir, () => ({ kind: "key", key: Buffer.alloc(32, 5) }), () => now);
    const item = vault.create(LOCAL_VAULT_PRINCIPAL, { kind: "login", name: "Example work", domains: ["example.test"] }, { source: "1password", onePassword: { via: "cli", vaultId: "vlt1", itemId: "aaaa1111" } });
    vault.grant(LOCAL_VAULT_PRINCIPAL, item.id, { botId: "bot-a", mode: "once", threadId: "t1", singleUse: true });
    const read = async () => "fake-1p-value";
    const fill = (field: "username" | "password") => vault.resolveForFill(LOCAL_VAULT_PRINCIPAL, { handle: vaultHandle(item.id), field, botId: "bot-a", threadId: "t1", pageUrl: "https://example.test/login" }, read);
    expect((await fill("username")).ok).toBe(true);
    now += 30_000;
    expect((await fill("password")).ok).toBe(true);
    now += 31_000;
    expect(await fill("password")).toMatchObject({ ok: false, code: "not_granted" });
  });

  it("ignores an Always saved on a 1Password item before, and never names the item to the bot (re-review of #954)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-vault-legacy-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const now = 2_000_000;
    const vault = new CredentialVault(dir, () => ({ kind: "key", key: Buffer.alloc(32, 5) }), () => now);
    const item = vault.create(LOCAL_VAULT_PRINCIPAL, { kind: "login", name: "Secret Payroll Portal", domains: ["example.test"] }, { source: "1password", onePassword: { via: "cli", vaultId: "vlt1", itemId: "aaaa1111" } });
    // an Always written by an earlier version, straight into the store
    (vault as unknown as { mutate(p: string, f: (items: Record<string, { grants: unknown[] }>) => void): void }).mutate(LOCAL_VAULT_PRINCIPAL, (items) => {
      items[item.id]!.grants.push({ botId: "bot-a", mode: "always", grantedAt: now });
    });
    expect(vault.granted(LOCAL_VAULT_PRINCIPAL, item.id, "bot-a", "t1")).toBe(false);
    const read = async () => null;
    const fill = (pageUrl: string) => vault.resolveForFill(LOCAL_VAULT_PRINCIPAL, { handle: vaultHandle(item.id), field: "password", botId: "bot-a", threadId: "t1", pageUrl }, read);
    const refused = await fill("https://example.test/login");
    expect(refused).toMatchObject({ ok: false, code: "not_granted" });
    expect(JSON.stringify(refused)).not.toContain("Payroll");
    vault.grant(LOCAL_VAULT_PRINCIPAL, item.id, { botId: "bot-a", mode: "once", threadId: "t1", singleUse: true });
    for (const [url, code] of [["https://other.test/", "wrong_origin"], ["https://example.test/login", "no_value"]] as const) {
      const answer = await fill(url);
      expect(answer).toMatchObject({ ok: false, code });
      expect(JSON.stringify(answer)).not.toContain("Payroll");
    }
  });

  it("only the person the card was made for sees its 1Password items", async () => {
    const { call, cards } = await serve({ onePassword: fakeOp([]) });
    cards.set("t1:m2", vaultRequestCard({ principalId: "pr_someone_else", botName: "Ada", domain: "example.test" }));
    expect((await call("POST", "/api/bots/bot-a/vault-cards/m2/onepassword", { threadId: "t1" })).status).toBe(403);
  });
});
