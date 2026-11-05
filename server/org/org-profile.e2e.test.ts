// A person's name and avatar on a Perspicax organization server, through the
// real server and the fake Perspicax with avatars on (the Perspicax change
// Sagax consumes: `picture` claim, directory `avatar`, and
// GET /api/v1/pulsabot/people/<sub>/avatar with the link token). The person
// reads as their Perspicax display name, never their login when a better
// name exists; their avatar is served by this server at a versioned URL; and
// a change in Perspicax flows down at the next sign-in or directory sync.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { removeTempDir, waitForExit } from "../testing/cleanup.ts";
import { startFakeOidcProvider, type FakeOidcProvider, type FakeOidcUser } from "../testing/fake-oidc-provider.ts";
import { freePortBlock } from "../testing/ports.ts";

const SERVER_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const posixOnly = describe.skipIf(process.platform === "win32");
const OWNER: FakeOidcUser = { sub: "01J9S8AMARTIN00000000000OW", email: "amartin@example.test", name: "Alex Martin", preferred_username: "amartin", role: "admin" };
// no display name: Perspicax's directory sends the login as the name
const NONAME: FakeOidcUser = { sub: "01J9S8NONAME00000000000NN", email: "sam.t@example.test", preferred_username: "samt", role: "employee" };
const PNG = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.from("fake png body one")]);
const PNG2 = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.from("fake png body two")]);

let PORT = 0;
let BASE = "";
let child: ChildProcess | undefined;
let home = "";
let log = "";
let idp: FakeOidcProvider;
let owner = "";
let noname = "";
let phoneBearer = "";

// What Caddy adds in front of the server: the request is remote, so it gets
// no loopback trust and needs its own session.
const REMOTE = { "x-forwarded-for": "198.51.100.23", "x-forwarded-proto": "https" };
const cookiePair = (setCookie: string) => setCookie.split(";")[0]!;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function api(path: string, cookie: string): Promise<{ status: number; body: any; text: string }> {
  const res = await fetch(`${BASE}${path}`, { headers: { ...REMOTE, cookie }, signal: AbortSignal.timeout(15_000) });
  const text = await res.text();
  let body: any = {};
  try { body = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body, text };
}

/** A phone's bearer and what GET /api/auth/session tells it. */
async function bearerSession(bearer: string): Promise<{ bearer: string; session: any }> {
  const res = await fetch(`${BASE}/api/auth/session`, { headers: { ...REMOTE, authorization: `Bearer ${bearer}` } });
  expect(res.status).toBe(200);
  return { bearer, session: await res.json() };
}

/** What the phone does with the session's avatarUrl: the versioned route on
 * this server, with its own bearer (never Perspicax). The current version is
 * cacheable for a day; an old version still answers the current image but
 * must not be cached under the old URL. */
async function expectPhoneAvatar(phone: { bearer: string; session: any }, image: Buffer): Promise<void> {
  const url = phone.session.avatarUrl as string;
  expect(url).toMatch(new RegExp(`^/api/people/${phone.session.principalId}/avatar\\?v=[0-9a-f]{16}$`));
  const before = idp.avatarRequests.length;
  const res = await fetch(`${BASE}${url}`, { headers: { ...REMOTE, authorization: `Bearer ${phone.bearer}` } });
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe("image/png");
  expect(res.headers.get("cache-control")).toBe("private, max-age=86400");
  expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  expect(Buffer.from(await res.arrayBuffer()).equals(image)).toBe(true);
  // read through the link (or this server's own cache of that version)
  expect(idp.avatarRequests.slice(before).every((request) => request.authorized)).toBe(true);
  const stale = await fetch(`${BASE}${url.replace(/v=[^&]+/, "v=0000000000000000")}`, { headers: { ...REMOTE, authorization: `Bearer ${phone.bearer}` } });
  expect(stale.status).toBe(200);
  expect(stale.headers.get("cache-control")).toBe("no-store");
  await stale.arrayBuffer();
  // another bearer, or none, reads nothing
  expect([401, 403]).toContain((await fetch(`${BASE}${url}`, { headers: { ...REMOTE, authorization: "Bearer omb_sess_not-a-real-token-0000000000000000000000" } })).status);
}

async function signIn(user: FakeOidcUser): Promise<string> {
  idp.user = { ...user };
  const start = await fetch(`${BASE}/auth/oidc/start`, { redirect: "manual" });
  const binding = cookiePair(start.headers.getSetCookie().find((c) => c.includes("_oidc="))!);
  const authorize = await fetch(start.headers.get("location")!, { redirect: "manual" });
  const callback = await fetch(authorize.headers.get("location")!, { redirect: "manual", headers: { cookie: binding } });
  const session = callback.headers.getSetCookie().find((c) => c.startsWith("omb_session_") && !c.includes("_oidc="));
  expect(callback.headers.get("location"), log.slice(-2000)).toBe("/");
  return cookiePair(session!);
}

async function until<T>(check: () => Promise<T | undefined>, ms = 15_000): Promise<T | undefined> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) return undefined;
    await sleep(250);
  }
}

posixOnly("a person's name and avatar on an organization server", () => {
  beforeAll(async () => {
    idp = await startFakeOidcProvider({ user: OWNER });
    idp.avatarsEnabled = true;
    idp.avatars.set(OWNER.sub, PNG);
    idp.directoryPeople = [OWNER, NONAME].map((user) => idp.personOf(user));
    PORT = await freePortBlock([0, 1]);
    BASE = `http://127.0.0.1:${PORT}`;
    home = mkdtempSync(join(tmpdir(), "omb-org-profile-"));
    const data = join(home, ".sagax");
    mkdirSync(data, { recursive: true });
    mkdirSync(join(home, "link"), { recursive: true, mode: 0o750 });
    writeFileSync(join(home, "link", "pulsabot.json"), JSON.stringify({
      version: 1, issuer: idp.issuer, client_id: "pulsa-bot", server_id: idp.serverId, origin: BASE, link_token: idp.linkToken,
    }), { mode: 0o640 });
    writeFileSync(join(data, "config.json"), JSON.stringify({ profile: { name: "Operator", email: "op@example.test" } }));
    child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
      cwd: join(SERVER_DIR, ".."),
      env: {
        ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
        HOME: home, USERPROFILE: home, SAGAX_LOCAL_VM_TEST_NAMESPACE: process.env.SAGAX_LOCAL_VM_TEST_NAMESPACE ?? "", SAGAX_PORT: String(PORT), SAGAX_WEBHOOK_PORT: String(PORT + 1),
        SAGAX_IDENTITY: "perspicax", SAGAX_PERSPICAX_ISSUER: idp.issuer, SAGAX_PUBLIC_URL: BASE,
        SAGAX_PERSPICAX_LINK_FILE: join(home, "link", "pulsabot.json"),
        SAGAX_PERSPICAX_DIRECTORY_SECONDS: "5",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout!.on("data", (c) => (log += c));
    child.stderr!.on("data", (c) => (log += c));
    const deadline = Date.now() + 20_000;
    for (;;) {
      try {
        if ((await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(2_000) })).ok) break;
      } catch {
        /* not up yet */
      }
      if (Date.now() > deadline) throw new Error(`server never came up:\n${log}`);
      await sleep(150);
    }
    owner = await signIn(OWNER);
    noname = await signIn(NONAME);
  }, 60_000);

  afterAll(async () => {
    if (child) await waitForExit(child, { signal: "SIGTERM" });
    await idp?.close();
    if (home) await removeTempDir(home);
  });

  it("names the person by their Perspicax display name, not their login", async () => {
    const session = await api("/api/auth/session", owner);
    expect(session.body).toMatchObject({ name: "Alex Martin", login: "amartin", profileManagedBy: "perspicax" });
    const config = await api("/api/config", owner);
    expect(config.body.viewer.name).toBe("Alex Martin");
    expect(config.body.profile.name).toBe("Alex Martin");
    expect(config.text).not.toContain('"name":"amartin"');
  });

  it("falls back to the address, then the login, when Perspicax has no display name", async () => {
    const config = await api("/api/config", noname);
    expect(config.body.viewer.name).toBe("sam.t");
    const directory = await api("/api/org/directory", owner);
    const sam = directory.body.people.find((person: any) => person.login === "samt");
    expect(sam.name).toBe("sam.t");
  });

  it("serves the Perspicax avatar at a versioned URL, read through the link", async () => {
    const version = idp.avatarVersion(OWNER.sub)!;
    const config = await api("/api/config", owner);
    const url = config.body.viewer.avatarUrl as string;
    expect(url).toBe(`/api/people/${config.body.viewer.principalId}/avatar?v=${version}`);
    expect(config.body.profile.avatarUrl).toBe(url);
    expect((await api("/api/auth/session", owner)).body.avatarUrl).toBe(url);
    const res = await fetch(`${BASE}${url}`, { headers: { ...REMOTE, cookie: owner } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await res.arrayBuffer()).equals(PNG)).toBe(true);
    expect(idp.avatarRequests.at(-1)).toEqual({ sub: OWNER.sub, authorized: true });
    // the directory lists it for pickers and room members
    const directory = await api("/api/org/directory", noname);
    expect(directory.body.people.find((person: any) => person.login === "amartin")).toMatchObject({ name: "Alex Martin", avatarUrl: url });
    // a person without one has no URL, and the route says so
    const sam = await api("/api/config", noname);
    expect(sam.body.viewer.avatarUrl).toBeUndefined();
    expect((await fetch(`${BASE}/api/people/${sam.body.viewer.principalId}/avatar`, { headers: { ...REMOTE, cookie: noname } })).status).toBe(404);
    // and nobody unauthenticated reads it
    expect([401, 403]).toContain((await fetch(`${BASE}${url}`, { headers: REMOTE })).status);
  });

  it("gives a phone signed in with Pulsatrix its person's avatar, through this server with its own bearer", async () => {
    // The phone's sheet: /auth/oidc/start?client=phone ends on sagax://pair,
    // whose credential POST /api/pair redeems for a client-scoped bearer.
    idp.user = { ...OWNER };
    const start = await fetch(`${BASE}/auth/oidc/start?client=phone&return=sagax`, { redirect: "manual" });
    const binding = cookiePair(start.headers.getSetCookie().find((c) => c.includes("_oidc="))!);
    const authorize = await fetch(start.headers.get("location")!, { redirect: "manual" });
    const callback = await fetch(authorize.headers.get("location")!, { redirect: "manual", headers: { cookie: binding } });
    const invite = new URL(callback.headers.get("location") ?? "");
    expect(`${invite.protocol}//${invite.host}`, log.slice(-2000)).toBe("sagax://pair");
    const paired = await fetch(`${BASE}/api/pair`, {
      method: "POST", headers: { ...REMOTE, "content-type": "application/json" },
      body: JSON.stringify({ credential: invite.searchParams.get("token"), deviceName: "Owner's iPhone", pairRequestId: "pair-request-avatar-1" }),
    });
    expect(paired.status).toBe(200);
    const phone = await bearerSession(((await paired.json()) as { token: string }).token);
    // an organization admin's phone carries their scopes
    expect(phone.session).toMatchObject({ kind: "session", identity: "perspicax", scopes: ["admin", "client"] });
    await expectPhoneAvatar(phone, PNG);
  });

  it("gives a phone paired by code from a signed-in session the same avatar", async () => {
    const opened = await fetch(`${BASE}/api/auth/pairing`, {
      method: "POST", headers: { ...REMOTE, cookie: owner, "content-type": "application/json" },
      body: JSON.stringify({ scopes: ["client"], label: "Owner's iPhone" }),
    });
    expect(opened.status).toBe(200);
    const { credential } = (await opened.json()) as { credential: string };
    const paired = await fetch(`${BASE}/api/pair`, {
      method: "POST", headers: { ...REMOTE, "content-type": "application/json" },
      body: JSON.stringify({ credential, deviceName: "Owner's iPhone", pairRequestId: "pair-request-avatar-2" }),
    });
    expect(paired.status).toBe(200);
    const phone = await bearerSession(((await paired.json()) as { token: string }).token);
    expect(phone.session.scopes).toEqual(["client"]);
    await expectPhoneAvatar(phone, PNG);
    phoneBearer = phone.bearer;
  });

  it("takes a new name and avatar from the directory sync, and a removed avatar too", async () => {
    idp.avatars.set(OWNER.sub, PNG2);
    const version = idp.avatarVersion(OWNER.sub)!;
    idp.directoryPeople = [{ ...OWNER, name: "O-W Martin" }, NONAME].map((user) => idp.personOf(user));
    const updated = await until(async () => {
      const viewer = (await api("/api/config", owner)).body.viewer;
      return viewer?.name === "O-W Martin" && viewer.avatarUrl?.endsWith(`v=${version}`) ? viewer : undefined;
    });
    expect(updated, log.slice(-2000)).toBeTruthy();
    const res = await fetch(`${BASE}${updated.avatarUrl}`, { headers: { ...REMOTE, cookie: owner } });
    expect(Buffer.from(await res.arrayBuffer()).equals(PNG2)).toBe(true);
    // the paired phone reads the new version at its next session read: a
    // new URL, so its cache (keyed by that URL) takes the new image
    const phone = await bearerSession(phoneBearer);
    expect(phone.session.avatarUrl).toBe(updated.avatarUrl);
    await expectPhoneAvatar(phone, PNG2);
    idp.avatars.delete(OWNER.sub);
    const removed = await until(async () => {
      const viewer = (await api("/api/config", owner)).body.viewer;
      return viewer && viewer.avatarUrl === undefined ? viewer : undefined;
    });
    expect(removed).toBeTruthy();
    expect((await api("/api/config", owner)).body.profile.avatarUrl).toBe("");
    // the phone falls back to the initial: no URL, nothing to fetch
    expect((await bearerSession(phoneBearer)).session.avatarUrl).toBeUndefined();
  }, 40_000);

  it("takes the picture claim at the next sign-in", async () => {
    // Perspicax changes both places at once; the sign-in sees it first
    idp.avatars.set(OWNER.sub, PNG);
    idp.directoryPeople = [OWNER, NONAME].map((user) => idp.personOf(user));
    owner = await signIn(OWNER);
    const config = await api("/api/config", owner);
    expect(config.body.viewer.avatarUrl).toMatch(new RegExp(`v=${idp.avatarVersion(OWNER.sub)}$`));
    expect(config.body.viewer.name).toBe("Alex Martin");
  });
});
