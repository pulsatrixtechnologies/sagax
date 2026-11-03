// A chat-only device with no person behind it, on a Perspicax organization
// server (slice 8 fix). Such devices still exist there: a pairing session from
// the interim era is kept as is, and a chat-only code made from this computer
// pairs a device with no principal. Neither may see another person's Directs
// or private sections, nor act as the operator (profile, bot looks).
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { removeTempDir, waitForExit } from "../testing/cleanup.ts";
import { startFakeOidcProvider, type FakeOidcProvider, type FakeOidcUser } from "../testing/fake-oidc-provider.ts";
import { freePortBlock } from "../testing/ports.ts";
import { SessionRegistry } from "../auth/sessions.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const posixOnly = describe.skipIf(process.platform === "win32");
const ALICE: FakeOidcUser = { sub: "01J9S8ALICE00000000000000A", email: "alice@example.test", name: "Alice", preferred_username: "alice", role: "admin" };
const BOB: FakeOidcUser = { sub: "01J9S8BOB000000000000000B", email: "bob@example.test", name: "Bob", preferred_username: "bob", role: "employee" };

let PORT = 0;
let BASE = "";
let child: ChildProcess;
let home: string;
let log = "";
let idp: FakeOidcProvider;
let interimToken = "";

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

posixOnly("Perspicax organization: a device with no person behind it", () => {
  let alice: Auth;
  let bob: Auth;
  let bobBot = { id: "", color: "" as string | undefined };
  const SECTION = "Alice private";

  beforeAll(async () => {
    idp = await startFakeOidcProvider({ user: ALICE });
    idp.directoryPeople = [ALICE, BOB].map((user) => idp.personOf(user));
    PORT = await freePortBlock([0, 1]);
    BASE = `http://127.0.0.1:${PORT}`;
    home = mkdtempSync(join(tmpdir(), "omb-org-anon-"));
    const data = join(home, ".sagax");
    mkdirSync(data, { recursive: true });
    mkdirSync(join(home, "link"), { recursive: true, mode: 0o750 });
    writeFileSync(join(home, "link", "pulsabot.json"), JSON.stringify({
      version: 1, issuer: idp.issuer, client_id: "pulsa-bot", server_id: idp.serverId, origin: BASE, link_token: idp.linkToken,
    }), { mode: 0o640 });
    writeFileSync(join(data, "config.json"), JSON.stringify({ profile: { name: "Operator", email: "op@example.test" } }));
    // A chat-only pairing session from the interim era: no principal, kept as is.
    const registry = new SessionRegistry({ file: join(data, "sessions.json") });
    interimToken = registry.issue({ label: "Old kiosk", scopes: ["client"] }).token;
    registry.close();
    await start();
    alice = await signIn(ALICE);
    bob = await signIn(BOB);
    const created = await api("POST", "/api/bots", bob, { name: "Bob helper" });
    expect(created.status, created.text).toBe(201);
    bobBot = { id: created.body.bot.id, color: created.body.bot.color };
    const sec = await api("POST", "/api/org/sections", alice, { name: SECTION });
    expect(sec.status, sec.text).toBeLessThan(300);
  }, 60_000);

  afterAll(async () => {
    child?.kill("SIGTERM");
    if (child) await waitForExit(child);
    await idp?.close();
    if (home) removeTempDir(home);
  });

  async function pairedFromLoopback(): Promise<Auth> {
    const opened = await api("POST", "/api/auth/pairing", undefined, { scopes: ["client"], label: "Kiosk" });
    expect(opened.status, opened.text).toBe(200);
    const paired = await api("POST", "/api/auth/pair", undefined, { code: opened.body.code });
    expect(paired.status, paired.text).toBe(200);
    expect(paired.body.session.principalId ?? null).toBeNull();
    return { token: paired.body.token };
  }

  for (const kind of ["interim-era session", "chat-only code from this computer"] as const) {
    it(`${kind}: sees no other person's bot or private section and is not the operator`, async () => {
      const device = kind === "interim-era session" ? { token: interimToken } : await pairedFromLoopback();
      const listed = await api("GET", "/api/bots", device);
      expect(listed.status, listed.text).toBe(200);
      expect((listed.body.bots ?? []).map((b: any) => b.id)).not.toContain(bobBot.id);
      expect(listed.body.sections ?? []).not.toContain(SECTION);
      const config = await api("GET", "/api/config", device);
      if (config.status === 200 && config.body.viewer) expect(config.body.viewer.operator).toBe(false);
      const look = await api("PATCH", `/api/bots/${bobBot.id}`, device, { color: "#ff0000" });
      expect(look.status, look.text).not.toBe(200);
      const after = (await api("GET", "/api/bots", bob)).body.bots.find((b: any) => b.id === bobBot.id);
      expect(after.color).toBe(bobBot.color);
    });
  }
});
