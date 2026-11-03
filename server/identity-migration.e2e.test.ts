// The boot migration on data written before principals: a real server over
// a DATA_DIR whose org owner, bot owner, grants and channel people are
// emails and "local-owner", with two old pairing sessions and no email.
// Booting maps every ref to a principal id, and booting again changes
// nothing.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SessionRegistry } from "./auth/sessions.ts";
import { removeTempDir, waitForExit } from "./testing/cleanup.ts";
import { freePortBlock } from "./testing/ports.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const PORT = await freePortBlock([0, 1]);
const BASE = `http://127.0.0.1:${PORT}`;
const posixOnly = describe.skipIf(process.platform === "win32");

let child: ChildProcess | undefined;
let home: string;
let data: string;
let log = "";

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

const read = (name: string) => JSON.parse(readFileSync(join(data, name), "utf8"));
const write = (name: string, value: unknown) => writeFileSync(join(data, name), JSON.stringify(value, null, 2));

let botId = "";
let channelId = "";
let adminToken = "";
let kioskToken = "";
let adminSessionId = "";
let kioskSessionId = "";

/** Everything the migration writes, to compare across boots. */
function identitySnapshot() {
  const bot = (read("bots.json") as any[]).find((b) => b.id === botId);
  const group = (read("groups.json") as any[]).find((g) => g.id === channelId);
  const sessions = (read("sessions.json").sessions as any[]).map((s) => ({ id: s.id, principalId: s.principalId }));
  return {
    orgOwner: read("config.json").org?.ownerUserId,
    bot: { ownerUserId: bot.ownerUserId, directGrants: bot.directGrants },
    humanIds: group.humanIds,
    principals: read("principals.json").principals,
    sessions,
  };
}

posixOnly("identity migration at boot", () => {
  beforeAll(async () => {
    home = mkdtempSync(join(tmpdir(), "omb-identity-migration-"));
    data = join(home, ".sagax");
    mkdirSync(data, { recursive: true });
    write("config.json", { profile: { name: "Owner", email: "owner@example.com" } });
    // A first boot only builds a valid bot and channel; they are then
    // rewritten to what a build before principals stored.
    await start();
    const bot = await api("POST", "/api/bots", { name: "Ops" });
    expect(bot.status, JSON.stringify(bot.body)).toBe(201);
    botId = bot.body.bot.id;
    const group = await api("POST", "/api/groups", { name: "Ops room", memberIds: [botId] });
    expect(group.status, JSON.stringify(group.body)).toBeLessThan(300);
    channelId = group.body.group.id;
    await stop();

    // A pending approval from the owner's bot, for the answer checks below.
    const threadId = (read("bots.json") as any[]).find((b) => b.id === botId).threadId as string;
    const card = { id: "m-approval", role: "assistant", kind: "options", at: 1, text: "", from: { botId }, card: { title: "Approval needed", requestId: "r1", tool: "bash" } };
    const db = new DatabaseSync(join(data, "messages.db"));
    db.prepare("INSERT INTO messages (thread_id, id, at, role, kind, text, json) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(threadId, card.id, card.at, card.role, card.kind, card.text, JSON.stringify(card));
    db.close();

    rmSync(join(data, "principals.json"), { force: true });
    const config = read("config.json");
    delete config.identityMigratedAt;
    config.org = { name: "Example", host: { kind: "server", url: "https://server.example.com" }, ownerUserId: "owner@example.com" };
    config.profile = { name: "Owner", email: "owner@example.com" };
    write("config.json", config);
    write("bots.json", (read("bots.json") as any[]).map((b) => (b.id === botId ? { ...b, ownerUserId: "local-owner", directGrants: ["morgan@example.com"] } : b)));
    write("groups.json", (read("groups.json") as any[]).map((g) => (g.id === channelId ? { ...g, humanIds: ["owner@example.com", "morgan@example.com"] } : g)));
    rmSync(join(data, "sessions.json"), { force: true });
    const registry = new SessionRegistry({ file: join(data, "sessions.json") });
    const admin = registry.issue({ label: "Owner's old phone", scopes: ["admin", "client"] });
    const kiosk = registry.issue({ label: "Lobby kiosk", scopes: ["client"] });
    registry.close();
    adminToken = admin.token;
    kioskToken = kiosk.token;
    adminSessionId = admin.session.id;
    kioskSessionId = kiosk.session.id;
    expect(existsSync(join(data, "principals.json"))).toBe(false);
    await start();
  }, 60_000);

  afterAll(async () => {
    await stop();
    await removeTempDir(home);
  });

  let first: ReturnType<typeof identitySnapshot>;

  it("maps every stored ref to a principal id, one per email and one local operator", () => {
    first = identitySnapshot();
    const principals = first.principals as { id: string; email?: string; local?: boolean }[];
    const local = principals.filter((p) => p.local);
    expect(local).toHaveLength(1);
    const localId = local[0]!.id;
    expect(local[0]!.email).toBe("owner@example.com");
    const emails = principals.map((p) => p.email).filter(Boolean);
    expect(new Set(emails).size).toBe(emails.length);
    const morgan = principals.find((p) => p.email === "morgan@example.com")!;
    expect(morgan.id).toMatch(/^pr_/);
    expect(principals).toHaveLength(2);

    // Slice 8: the interim organization is gone; its old key is left as it
    // was (ignored), never rewritten.
    expect(first.orgOwner).toBe("owner@example.com");
    expect(first.bot).toEqual({ ownerUserId: localId, directGrants: [morgan.id] });
    expect(first.humanIds).toEqual([localId, morgan.id]);
    const byId = new Map(first.sessions.map((s) => [s.id, s.principalId]));
    expect(byId.get(adminSessionId)).toBe(localId);
    expect(byId.get(kioskSessionId)).toBeUndefined();
    expect(typeof read("config.json").identityMigratedAt).toBe("number");
  });

  it("names the old admin device it promoted to the operator", () => {
    expect(log).toContain(adminSessionId);
    expect(log).toContain("Owner's old phone");
    expect(log).not.toContain(kioskSessionId);
  });

  it("lets the old admin device see the channel and answer the owner's approval", async () => {
    const seen = await api("GET", "/api/bots", undefined, adminToken);
    expect(seen.status).toBe(200);
    expect(seen.body.groups.map((g: any) => g.id)).toContain(channelId);
    expect(seen.body.bots.map((b: any) => b.id)).toContain(botId);
    const answer = await api("POST", `/api/bots/${botId}/respond`, { requestId: "r1", behavior: "allow" }, adminToken);
    expect([403, 404], JSON.stringify(answer.body)).not.toContain(answer.status);
  });

  it("leaves the old kiosk a principal-less chat device, as on any personal server", async () => {
    // Slice 8: no interim organization, so a chat-only device sees the
    // operator's bots and rooms (its scope still gates what it may do), and
    // it is never given a principal.
    const seen = await api("GET", "/api/bots", undefined, kioskToken);
    expect(seen.status).toBe(200);
    expect(seen.body.groups.map((g: any) => g.id)).toContain(channelId);
    expect(seen.body.bots.map((b: any) => b.id)).toContain(botId);
    expect(identitySnapshot().sessions.find((session) => session.id === kioskSessionId)?.principalId).toBeUndefined();
  });

  it("changes nothing on a second boot", async () => {
    await stop();
    await start();
    expect(identitySnapshot()).toEqual(first);
    expect(log).not.toContain("now acts as the local operator");
  }, 40_000);
});
