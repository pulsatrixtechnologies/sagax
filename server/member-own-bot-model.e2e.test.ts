// A member (not an admin) picks the model of their own bots (2026-10-19
// owner report: a member's bots stayed on Auto). Real server against the
// fake Perspicax and the fake Claude CLI:
//
//   MM-1  given the organization's Claude (sagax_server_engines): the member
//         reads it as theirs (org key) and moves their bot from Auto to a
//         chosen model; it stays chosen
//   MM-2  given nothing, with their own Anthropic key in Perspicax: their key
//         serves Claude and the choice is theirs too
//   MM-3  given nothing, no key: Claude reads "not given, nothing of yours"
//         (the app's model menu then says to add a key or ask an admin)
//   MM-4  an admin is unchanged: the organization's key, any model
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
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
const ORG_KEY = "sk-ant-test-org-key-000000";
const ADMIN: FakeOidcUser = { sub: "01J9MMADMIN00000000000AA", name: "Ada", preferred_username: "ada", role: "admin", teams: [] };
const GIVEN: FakeOidcUser = { sub: "01J9MMGIVEN00000000000GG", name: "Gil", preferred_username: "gil", role: "employee", teams: [] };
const KEYED: FakeOidcUser = { sub: "01J9MMKEYED00000000000KK", name: "Kim", preferred_username: "kim", role: "employee", teams: [] };
const NONE: FakeOidcUser = { sub: "01J9MMNONE000000000000NN", name: "Nia", preferred_username: "nia", role: "employee", teams: [] };

let BASE = "";
let child: ChildProcess;
let home = "";
let log = "";
let idp: FakeOidcProvider;

type Auth = { cookie?: string };
const api = async (method: string, path: string, auth?: Auth, body?: unknown): Promise<{ status: number; body: any; text: string }> => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(auth?.cookie ? { cookie: auth.cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: any = {};
  try { parsed = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body: parsed, text };
};
const cookiePair = (setCookie: string) => setCookie.split(";")[0]!;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor<T>(read: () => Promise<T | null | undefined | false>, ms = 20_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out. server log:\n${log.slice(-3000)}`);
    await sleep(150);
  }
}

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

/** The person's Claude as GET /api/me/engines says it, once the directory
 * read at sign-in has landed. */
async function claudeFor(user: FakeOidcUser, ready: (row: Record<string, any>) => boolean): Promise<{ auth: Auth; row: Record<string, any> }> {
  return waitFor(async () => {
    const auth = await signIn(user);
    const row = ((await api("GET", "/api/me/engines", auth)).body.engines as Array<Record<string, any>> | undefined)?.find((engine) => engine.instanceId === "claude");
    return row && ready(row) ? { auth, row } : null;
  });
}

/** A new bot of `auth`, then its model chosen by hand. */
async function chooseModel(auth: Auth, name: string): Promise<Record<string, any>> {
  const created = await api("POST", "/api/bots", auth, { name });
  expect(created.status, created.text).toBe(201);
  const id = created.body.bot.id as string;
  const patched = await api("PATCH", `/api/bots/${id}`, auth, { modelSelection: { instanceId: "claude", model: "claude-fake-opus" } });
  expect(patched.status, patched.text).toBe(200);
  const stored = ((await api("GET", "/api/bots?messages=0", auth)).body.bots as Array<Record<string, any>>).find((bot) => bot.id === id)!;
  return stored.modelSelection;
}

posixOnly("Perspicax organization: a member picks the model of their own bots", () => {
  beforeAll(async () => {
    chmodSync(FAKE_CLAUDE, 0o755);
    idp = await startFakeOidcProvider({ user: ADMIN });
    idp.directoryPeople = [
      { ...idp.personOf(ADMIN) },
      { ...idp.personOf(GIVEN), sagax_server_engines: ["claude"] },
      { ...idp.personOf(KEYED), sagax_server_engines: [] },
      { ...idp.personOf(NONE), sagax_server_engines: [] },
    ];
    idp.providerKeys.set(`${KEYED.sub}/anthropic`, "sk-ant-test-kim-own-key-000");
    const port = await freePortBlock([0, 1]);
    BASE = `http://127.0.0.1:${port}`;
    home = mkdtempSync(join(tmpdir(), "omb-member-model-"));
    const data = join(home, ".sagax");
    mkdirSync(data, { recursive: true });
    mkdirSync(join(home, "link"), { recursive: true, mode: 0o750 });
    writeFileSync(join(home, "link", "pulsabot.json"), JSON.stringify({
      version: 1, issuer: idp.issuer, client_id: "pulsa-bot", server_id: idp.serverId, origin: BASE, link_token: idp.linkToken,
    }), { mode: 0o640 });
    writeFileSync(join(data, "config.json"), JSON.stringify({
      instances: { claude: { driver: "claudeAgent", config: { cli: FAKE_CLAUDE, fullAuto: true } } },
    }));
    child = spawn(process.execPath, ["--experimental-strip-types", join(SERVER_DIR, "index.ts")], {
      cwd: join(SERVER_DIR, ".."),
      env: {
        PATH: process.env.PATH ?? "",
        HOME: home, USERPROFILE: home, SAGAX_PORT: String(port), SAGAX_WEBHOOK_PORT: String(port + 1),
        SAGAX_LOCAL_VM_TEST_NAMESPACE: process.env.SAGAX_LOCAL_VM_TEST_NAMESPACE ?? "",
        SAGAX_IDENTITY: "perspicax",
        SAGAX_PERSPICAX_ISSUER: idp.issuer,
        SAGAX_PUBLIC_URL: BASE,
        SAGAX_PERSPICAX_LINK_FILE: join(home, "link", "pulsabot.json"),
        SAGAX_PERSPICAX_DIRECTORY_SECONDS: "3600",
        SAGAX_ANTHROPIC_API_KEY: ORG_KEY,
        SAGAX_ORG_NAME: "Acme",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout!.on("data", (c) => (log += c));
    child.stderr!.on("data", (c) => (log += c));
    await waitFor(async () => {
      if (child.exitCode !== null) throw new Error(`server exited during boot:\n${log}`);
      try { return (await fetch(`${BASE}/api/health`)).ok; } catch { return false; }
    });
  }, 60_000);

  afterAll(async () => {
    child?.kill("SIGTERM");
    if (child) await waitForExit(child);
    await idp?.close();
    if (home) removeTempDir(home);
  });

  it("MM-1: a member given the organization's Claude chooses their bot's model", async () => {
    const { auth, row } = await claudeFor(GIVEN, (engine) => engine.myTurns === "org-key");
    expect(row.orgKeyNotGiven).toBeFalsy();
    expect(await chooseModel(auth, "Gil's bot")).toEqual({ instanceId: "claude", model: "claude-fake-opus" });
  }, 60_000);

  it("MM-2: a member with their own key chooses too, on their key", async () => {
    const { auth, row } = await claudeFor(KEYED, (engine) => engine.myTurns === "key");
    expect(row.orgKeyNotGiven).toBe(true);
    expect(await chooseModel(auth, "Kim's bot")).toEqual({ instanceId: "claude", model: "claude-fake-opus" });
  }, 60_000);

  it("MM-3: a member with nothing reads why, instead of a silent list", async () => {
    const { row } = await claudeFor(NONE, (engine) => engine.orgKeyNotGiven === true);
    expect(row).toMatchObject({ myTurns: "none", orgKeyNotGiven: true });
  }, 60_000);

  it("MM-4: an admin is unchanged", async () => {
    const { auth } = await claudeFor(ADMIN, (engine) => engine.myTurns === "org-key");
    expect(await chooseModel(auth, "Ada's bot")).toEqual({ instanceId: "claude", model: "claude-fake-opus" });
  }, 60_000);
});
