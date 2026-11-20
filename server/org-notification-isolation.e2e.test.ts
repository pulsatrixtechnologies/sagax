// Organization server, through the real server (an isolated fixture: its own
// temporary home, fake Perspicax and fake engine), misuse guardrails in
// enforce mode:
//
//   NI-1  a member's request to their own bot is refused by the security
//         policy: the member reads the refusal, and the admin's app hears
//         nothing about the member's bot (no notify frame on the admin's
//         stream, no notify line the phones would follow). The admins read
//         the refusal in the console's activity log, not in the app.
//
// A silence is only worth something beside the noise: the admin's own bot,
// created after the refusal, reaches the admin's stream, so the stream was
// live when the refusal would have been announced.
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { removeTempDir, waitForExit } from "./testing/cleanup.ts";
import { startFakeOidcProvider, type FakeOidcProvider, type FakeOidcUser } from "./testing/fake-oidc-provider.ts";
import { freePortBlock } from "./testing/ports.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const FAKE_CLAUDE = join(SERVER_DIR, "testing", "fake-claude-cli.ts");
const posixOnly = describe.skipIf(process.platform === "win32");
const ORG_KEY = "sk-ant-test-org-key";
const ADMIN: FakeOidcUser = { sub: "01J9PTADMIN000000000000AD", email: "admin@example.test", name: "Ada", preferred_username: "ada", role: "admin" };
const MEMBER: FakeOidcUser = { sub: "01J9PTMEMBER00000000000MB", email: "member@example.test", name: "Max", preferred_username: "max", role: "employee" };

let BASE = "";
let child: ChildProcess;
let home: string;
let log = "";
let idp: FakeOidcProvider;

type Auth = { cookie?: string };
const api = async (method: string, path: string, auth?: Auth, body?: unknown): Promise<{ status: number; body: any; text: string }> => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(auth?.cookie ? { cookie: auth.cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
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

async function waitFor<T>(read: () => Promise<T | null | undefined | false>, ms = 20_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out. server log:\n${log.slice(-3000)}`);
    await sleep(150);
  }
}

async function openStream(auth: Auth): Promise<{ text: () => string; close: () => void }> {
  const { body } = await api("POST", "/api/auth/stream-ticket", auth);
  expect(body.ticket).toMatch(/^sgx_tick_/);
  return new Promise((resolve, reject) => {
    let received = "";
    const req = request(`${BASE}/api/events?ticket=${encodeURIComponent(body.ticket)}`, { headers: { accept: "text/event-stream" } }, (res) => {
      expect(res.statusCode).toBe(200);
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => { received += chunk; });
      resolve({ text: () => received, close: () => req.destroy() });
    });
    req.on("error", reject);
    req.end();
  });
}

const frames = (stream: { text: () => string }) => stream.text().split("\n")
  .filter((line) => line.startsWith("data: "))
  .map((line) => { try { return JSON.parse(line.slice(6)); } catch { return null; } })
  .filter(Boolean) as Array<Record<string, any>>;

posixOnly("Perspicax organization: a member's bot is never announced in another person's app", () => {
  let admin: Auth;

  beforeAll(async () => {
    chmodSync(FAKE_CLAUDE, 0o755);
    idp = await startFakeOidcProvider({ user: ADMIN });
    idp.directoryPeople = [ADMIN, MEMBER].map((user) => idp.personOf(user));
    const port = await freePortBlock([0, 1]);
    BASE = `http://127.0.0.1:${port}`;
    home = mkdtempSync(join(tmpdir(), "omb-org-notify-isolation-"));
    const data = join(home, ".openmausbot");
    mkdirSync(data, { recursive: true });
    mkdirSync(join(home, "link"), { recursive: true, mode: 0o750 });
    writeFileSync(join(home, "link", "pulsabot.json"), JSON.stringify({
      version: 1, issuer: idp.issuer, client_id: "pulsa-bot", server_id: idp.serverId, origin: BASE, link_token: idp.linkToken,
    }), { mode: 0o640 });
    writeFileSync(join(data, "config.json"), JSON.stringify({
      instances: { claude: { driver: "claudeAgent", config: { cli: FAKE_CLAUDE, fullAuto: true } } },
    }));
    child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
      cwd: join(SERVER_DIR, ".."),
      env: {
        ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
        HOME: home, USERPROFILE: home, SAGAX_LOCAL_VM_TEST_NAMESPACE: process.env.SAGAX_LOCAL_VM_TEST_NAMESPACE ?? "",
        SAGAX_PORT: String(port), SAGAX_WEBHOOK_PORT: String(port + 1),
        SAGAX_IDENTITY: "perspicax",
        SAGAX_PERSPICAX_ISSUER: idp.issuer,
        SAGAX_PUBLIC_URL: BASE,
        SAGAX_PERSPICAX_LINK_FILE: join(home, "link", "pulsabot.json"),
        SAGAX_PERSPICAX_DIRECTORY_SECONDS: "3600",
        SAGAX_ANTHROPIC_API_KEY: ORG_KEY,
        SAGAX_ORG_NAME: "Acme",
        SAGAX_MISUSE_GUARDRAILS: "enforce",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout!.on("data", (c) => (log += c));
    child.stderr!.on("data", (c) => (log += c));
    await waitFor(async () => {
      if (child.exitCode !== null) throw new Error(`server exited during boot:\n${log}`);
      try { return (await fetch(`${BASE}/api/health`)).ok; } catch { return false; }
    }, 40_000);
    admin = await signIn(ADMIN);
  }, 60_000);

  afterAll(async () => {
    child?.kill("SIGTERM");
    if (child) await waitForExit(child);
    await idp?.close();
    if (home) removeTempDir(home);
  });

  it("NI-1: a refusal on a member's own bot stays out of the admin's app and phones", async () => {
    const member = await signIn(MEMBER);
    const created = await api("POST", "/api/bots", member, { name: "Field helper" });
    expect(created.status, created.text).toBe(201);
    const memberBot = created.body.bot.id as string;
    const adminStream = await openStream(admin);

    // the member's own request, refused by the security policy
    const refused = await api("POST", `/api/bots/${memberBot}/messages`, member, { text: "sudo -i" });
    expect(refused.status, refused.text).toBe(403);
    expect(refused.body.code).toBe("misuse_blocked");

    // ordering barrier: the admin's own bot reaches the admin's stream
    const own = await api("POST", "/api/bots", admin, { name: "Desk helper" });
    expect(own.status, own.text).toBe(201);
    const adminBot = own.body.bot.id as string;
    await waitFor(async () => frames(adminStream).some((frame) => frame.kind === "bot" && frame.bot?.id === adminBot));
    await sleep(300);

    const aboutMemberBot = frames(adminStream).filter((frame) => frame.kind === "notify" && frame.notification?.botId === memberBot);
    expect(aboutMemberBot).toEqual([]);
    // the phones follow the same frames (one [notify] line per frame on its way out)
    expect(log).not.toMatch(new RegExp(`\\[notify\\][^\\n]*bot=${memberBot}`));
    adminStream.close();
  }, 60_000);
});
