// #2045 isolation, through the real server: a person lists only their own
// teams. Two members, A (the first admin) and B. B creates "Finance"; A sees
// it nowhere (sections of /api/bots, the sidebar list, /api/org/sections, the
// live "sections" frame). A legacy team name with no record, and an empty
// copy the old first-admin fallback gave to A, show up for nobody after a
// restart; nothing is deleted from disk.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { removeTempDir, waitForExit } from "../testing/cleanup.ts";
import { startFakeOidcProvider, type FakeOidcProvider, type FakeOidcUser } from "../testing/fake-oidc-provider.ts";
import { freePortBlock } from "../testing/ports.ts";

const SERVER_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const posixOnly = describe.skipIf(process.platform === "win32");
const A: FakeOidcUser = { sub: "01J9ISOA0000000000000000AA", name: "Anne", preferred_username: "anne", role: "admin", teams: [] };
const B: FakeOidcUser = { sub: "01J9ISOB0000000000000000BB", name: "Benoit", preferred_username: "benoit", role: "employee", teams: [] };

let PORT = 0;
let BASE = "";
let child: ChildProcess | undefined;
let home = "";
let data = "";
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

/** The next "sections" list the live stream sends this person (frames go out on a change). */
async function streamSections(auth: Auth): Promise<{ next: Promise<string[]> }> {
  const { body } = await api("POST", "/api/auth/stream-ticket", auth);
  let opened: () => void = () => {};
  const ready = new Promise<void>((r) => (opened = r));
  const next = new Promise<string[]>((resolve, reject) => {
    let received = "";
    const req = request(`${BASE}/api/events?ticket=${encodeURIComponent(body.ticket)}`, { headers: { accept: "text/event-stream" } }, (res) => {
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        received += chunk;
        if (received.includes('"kind":"hello"')) opened();
        const match = /"sections":(\[[^\]]*\])/.exec(received);
        if (match) { req.destroy(); resolve(JSON.parse(match[1]!) as string[]); }
      });
    });
    req.on("error", (error) => (received ? undefined : reject(error)));
    setTimeout(() => { req.destroy(); reject(new Error(`no sections frame:\n${received.slice(0, 2000)}`)); }, 30_000);
    req.end();
  });
  await ready;
  return { next };
}

async function start() {
  child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
    cwd: join(SERVER_DIR, ".."),
    env: {
      ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
      HOME: home, USERPROFILE: home, SAGAX_LOCAL_VM_TEST_NAMESPACE: process.env.SAGAX_LOCAL_VM_TEST_NAMESPACE ?? "", SAGAX_PORT: String(PORT), SAGAX_WEBHOOK_PORT: String(PORT + 1),
      SAGAX_DATA_DIR: data,
      SAGAX_IDENTITY: "perspicax",
      SAGAX_PERSPICAX_ISSUER: idp.issuer,
      SAGAX_PUBLIC_URL: BASE,
      SAGAX_PERSPICAX_LINK_FILE: join(home, "link", "pulsabot.json"),
      SAGAX_PERSPICAX_DIRECTORY_SECONDS: "3600",
      SAGAX_ORG_NAME: "Acme",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout!.on("data", (c) => (log += c));
  child.stderr!.on("data", (c) => (log += c));
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return;
    } catch { /* not up yet */ }
    if (Date.now() > deadline) throw new Error(`server never came up:\n${log}`);
    await sleep(150);
  }
}

async function stop() {
  if (!child) return;
  child.kill("SIGTERM");
  await waitForExit(child);
  child = undefined;
}

const teamsOf = async (who: Auth) => ({
  bots: (await api("GET", "/api/bots", who)).body.sections as string[],
  sidebar: (await api("GET", "/api/sidebar-sections", who)).body.sections as string[],
  org: ((await api("GET", "/api/org/sections", who)).body.sections as Array<{ name: string }>).map((row) => row.name),
});

posixOnly("#2045 isolation: a person lists only their own teams", () => {
  let a: Auth;
  let b: Auth;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    idp = await startFakeOidcProvider({ user: A });
    idp.directoryPeople = [A, B].map((user) => idp.personOf(user));
    PORT = await freePortBlock([0, 1]);
    BASE = `http://127.0.0.1:${PORT}`;
    home = mkdtempSync(join(tmpdir(), "omb-team-isolation-"));
    data = join(home, ".sagax");
    mkdirSync(data, { recursive: true });
    mkdirSync(join(home, "link"), { recursive: true, mode: 0o750 });
    writeFileSync(join(home, "link", "pulsabot.json"), JSON.stringify({
      version: 1, issuer: idp.issuer, client_id: "pulsa-bot", server_id: idp.serverId, origin: BASE, link_token: idp.linkToken,
    }), { mode: 0o640 });
    await start();
    a = await signIn(A);
    b = await signIn(B);
    for (const person of (await api("GET", "/api/org/directory", a)).body.people as Array<{ principalId: string; login: string }>) ids[person.login] = person.principalId;
  }, 120_000);

  afterAll(async () => {
    await stop();
    await idp?.close();
    if (home) removeTempDir(home);
  });

  it("B creates Finance: B lists it, A sees it in no list and no selector", async () => {
    const liveA = await streamSections(a);
    const liveB = await streamSections(b);
    const made = await api("POST", "/api/sidebar-sections", b, { name: "Finance", botIds: [] });
    expect(made.status, made.text).toBe(200);
    const ofB = { ...(await teamsOf(b)), stream: await liveB.next };
    const ofA = { ...(await teamsOf(a)), stream: await liveA.next };
    for (const [where, list] of Object.entries(ofB)) expect(list, where).toContain("Finance");
    for (const [where, list] of Object.entries(ofA)) expect(list, where).not.toContain("Finance");
    // the team export (Team map) and the Move-to-team picker read the same list
    expect((await api("PATCH", "/api/sidebar-sections?section=Finance", a, { name: "Pris" })).status).toBe(404);
  }, 120_000);

  it("a legacy team with no owner, and an empty copy handed to the first admin, show for nobody after a restart", async () => {
    await sleep(500); // the audit row of B's creation reaches disk
    await stop();
    const contextsFile = join(data, "section-contexts.json");
    const contexts = JSON.parse(readFileSync(contextsFile, "utf8"));
    contexts.sections = [...contexts.sections, "Agents personels"];
    writeFileSync(contextsFile, JSON.stringify(contexts));
    const channelsFile = join(data, "section-channels.json");
    const channels = JSON.parse(readFileSync(channelsFile, "utf8"));
    channels.sections.push({ id: "sec_00000000-0000-4000-8000-0000000000aa", name: "Finance", ownerPrincipalId: ids.anne, members: [], defaultLevel: "use", createdAt: 1 });
    delete channels.ownersVerifiedAt;
    writeFileSync(channelsFile, JSON.stringify(channels));
    await start();
    a = await signIn(A);
    b = await signIn(B);
    const ofA = await teamsOf(a);
    const ofB = await teamsOf(b);
    for (const list of Object.values(ofA)) {
      expect(list).not.toContain("Finance");
      expect(list).not.toContain("Agents personels");
    }
    for (const list of Object.values(ofB)) {
      expect(list).toContain("Finance");
      expect(list).not.toContain("Agents personels");
    }
    // nothing deleted: the records stay on disk, unclaimed, with the former owner kept
    const after = JSON.parse(readFileSync(channelsFile, "utf8")).sections as Array<{ id: string; name: string; ownerPrincipalId: string; formerOwnerPrincipalId?: string }>;
    expect(after.find((row) => row.id === "sec_00000000-0000-4000-8000-0000000000aa")).toMatchObject({ ownerPrincipalId: "unclaimed", formerOwnerPrincipalId: ids.anne });
    expect(after.find((row) => row.name === "Agents personels")).toMatchObject({ ownerPrincipalId: "unclaimed" });
    expect(after.find((row) => row.name === "Finance" && row.ownerPrincipalId === ids.benoit)).toBeTruthy();
  }, 180_000);
});
