// A member's routines on an organization server (slice 8 fix): the routine
// list, its single route and live routine frames follow the bot and room
// rules, not the legacy email-keyed set, which opened everything to members.
import { spawn, type ChildProcess } from "node:child_process";
import { request } from "node:http";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { removeTempDir, waitForExit } from "../testing/cleanup.ts";
import { startFakeOidcProvider, type FakeOidcProvider, type FakeOidcUser } from "../testing/fake-oidc-provider.ts";
import { freePortBlock } from "../testing/ports.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const posixOnly = describe.skipIf(process.platform === "win32");
const ALICE: FakeOidcUser = { sub: "01J9S8ALICE00000000000000A", email: "alice@example.test", name: "Alice", preferred_username: "alice", role: "admin" };
const BOB: FakeOidcUser = { sub: "01J9S8BOB000000000000000B", email: "bob@example.test", name: "Bob", preferred_username: "bob", role: "employee" };
const CAROL: FakeOidcUser = { sub: "01J9S8CAROL0000000000000C", email: "carol@example.test", name: "Carol", preferred_username: "carol", role: "employee" };

let PORT = 0;
let BASE = "";
let child: ChildProcess;
let home: string;
let log = "";
let idp: FakeOidcProvider;

type Auth = { cookie?: string; token?: string };
const api = async (method: string, path: string, auth?: Auth, body?: unknown): Promise<{ status: number; body: any; text: string }> => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(auth?.cookie ? { cookie: auth.cookie } : {}),
      ...(auth?.token ? { authorization: `Bearer ${auth.token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  let parsed: any = {};
  try { parsed = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body: parsed, text };
};
const cookiePair = (setCookie: string) => setCookie.split(";")[0]!;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
      SAGAX_PERSPICAX_LINK_FILE: join(home, "link", "pulsabot.json"),
      SAGAX_PERSPICAX_DIRECTORY_SECONDS: "5",
      SAGAX_ANTHROPIC_API_KEY: "sk-ant-test-org-key",
      SAGAX_ORG_NAME: "Acme",
      // the operator at this computer (the serve CLI, the desktop app) may
      // make a pairing code without a session
      SAGAX_LOOPBACK_TRUST: "owner",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout!.on("data", (c) => (log += c));
  child.stderr!.on("data", (c) => (log += c));
  const deadline = Date.now() + 20_000;
  for (;;) {
    try {
      if ((await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(2_000) })).ok) return;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) throw new Error(`server never came up:\n${log}`);
    await sleep(150);
  }
}

async function openStream(auth: Auth): Promise<{ text: () => string; close: () => void }> {
  const { body } = await api("POST", "/api/auth/stream-ticket", auth);
  return new Promise((resolve, reject) => {
    let received = "";
    const req = request(`${BASE}/api/events?ticket=${encodeURIComponent(body.ticket)}`, { headers: { accept: "text/event-stream" } }, (res) => {
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => { received += chunk; });
      resolve({ text: () => received, close: () => req.destroy() });
    });
    req.on("error", reject);
    req.end();
  });
}

async function waitFor(check: () => boolean | Promise<boolean>, ms = 10_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error("timed out");
    await sleep(100);
  }
}

posixOnly("Perspicax organization: a member's routines stay with the people who see the bot", () => {
  let bob: Auth;
  let carol: Auth;
  let bobBotId = "";

  beforeAll(async () => {
    idp = await startFakeOidcProvider({ user: ALICE });
    idp.directoryPeople = [ALICE, BOB, CAROL].map((user) => idp.personOf(user));
    PORT = await freePortBlock([0, 1]);
    BASE = `http://127.0.0.1:${PORT}`;
    home = mkdtempSync(join(tmpdir(), "omb-org-routines-"));
    const data = join(home, ".sagax");
    mkdirSync(data, { recursive: true });
    mkdirSync(join(home, "link"), { recursive: true, mode: 0o750 });
    writeFileSync(join(home, "link", "pulsabot.json"), JSON.stringify({
      version: 1, issuer: idp.issuer, client_id: "pulsa-bot", server_id: idp.serverId, origin: BASE, link_token: idp.linkToken,
    }), { mode: 0o640 });
    writeFileSync(join(data, "config.json"), JSON.stringify({ profile: { name: "Operator", email: "op@example.test" } }));
    await start();
    await signIn(ALICE);
    bob = await signIn(BOB);
    carol = await signIn(CAROL);
    const created = await api("POST", "/api/bots", bob, { name: "Bolt" });
    expect(created.status, created.text).toBe(201);
    bobBotId = created.body.bot.id;
  }, 60_000);

  afterAll(async () => {
    child?.kill("SIGTERM");
    if (child) await waitForExit(child);
    await idp?.close();
    if (home) removeTempDir(home);
  });

  it("keeps bob's routine off carol's list, her stream and its own routes", async () => {
    const carolStream = await openStream(carol);
    const bobStream = await openStream(bob);
    const routine = await api("POST", "/api/routines", bob, {
      name: "Bolt hourly", botId: bobBotId, prompt: "Resume les nouvelles", enabled: false,
      schedule: { type: "interval", everyMinutes: 60, anchorAt: Date.now() + 3_600_000 },
    });
    expect(routine.status, routine.text).toBe(201);
    const id = routine.body.routine.id as string;
    // bob hears it live and lists it: the stream works, it is not just quiet
    await waitFor(() => bobStream.text().includes(id));
    const bobList = await api("GET", "/api/routines", bob);
    expect((bobList.body.routines as Array<{ id: string }>).map((r) => r.id)).toContain(id);
    await sleep(300);
    expect(carolStream.text()).not.toContain(id);
    expect(carolStream.text()).not.toContain("Bolt hourly");
    const carolList = await api("GET", "/api/routines", carol);
    expect(carolList.status).toBe(200);
    expect(carolList.text).not.toContain(id);
    expect(carolList.text).not.toContain("Resume les nouvelles");
    const carolGet = await api("GET", `/api/routines/${id}`, carol);
    // no member reads a single routine by id (admin scope); never its body
    expect([403, 404], carolGet.text).toContain(carolGet.status);
    expect(carolGet.text).not.toContain("Bolt hourly");
    const carolPatch = await api("PATCH", `/api/routines/${id}`, carol, { name: "x" });
    expect(carolPatch.status, carolPatch.text).toBe(404);
    // an edit reaches bob, never carol
    expect((await api("PATCH", `/api/routines/${id}`, bob, { name: "Bolt daily" })).status).toBe(200);
    await waitFor(() => bobStream.text().includes("Bolt daily"));
    await sleep(300);
    expect(carolStream.text()).not.toContain("Bolt daily");
    carolStream.close();
    bobStream.close();
  }, 60_000);
});
