// "Sign in with Pulsatrix" through the real server, against a local fake
// OpenID Connect provider (server/testing/fake-oidc-provider.ts) shaped like
// Perspicax slice 1. The server runs with SAGAX_IDENTITY=perspicax:
//
//   - the environment descriptor advertises the sign-in and no email codes;
//   - /auth/oidc/start -> provider -> /auth/oidc/callback sets a Sagax
//     session cookie, and /api/auth/session names the principal, the email
//     and the role;
//   - scenario A (spec section 10): an admin signed in this way creates a bot
//     on the server and gets its answer from the (fake) engine, on the
//     organization key (the person who speaks pays, 2026-10-01); a second
//     browser of the same person reads the same thread;
//   - an employee gets a client session only; a replayed callback, a foreign
//     browser and a role the server does not know are refused;
//   - email codes and invitation routes answer 403.
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { removeTempDir, waitForExit } from "../testing/cleanup.ts";
import { startFakeOidcProvider, type FakeOidcProvider } from "../testing/fake-oidc-provider.ts";
import { freePortBlock } from "../testing/ports.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const FAKE_CLI = join(SERVER_DIR, "..", "testing", "fake-acp-cli.ts");
const FAKE_CLAUDE = join(SERVER_DIR, "..", "testing", "fake-claude-cli.ts");
// The organization key (Settings > Connections). Since 2026-10-01 the person
// who speaks pays: the server's own sign-ins no longer serve an admin's bot,
// so scenario A's turn runs on this key (org-sharing covers the refusals).
const ORG_KEY = "sk-ant-test-org-key";
const posixOnly = describe.skipIf(process.platform === "win32");
const ADMIN = { sub: "01J9ADMIN0000000000000000A", email: "Alice@Example.test", name: "Alice Admin", preferred_username: "alice", role: "admin" };
const EMPLOYEE = { sub: "01J9EMPLOYEE00000000000000B", email: "bob@example.test", name: "Bob", preferred_username: "bob", role: "employee" };

let PORT = 0;
let BASE = "";
let child: ChildProcess;
let home: string;
let log = "";
let idp: FakeOidcProvider;

type Jar = { cookie: string };
const api = async (method: string, path: string, jar?: Jar, body?: unknown): Promise<{ status: number; body: any }> => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(jar ? { cookie: jar.cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

const cookiePair = (setCookie: string) => setCookie.split(";")[0]!;

/** The browser's walk: start, the provider's page, the callback. Returns the
 * callback response and the cookies the browser would then hold. */
async function signIn(options: { tamperBinding?: boolean } = {}): Promise<{ status: number; location: string; jar: Jar; callbackUrl: string; binding: string }> {
  const start = await fetch(`${BASE}/auth/oidc/start`, { redirect: "manual" });
  expect(start.status).toBe(303);
  const bindingSet = start.headers.getSetCookie().find((c) => c.includes("_oidc="));
  expect(bindingSet, "binding cookie").toBeTruthy();
  expect(bindingSet).toMatch(/HttpOnly/);
  expect(bindingSet).toMatch(/Path=\/auth\/oidc/);
  const binding = cookiePair(bindingSet!);
  const authorize = await fetch(start.headers.get("location")!, { redirect: "manual" });
  expect(authorize.status).toBe(302);
  const callbackUrl = authorize.headers.get("location")!;
  expect(callbackUrl.startsWith(`${BASE}/auth/oidc/callback?`)).toBe(true);
  const presented = options.tamperBinding ? binding.replace(/=.*/, "=someone-else") : binding;
  const callback = await fetch(callbackUrl, { redirect: "manual", headers: { cookie: presented, "user-agent": "Mozilla/5.0 (Macintosh; Mac OS X) Chrome/140 Safari/537" } });
  const session = callback.headers.getSetCookie().find((c) => c.startsWith("omb_session_") && !c.includes("_oidc="));
  return { status: callback.status, location: callback.headers.get("location") ?? "", jar: { cookie: session ? cookiePair(session) : "" }, callbackUrl, binding };
}

async function waitFor<T>(read: () => Promise<T | null | undefined>, ms = 30_000): Promise<T | null> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline) return null;
    await new Promise((r) => setTimeout(r, 200));
  }
}

async function start() {
  child = spawn(process.execPath, [join(SERVER_DIR, "..", "index.ts")], {
    cwd: join(SERVER_DIR, "..", ".."),
    env: {
      ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
      HOME: home, USERPROFILE: home, SAGAX_LOCAL_VM_TEST_NAMESPACE: process.env.SAGAX_LOCAL_VM_TEST_NAMESPACE ?? "", SAGAX_PORT: String(PORT), SAGAX_WEBHOOK_PORT: String(PORT + 1),
      SAGAX_IDENTITY: "perspicax",
      SAGAX_PERSPICAX_ISSUER: idp.issuer,
      SAGAX_PERSPICAX_LINK_FILE: join(home, "link", "pulsabot.json"),
      SAGAX_PUBLIC_URL: BASE,
      SAGAX_ANTHROPIC_API_KEY: ORG_KEY,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout!.on("data", (c) => (log += c));
  child.stderr!.on("data", (c) => (log += c));
  const deadline = Date.now() + 20_000;
  for (;;) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) throw new Error(`server never came up:\n${log}`);
    await new Promise((r) => setTimeout(r, 150));
  }
}

posixOnly("Sign in with Pulsatrix (SAGAX_IDENTITY=perspicax)", () => {
  beforeAll(async () => {
    chmodSync(FAKE_CLI, 0o755);
    chmodSync(FAKE_CLAUDE, 0o755);
    idp = await startFakeOidcProvider({ user: ADMIN });
    idp.directoryPeople = [ADMIN, EMPLOYEE].map((user) => idp.personOf(user));
    PORT = await freePortBlock([0, 1]);
    BASE = `http://127.0.0.1:${PORT}`;
    home = mkdtempSync(join(tmpdir(), "omb-oidc-login-"));
    const data = join(home, ".sagax");
    mkdirSync(data, { recursive: true });
    // Organization-key turns require the directory's engine allowlist.
    // Exercise the same linked directory as the organization-sharing tests.
    mkdirSync(join(home, "link"), { recursive: true, mode: 0o750 });
    writeFileSync(join(home, "link", "pulsabot.json"), JSON.stringify({
      version: 1, issuer: idp.issuer, client_id: "pulsa-bot", server_id: idp.serverId, origin: BASE, link_token: idp.linkToken,
    }), { mode: 0o640 });
    writeFileSync(join(data, "config.json"), JSON.stringify({
      instances: {
        grok: { driver: "grokAgent", config: { cli: FAKE_CLI, fullAuto: false } },
        claude: { driver: "claudeAgent", config: { cli: FAKE_CLAUDE, fullAuto: true } },
      },
    }));
    await start();
  });

  afterAll(async () => {
    child?.kill("SIGTERM");
    if (child) await waitForExit(child);
    await idp?.close();
    if (home) removeTempDir(home);
  });

  it("advertises the Perspicax sign-in and no email codes", async () => {
    const res = await fetch(`${BASE}/.well-known/openmausbot/environment`);
    const body = await res.json() as any;
    expect(body.identity).toEqual({ kind: "perspicax", protocol: "oidc", issuer: idp.issuer, loginPath: "/auth/oidc/start", nativeReturn: true, loopbackReturn: true, nativeReturnSchemes: ["sagax"], phoneReturnSchemes: ["sagax"] });
    expect(body.capabilities.emailSignIn).toBe(false);
    expect(log).toMatch(/service trust \(organization server/);
  });

  const ids = { principal: "", bot: "", thread: "" };

  it("signs an admin in: session cookie, principal, email and role", async () => {
    idp.user = ADMIN;
    const signedIn = await signIn();
    expect(signedIn.status, log.slice(-2000)).toBe(303);
    expect(signedIn.location).toBe("/");
    expect(signedIn.jar.cookie).toMatch(/^omb_session_/);
    // the provider saw the Sagax origin as the login token's resource
    expect(idp.lastAuthorize).toMatchObject({ client_id: "pulsa-bot", redirect_uri: `${BASE}/auth/oidc/callback`, resource: BASE, code_challenge_method: "S256" });
    const session = await api("GET", "/api/auth/session", signedIn.jar);
    expect(session.status).toBe(200);
    expect(session.body).toMatchObject({
      kind: "session", via: "cookie", scopes: ["admin", "client"], identity: "perspicax",
      email: "alice@example.test", name: "Alice Admin", login: "alice", role: "admin", orgRole: "admin",
    });
    expect(session.body.principalId).toMatch(/^pr_/);
    ids.principal = session.body.principalId;
    // the person is keyed by (iss, sub); the email is an attribute
    const principals = JSON.parse(readFileSync(join(home, ".sagax", "principals.json"), "utf8")).principals as any[];
    expect(principals.find((p) => p.id === ids.principal)).toMatchObject({ subject: { iss: idp.issuer, sub: ADMIN.sub }, email: "alice@example.test", orgRole: "admin" });
    // slice 2 keeps the grant, sealed: nothing from the provider reaches the
    // stored sessions, and the vault holds no readable token
    expect(idp.revoked).toEqual([]);
    const stored = readFileSync(join(home, ".sagax", "sessions.json"), "utf8");
    expect(stored).not.toMatch(/pxlr1\.|pxlo1\.|eyJ/);
    expect(readFileSync(join(home, ".sagax", "idp-grants.enc"), "utf8")).not.toMatch(/pxlr1\./);
  });

  it("scenario A: the admin creates a bot on the server and gets its answer; another browser reads the thread", async () => {
    const jar = (await signIn()).jar;
    const organization = await waitFor(async () => {
      const current = await api("GET", "/api/org", jar);
      return current.body.link?.state === "ok" ? current.body : null;
    });
    expect(organization, log.slice(-3000)).toBeTruthy();
    const created = await api("POST", "/api/bots", jar, { name: "Helpdesk Otter" });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    ids.bot = created.body.bot.id;
    ids.thread = created.body.bot.threadId;
    const patched = await api("PATCH", `/api/bots/${ids.bot}`, jar, { modelSelection: { instanceId: "claude", model: "fake-model" } });
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);
    const sent = await api("POST", `/api/bots/${ids.bot}/messages`, jar, { text: "Hello from Perspicax", threadId: ids.thread });
    expect(sent.status, JSON.stringify(sent.body)).toBe(202);
    const reply = await waitFor(async () => {
      const { body } = await api("GET", `/api/threads/${ids.thread}/messages`, jar);
      const messages = (body.messages ?? []) as Array<{ role: string; text?: string }>;
      const asked = messages.findIndex((m) => m.role === "user" && m.text?.includes("Hello from Perspicax"));
      return asked >= 0 ? messages.slice(asked + 1).find((m) => m.role === "bot" && m.text) : null;
    });
    expect(reply, log.slice(-3000)).toBeTruthy();
    // the bot belongs to the person who signed in
    const bots = await api("GET", "/api/bots", jar);
    expect(bots.body.bots.map((b: { id: string }) => b.id)).toContain(ids.bot);

    // a second browser of the same person: same principal, same thread
    const other = (await signIn()).jar;
    expect(other.cookie).not.toBe(jar.cookie);
    const again = await api("GET", "/api/auth/session", other);
    expect(again.body.principalId).toBe(ids.principal);
    const thread = await api("GET", `/api/threads/${ids.thread}/messages`, other);
    expect(thread.status).toBe(200);
    expect(JSON.stringify(thread.body.messages)).toContain("Hello from Perspicax");
  });

  it("gives an employee a client session only", async () => {
    idp.user = EMPLOYEE;
    const { jar, status } = await signIn();
    expect(status).toBe(303);
    const session = await api("GET", "/api/auth/session", jar);
    expect(session.body).toMatchObject({ scopes: ["client"], role: "employee", orgRole: "member", email: "bob@example.test" });
    expect(session.body.principalId).not.toBe(ids.principal);
    expect((await api("GET", "/api/auth/sessions", jar)).status).toBe(403);
  });

  it("refuses a replayed callback, a callback in another browser and an unknown role", async () => {
    idp.user = ADMIN;
    const first = await signIn();
    expect(first.status).toBe(303);
    const replay = await fetch(first.callbackUrl, { redirect: "manual", headers: { cookie: first.binding } });
    expect(replay.status).toBe(303);
    expect(replay.headers.get("location")).toBe("/pair#signin_error=state");
    expect(replay.headers.getSetCookie().some((c) => c.startsWith("omb_session_") && !c.includes("_oidc="))).toBe(false);

    const foreign = await signIn({ tamperBinding: true });
    expect(foreign.location).toBe("/pair#signin_error=binding");
    expect(foreign.jar.cookie).toBe("");

    idp.user = { ...EMPLOYEE, sub: "01J9SERVICE000000000000000C", role: "service" };
    const service = await signIn();
    expect(service.location).toBe("/pair#signin_error=role");
    expect(service.jar.cookie).toBe("");
  });

  it("refuses email codes and every invitation route", async () => {
    idp.user = ADMIN;
    const { jar } = await signIn();
    for (const [method, path, body] of [
      ["POST", "/api/auth/email/start", { email: "alice@example.test" }],
      ["POST", "/api/auth/email/verify", { email: "alice@example.test", code: "12345678" }],
      ["POST", "/api/org/invites", { email: "carol@example.test" }],
      ["GET", "/api/org/invites/abcdef/preview", undefined],
      ["POST", "/api/org/invites/abcdef/join", {}],
      ["POST", "/api/org/invites/abcdef/revoke", {}],
    ] as const) {
      const res = await api(method, path, jar, body);
      expect(res.status, `${method} ${path}`).toBe(403);
      expect(res.body.code).toBe("identity_perspicax");
    }
  });

  it("keeps email solo: a sign-in list and mail on disk change nothing on an organization server", async () => {
    // As if an older build or `openmausbot access add` had written them.
    const file = join(home, ".sagax", "config.json");
    let current: Record<string, unknown> = {};
    try { current = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>; } catch { /* none yet */ }
    writeFileSync(file, JSON.stringify({
      ...current,
      signIn: { admins: ["alice@example.test"], members: ["@example.test"] },
      mail: { provider: "smtp", from: "bot@example.test", smtp: { host: "127.0.0.1", port: 9 } },
    }));
    idp.user = ADMIN;
    const { jar } = await signIn();
    const environment = await api("GET", "/.well-known/openmausbot/environment");
    expect(environment.body.capabilities.emailSignIn).toBe(false);
    expect(await api("POST", "/api/auth/email/start", undefined, { email: "alice@example.test" })).toMatchObject({ status: 403, body: { code: "identity_perspicax" } });
    expect(await api("GET", "/api/org/invites", jar)).toMatchObject({ status: 403, body: { code: "identity_perspicax" } });
    const config = await api("GET", "/api/config", jar);
    expect(config.status).toBe(200);
    expect(config.body).not.toHaveProperty("signIn");
    const join_ = await fetch(`${BASE}/join`, { redirect: "manual" });
    expect(join_.status).toBe(302);
    expect(join_.headers.get("location")).toBe("/pair");
  });

  it("treats this machine as a service, not the owner, without a session", async () => {
    const res = await api("GET", "/api/auth/session");
    expect(res.body).toMatchObject({ kind: "loopback", trust: "service" });
    expect((await api("GET", "/api/auth/sessions")).status).toBeGreaterThanOrEqual(401);
  });
});
