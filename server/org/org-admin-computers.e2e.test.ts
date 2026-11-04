// The Perspicax console's Computers (server/org/org-admin-computers.ts) through
// the real organization server: an in-test provisioner (the real HTTP
// handler and lifecycle over a FakeDocker), a fake desktop app signed in as
// Bob, and console assertions from the local fake provider.
//
//   K1  an admin lists Bob's server environment and his desktop; a member
//       is refused; the desktop's own id never reaches the wire
//   K2  stop, reset and delete Bob's environment, with the confirmations
//       and the admin activity rows; his desktop is never acted on
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SandboxdVerifier } from "../sandbox/sandboxd-auth.ts";
import { SandboxService } from "../sandbox/sandboxd-core.ts";
import { createSandboxdHandler } from "../sandboxd.ts";
import { removeTempDir, waitForExit } from "../testing/cleanup.ts";
import { FakeDocker } from "../testing/fake-docker.ts";
import { connectFakeDesktop, type FakeDesktop } from "../testing/fake-desktop.ts";
import { startFakeOidcProvider, type FakeOidcProvider, type FakeOidcUser } from "../testing/fake-oidc-provider.ts";
import { freePortBlock } from "../testing/ports.ts";
import { sandboxdConfigFromEnv } from "../sandbox/user-sandbox-spec.ts";

const SERVER_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const posixOnly = describe.skipIf(process.platform === "win32");
const SANDBOXD_KEY = "d".repeat(64);
const INSTANCE = "e2e";
const ALICE: FakeOidcUser = { sub: "01J9K1ALICE00000000000000A", name: "Alice", preferred_username: "alice", role: "admin", teams: [] };
const BOB: FakeOidcUser = { sub: "01J9K1BOB000000000000000B", name: "Bob", preferred_username: "bob", role: "employee", teams: [] };

let PORT = 0;
let BASE = "";
let child: ChildProcess;
let home: string;
let log = "";
let idp: FakeOidcProvider;
let provisioner: Server;
const docker = new FakeDocker();

type Auth = { cookie?: string; bearer?: string };
const api = async (method: string, path: string, auth?: Auth, body?: unknown): Promise<{ status: number; body: any; text: string }> => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(auth?.cookie ? { cookie: auth.cookie } : {}),
      ...(auth?.bearer ? { authorization: `Bearer ${auth.bearer}` } : {}),
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
    if (Date.now() > deadline) throw new Error(`timed out. server log:\n${log.slice(-4000)}`);
    await sleep(150);
  }
}

const admin = (method: string, sub: string, user: FakeOidcUser, body?: unknown) =>
  api(method, `/api/org/admin/${sub}`, { bearer: idp.consoleAssertion({ sub: user.sub, aud: BASE, role: user.role === "admin" ? "admin" : "employee", teams: user.teams ?? [] }) }, body);

posixOnly("Perspicax console: the organization's computers", () => {
  let bob: Auth;
  let desktop: FakeDesktop;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    const service = new SandboxService(docker, sandboxdConfigFromEnv({ SAGAX_SANDBOX_IMAGE: "sagax-sandbox:test", SAGAX_SANDBOX_INSTANCE: INSTANCE }));
    await service.installEgressPolicy();
    provisioner = createServer(createSandboxdHandler(service, new SandboxdVerifier(SANDBOXD_KEY)));
    await new Promise<void>((resolve) => provisioner.listen(0, "127.0.0.1", resolve));
    idp = await startFakeOidcProvider({ user: ALICE });
    idp.directoryPeople = [ALICE, BOB].map((user) => idp.personOf(user));
    PORT = await freePortBlock([0, 1]);
    BASE = `http://127.0.0.1:${PORT}`;
    home = mkdtempSync(join(tmpdir(), "omb-org-computers-"));
    mkdirSync(join(home, ".sagax"), { recursive: true });
    mkdirSync(join(home, "link"), { recursive: true, mode: 0o750 });
    writeFileSync(join(home, "link", "pulsabot.json"), JSON.stringify({
      version: 1, issuer: idp.issuer, client_id: "pulsa-bot", server_id: idp.serverId, origin: BASE, link_token: idp.linkToken,
    }), { mode: 0o640 });
    writeFileSync(join(home, "sandboxd-key"), `${SANDBOXD_KEY}\n`, { mode: 0o400 });
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
        SAGAX_ORG_NAME: "Acme",
        SAGAX_SANDBOXD_URL: `http://127.0.0.1:${(provisioner.address() as AddressInfo).port}`,
        SAGAX_SANDBOXD_KEY_FILE: join(home, "sandboxd-key"),
        SAGAX_SANDBOX_INSTANCE: INSTANCE,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout!.on("data", (c) => (log += c));
    child.stderr!.on("data", (c) => (log += c));
    await waitFor(async () => {
      try { return (await fetch(`${BASE}/api/health`)).ok; } catch { return false; }
    });
    const alice = await signIn(ALICE);
    bob = await signIn(BOB);
    const people = await waitFor(async () => {
      const got = (await api("GET", "/api/org/directory", alice)).body.people as Array<{ principalId: string; login: string }> | undefined;
      return got && got.length === 2 ? got : null;
    });
    for (const person of people) ids[person.login] = person.principalId;
    // Bob's own environment, started from his Computer tab, and his desktop app
    const started = await api("POST", "/api/me/server-environment/power", bob, { action: "start" });
    expect(started.status, started.text).toBe(200);
    desktop = await connectFakeDesktop({ base: BASE, cookie: bob.cookie!, name: "Bob's Mac", tunnel: false });
  }, 60_000);

  afterAll(async () => {
    await desktop?.close();
    child?.kill("SIGTERM");
    if (child) await waitForExit(child);
    await idp?.close();
    await new Promise<void>((resolve) => provisioner?.close(() => resolve()));
    if (home) removeTempDir(home);
  });

  it("K1: an admin lists every server environment and desktop; a member is refused", async () => {
    expect((await admin("GET", "computers", BOB)).body.code).toBe("forbidden_role");
    const caps = await admin("GET", "capabilities", BOB);
    expect(caps.body.routes).toEqual(expect.arrayContaining(["GET computers", "GET computers/{id}", "POST computers/{id}/stop", "POST computers/{id}/delete"]));
    const got = await admin("GET", "computers", ALICE);
    expect(got.status, got.text).toBe(200);
    expect(got.body.environments).toMatchObject({ configured: true, reachable: true, maxRunning: expect.any(Number) });
    const env = got.body.items.find((item: { id: string }) => item.id === `env:${ids.bob}`);
    expect(env).toMatchObject({
      kind: "server-environment", name: "Bob", owner: { principalId: ids.bob, sub: BOB.sub, name: "Bob" }, state: "running",
      resources: { cpus: expect.any(Number), memoryLimitBytes: expect.any(Number), overQuota: false }, image: "sagax-sandbox:test",
      actions: ["stop", "pause", "update", "reset", "delete"], bots: [],
    });
    const mac = got.body.items.find((item: { kind: string }) => item.kind === "desktop");
    expect(mac).toMatchObject({ id: expect.stringMatching(/^desktop:[0-9a-f]{16}$/), name: "Bob's Mac", owner: { principalId: ids.bob }, state: "online", platform: "linux", localVm: true, actions: [], resources: null });
    expect(got.text).not.toContain(desktop.id);
    expect(got.text).not.toContain(desktop.secret);
    // Alice has no environment and no desktop: nothing listed for her
    expect(got.body.items.some((item: { owner: { principalId: string } }) => item.owner.principalId === ids.alice)).toBe(false);
    const page = await admin("GET", `computers/${encodeURIComponent(mac.id)}`, ALICE);
    expect(page.body).toMatchObject({ computer: { id: mac.id, kind: "desktop" }, activity: [] });
  });

  it("K2: stop, reset and delete Bob's environment, confirmed and audited; never his desktop", async () => {
    const id = `env:${ids.bob}`;
    const mac = (await admin("GET", "computers?kind=desktop", ALICE)).body.items[0];
    const refused = await admin("POST", `computers/${mac.id}/stop`, ALICE, { confirm: true });
    expect(refused.status, refused.text).toBe(409);
    expect(refused.body.code).toBe("personal_computer");

    const stopped = await admin("POST", `computers/${id}/stop`, ALICE, {});
    expect(stopped.status, stopped.text).toBe(200);
    expect(stopped.body.computer).toMatchObject({ id, state: "stopped", actions: ["start", "update", "reset", "delete"] });
    // Bob's own Computer tab sees it stopped
    expect((await api("GET", "/api/me/server-environment", bob)).body.state).toBe("stopped");

    expect((await admin("POST", `computers/${id}/reset`, ALICE, {})).body.code).toBe("confirm_required");
    const reset = await admin("POST", `computers/${id}/reset`, ALICE, { confirm: true });
    expect(reset.status, reset.text).toBe(200);
    expect(reset.body.computer.state).toBe("running");

    expect((await admin("POST", `computers/${id}/delete`, ALICE, {})).body.code).toBe("confirm_required");
    const deleted = await admin("POST", `computers/${id}/delete`, ALICE, { confirm: true });
    expect(deleted.body).toEqual({ deleted: id });
    expect((await admin("GET", `computers/${id}`, ALICE)).status).toBe(404);

    const audit = (await admin("GET", `audit?category=computer&target=${encodeURIComponent(id)}`, ALICE)).body.rows as Array<any>;
    expect(audit.map((row) => row.action)).toEqual(["computer.delete", "computer.reset", "computer.stop"]);
    expect(audit[2]).toMatchObject({ category: "computer", actor: { kind: "person", principalId: ids.alice, via: "console" }, target: { kind: "computer", id, name: "Bob" }, before: { state: "running" }, after: { state: "stopped" } });
    expect(audit[0].after).toMatchObject({ state: "deleted", confirmed: true });
  }, 60_000);
});
