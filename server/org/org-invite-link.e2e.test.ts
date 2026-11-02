// Invite links through the real server, on a solo server (slice 8: no
// organization, invitations in the server's own name, links on its public
// address): the owner invites an address and gets a /join link; a remote browser with no session (a request marked as
// proxied, as through Caddy) previews and redeems it, and becomes a member
// who sees only the channels shared with her. The link works once. An
// invited address that signs in with an emailed code joins without it.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { removeTempDir, waitForExit } from "../testing/cleanup.ts";
import { freePortBlock } from "../testing/ports.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const PORT = await freePortBlock([0, 1]);
const BASE = `http://127.0.0.1:${PORT}`;
const posixOnly = describe.skipIf(process.platform === "win32");
const ZARA = "zara@example.test";
const ADA = "ada@example.test";
// What Caddy adds in front of the server: the request is remote, so it gets
// no loopback trust and needs its own session.
const REMOTE = { "x-forwarded-for": "198.51.100.23", "x-forwarded-proto": "https" };

let child: ChildProcess | undefined;
let home = "";
let captureFile = "";
let log = "";

async function api(method: string, path: string, options: { body?: unknown; headers?: Record<string, string> } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(options.body !== undefined ? { "content-type": "application/json" } : {}), ...options.headers },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await res.text();
  let body: any = {};
  try {
    body = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: res.status, body, cookie: res.headers.get("set-cookie") };
}

function mails(): { to: string; subject: string; text: string }[] {
  try {
    return readFileSync(captureFile, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

async function until<T>(check: () => T | undefined, ms = 5_000): Promise<T | undefined> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() > deadline) return undefined;
    await new Promise((r) => setTimeout(r, 50));
  }
}

posixOnly("org invite links", () => {
  beforeAll(async () => {
    home = mkdtempSync(join(tmpdir(), "omb-org-invite-link-"));
    const data = join(home, ".sagax");
    mkdirSync(data, { recursive: true });
    writeFileSync(join(data, "config.json"), JSON.stringify({ profile: { name: "Owner", email: "owner@example.com" } }));
    captureFile = join(home, "mail-capture.jsonl");
    child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
      cwd: join(SERVER_DIR, ".."),
      env: {
        ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
        ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
        HOME: home, USERPROFILE: home, SAGAX_LOCAL_VM_TEST_NAMESPACE: process.env.SAGAX_LOCAL_VM_TEST_NAMESPACE ?? "", SAGAX_PORT: String(PORT), SAGAX_WEBHOOK_PORT: String(PORT + 1),
        SAGAX_MAIL_PROVIDER: "sendgrid", SAGAX_MAIL_FROM: "bot@example.com", SAGAX_SENDGRID_API_KEY: "test-key",
        SAGAX_MAIL_CAPTURE_FILE: captureFile, SAGAX_TEST_SEAMS: "1",
        SAGAX_PUBLIC_URL: "https://server.example.com", SAGAX_ENVIRONMENT_LABEL: "Example",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout!.on("data", (c) => (log += c));
    child.stderr!.on("data", (c) => (log += c));
    const deadline = Date.now() + 20_000;
    for (;;) {
      try {
        if ((await fetch(`${BASE}/api/health`)).ok) break;
      } catch {
        /* not up yet */
      }
      if (Date.now() > deadline) throw new Error(`server never came up:\n${log}`);
      await new Promise((r) => setTimeout(r, 150));
    }
  }, 40_000);

  afterAll(async () => {
    if (child) await waitForExit(child, { signal: "SIGTERM" });
    await removeTempDir(home);
  });

  let token = "";
  let cookie = "";

  it("gives the owner a /join link on the server's public address, and mails it, with no organization", async () => {
    const org = await api("POST", "/api/org", { body: { name: "Example", host: { kind: "server", url: "https://server.example.com" } } });
    expect(org).toMatchObject({ status: 410, body: { code: "interim_org_removed" } });
    expect(await api("GET", "/api/org")).toMatchObject({ status: 404, body: { code: "no_organization" } });
    const invite = await api("POST", "/api/org/invites", { body: { email: ZARA } });
    expect(invite.status, JSON.stringify(invite.body)).toBe(200);
    expect(invite.body.link).toMatch(/^https:\/\/server\.example\.com\/join#token=[0-9a-f]{32}$/);
    token = /token=([0-9a-f]+)/.exec(invite.body.link)![1]!;
    expect(invite.body.mailed).toBe(true);
    const mail = await until(() => mails().find((m) => m.to === ZARA));
    expect(mail?.text).toContain(`Open ${invite.body.link} within 7 days to join Example.`);
    const listed = await api("GET", "/api/org/invites");
    expect(listed.body.org).toMatchObject({ name: "Example", host: { kind: "this-computer" } });
    expect(listed.body.pendingInvites).toEqual([expect.objectContaining({ email: ZARA, link: invite.body.link })]);
    expect(listed.body.people).toEqual([expect.objectContaining({ role: "owner", email: "owner@example.com" })]);
  });

  it("lets a remote browser with no session preview the invite, masked", async () => {
    const refused = await api("GET", "/api/org/invites", { headers: REMOTE });
    expect([401, 403]).toContain(refused.status);
    const preview = await api("GET", `/api/org/invites/${token}/preview`, { headers: REMOTE });
    expect(preview.status).toBe(200);
    expect(preview.body).toEqual({ status: "open", orgName: "Example", email: "z***@example.test" });
    const unknown = await api("GET", "/api/org/invites/ffffffffffffffffffffffffffffffff/preview", { headers: REMOTE });
    expect(unknown.body).toEqual({ status: "unknown" });
  });

  it("joins as a member with a session cookie", async () => {
    const joined = await api("POST", `/api/org/invites/${token}/join`, { body: {}, headers: REMOTE });
    expect(joined.status, JSON.stringify(joined.body)).toBe(200);
    expect(joined.body).toEqual({ status: "joined", orgName: "Example" });
    expect(joined.cookie).toBeTruthy();
    expect(joined.cookie).toMatch(/HttpOnly/i);
    cookie = joined.cookie!.split(";")[0]!;
    // A member does not read the invitation directory (admin only).
    expect((await api("GET", "/api/org/invites", { headers: { ...REMOTE, cookie } })).status).toBe(403);
    const org = await api("GET", "/api/org/invites");
    expect(org.status, JSON.stringify(org.body)).toBe(200);
    expect(org.body.people).toContainEqual({ id: ZARA, role: "member", email: ZARA });
    expect(JSON.stringify(org.body.pendingInvites)).not.toContain(token);
    const sessions = await api("GET", "/api/auth/sessions");
    const mine = sessions.body.sessions.find((s: any) => s.label === `Invited: ${ZARA}`);
    expect(mine?.scopes).toEqual(["client"]);
    expect(mine?.principalId).toMatch(/^pr_/);
  });

  it("shows her a channel only once she is added to it", async () => {
    const bot = await api("POST", "/api/bots", { body: { name: "Ops" } });
    expect(bot.status).toBe(201);
    const shared = await api("POST", "/api/groups", { body: { name: "Shared room", memberIds: [bot.body.bot.id], humanIds: [] } });
    const other = await api("POST", "/api/groups", { body: { name: "Other room", memberIds: [bot.body.bot.id], humanIds: [] } });
    expect(shared.status, JSON.stringify(shared.body)).toBeLessThan(300);
    expect(other.status).toBeLessThan(300);
    const seen = async () => (await api("GET", "/api/bots", { headers: { ...REMOTE, cookie } })).body.groups.map((g: any) => g.id);
    expect(await seen()).not.toContain(shared.body.group.id);
    const added = await api("PATCH", `/api/groups/${shared.body.group.id}`, { body: { humanIds: [ZARA] } });
    expect(added.status, JSON.stringify(added.body)).toBeLessThan(300);
    const now = await seen();
    expect(now).toContain(shared.body.group.id);
    expect(now).not.toContain(other.body.group.id);
  });

  it("refuses the same link a second time", async () => {
    const again = await api("POST", `/api/org/invites/${token}/join`, { body: {}, headers: REMOTE });
    expect(again.status).toBe(410);
    expect(again.body).toEqual({ status: "used" });
    expect(again.cookie).toBeNull();
  });

  it("makes an invited address a member when it signs in with an emailed code, without the link", async () => {
    const invite = await api("POST", "/api/org/invites", { body: { email: ADA } });
    expect(invite.status).toBe(200);
    const started = await api("POST", "/api/auth/email/start", { body: { email: ADA }, headers: REMOTE });
    expect(started.status, JSON.stringify(started.body)).toBe(200);
    const mail = await until(() => mails().find((m) => m.to === ADA && /Your code is \d{8}/.test(m.text)));
    const code = /Your code is (\d{8})/.exec(mail!.text)![1];
    const verified = await api("POST", "/api/auth/email/verify", { body: { email: ADA, code }, headers: REMOTE });
    expect(verified.status, JSON.stringify(verified.body)).toBe(200);
    const org = await api("GET", "/api/org/invites");
    expect(org.body.people).toContainEqual({ id: ADA, role: "member", email: ADA });
    expect(org.body.pendingInvites).toEqual([]);
    const config = JSON.parse(readFileSync(join(home, ".sagax", "config.json"), "utf8"));
    expect(config.signIn.members).toEqual([ZARA, ADA]);
    const link = /token=([0-9a-f]+)/.exec(invite.body.link)![1]!;
    expect((await api("GET", `/api/org/invites/${link}/preview`, { headers: REMOTE })).body).toEqual({ status: "used" });
  });
});
