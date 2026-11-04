// Full access on an organization server through the real server, the fake
// Perspicax provider and the fake Claude CLI (server/org/org-full-access.ts):
//
//   FA-1  the bot's owner turns Full on for a thread after confirming once;
//         the turn runs Claude with bypassPermissions while the server's own
//         host tools stay withheld (the org denial holds under Full)
//   FA-2  an admin turns the policy off: grants and turns asking Full are
//         refused (org_full_access_disabled); Ask still works; members may
//         not change the policy
//   FA-3  mode changes and Full turns are in the admin activity log
//   FA-4  (2026-10-20, the owner: "le bot principal doit pouvoir absolument tout
//         faire") the owner asks their Primary Bot "mets Zed en Full" and
//         also "mets-toi en Full": sagax_settings with their words turns it
//         on at once, with their own rights; without their words it waits
//   FA-5  (PR #934 review) the Full grant from the bot's settings names the
//         open conversation: the owner's own thread follows and is audited;
//         another person's thread is never named or audited, and the level
//         that person chose for their own conversation stays theirs. Since
//         #1169 the level is the bot's: the owner's threads follow it
//   FA-6  (#1674) the packaged desktop app on this remote server has no
//         private approval channel (its page is the server's): the app's own
//         saves turn Full on through the server, for the conversation and
//         for the bot, never a false "requires the packaged desktop app";
//         Refresh permissions brings the bot's Full back to a thread
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { removeTempDir, waitForExit } from "../testing/cleanup.ts";
import { startFakeOidcProvider, type FakeOidcProvider, type FakeOidcUser } from "../testing/fake-oidc-provider.ts";
import { freePortBlock } from "../testing/ports.ts";
import { CLAUDE_HOST_TOOLS } from "../drivers/host-tools.ts";

const SERVER_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const FAKE_CLAUDE = join(SERVER_DIR, "testing", "fake-claude-cli.ts");
const posixOnly = describe.skipIf(process.platform === "win32");
const ALICE: FakeOidcUser = { sub: "01J9FAALICE00000000000000A", email: "alice@example.test", name: "Alice", preferred_username: "alice", role: "admin" };
const ERIN: FakeOidcUser = { sub: "01J9FAERIN000000000000000E", email: "erin@example.test", name: "Erin", preferred_username: "erin", role: "employee" };

let BASE = "";
let child: ChildProcess;
let home: string;
let dump = "";
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

async function waitFor<T>(read: () => Promise<T | null | undefined | false>, ms = 15_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out. server log:\n${log.slice(-3000)}`);
    await sleep(150);
  }
}

/** The admin activity log of one category, as an admin reads it. The rows
 * are sealed on disk (2026-10-27, #1263), so they are read through the
 * route, not the files. */
async function auditRows(as: Auth, what: "approval" | "org"): Promise<Array<{ action: string; what: string; after?: Record<string, unknown>; before?: Record<string, unknown>; target?: unknown }>> {
  const got = await api("GET", `/api/admin-activity?what=${what}`, as);
  expect(got.status, got.text).toBe(200);
  return got.body.entries;
}

posixOnly("organization Full access", () => {
  let alice: Auth;
  let erin: Auth;
  let erinId = "";
  let zed: { id: string; threadId: string };

  beforeAll(async () => {
    chmodSync(FAKE_CLAUDE, 0o755);
    idp = await startFakeOidcProvider({ user: ALICE });
    idp.directoryPeople = [ALICE, ERIN].map((user) => idp.personOf(user));
    const port = await freePortBlock([0, 1]);
    BASE = `http://127.0.0.1:${port}`;
    home = mkdtempSync(join(tmpdir(), "omb-org-full-access-"));
    const data = join(home, ".openmausbot");
    mkdirSync(data, { recursive: true });
    mkdirSync(join(home, "link"), { recursive: true, mode: 0o750 });
    writeFileSync(join(home, "link", "pulsabot.json"), JSON.stringify({
      version: 1, issuer: idp.issuer, client_id: "pulsa-bot", server_id: idp.serverId, origin: BASE, link_token: idp.linkToken,
    }), { mode: 0o640 });
    dump = join(home, "claude-dump.json");
    writeFileSync(join(data, "config.json"), JSON.stringify({
      instances: {
        // fcce56775 (#1812): these fixtures use the organization API key.
        claude: { driver: "claudeAgent", access: "api", environment: { FAKE_CLAUDE_DUMP: dump }, config: { cli: FAKE_CLAUDE, requireApiKey: true, fullAuto: true } },
        // a turn that stays open, for the Primary Bot's tool calls (FA-4)
        waiting: { driver: "claudeAgent", access: "api", environment: { FAKE_CLAUDE_DUMP: dump, FAKE_CLAUDE_MODE: "hang" }, config: { cli: FAKE_CLAUDE, requireApiKey: true, fullAuto: true } },
      },
    }));
    child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
      cwd: join(SERVER_DIR, ".."),
      env: {
        ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
        HOME: home, USERPROFILE: home, SAGAX_PORT: String(port), SAGAX_WEBHOOK_PORT: String(port + 1),
        SAGAX_IDENTITY: "perspicax",
        SAGAX_PERSPICAX_ISSUER: idp.issuer,
        SAGAX_PUBLIC_URL: BASE,
        SAGAX_PERSPICAX_LINK_FILE: join(home, "link", "pulsabot.json"),
        SAGAX_ANTHROPIC_API_KEY: "sk-ant-test-org-key",
        SAGAX_ORG_NAME: "Acme",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout!.on("data", (c) => (log += c));
    child.stderr!.on("data", (c) => (log += c));
    await waitFor(async () => {
      try { return (await fetch(`${BASE}/api/health`)).ok; } catch { return false; }
    }, 20_000);
    alice = await signIn(ALICE);
    erin = await signIn(ERIN);
    erinId = (await api("GET", "/api/auth/session", erin)).body.principalId;
    const created = await api("POST", "/api/bots", erin, { name: "Zed" });
    expect(created.status, created.text).toBe(201);
    // #1098: no policy saved, so a new bot of the organization starts on
    // Approve for me, as on a solo server
    expect(created.body.bot.approvalMode).toBe("auto");
    const patched = await api("PATCH", `/api/bots/${created.body.bot.id}`, erin, { modelSelection: { instanceId: "claude", model: "fake-model" } });
    expect(patched.status, patched.text).toBe(200);
    zed = { id: created.body.bot.id, threadId: created.body.bot.threadId };
    // shared with the admin, who still is not its owner
    const aliceId = (await api("GET", "/api/auth/session", alice)).body.principalId;
    expect((await api("POST", `/api/bots/${zed.id}/direct-grants`, erin, { userId: aliceId })).status).toBe(200);
  }, 60_000);

  afterAll(async () => {
    if (child && child.exitCode === null) {
      child.kill("SIGTERM");
      await waitForExit(child, 5_000);
    }
    await idp?.close();
    if (home) removeTempDir(home);
  });

  it("FA-1: the owner confirms once, the turn bypasses prompts, host tools stay withheld", async () => {
    // 2026-10-26 (owner): no organization switch, the owner's confirmation is the gate
    expect((await api("GET", "/api/org", alice)).body.settings.allowFullAccess).toBe(true);
    const thread = `/api/bots/${zed.id}/tasks/${zed.threadId}`;
    const unconfirmed = await api("PATCH", thread, erin, { approvalMode: "full" });
    expect(unconfirmed.status, unconfirmed.text).toBe(409);
    expect(unconfirmed.body.code).toBe("full_access_confirm_required");
    // the admin is not the owner
    // the admin never reaches the owner's private thread, and is not the
    // bot's owner either
    expect((await api("PATCH", thread, alice, { approvalMode: "full", confirmFullAccess: true })).status).toBe(404);
    const byAdmin = await api("PATCH", `/api/bots/${zed.id}`, alice, { approvalMode: "full", confirmFullAccess: true });
    expect(byAdmin.body.code, byAdmin.text).toBe("full_access_owner_only");
    const granted = await api("PATCH", thread, erin, { approvalMode: "full", confirmFullAccess: true });
    expect(granted.status, granted.text).toBe(200);
    expect(granted.body.task.approvalMode).toBe("full");
    expect(granted.body.bot.fullAccessConsent.principalId).toBe(erinId);
    // confirmed once: the next grant for this bot needs no confirmation
    expect((await api("PATCH", thread, erin, { approvalMode: "ask" })).status).toBe(200);
    expect((await api("PATCH", thread, erin, { approvalMode: "full" })).status).toBe(200);

    rmSync(dump, { force: true });
    const sent = await api("POST", `/api/bots/${zed.id}/messages`, erin, { text: "go full" });
    expect(sent.status, sent.text).toBe(202);
    await waitFor(async () => existsSync(dump), 20_000);
    const argv = (JSON.parse(readFileSync(dump, "utf8")) as { argv: string[] }).argv;
    expect(argv[argv.indexOf("--permission-mode") + 1]).toBe("bypassPermissions");
    const denied = argv[argv.indexOf("--disallowedTools") + 1]!.split(",");
    for (const tool of CLAUDE_HOST_TOOLS) expect(denied).toContain(tool);
    await waitFor(async () => (await auditRows(alice, "approval")).some((row) => row.action === "approval.full_access_turn"));
  }, 60_000);

  it("FA-2: a saved allowFullAccess false takes nothing from the owner (2026-10-26); Ask still works", async () => {
    expect((await api("PATCH", "/api/org/settings", erin, { allowFullAccess: false })).status).toBe(403);
    const off = await api("PATCH", "/api/org/settings", alice, { allowFullAccess: false });
    expect(off.status, off.text).toBe(200);
    expect(off.body.settings.allowFullAccess).toBe(true);
    await waitFor(async () => !(await api("GET", `/api/bots`, erin)).body.bots.find((bot: { id: string; busy?: boolean }) => bot.id === zed.id)?.busy);
    const thread = await api("PATCH", `/api/bots/${zed.id}/tasks/${zed.threadId}`, erin, { approvalMode: "full", confirmFullAccess: true });
    expect(thread.status, thread.text).toBe(200);

    // back to Ask: the bot works again, prompting as usual
    expect((await api("PATCH", `/api/bots/${zed.id}/tasks/${zed.threadId}`, erin, { approvalMode: "ask" })).status).toBe(200);
    rmSync(dump, { force: true });
    expect((await api("POST", `/api/bots/${zed.id}/messages`, erin, { text: "ask now" })).status).toBe(202);
    await waitFor(async () => existsSync(dump), 20_000);
    const argv = (JSON.parse(readFileSync(dump, "utf8")) as { argv: string[] }).argv;
    expect(argv[argv.indexOf("--permission-mode") + 1]).not.toBe("bypassPermissions");
  }, 60_000);

  it("FA-3: mode changes and the policy are in the admin activity log", async () => {
    const rows = await auditRows(alice, "approval");
    expect(rows.some((row) => row.action === "approval.mode" && row.after?.approvalMode === "full")).toBe(true);
    expect((await auditRows(alice, "org")).some((row) => row.action === "org.settings" && row.after?.allowFullAccess === false)).toBe(true);
    const listed = await api("GET", "/api/admin-activity?what=approval", alice);
    expect(listed.status, listed.text).toBe(200);
    expect(listed.text).toContain("approval.full_access_turn");
  });

  it("FA-4: the owner's Primary Bot turns Full on at their request, for another bot and for itself", async () => {
    const created = await api("POST", "/api/bots", erin, { name: "Ivy" });
    expect(created.status, created.text).toBe(201);
    const ivy = created.body.bot as { id: string; threadId: string };
    expect((await api("PATCH", `/api/bots/${ivy.id}`, erin, { modelSelection: { instanceId: "waiting", model: "fake-model" } })).status).toBe(200);
    expect((await api("POST", `/api/bots/${ivy.id}/primary`, erin, {})).status).toBe(200);
    const aliceId = (await api("GET", "/api/auth/session", alice)).body.principalId;
    expect((await api("POST", `/api/bots/${ivy.id}/direct-grants`, erin, { userId: aliceId })).status).toBe(200);
    expect((await api("GET", `/api/bots`, erin)).body.bots.find((bot: { id: string }) => bot.id === zed.id).approvalMode).not.toBe("full");
    await waitFor(async () => !(await api("GET", `/api/bots`, erin)).body.bots.find((bot: { id: string; busy?: boolean }) => bot.id === zed.id)?.busy);
    rmSync(dump, { force: true });
    const sent = await api("POST", `/api/bots/${ivy.id}/messages`, erin, { text: "Mets Zed en Full et mets-toi en Full aussi." });
    expect(sent.status, sent.text).toBe(202);
    const comms = await waitFor(async () => {
      try { return JSON.parse(readFileSync(dump, "utf8")).mcpConfig.mcpServers.agents.env.SAGAX_COMMS_TOKEN as string; } catch { return null; }
    }, 20_000);
    const settings = async (args: Record<string, unknown>) => {
      const res = await fetch(`${BASE}/api/internal/settings`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${comms}` }, body: JSON.stringify(args) });
      return { status: res.status, body: await res.json() as any };
    };
    // without the person's words: their card
    const held = await settings({ action: "set", key: "bot.approvalMode", target: zed.id, value: "full" });
    expect(held.body.text, JSON.stringify(held.body)).toContain("Approval needed.");
    const zedFull = await settings({ action: "set", key: "bot.approvalMode", target: zed.id, value: "full", quote: "Mets Zed en Full" });
    expect(zedFull.body.text, JSON.stringify(zedFull.body)).toMatch(/^Done/);
    // the stored level, as the organization's admin reads it
    const level = async (botId: string) => (await api("GET", `/api/bots`, alice)).body.bots.find((bot: { id: string }) => bot.id === botId)?.approvalMode;
    expect(await level(zed.id)).toBe("full");
    // itself, while it answers: applies from its next message
    const self = await settings({ action: "set", key: "bot.approvalMode", value: "full", quote: "mets-toi en Full" });
    expect(self.body.text, JSON.stringify(self.body)).toMatch(/^Done/);
    // the audit line lands just after the reply
    await waitFor(async () => (await auditRows(alice, "approval")).some((row) => row.action === "approval.mode" && row.after?.approvalMode === "full" && JSON.stringify(row.target ?? {}).includes(ivy.id)));
    // and this conversation, which keeps its own level
    const here = await settings({ action: "set", key: "thread.approvalMode", value: "full", quote: "mets-toi en Full" });
    expect(here.body.text, JSON.stringify(here.body)).toMatch(/^Done/);
    const mine = (await api("GET", `/api/bots`, erin)).body.bots.find((bot: { id: string }) => bot.id === ivy.id);
    // (a member's message lands in her own conversation with the bot)
    expect(mine.tasks.map((task: { approvalMode: string }) => task.approvalMode)).toContain("full");
    await api("POST", `/api/bots/${ivy.id}/interrupt`, erin, { threadId: ivy.threadId });
  }, 60_000);

  it("FA-5: the Full grant names and audits the owner's open thread, never another person's, whose own level stays (#1169)", async () => {
    await waitFor(async () => !(await api("GET", `/api/bots`, erin)).body.bots.find((bot: { id: string; busy?: boolean }) => bot.id === zed.id)?.busy);
    // Alice (shared on Zed) has her own private thread on it
    const aliceThread = (await api("GET", `/api/bots`, alice)).body.bots.find((bot: { id: string }) => bot.id === zed.id)?.threadId as string;
    expect(aliceThread).toBeTruthy();
    expect(aliceThread).not.toBe(zed.threadId);
    expect((await api("PATCH", `/api/bots/${zed.id}/tasks/${zed.threadId}`, erin, { approvalMode: "ask" })).status).toBe(200);
    const threadOf = async (who: Auth, threadId: string): Promise<{ approvalMode?: string; approvalOwn?: string } | undefined> =>
      ((await api("GET", `/api/bots`, who)).body.bots.find((bot: { id: string }) => bot.id === zed.id)?.tasks ?? [])
        .find((task: { threadId: string }) => task.threadId === threadId);
    const threadMode = async (who: Auth, threadId: string) => (await threadOf(who, threadId))?.approvalMode;
    const botMode = async (who: Auth) => (await api("GET", `/api/bots`, who)).body.bots.find((bot: { id: string }) => bot.id === zed.id)?.approvalMode;
    // started while Zed defaulted to Full (FA-4): Alice lowers her own
    const lowered = await api("PATCH", `/api/bots/${zed.id}/tasks/${aliceThread}`, alice, { approvalMode: "ask" });
    expect(lowered.status, lowered.text).toBe(200);
    expect(await threadOf(alice, aliceThread)).toMatchObject({ approvalMode: "ask", approvalOwn: "thread" });

    // the owner names another person's conversation: it is not named in the
    // audit, and the level that person chose for it stays theirs
    const foreign = await api("PATCH", `/api/bots/${zed.id}`, erin, { approvalMode: "full", threadId: aliceThread });
    expect(foreign.status, foreign.text).toBe(200);
    expect(await botMode(erin)).toBe("full");
    expect(await threadOf(alice, aliceThread)).toMatchObject({ approvalMode: "ask", approvalOwn: "thread" });
    expect((await auditRows(alice, "approval")).some((row) => row.action === "approval.mode" && row.after?.approvalMode === "full" && row.after?.threadId === aliceThread)).toBe(false);

    // the owner's own open conversation follows and the change is audited with it
    const relowered = await api("PATCH", `/api/bots/${zed.id}/tasks/${zed.threadId}`, erin, { approvalMode: "ask" });
    expect(relowered.status, relowered.text).toBe(200);
    expect(await threadMode(erin, zed.threadId)).toBe("ask");
    const threadRows = async () => (await auditRows(alice, "approval")).filter((row) => row.action === "approval.mode" && row.after?.approvalMode === "full" && row.after?.threadId === zed.threadId).length;
    const rowsBefore = await threadRows();
    const own = await api("PATCH", `/api/bots/${zed.id}`, erin, { approvalMode: "full", threadId: zed.threadId });
    expect(own.status, own.text).toBe(200);
    // its exception ends: it reads the bot's Full, live
    expect(await threadOf(erin, zed.threadId)).not.toHaveProperty("approvalOwn");
    expect(await threadMode(erin, zed.threadId)).toBeUndefined();
    expect(await botMode(erin)).toBe("full");
    await waitFor(async () => (await threadRows()) === rowsBefore + 1);
  }, 60_000);

  it("FA-6: the packaged desktop app on a remote organization server turns Full on, for the conversation and the bot (#1674)", async () => {
    // the app's own saves (src/state/store.tsx, loaded at run time: the
    // server's typecheck does not compile the app)
    const appStore: string = "../../src/state/store.tsx";
    type Save = (...args: unknown[]) => Promise<{ id: string; approvalMode?: string }>;
    const { persistBotUpdate, persistTaskApproval } = await import(appStore) as { persistBotUpdate: Save; persistTaskApproval: Save };
    // the app's own transport on a remote page: the session cookie, no private channel
    const request = async (path: string, init?: RequestInit) => {
      const got = await api(init?.method ?? "GET", path, erin, init?.body ? JSON.parse(String(init.body)) : undefined);
      if (got.status >= 400) throw new Error(got.body?.error ?? got.text);
      return got.body;
    };
    const threadOf = async (threadId: string) =>
      ((await api("GET", `/api/bots`, erin)).body.bots.find((bot: { id: string }) => bot.id === zed.id)?.tasks ?? [])
        .find((task: { threadId: string }) => task.threadId === threadId) as { approvalMode?: string; approvalOwn?: string } | undefined;
    await waitFor(async () => !(await api("GET", `/api/bots`, erin)).body.bots.find((bot: { id: string; busy?: boolean }) => bot.id === zed.id)?.busy);
    expect((await api("PATCH", `/api/bots/${zed.id}/tasks/${zed.threadId}`, erin, { approvalMode: "ask" })).status).toBe(200);

    // this conversation: the composer's save, no bridge
    const thread = await persistTaskApproval(zed.id, zed.threadId, { approvalMode: "full", confirmFullAccess: true }, undefined, request);
    expect(thread.id).toBe(zed.id);
    expect((await threadOf(zed.threadId))?.approvalMode).toBe("full");

    // the bot (Edit bot > Permissions), naming the open conversation, which follows
    expect((await api("PATCH", `/api/bots/${zed.id}/tasks/${zed.threadId}`, erin, { approvalMode: "ask" })).status).toBe(200);
    expect(await threadOf(zed.threadId)).toMatchObject({ approvalMode: "ask", approvalOwn: "thread" });
    const bot = await persistBotUpdate(zed.id, { approvalMode: "full", confirmFullAccess: true, threadId: zed.threadId }, new AbortController().signal, request, undefined);
    expect(bot.approvalMode).toBe("full");
    expect(await threadOf(zed.threadId)).not.toHaveProperty("approvalOwn");

    // "Use Full access here" / Refresh permissions: the thread's own level
    // gives way to the bot's Full through the thread route, no desktop channel
    expect((await api("PATCH", `/api/bots/${zed.id}/tasks/${zed.threadId}`, erin, { approvalMode: "ask" })).status).toBe(200);
    expect(await threadOf(zed.threadId)).toMatchObject({ approvalMode: "ask", approvalOwn: "thread" });
    const refreshed = await api("PATCH", `/api/bots/${zed.id}/tasks/${zed.threadId}`, erin, { refreshPermissions: true });
    expect(refreshed.status, refreshed.text).toBe(200);
    expect(await threadOf(zed.threadId)).not.toHaveProperty("approvalOwn");
    // someone who does not own the bot is refused in the server's words
    expect((await api("PATCH", `/api/bots/${zed.id}/tasks/${zed.threadId}`, alice, { refreshPermissions: true })).status).toBeGreaterThanOrEqual(400);
  }, 60_000);
});
