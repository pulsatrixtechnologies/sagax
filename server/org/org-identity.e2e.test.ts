// Identity on a solo server through the real server: the local operator is
// one principal (never an email or "local-owner"), a phone paired from this
// computer is that same person, a person named by address in a room or a
// grant is a principal, and a restart keeps one local operator. Slice 8: the
// interim organization, email codes and invitations are gone (410), a
// legacy email session ends at its first request while a pairing session in
// the same file keeps working, and an old config.json with the removed keys
// boots.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SessionRegistry } from "../auth/sessions.ts";
import { removeTempDir, waitForExit } from "../testing/cleanup.ts";
import { freePortBlock } from "../testing/ports.ts";

const SERVER_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = await freePortBlock([0, 1]);
const BASE = `http://127.0.0.1:${PORT}`;
const posixOnly = describe.skipIf(process.platform === "win32");

let child: ChildProcess | undefined;
let home: string;
let data: string;
let log = "";
const ZARA = "zara@example.test";
const ZARA_ID = "pr_2a2a2a2a-2a2a-4a2a-8a2a-2a2a2a2a2a2a";
let zaraToken = "";

const api = async (method: string, path: string, body?: unknown, token?: string): Promise<{ status: number; body: any }> => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: any = {};
  try {
    parsed = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: res.status, body: parsed };
};

async function start() {
  log = "";
  child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
    cwd: join(SERVER_DIR, ".."),
    env: {
      ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
      ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
      HOME: home, USERPROFILE: home, SAGAX_LOCAL_VM_TEST_NAMESPACE: process.env.SAGAX_LOCAL_VM_TEST_NAMESPACE ?? "", SAGAX_PORT: String(PORT), SAGAX_WEBHOOK_PORT: String(PORT + 1),
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

async function stop() {
  if (child) await waitForExit(child, { signal: "SIGTERM" });
  child = undefined;
}

/** A live /api/events stream: what it received so far, and whether the
 * server ended it. */
function openStream(token: string) {
  const state = { text: "", closed: false };
  const controller = new AbortController();
  const ready = (async () => {
    const res = await fetch(`${BASE}/api/events`, { headers: { authorization: `Bearer ${token}` }, signal: controller.signal });
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const pump = (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          state.text += decoder.decode(value, { stream: true });
        }
      } catch {
        /* aborted */
      }
      state.closed = true;
    })();
    return pump;
  })();
  return { state, ready, abort: () => controller.abort() };
}

async function until(check: () => boolean, ms = 5_000) {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) return false;
    await new Promise((r) => setTimeout(r, 50));
  }
  return true;
}

const principalsFile = () => JSON.parse(readFileSync(join(data, "principals.json"), "utf8")) as { principals: { id: string; email?: string; local?: boolean }[] };

posixOnly("org identity", () => {
  beforeAll(async () => {
    home = mkdtempSync(join(tmpdir(), "omb-org-identity-"));
    data = join(home, ".sagax");
    mkdirSync(data, { recursive: true });
    writeFileSync(join(data, "config.json"), JSON.stringify({ profile: { name: "Owner", email: "owner@example.com" } }));
    // Zara is a person this server knows by address, with a device bound to
    // her principal (a pairing session, not an email sign-in).
    writeFileSync(join(data, "principals.json"), JSON.stringify({ version: 1, principals: [{ id: ZARA_ID, kind: "human", email: ZARA, createdAt: 1 }] }));
    const registry = new SessionRegistry({ file: join(data, "sessions.json") });
    zaraToken = registry.issue({ label: "Zara's laptop", principalId: ZARA_ID, scopes: ["client"] }).token;
    registry.close();
    await start();
  }, 40_000);

  afterAll(async () => {
    await stop();
    await removeTempDir(home);
  });

  let ownerId = "";
  let kioskToken = "";
  let kioskStream: ReturnType<typeof openStream> | undefined;

  it("lets a chat-only device see the operator's bot while no organization exists", async () => {
    const bot = await api("POST", "/api/bots", { name: "Personal" });
    expect(bot.status).toBe(201);
    const pairing = await api("POST", "/api/auth/pairing", { label: "Kiosk", scopes: ["client"] });
    const paired = await api("POST", "/api/auth/pair", { code: pairing.body.code });
    expect(paired.status).toBe(200);
    kioskToken = paired.body.token;
    const seen = await api("GET", "/api/bots", undefined, kioskToken);
    expect(seen.status).toBe(200);
    expect(seen.body.bots.map((b: any) => b.id)).toContain(bot.body.bot.id);
    // It sees the bot but does not own it: a grant is refused before the
    // grantee is resolved, so a huge email creates no principal.
    const before = principalsFile().principals;
    const refused = await api("POST", `/api/bots/${bot.body.bot.id}/direct-grants`, { userId: `${"a".repeat(400)}@example.test` }, kioskToken);
    expect(refused).toEqual({ status: 403, body: { error: "not-owner" } });
    const plain = await api("POST", `/api/bots/${bot.body.bot.id}/direct-grants`, { userId: "stranger@example.test" }, kioskToken);
    expect(plain).toEqual({ status: 403, body: { error: "not-owner" } });
    expect(principalsFile().principals).toEqual(before);
    // Its live stream opens now, unfiltered, before any organization.
    kioskStream = openStream(kioskToken);
    expect(await until(() => kioskStream!.state.text.includes('"kind":"hello"'))).toBe(true);
    expect(kioskStream.state.closed).toBe(false);
  });

  it("has no organization: GET 404, create and change 410", async () => {
    expect(await api("GET", "/api/org")).toMatchObject({ status: 404, body: { code: "no_organization" } });
    expect(await api("POST", "/api/org", { name: "Example", host: { kind: "server", url: "https://server.example.com" } })).toMatchObject({ status: 410, body: { code: "interim_org_removed" } });
    expect(await api("PATCH", "/api/org", { host: { kind: "server", url: "https://server.example.com" } })).toMatchObject({ status: 410, body: { code: "interim_org_removed" } });
    const config = await api("GET", "/api/config");
    ownerId = config.body.viewer.principalId;
    expect(ownerId).toMatch(/^pr_/);
    const local = principalsFile().principals.filter((p) => p.local);
    expect(local).toEqual([expect.objectContaining({ id: ownerId, email: "owner@example.com" })]);
    kioskStream?.abort();
  });

  it("pairs a phone from this computer as the same person", async () => {
    const pairing = await api("POST", "/api/auth/pairing", { label: "Owner's phone", scopes: ["admin", "client"] });
    expect(pairing.status, JSON.stringify(pairing.body)).toBe(200);
    const paired = await api("POST", "/api/auth/pair", { code: pairing.body.code });
    expect(paired.status, JSON.stringify(paired.body)).toBe(200);
    const token = paired.body.token as string;
    const listed = await api("GET", "/api/auth/sessions", undefined, token);
    expect(listed.status).toBe(200);
    const mine = listed.body.sessions.find((session: any) => session.id === listed.body.current);
    expect(mine?.principalId).toBe(ownerId);
  });

  let botId = "";
  let channelId = "";

  it("lets a member added to a channel by email see it from her own session", async () => {
    const bot = await api("POST", "/api/bots", { name: "Ops" });
    expect(bot.status, JSON.stringify(bot.body)).toBe(201);
    botId = bot.body.bot.id;
    const created = await api("POST", "/api/groups", { name: "Ops room", memberIds: [botId], humanIds: ["Zara@Example.test"] });
    expect(created.status, JSON.stringify(created.body)).toBeLessThan(300);
    channelId = created.body.group.id;
    expect(created.body.group.humanIds).toEqual([ZARA_ID]);
    const seen = await api("GET", "/api/bots", undefined, zaraToken);
    expect(seen.status).toBe(200);
    expect(seen.body.groups.map((g: any) => g.id)).toContain(channelId);
  });

  it("lets a person granted a bot by email see it in her Direct view", async () => {
    const bot = await api("POST", "/api/bots", { name: "Solo" });
    expect(bot.status).toBe(201);
    const soloId = bot.body.bot.id as string;
    expect((await api("GET", "/api/bots", undefined, zaraToken)).body.bots.map((b: any) => b.id)).not.toContain(soloId);
    const granted = await api("POST", `/api/bots/${soloId}/direct-grants`, { userId: ZARA.toUpperCase() });
    expect(granted.status, JSON.stringify(granted.body)).toBe(200);
    expect(granted.body.directGrants).toEqual([ZARA_ID]);
    expect((await api("GET", "/api/bots", undefined, zaraToken)).body.bots.map((b: any) => b.id)).toContain(soloId);
  });

  const pairAs = async (scopes: string[]) => {
    const pairing = await api("POST", "/api/auth/pairing", { label: "Device", scopes });
    expect(pairing.status).toBe(200);
    const paired = await api("POST", "/api/auth/pair", { code: pairing.body.code });
    expect(paired.status).toBe(200);
    return paired.body.token as string;
  };

  it("pairs an admin code from this computer as the operator, who sees every channel", async () => {
    const token = await pairAs(["admin", "client"]);
    const seen = await api("GET", "/api/bots", undefined, token);
    expect(seen.body.groups.map((g: any) => g.id)).toContain(channelId);
    expect(seen.body.bots.map((b: any) => b.id)).toContain(botId);
  });

  it("lets the operator's own paired device edit the name and email, as a solo server always did", async () => {
    const token = await pairAs(["admin", "client"]);
    const session = await api("GET", "/api/auth/session", undefined, token);
    expect(session.body.profileManagedBy).toBeUndefined();
    const saved = await api("PUT", "/api/config", { profile: { name: "Owner Martin", email: "owner@example.com" } }, token);
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.profile).toMatchObject({ name: "Owner Martin", email: "owner@example.com" });
    const config = await api("GET", "/api/config", undefined, token);
    expect(config.body.viewer.profileManagedBy).toBeUndefined();
    expect(config.body.viewer.profileManageUrl).toBeUndefined();
  });

  it("keeps one local operator and the same owner across a restart", async () => {
    await stop();
    // A bad entry (an oversized email, as an older build could write) is
    // skipped on load; it does not wipe the file or change the operator.
    const file = JSON.parse(readFileSync(join(data, "principals.json"), "utf8"));
    file.principals.push({ id: "pr_00000000-0000-4000-8000-0000000000ff", kind: "human", email: `${"a".repeat(400)}@example.test`, createdAt: 1 });
    writeFileSync(join(data, "principals.json"), JSON.stringify(file));
    await start();
    const local = principalsFile().principals.filter((p) => p.local);
    expect(local).toHaveLength(1);
    expect(local[0]!.id).toBe(ownerId);
    expect((await api("GET", "/api/config")).body.viewer.principalId).toBe(ownerId);
  }, 40_000);
});

// A separate boot (slice 8, "email stays solo"): a solo server keeps its
// email sign-in list, invitations and mailer; only the interim organization
// is gone. The data directory is one an older build left: config.json with
// an `org` key, an email session and a pairing session.
posixOnly("slice 8: a solo server keeps email sign-in, without an organization", () => {
  it("keeps the email routes, invitations and both sessions, refuses an organization and ignores the old org key", async () => {
    const home2 = mkdtempSync(join(tmpdir(), "omb-interim-removed-"));
    const data2 = join(home2, ".sagax");
    mkdirSync(data2, { recursive: true });
    writeFileSync(join(data2, "config.json"), JSON.stringify({
      profile: { name: "Owner", email: "owner@example.com" },
      signIn: { admins: ["owner@example.com"], members: ["dana@example.test"] },
      invites: [
        { token: "e".repeat(32), email: "eve@example.test", createdAt: 1, expiresAt: 2 },
        { token: "f".repeat(32), email: "fay@example.test", createdAt: Date.now(), expiresAt: Date.now() + 86_400_000 },
      ],
      org: { name: "Example", host: { kind: "server", url: "https://server.example.com" }, ownerUserId: "owner@example.com" },
      mail: { provider: "smtp", from: "bot@example.com", smtp: { host: "smtp.example.com" } },
    }));
    // Dana signed in with an emailed code under an older build: her address
    // is on the list, so her session survives the seeding registry's close.
    const seeded = new SessionRegistry({ file: join(data2, "sessions.json"), emailScopes: () => ["client"] });
    const emailToken = seeded.issue({ label: "Dana's laptop", email: "dana@example.test", scopes: ["client"] }).token;
    const pairing = seeded.openPairing({ scopes: ["admin", "client"], label: "Owner's phone" });
    const paired = seeded.exchange({ code: pairing.code, label: "Owner's phone", source: "test" });
    if (!paired.ok) throw new Error(paired.error);
    seeded.close();
    const port = await freePortBlock([0, 1]);
    const base = `http://127.0.0.1:${port}`;
    let log2 = "";
    const child2 = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
      cwd: join(SERVER_DIR, ".."),
      env: {
        ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
        ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
        HOME: home2, USERPROFILE: home2, SAGAX_PORT: String(port), SAGAX_WEBHOOK_PORT: String(port + 1),
        // Mail is captured, never sent (server/index.ts test seam).
        SAGAX_MAIL_CAPTURE_FILE: join(home2, "mail.jsonl"), SAGAX_TEST_SEAMS: "1", NODE_ENV: "test",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child2.stdout!.on("data", (c) => (log2 += c));
    child2.stderr!.on("data", (c) => (log2 += c));
    const call = async (method: string, path: string, init: { body?: unknown; token?: string } = {}) => {
      const res = await fetch(`${base}${path}`, {
        method, redirect: "manual",
        headers: { ...(init.body !== undefined ? { "content-type": "application/json" } : {}), ...(init.token ? { authorization: `Bearer ${init.token}` } : {}) },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });
      const text = await res.text();
      let body: any = {};
      try { body = JSON.parse(text); } catch { /* not JSON */ }
      return { status: res.status, body, location: res.headers.get("location") };
    };
    try {
      const deadline = Date.now() + 20_000;
      for (;;) {
        try {
          if ((await fetch(`${base}/api/health`)).ok) break;
        } catch {
          /* not up yet */
        }
        if (Date.now() > deadline) throw new Error(`server never came up:\n${log2}`);
        await new Promise((r) => setTimeout(r, 150));
      }
      expect(log2).not.toMatch(/ignoring .*config\.json/);
      // The old profile still applies: the config file loaded.
      expect((await call("GET", "/api/config")).body.profile.name).toBe("Owner");
      // Email sign-in for the server's list: a code is mailed, a wrong one is refused.
      expect((await call("GET", "/.well-known/openmausbot/environment")).body.capabilities.emailSignIn).toBe(true);
      expect(await call("POST", "/api/auth/email/start", { body: { email: "dana@example.test" } })).toMatchObject({ status: 200, body: { ok: true } });
      const mail = readFileSync(join(home2, "mail.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line) as { to: string; text: string });
      expect(mail.map((m) => m.to)).toEqual(["dana@example.test"]);
      expect(mail[0]!.text).toMatch(/\d{8}/);
      expect((await call("POST", "/api/auth/email/start", { body: { email: "stranger@example.test" } })).status).toBe(403);
      // The invitations from before still answer, in the server's own name.
      expect(await call("GET", `/api/org/invites/${"e".repeat(32)}/preview`)).toMatchObject({ status: 200, body: { status: "expired" } });
      expect(await call("GET", `/api/org/invites/${"f".repeat(32)}/preview`)).toMatchObject({ status: 200, body: { status: "open", email: "f***@example.test" } });
      // No organization: nothing to create or move, the old org key ignored.
      expect(await call("POST", "/api/org", { body: { name: "X", host: { kind: "server", url: "https://x.test" } }, token: paired.token })).toMatchObject({ status: 410, body: { code: "interim_org_removed" } });
      expect(await call("PATCH", "/api/org", { body: { host: { kind: "server", url: "https://x.test" } }, token: paired.token })).toMatchObject({ status: 410, body: { code: "interim_org_removed" } });
      expect(await call("GET", "/api/org", { token: paired.token })).toMatchObject({ status: 404, body: { code: "no_organization" } });
      expect((await call("GET", "/join")).status).not.toBe(302);
      const config2 = JSON.parse(readFileSync(join(data2, "config.json"), "utf8")) as Record<string, unknown>;
      expect(config2.signIn).toEqual({ admins: ["owner@example.com"], members: ["dana@example.test"] });
      // An admin issues an invitation; it is mailed with its /join link.
      const issued = await call("POST", "/api/org/invites", { body: { email: "gus@example.test" }, token: paired.token });
      expect(issued.status, JSON.stringify(issued.body)).toBe(200);
      expect(issued.body).toMatchObject({ mailed: true, invite: { email: "gus@example.test" } });
      expect(issued.body.link).toMatch(/\/join#token=/);
      const invited = readFileSync(join(home2, "mail.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line) as { to: string; text: string });
      expect(invited.at(-1)).toMatchObject({ to: "gus@example.test" });
      expect(invited.at(-1)!.text).toContain(issued.body.link);
      // Both sessions keep working: the email one is on the list.
      expect((await call("GET", "/api/bots", { token: emailToken })).status).toBe(200);
      expect((await call("GET", "/api/bots", { token: paired.token })).status).toBe(200);
      const sessions2 = JSON.parse(readFileSync(join(data2, "sessions.json"), "utf8")) as { sessions: { label: string }[] };
      expect(sessions2.sessions.map((session) => session.label).sort()).toEqual(["Dana's laptop", "Owner's phone"]);
    } finally {
      await waitForExit(child2, { signal: "SIGTERM" });
      await removeTempDir(home2);
    }
  }, 40_000);
});
