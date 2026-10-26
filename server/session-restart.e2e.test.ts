// 2026-10-19 (JC signed out several times a day on the GOX server): a "Sign
// in with Pulsatrix" session must survive a server restart, clean or not (an
// out-of-memory kill, a deploy stop that outran its grace period), and an
// app update; it ends only when the provider says so.
//
//   R1  a clean restart (SIGTERM) keeps the session
//   R2  a crash (SIGKILL) keeps the session; the provider confirms it once
//   R3  a crash, then the person is disabled at the provider: signed out
//   R4  a crash, the provider down for a moment: 503 to retry, never a sign-out
//   R5  a logout before the crash stays a logout
//   R6  an app update (new build, empty HTTP cache, same cookie jar): still signed in
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { removeTempDir, waitForExit } from "./testing/cleanup.ts";
import { startFakeOidcProvider, type FakeOidcProvider, type FakeOidcUser } from "./testing/fake-oidc-provider.ts";
import { freePortBlock } from "./testing/ports.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const FAKE_CLI = join(SERVER_DIR, "testing", "fake-acp-cli.ts");
const posixOnly = describe.skipIf(process.platform === "win32");
const ALICE: FakeOidcUser = { sub: "01J9R1ALICE00000000000000A", email: "alice@example.test", name: "Alice", preferred_username: "alice", role: "admin" };
const BOB: FakeOidcUser = { sub: "01J9R1BOB000000000000000B", email: "bob@example.test", name: "Bob", preferred_username: "bob", role: "employee" };
const CAROL: FakeOidcUser = { sub: "01J9R1CAROL00000000000000C", email: "carol@example.test", name: "Carol", preferred_username: "carol", role: "employee" };
const DAVE: FakeOidcUser = { sub: "01J9R1DAVE000000000000000D", email: "dave@example.test", name: "Dave", preferred_username: "dave", role: "employee" };
const CLI_OWNER = "cli-owner-token-0123456789abcdefghijklmnopq";

let PORT = 0;
let BASE = "";
let child: ChildProcess;
let home: string;
let log = "";
let idp: FakeOidcProvider;

type Auth = { cookie: string };
const api = async (method: string, path: string, auth?: Auth): Promise<{ status: number; body: any; headers: Headers }> => {
  const res = await fetch(`${BASE}${path}`, { method, headers: auth?.cookie ? { cookie: auth.cookie } : {} });
  return { status: res.status, body: await res.json().catch(() => ({})), headers: res.headers };
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const cookiePair = (setCookie: string) => setCookie.split(";")[0]!;

async function signIn(user: FakeOidcUser): Promise<Auth> {
  idp.user = { ...user };
  const start = await fetch(`${BASE}/auth/oidc/start`, { redirect: "manual" });
  const binding = cookiePair(start.headers.getSetCookie().find((c) => c.includes("_oidc="))!);
  const authorize = await fetch(start.headers.get("location")!, { redirect: "manual" });
  const callback = await fetch(authorize.headers.get("location")!, { redirect: "manual", headers: { cookie: binding } });
  const session = callback.headers.getSetCookie().find((c) => c.startsWith("omb_session_") && !c.includes("_oidc="));
  expect(callback.headers.get("location"), log.slice(-2000)).toBe("/");
  return { cookie: cookiePair(session!) };
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

async function restart(signal: "SIGTERM" | "SIGKILL") {
  child.kill(signal);
  await waitForExit(child);
  if (signal === "SIGKILL") expect(existsSync(join(home, ".sagax", "sessions.json.open"))).toBe(true);
  await start();
}

posixOnly("a Pulsatrix sign-in across server restarts and app updates", () => {
  beforeAll(async () => {
    chmodSync(FAKE_CLI, 0o755);
    idp = await startFakeOidcProvider({ user: ALICE });
    PORT = await freePortBlock([0, 1]);
    BASE = `http://127.0.0.1:${PORT}`;
    home = mkdtempSync(join(tmpdir(), "omb-session-restart-"));
    const data = join(home, ".sagax");
    mkdirSync(data, { recursive: true });
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

  it("R1: a clean restart keeps the session", async () => {
    const alice = await signIn(ALICE);
    expect((await api("GET", "/api/auth/session", alice)).status).toBe(200);
    await restart("SIGTERM");
    expect((await api("GET", "/api/auth/session", alice)).status).toBe(200);
  });

  it("R2-R5: after a crash, a live sign-in is kept, a disabled one ends, a provider outage asks to retry, a logout stays", async () => {
    const alice = await signIn(ALICE);
    const bob = await signIn(BOB);
    const carol = await signIn(CAROL);
    const dave = await signIn(DAVE);
    for (const who of [alice, bob, carol, dave]) expect((await api("GET", "/api/auth/session", who)).status).toBe(200);
    expect((await api("POST", "/api/auth/logout", dave)).status).toBeLessThan(300);
    await restart("SIGKILL");

    // R2: confirmed by a refresh at the provider, then served.
    const before = idp.refreshCount;
    expect((await api("GET", "/api/auth/session", alice)).status, log.slice(-2000)).toBe(200);
    expect(idp.refreshCount).toBeGreaterThan(before);
    const afterFirst = idp.refreshCount;
    expect((await api("GET", "/api/auth/session", alice)).status).toBe(200);
    expect(idp.refreshCount).toBe(afterFirst); // confirmed once, not on every request

    // R3: disabled at the provider while the server was down.
    idp.disable(BOB.sub);
    const ended = await api("GET", "/api/auth/session", bob);
    expect(ended.status).toBe(401);
    expect((await api("GET", "/api/auth/session", bob)).status).toBe(401);

    // R4: the provider fails once: retry later, the session is not thrown away.
    idp.failNextToken(503);
    const pending = await api("GET", "/api/auth/session", carol);
    expect(pending.status).toBe(503);
    expect(pending.body.code).toBe("idp_recheck_pending");
    expect(pending.headers.get("set-cookie") ?? "").not.toMatch(/omb_session_[^=]*=;/);
    await sleep(61_000); // the transient-failure gate (IDP_RETRY_AFTER_FAILURE_MS)
    expect((await api("GET", "/api/auth/session", carol)).status).toBe(200);

    // R5: logged out before the crash: still out.
    expect((await api("GET", "/api/auth/session", dave)).status).toBe(401);
  }, 120_000);

  it("R6: an app update (empty HTTP cache, same cookie) and a server deploy keep the session", async () => {
    const alice = await signIn(ALICE);
    // The desktop app's update path clears only the HTTP cache
    // (electron/startup-cache-eviction.mjs): the cookie jar stays. A new
    // client with nothing but that cookie, after a deploy that was killed.
    await restart("SIGKILL");
    const res = await fetch(`${BASE}/api/auth/session`, { headers: { cookie: alice.cookie, "cache-control": "no-cache" } });
    expect(res.status, `${JSON.stringify(await res.clone().json().catch(() => null))}\n${log.slice(-3000)}`).toBe(200);
  });
});
