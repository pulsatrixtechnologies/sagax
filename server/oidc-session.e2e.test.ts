// Slice 2 of "Sign in with Pulsatrix" through the real server, against the
// local fake provider (server/testing/fake-oidc-provider.ts) and the fake
// engine: the session lives on the provider's grant.
//
//   S2-1  a due grant is refreshed on use, in the background, and rotates
//   S2-2  a role change at the provider narrows the session on its next refresh
//   S2-3  a back-channel logout ends the person's sessions and open stream at once
//   S2-5  logout revokes the grant at the provider and drops it from the vault
//   S2-6  forged and replayed logout tokens are refused; the session stays
//   S2-7  the desktop return link redeems once into a person-bound cookie session
//   S2-8  the phone return link redeems into a bearer that a back-channel
//         logout ends by principal
//   plus: a provider refusing the refresh ends the session and, with no
//   back-channel push at all, every device the person paired (T8); a member
//   pairs their own device, never wider than themselves (D13); a device
//   paired from a signed-in session follows the person's other grants after
//   its creator logs out, and ends with the last one.
//
// SAGAX_OIDC_REFRESH_AFTER_SECONDS=1 makes every grant due after a second.
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { removeTempDir, waitForExit } from "./testing/cleanup.ts";
import { startFakeOidcProvider, type FakeOidcProvider, type FakeOidcUser } from "./testing/fake-oidc-provider.ts";
import { freePortBlock } from "./testing/ports.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
// The desktop app's own loopback listener (electron/oidc-system-sign-in.cjs).
const { startLoopbackReturn } = createRequire(import.meta.url)("../electron/oidc-system-sign-in.cjs") as {
  startLoopbackReturn: (options?: { timeoutMs?: number }) => Promise<{ returnTo: string; result: Promise<{ code?: string; error?: string; timeout?: true; cancelled?: true }>; cancel: () => void }>;
};
const FAKE_CLI = join(SERVER_DIR, "testing", "fake-acp-cli.ts");
const posixOnly = describe.skipIf(process.platform === "win32");
const ALICE: FakeOidcUser = { sub: "01J9S2ALICE00000000000000A", email: "alice@example.test", name: "Alice", preferred_username: "alice", role: "admin" };
const BOB: FakeOidcUser = { sub: "01J9S2BOB000000000000000B", email: "bob@example.test", name: "Bob", preferred_username: "bob", role: "employee" };
const CAROL: FakeOidcUser = { sub: "01J9S2CAROL00000000000000C", email: "carol@example.test", name: "Carol", preferred_username: "carol", role: "admin" };
const DAVE: FakeOidcUser = { sub: "01J9S2DAVE000000000000000D", email: "dave@example.test", name: "Dave", preferred_username: "dave", role: "employee" };
const ERIN: FakeOidcUser = { sub: "01J9S2ERIN000000000000000E", email: "erin@example.test", name: "Erin", preferred_username: "erin", role: "admin" };
const GRACE: FakeOidcUser = { sub: "01J9S2GRACE00000000000000G", email: "grace@example.test", name: "Grace", preferred_username: "grace", role: "admin" };
const HANK: FakeOidcUser = { sub: "01J9S2HANK000000000000000H", email: "hank@example.test", name: "Hank", preferred_username: "hank", role: "admin" };
const IVY: FakeOidcUser = { sub: "01J9S2IVY0000000000000000I", email: "ivy@example.test", name: "Ivy", preferred_username: "ivy", role: "employee" };
const FRANK: FakeOidcUser = { sub: "01J9S2FRANK00000000000000F", email: "frank@example.test", name: "Frank", preferred_username: "frank", role: "employee" };

let PORT = 0;
let BASE = "";
let child: ChildProcess;
let home: string;
let log = "";
let idp: FakeOidcProvider;
/** The per-launch secret `openmausbot serve` hands its server on stdin. */
const CLI_OWNER = "cli-owner-token-0123456789abcdefghijklmnopq";
/** A device paired before this server joined the organization: a session with no person. */
const LEGACY_BEARER = "omb_sess_legacy-device-paired-before-the-organization-0001";
/** A session as the server keeps it (sessions.json): the person behind it. */
const storedSession = (id: string): { principalId?: string; scopes: string[] } | undefined => {
  const doc = JSON.parse(readFileSync(join(home, ".sagax", "sessions.json"), "utf8")) as { sessions?: Array<{ id: string; principalId?: string; scopes: string[] }> };
  return doc.sessions?.find((s) => s.id === id);
};

type Auth = { cookie?: string; bearer?: string };
const api = async (method: string, path: string, auth?: Auth, body?: unknown): Promise<{ status: number; body: any; headers: Headers }> => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(auth?.cookie ? { cookie: auth.cookie } : {}),
      ...(auth?.bearer ? { authorization: `Bearer ${auth.bearer}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})), headers: res.headers };
};
const cookiePair = (setCookie: string) => setCookie.split(";")[0]!;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The browser's walk through the provider. Returns where the callback sent it. */
async function walk(user: FakeOidcUser, client?: "desktop" | "phone", returnTo?: string): Promise<{ location: string; cookie: string }> {
  idp.user = { ...user };
  const query = new URLSearchParams();
  if (client) query.set("client", client);
  if (returnTo) query.set("return", returnTo);
  const start = await fetch(`${BASE}/auth/oidc/start${query.size ? `?${query}` : ""}`, { redirect: "manual" });
  const binding = cookiePair(start.headers.getSetCookie().find((c) => c.includes("_oidc="))!);
  const authorize = await fetch(start.headers.get("location")!, { redirect: "manual" });
  const callback = await fetch(authorize.headers.get("location")!, { redirect: "manual", headers: { cookie: binding } });
  const session = callback.headers.getSetCookie().find((c) => c.startsWith("omb_session_") && !c.includes("_oidc="));
  return { location: callback.headers.get("location") ?? "", cookie: session ? cookiePair(session) : "" };
}

async function signIn(user: FakeOidcUser): Promise<Auth> {
  const { location, cookie } = await walk(user);
  expect(location, log.slice(-2000)).toBe("/");
  return { cookie };
}

async function waitFor<T>(read: () => Promise<T | null | undefined | false>, ms = 10_000): Promise<T | null> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline) return null;
    await sleep(100);
  }
}

const backchannel = (token: string) => fetch(`${BASE}/api/auth/oidc/backchannel-logout`, {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: `logout_token=${encodeURIComponent(token)}`,
});

/** Open /api/events with a stream ticket; resolves `ended` when the server closes it. */
async function openStream(auth: Auth): Promise<{ ended: Promise<void> }> {
  const { body } = await api("POST", "/api/auth/stream-ticket", auth);
  expect(body.ticket).toMatch(/^sgx_tick_/);
  return new Promise((resolve, reject) => {
    const req = request(`${BASE}/api/events?ticket=${encodeURIComponent(body.ticket)}`, { headers: { accept: "text/event-stream" } }, (res) => {
      expect(res.statusCode).toBe(200);
      const ended = new Promise<void>((done) => { res.on("end", () => done()); res.on("close", () => done()); res.on("error", () => done()); });
      res.resume();
      resolve({ ended });
    });
    req.on("error", reject);
    req.end();
  });
}

async function start() {
  child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
    cwd: join(SERVER_DIR, ".."),
    env: {
      ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
      HOME: home, USERPROFILE: home, SAGAX_LOCAL_VM_TEST_NAMESPACE: process.env.SAGAX_LOCAL_VM_TEST_NAMESPACE ?? "", SAGAX_PORT: String(PORT), SAGAX_WEBHOOK_PORT: String(PORT + 1),
      SAGAX_IDENTITY: "perspicax",
      SAGAX_PERSPICAX_ISSUER: idp.issuer,
      SAGAX_PUBLIC_URL: BASE,
      SAGAX_OIDC_REFRESH_AFTER_SECONDS: "1",
      SAGAX_CLI_OWNER_STDIN: "1",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdin!.write(`${CLI_OWNER}\n`);
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
    await sleep(150);
  }
}

posixOnly("Sign in with Pulsatrix, slice 2: the session lives on the provider's grant", () => {
  beforeAll(async () => {
    chmodSync(FAKE_CLI, 0o755);
    idp = await startFakeOidcProvider({ user: ALICE });
    PORT = await freePortBlock([0, 1]);
    BASE = `http://127.0.0.1:${PORT}`;
    home = mkdtempSync(join(tmpdir(), "omb-oidc-session-"));
    const data = join(home, ".sagax");
    mkdirSync(data, { recursive: true });
    const now = Date.now();
    writeFileSync(join(data, "sessions.json"), JSON.stringify({ version: 1, sessions: [{
      id: "sess_legacy_device", tokenHash: createHash("sha256").update(LEGACY_BEARER).digest("hex"), label: "Old phone",
      // a chat-only code: the boot migration binds only admin devices to the local operator
      scopes: ["client"], createdAt: now, lastSeenAt: now, expiresAt: now + 24 * 60 * 60_000,
    }] }), { mode: 0o600 });
    writeFileSync(join(data, "config.json"), JSON.stringify({
      instances: { grok: { driver: "grokAgent", config: { cli: FAKE_CLI, fullAuto: false } } },
    }));
    await start();
  });

  afterAll(async () => {
    child?.kill("SIGTERM");
    if (child) await waitForExit(child);
    await idp?.close();
    if (home) removeTempDir(home);
  });

  it("S2-1: refreshes a due grant on use, in the background, and rotates it again later", async () => {
    const bob = await signIn(BOB);
    const before = idp.refreshCount;
    await sleep(1_100);
    expect((await api("GET", "/api/auth/session", bob)).status).toBe(200);
    expect(await waitFor(async () => idp.refreshCount > before)).toBe(true);
    expect(idp.lastTokenRequest).toMatchObject({ grant_type: "refresh_token", client_id: "pulsa-bot", resource: BASE });
    await sleep(1_100);
    expect((await api("GET", "/api/auth/session", bob)).status).toBe(200);
    expect(await waitFor(async () => idp.refreshCount > before + 1)).toBe(true);
    expect((await api("GET", "/api/auth/session", bob)).status).toBe(200);
  });

  it("S2-2: a role change at the provider narrows the session on its next refresh", async () => {
    const carol = await signIn(CAROL);
    expect((await api("GET", "/api/auth/session", carol)).body).toMatchObject({ scopes: ["admin", "client"], role: "admin" });
    idp.setRole(CAROL.sub, "employee");
    const before = idp.refreshCount;
    await sleep(1_100);
    await api("GET", "/api/auth/session", carol);
    await waitFor(async () => idp.refreshCount > before);
    const after = await waitFor(async () => {
      const got = await api("GET", "/api/auth/session", carol);
      return got.body.role === "employee" ? got : null;
    });
    expect(after?.body).toMatchObject({ scopes: ["client"], role: "employee", orgRole: "member" });
    expect((await api("GET", "/api/auth/pairing", carol)).status).toBe(403);
    idp.setRole(CAROL.sub, "admin");
  });

  it("S2-2 strict: the one request that finds the grant due is already served with the provider's new role", async () => {
    const hank = await signIn(HANK);
    expect((await api("GET", "/api/auth/pairing", hank)).status).toBe(200);
    idp.setRole(HANK.sub, "employee");
    try {
      await sleep(1_100);
      expect((await api("GET", "/api/auth/pairing", hank)).status).toBe(403);
      expect((await api("GET", "/api/auth/session", hank)).body).toMatchObject({ scopes: ["client"], role: "employee" });
    } finally {
      idp.setRole(HANK.sub, "admin");
    }
  });

  it("the one request that finds the grant due is refused when the provider disabled the person", async () => {
    const ivy = await signIn(IVY);
    idp.disable(IVY.sub);
    try {
      await sleep(1_100);
      expect((await api("GET", "/api/auth/session", ivy)).status).toBe(401);
    } finally {
      idp.enable(IVY.sub);
    }
  });

  it("S2-3 and S2-6: forged logout tokens change nothing; a valid one ends the person's sessions and stream at once; a replay is refused", async () => {
    const dave = await signIn(DAVE);
    const daveAgain = await signIn(DAVE);
    const stream = await openStream(dave);
    for (const forged of [
      idp.logoutToken({ sub: DAVE.sub, strayKey: true }),
      idp.logoutToken({ sub: DAVE.sub, header: (h) => ({ ...h, alg: "none" }) }),
      idp.logoutToken({ sub: DAVE.sub, claims: (c) => ({ ...c, aud: "someone-else" }) }),
      idp.logoutToken({ sub: DAVE.sub, claims: (c) => ({ ...c, iss: "https://evil.example" }) }),
      idp.logoutToken({ sub: DAVE.sub, claims: (c) => ({ ...c, exp: Math.floor(Date.now() / 1000) - 300 }) }),
      idp.logoutToken({ sub: DAVE.sub, claims: (c) => { const { events: _e, ...rest } = c; return rest; } }),
      idp.logoutToken({ sub: DAVE.sub, claims: (c) => ({ ...c, nonce: "n" }) }),
    ]) {
      const res = await backchannel(forged);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_request" });
    }
    expect((await api("GET", "/api/auth/session", dave)).status).toBe(200);
    const principalId = (await api("GET", "/api/auth/session", dave)).body.principalId;
    const logout = idp.logoutToken({ sub: DAVE.sub });
    const revokedBefore = idp.revoked.length;
    const started = Date.now();
    const res = await backchannel(logout);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    await stream.ended;
    expect(Date.now() - started).toBeLessThan(3_000);
    expect((await api("GET", "/api/auth/session", dave)).status).toBe(401);
    expect((await api("GET", "/api/auth/session", daveAgain)).status).toBe(401);
    // the provider already ended the grant: nothing is revoked back
    await sleep(200);
    expect(idp.revoked.length).toBe(revokedBefore);
    expect((await backchannel(logout)).status).toBe(400);
    // signing in again works, same person
    const back = await signIn(DAVE);
    expect((await api("GET", "/api/auth/session", back)).body).toMatchObject({ principalId });
  });

  it("ends the session when the provider refuses the refresh (a disabled person)", async () => {
    const bob = await signIn(BOB);
    idp.disable(BOB.sub);
    try {
      await sleep(1_100);
      await api("GET", "/api/auth/session", bob);
      const refused = await waitFor(async () => (await api("GET", "/api/auth/session", bob)).status === 401);
      expect(refused).toBe(true);
    } finally {
      idp.enable(BOB.sub);
    }
  });

  it("T8 fallback: a refused refresh ends the devices a member paired, even when the back-channel push never arrived", async () => {
    const bob = await signIn(BOB);
    const code = await api("POST", "/api/auth/pairing", bob, { label: "Bob's phone" });
    expect(code.status, JSON.stringify(code.body)).toBe(200);
    const phone = await api("POST", "/api/pair", undefined, { credential: code.body.credential, deviceName: "Bob's phone", pairRequestId: "pair-request-t8-1" });
    expect(phone.status).toBe(200);
    const bearer = phone.body.token as string;
    // and a device that phone paired in turn
    const code2 = await api("POST", "/api/auth/pairing", { bearer }, { label: "Bob's tablet" });
    const tablet = await api("POST", "/api/pair", undefined, { credential: code2.body.credential, deviceName: "Bob's tablet", pairRequestId: "pair-request-t8-2" });
    expect(tablet.status).toBe(200);
    const pending = await api("POST", "/api/auth/pairing", bob, { label: "later" });
    expect(pending.status).toBe(200);
    // Perspicax disables Bob, but the push is lost (Sagax was restarting)
    idp.disable(BOB.sub);
    try {
      await sleep(1_100);
      await api("GET", "/api/auth/session", bob);
      expect(await waitFor(async () => (await api("GET", "/api/auth/session", bob)).status === 401)).toBe(true);
      expect((await api("GET", "/api/auth/session", { bearer })).status).toBe(401);
      expect((await api("GET", "/api/auth/session", { bearer: tablet.body.token })).status).toBe(401);
      expect((await api("POST", "/api/pair", undefined, { credential: pending.body.credential, deviceName: "late" })).status).not.toBe(200);
    } finally {
      idp.enable(BOB.sub);
    }
  });

  it("a device paired from the web follows the person's other grant after a web logout: a demotion with no push narrows it", async () => {
    const web = await signIn(ERIN);
    const laptop = await signIn(ERIN);
    const code = await api("POST", "/api/auth/pairing", web, { scopes: ["admin", "client"], label: "Erin's phone" });
    expect(code.status, JSON.stringify(code.body)).toBe(200);
    const paired = await api("POST", "/api/pair", undefined, { credential: code.body.credential, deviceName: "Erin's phone", pairRequestId: "pair-request-follow-1" });
    expect(paired.status).toBe(200);
    const phone = { bearer: paired.body.token as string };
    expect((await api("GET", "/api/auth/session", phone)).body.scopes).toEqual(["admin", "client"]);
    expect((await api("POST", "/api/auth/logout", web)).status).toBe(200);
    // Perspicax demotes Erin; no back-channel is sent for a role change
    idp.setRole(ERIN.sub, "employee");
    try {
      const before = idp.refreshCount;
      await sleep(1_100);
      await api("GET", "/api/auth/session", phone);
      expect(await waitFor(async () => idp.refreshCount > before)).toBe(true);
      const narrowed = await waitFor(async () => {
        const got = await api("GET", "/api/auth/session", phone);
        return got.status === 200 && got.body.scopes.length === 1 ? got : null;
      });
      expect(narrowed?.body.scopes).toEqual(["client"]);
      expect((await api("GET", "/api/auth/pairing", phone)).status).toBe(403);
      expect((await api("GET", "/api/auth/session", laptop)).body).toMatchObject({ scopes: ["client"], role: "employee" });
    } finally {
      idp.setRole(ERIN.sub, "admin");
    }
  });

  it("a device paired from the web never holds more than its person's organization role, on the very request", async () => {
    const web = await signIn(GRACE);
    const code = await api("POST", "/api/auth/pairing", web, { scopes: ["admin", "client"], label: "Grace's phone" });
    const paired = await api("POST", "/api/pair", undefined, { credential: code.body.credential, deviceName: "Grace's phone", pairRequestId: "pair-request-follow-3" });
    expect(paired.status).toBe(200);
    const phone = { bearer: paired.body.token as string };
    expect((await api("POST", "/api/auth/logout", web)).status).toBe(200);
    // demoted, then signed in again on the web: the person is a member now
    idp.setRole(GRACE.sub, "employee");
    try {
      const again = await signIn({ ...GRACE, role: "employee" });
      expect((await api("GET", "/api/auth/session", again)).body).toMatchObject({ orgRole: "member" });
      const admin = await api("GET", "/api/auth/pairing", phone);
      expect(admin.status).toBe(403);
      expect((await api("GET", "/api/auth/session", phone)).body.scopes).toEqual(["client"]);
    } finally {
      idp.setRole(GRACE.sub, "admin");
    }
  });

  it("T8 with only a paired device left: after a web logout and a lost push, the device is refused", async () => {
    const web = await signIn(FRANK);
    const code = await api("POST", "/api/auth/pairing", web, { label: "Frank's phone" });
    expect(code.status, JSON.stringify(code.body)).toBe(200);
    const paired = await api("POST", "/api/pair", undefined, { credential: code.body.credential, deviceName: "Frank's phone", pairRequestId: "pair-request-follow-2" });
    expect(paired.status).toBe(200);
    const phone = { bearer: paired.body.token as string };
    expect((await api("GET", "/api/auth/session", phone)).status).toBe(200);
    expect((await api("POST", "/api/auth/logout", web)).status).toBe(200);
    // Perspicax disables Frank while the push is lost
    idp.disable(FRANK.sub);
    try {
      const refused = await api("GET", "/api/auth/session", phone);
      expect(refused.status).toBe(401);
      expect(refused.body).toMatchObject({ code: "idp_session_ended" });
    } finally {
      idp.enable(FRANK.sub);
    }
  });

  it("D13: a member pairs only their own devices, never wider than themselves", async () => {
    const dave = await signIn(DAVE);
    const me = (await api("GET", "/api/auth/session", dave)).body;
    expect(me).toMatchObject({ scopes: ["client"] });
    // asking for admin alone is refused, never an admin code
    const admin = await api("POST", "/api/auth/pairing", dave, { scopes: ["admin"], label: "x" });
    expect(admin.status).toBe(403);
    expect(admin.body).toMatchObject({ code: "scope_exceeds_session" });
    expect(admin.body.credential).toBeUndefined();
    // no scopes in the body: a client code bound to Dave
    const plain = await api("POST", "/api/auth/pairing", dave, { label: "Dave's phone" });
    expect(plain.status, JSON.stringify(plain.body)).toBe(200);
    const phone = await api("POST", "/api/pair", undefined, { credential: plain.body.credential, deviceName: "Dave's phone", pairRequestId: "pair-request-d13-1" });
    expect(phone.status).toBe(200);
    const phoneSession = (await api("GET", "/api/auth/session", { bearer: phone.body.token })).body;
    expect(phoneSession.scopes).toEqual(["client"]);
    expect(storedSession(phoneSession.id)).toMatchObject({ principalId: me.principalId, scopes: ["client"] });
    // a wider request is clamped to what Dave holds
    const wide = await api("POST", "/api/auth/pairing", dave, { scopes: ["admin", "client"] });
    expect(wide.status).toBe(200);
    const tablet = await api("POST", "/api/pair", undefined, { credential: wide.body.credential, deviceName: "Dave's tablet", pairRequestId: "pair-request-d13-2" });
    const tabletSession = (await api("GET", "/api/auth/session", { bearer: tablet.body.token })).body;
    expect(tabletSession.scopes).toEqual(["client"]);
    expect(storedSession(tabletSession.id)).toMatchObject({ principalId: me.principalId, scopes: ["client"] });
    // an admin gets an admin code bound to her
    const alice = await signIn(ALICE);
    const aliceMe = (await api("GET", "/api/auth/session", alice)).body;
    const adminCode = await api("POST", "/api/auth/pairing", alice, { scopes: ["admin", "client"] });
    expect(adminCode.status).toBe(200);
    const aliceDevice = await api("POST", "/api/pair", undefined, { credential: adminCode.body.credential, deviceName: "Alice's phone", pairRequestId: "pair-request-d13-3" });
    const aliceDeviceSession = (await api("GET", "/api/auth/session", { bearer: aliceDevice.body.token })).body;
    expect(aliceDeviceSession.scopes).toEqual(["admin", "client"]);
    expect(storedSession(aliceDeviceSession.id)).toMatchObject({ principalId: aliceMe.principalId });
  });

  it("D13: a session without a person cannot pair a device on an organization server", async () => {
    // a device paired before the server joined the organization: no person behind it
    expect(storedSession("sess_legacy_device")?.principalId).toBeUndefined();
    for (const scopes of [["client"], ["admin", "client"], undefined]) {
      const refused = await api("POST", "/api/auth/pairing", { bearer: LEGACY_BEARER }, scopes ? { scopes } : {});
      expect(refused.status).toBe(403);
      expect(refused.body).toMatchObject({ code: "principal_required" });
      expect(refused.body.credential).toBeUndefined();
    }
  });

  it("S2-5: logout revokes the grant at the provider", async () => {
    const alice = await signIn(ALICE);
    const live = new Set(idp.liveRefreshTokens());
    const res = await api("POST", "/api/auth/logout", alice);
    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie().join(";")).toMatch(/Max-Age=0/);
    const revoked = await waitFor(async () => idp.revoked.find((r) => r.token && live.has(r.token)) ?? null, 3_000);
    expect(revoked).toMatchObject({ token_type_hint: "refresh_token", client_id: "pulsa-bot" });
    expect((await api("GET", "/api/auth/session", alice)).status).toBe(401);
  });

  it("S2-7b: the desktop sign-in comes back to the app's loopback listener, the credential in the fragment only", async () => {
    const env = await (await fetch(`${BASE}/.well-known/openmausbot/environment`)).json() as { identity?: { loopbackReturn?: boolean } };
    expect(env.identity?.loopbackReturn).toBe(true);
    const listener = await startLoopbackReturn();
    idp.user = { ...ALICE };
    // the system browser: start (with the return), the provider, the callback
    const start = await fetch(`${BASE}/auth/oidc/start?client=desktop&return=${encodeURIComponent(listener.returnTo)}`, { redirect: "manual" });
    expect(start.status).toBe(303);
    const binding = cookiePair(start.headers.getSetCookie().find((c) => c.includes("_oidc="))!);
    const authorize = await fetch(start.headers.get("location")!, { redirect: "manual" });
    // Perspicax is unchanged: its redirect stays the server's callback
    expect(authorize.headers.get("location")!.startsWith(`${BASE}/auth/oidc/callback?`)).toBe(true);
    const callback = await fetch(authorize.headers.get("location")!, { redirect: "manual", headers: { cookie: binding } });
    expect(callback.status).toBe(303);
    const location = callback.headers.get("location") ?? "";
    const target = new URL(location);
    expect(`${target.origin}${target.pathname}`).toBe(listener.returnTo);
    expect(target.search).toBe("");
    const code = new URLSearchParams(target.hash.slice(1)).get("code")!;
    expect(code).toMatch(/^omb_pair_[A-Za-z0-9_-]{43}$/);
    // the browser follows without the fragment, gets the page, and its script posts the fragment back
    const page = await fetch(listener.returnTo);
    expect(await page.text()).toContain("Connexion réussie, vous pouvez revenir à Sagax");
    const posted = await fetch(listener.returnTo, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", origin: new URL(listener.returnTo).origin },
      body: new URLSearchParams({ code }).toString(),
    });
    expect(posted.status).toBe(200);
    expect(await listener.result).toEqual({ code });
    // the app then redeems it on /pair, once
    const paired = await api("POST", "/api/auth/pair", undefined, { code, label: "My Mac", cookie: true, attemptId: "attempt-desktop-loopback-1" });
    expect(paired.status).toBe(200);
    const cookie = cookiePair(paired.headers.getSetCookie().find((c) => c.startsWith("omb_session_"))!);
    expect((await api("GET", "/api/auth/session", { cookie })).body).toMatchObject({ identity: "perspicax", role: "admin", email: "alice@example.test" });
    expect((await api("POST", "/api/auth/pair", undefined, { code, cookie: true })).status).toBe(401);
    // the credential never reached the server's log
    expect(log).not.toContain(code);
    // a return that is not a loopback listener is refused before the provider
    const evil = await fetch(`${BASE}/auth/oidc/start?client=desktop&return=${encodeURIComponent("http://localhost:5555/" + "S".repeat(43))}`, { redirect: "manual" });
    expect(evil.headers.get("location")).toBe("/pair#signin_error=return");
  });

  it("S2-7: the desktop return link redeems once into a person-bound cookie session", async () => {
    const { location } = await walk(ALICE, "desktop");
    const match = /^sagax:\/\/auth\?origin=([^#]+)#code=(omb_pair_[A-Za-z0-9_-]{43})$/.exec(location);
    expect(match, location).not.toBeNull();
    expect(decodeURIComponent(match![1]!)).toBe(BASE);
    const paired = await api("POST", "/api/auth/pair", undefined, { code: match![2], label: "My Mac", cookie: true, attemptId: "attempt-desktop-1" });
    expect(paired.status).toBe(200);
    const cookie = cookiePair(paired.headers.getSetCookie().find((c) => c.startsWith("omb_session_"))!);
    const session = await api("GET", "/api/auth/session", { cookie });
    expect(session.body).toMatchObject({ identity: "perspicax", scopes: ["admin", "client"], role: "admin", email: "alice@example.test" });
    expect(session.body.principalId).toMatch(/^pr_/);
    expect((await api("POST", "/api/auth/pair", undefined, { code: match![2], cookie: true })).status).toBe(401);
    // its grant refreshes like a web one
    const before = idp.refreshCount;
    await sleep(1_100);
    await api("GET", "/api/auth/session", { cookie });
    expect(await waitFor(async () => idp.refreshCount > before)).toBe(true);
  });

  it("S2-8: the phone return link redeems into a bearer that a back-channel logout ends by principal", async () => {
    const { location } = await walk(BOB, "phone");
    const url = new URL(location);
    expect(`${url.protocol}//${url.host}`).toBe("sagax://pair");
    expect(url.searchParams.get("address")).toBe(BASE);
    const token = url.searchParams.get("token")!;
    expect(token).toMatch(/^omb_pair_[A-Za-z0-9_-]{43}$/);
    const paired = await api("POST", "/api/pair", undefined, { credential: token, deviceName: "Bob's phone", pairRequestId: "pair-request-phone-1" });
    expect(paired.status).toBe(200);
    const bearer = paired.body.token as string;
    const session = await api("GET", "/api/auth/session", { bearer });
    expect(session.body).toMatchObject({ identity: "perspicax", scopes: ["client"], role: "employee" });
    // a device Bob pairs himself from that phone: his person, never wider
    const code = await api("POST", "/api/auth/pairing", { bearer }, { scopes: ["admin", "client"], label: "Bob's tablet" });
    expect(code.status, JSON.stringify(code.body)).toBe(200);
    const tablet = await api("POST", "/api/pair", undefined, { credential: code.body.credential, deviceName: "Bob's tablet" });
    const tabletSession = await api("GET", "/api/auth/session", { bearer: tablet.body.token });
    // (its person shows below: the back-channel logout ends it by principal)
    expect(tabletSession.body).toMatchObject({ kind: "session", scopes: ["client"] });
    // Perspicax disables Bob: both devices are cut
    expect((await backchannel(idp.logoutToken({ sub: BOB.sub }))).status).toBe(200);
    expect((await api("GET", "/api/auth/session", { bearer })).status).toBe(401);
    expect((await api("GET", "/api/auth/session", { bearer: tablet.body.token })).status).toBe(401);
  });

  it("S2-8b: a phone that names return=sagax gets sagax://pair and a session bound to its person", async () => {
    const { location } = await walk(BOB, "phone", "sagax");
    const url = new URL(location);
    expect(`${url.protocol}//${url.host}`).toBe("sagax://pair");
    expect(url.searchParams.get("address")).toBe(BASE);
    const token = url.searchParams.get("token")!;
    expect(token).toMatch(/^omb_pair_[A-Za-z0-9_-]{43}$/);
    const paired = await api("POST", "/api/pair", undefined, { credential: token, deviceName: "Bob's iPhone", pairRequestId: "pair-request-phone-sagax" });
    expect(paired.status).toBe(200);
    const bearer = paired.body.token as string;
    const session = await api("GET", "/api/auth/session", { bearer });
    expect(session.body).toMatchObject({ identity: "perspicax", scopes: ["client"], role: "employee" });
    expect(session.body.principalId).toMatch(/^pr_/);
    // the same person as Bob's web sign-in, never an admin
    const web = await signIn(BOB);
    expect((await api("GET", "/api/auth/session", web)).body.principalId).toBe(session.body.principalId);
    // An admin page stays closed to it. Since #2045 a member manages their own
    // teams, so /api/sidebar-sections is no longer an admin probe.
    expect((await api("GET", "/api/auth/pairing", { bearer })).status).toBe(403);
    // single use
    expect((await api("POST", "/api/pair", undefined, { credential: token, deviceName: "again" })).status).not.toBe(200);
    expect(log).not.toContain(token);
  });

  it("advertises the native return and refuses an unknown client", async () => {
    const env = await (await fetch(`${BASE}/.well-known/openmausbot/environment`)).json() as { identity: unknown };
    expect(env.identity).toMatchObject({ kind: "perspicax", nativeReturn: true, loginPath: "/auth/oidc/start" });
    const bad = await fetch(`${BASE}/auth/oidc/start?client=tv`, { redirect: "manual" });
    expect(bad.headers.get("location")).toBe("/pair#signin_error=client");
    expect(log).not.toMatch(/pxlr1\.|omb_pair_[A-Za-z0-9_-]{43}/);
  });
});
