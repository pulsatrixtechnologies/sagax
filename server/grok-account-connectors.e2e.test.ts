// The grok.com connectors of a person's own Grok sign-in (Outlook, Teams,
// calendar) on a solo server and on an organization server, through the
// real server and the fake Grok CLI only (2026-10-30, the operator: "Oui,
// avec carte, si le allow always est respecté, et si je suis en bypass que
// ça ne le demande pas."). The fake CLI serves the managed gateway only when
// the turn sets both GROK_MANAGED_* variables, and calls a gateway tool the
// way grok 1.0.70 does: it asks first in default and acceptEdits, and runs
// unasked in auto and bypassPermissions.
//
//   read          an Outlook search passes with no card, journaled
//   Ask           a send shows its card; denied, it never runs
//   Auto          a send shows its card too (Approve for me never sends),
//                 a personal gateway's escaped tool name included
//   Always allow  the card's rule is kept; the same send then goes with no card
//   Full access   a send goes with no card
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { removeTempDir, waitForExit } from "./testing/cleanup.ts";
import { startFakeOidcProvider, type FakeOidcProvider, type FakeOidcUser } from "./testing/fake-oidc-provider.ts";
import { freePortBlock } from "./testing/ports.ts";
import { waitForServerReady } from "./testing/server-ready.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const FAKE_ACP = join(SERVER_DIR, "testing", "fake-acp-cli.ts");
const TEAM_LIST = join(SERVER_DIR, "testing", "grok-gateway-team-mcp-list.json");
const PERSONAL_LIST = join(SERVER_DIR, "testing", "grok-gateway-mcp-list.json");
// #2747 (QA of #2816): a bot loads the account's managed gateway only when it
// opted in (bot setting grokAccountConnectors, harness-connectors.ts
// grokCloudConnectorsForTurn), so every bot here opts in.
const posixOnly = describe.skipIf(process.platform === "win32");

const READ = "outlook__search";
const SEND = "outlook__send_message";
/** A personal account's gateway names its tools for the connector, escaped */
const PERSONAL_SEND = "cursor__user-Outlook-send_5fmail___12";

/** One Grok engine per call list, all on the fake CLI. */
function grokInstances(): Record<string, unknown> {
  const instance = (calls: string, list = TEAM_LIST) => ({
    driver: "grokAgent",
    environment: { FAKE_ACP_MODE: "gateway-call", FAKE_ACP_MCP_LIST_FILE: list, FAKE_ACP_GATEWAY_CALLS: calls },
    config: { cli: FAKE_ACP, fullAuto: false },
  });
  return { grokread: instance(READ), groksend: instance(SEND), groksendpersonal: instance(PERSONAL_SEND, PERSONAL_LIST) };
}

type Call = (method: string, path: string, body?: unknown) => Promise<{ status: number; body: any; text: string }>;

/** The scenarios, the same on both servers. */
function scenarios(input: { call: () => Call; log: () => string; fullBot: () => Promise<{ id: string; threadId: string }> }) {
  const api = async (method: string, path: string, body?: unknown, status = 200) => {
    const result = await input.call()(method, path, body);
    expect(result.status, `${method} ${path}: ${result.text}\n${input.log().slice(-2000)}`).toBe(status);
    return result.body;
  };
  // These calls use the account gateway, not a computer. Auto can discover
  // an ambient Local VM asynchronously and would make this fixture host-dependent.
  const newBot = async (name: string, instanceId: string, approvalMode: "ask" | "auto") => {
    const bot = (await api("POST", "/api/bots", { name, computer: "off", browser: false, modelSelection: { instanceId, model: "grok-4.7" } }, 201)).bot;
    const configured = await api("PATCH", `/api/bots/${bot.id}`, { approvalMode, computer: "off", browser: false, grokAccountConnectors: true });
    expect(configured.bot.grokAccountConnectors).toBe(true);
    expect(configured.bot.computer).toBe("off");
    await api("PATCH", `/api/bots/${bot.id}/tasks/${bot.threadId}`, { approvalMode });
    return bot as { id: string; threadId: string };
  };
  const messages = async (bot: { threadId: string }) => (await api("GET", `/api/threads/${bot.threadId}/messages?limit=200`)).messages as any[];
  const cards = async (bot: { threadId: string }) => (await messages(bot)).filter((message) => message.kind === "options" && message.card?.requestId && message.card.requestType === "permission");
  const waitForCard = async (bot: { threadId: string }) => {
    try {
      await expect.poll(async () => (await cards(bot)).length, { timeout: 30_000 }).toBe(1);
    } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : error}\nThread: ${JSON.stringify(await messages(bot))}\nServer: ${input.log().slice(-4000)}`);
    }
  };
  const idle = async (bot: { id: string }) => expect.poll(async () => (await api("GET", "/api/bots?messages=0")).bots.find((row: any) => row.id === bot.id)?.busy, { timeout: 30_000 }).toBeFalsy();
  const replied = async (bot: { threadId: string }, line: string) =>
    expect.poll(async () => (await messages(bot)).some((message) => message.role === "bot" && typeof message.text === "string" && message.text.includes(line)), { timeout: 30_000 }).toBe(true);
  const decisions = async () => ((await api("GET", "/api/decisions")).decisions ?? []) as any[];
  const send = async (bot: { id: string; threadId: string }, text: string) => api("POST", `/api/bots/${bot.id}/messages`, { threadId: bot.threadId, text }, 202);

  it("a read of the person's own Outlook passes with no card, even at Ask", async () => {
    const bot = await newBot("Reader", "grokread", "ask");
    await send(bot, "Quel est mon dernier courriel?");
    await replied(bot, `${READ} -> ran (asked)`);
    expect(await cards(bot)).toHaveLength(0);
    expect((await decisions()).some((row) => row.botId === bot.id && row.source === "connector-read")).toBe(true);
    await idle(bot);
  }, 90_000);

  it("a send at Ask shows its card; denied, it never runs", async () => {
    const bot = await newBot("Sender ask", "groksend", "ask");
    await send(bot, "Envoie le suivi à Ana.");
    await waitForCard(bot);
    const card = (await cards(bot))[0].card;
    expect(card.mcpTool).toBe(SEND);
    // never a session-wide allow on a send
    expect(card.allowSession).toBeUndefined();
    await api("POST", `/api/threads/${bot.threadId}/respond`, { requestId: card.requestId, behavior: "deny" });
    await replied(bot, `${SEND} -> refused`);
    await idle(bot);
  }, 90_000);

  it("a send at Auto shows its card too: Approve for me never sends for the person", async () => {
    const bot = await newBot("Sender auto", "groksend", "auto");
    await send(bot, "Envoie le suivi à Ana.");
    await waitForCard(bot);
    const card = (await cards(bot))[0].card;
    await api("POST", `/api/threads/${bot.threadId}/respond`, { requestId: card.requestId, behavior: "allow" });
    await replied(bot, `${SEND} -> ran (asked)`);
    await idle(bot);
  }, 90_000);

  it("a send through a personal account's gateway, whose tool name is no plain server__tool, keeps its card at Auto", async () => {
    const bot = await newBot("Sender personal", "groksendpersonal", "auto");
    await send(bot, "Envoie le suivi à Ana.");
    await waitForCard(bot);
    const card = (await cards(bot))[0].card;
    expect(card.mcpTool).toBe(PERSONAL_SEND);
    await api("POST", `/api/threads/${bot.threadId}/respond`, { requestId: card.requestId, behavior: "deny" });
    await replied(bot, `${PERSONAL_SEND} -> refused`);
    await idle(bot);
  }, 90_000);

  it("Always allow on the send's card is kept: the same send then goes with no card", async () => {
    const bot = await newBot("Sender always", "groksend", "ask");
    await send(bot, "Envoie le suivi à Ana.");
    await waitForCard(bot);
    const card = (await cards(bot))[0].card;
    expect(card.ownerRule, JSON.stringify(card)).toBeTruthy();
    await api("POST", `/api/threads/${bot.threadId}/respond`, { requestId: card.requestId, behavior: "allow", rule: "allow" });
    await replied(bot, `${SEND} -> ran (asked)`);
    await idle(bot);
    await send(bot, "Encore une fois, s'il te plaît.");
    await expect.poll(async () => (await decisions()).filter((row) => row.botId === bot.id && row.source === "owner-rule").length, { timeout: 30_000 }).toBeGreaterThan(0);
    await idle(bot);
    expect(await cards(bot)).toHaveLength(1);
  }, 120_000);

  it("Full access: a send goes with no card", async () => {
    const bot = await input.fullBot();
    await send(bot, "Envoie le suivi à Ana.");
    await replied(bot, `${SEND} -> ran (asked)`);
    expect(await cards(bot)).toHaveLength(0);
    expect((await decisions()).some((row) => row.botId === bot.id && row.decision === "auto-approved" && (row.source === "full-access" || row.source === "owner-bypass"))).toBe(true);
    await idle(bot);
  }, 90_000);
}

async function fetchCall(base: string, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const response = await fetch(base + path, {
    method,
    headers: { origin: base, "content-type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  let parsed: any = {};
  try { parsed = JSON.parse(text); } catch { /* not JSON */ }
  return { status: response.status, body: parsed, text };
}


posixOnly("solo server: the operator's own Grok sign-in", () => {
  let home = "";
  let base = "";
  let log = "";
  let port = 0;
  let child: ChildProcess | undefined;
  let fullBot: { id: string; threadId: string } | undefined;
  const boot = async () => {
    child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
      cwd: join(SERVER_DIR, ".."),
      env: {
        ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
        HOME: home, USERPROFILE: home, SAGAX_LOCAL_VM_TEST_NAMESPACE: process.env.SAGAX_LOCAL_VM_TEST_NAMESPACE ?? "", SAGAX_PORT: String(port), SAGAX_WEBHOOK_PORT: String(port + 1),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout!.on("data", (chunk) => (log += chunk));
    child.stderr!.on("data", (chunk) => (log += chunk));
    await waitForServerReady(child, base, () => log);
  };
  beforeAll(async () => {
    chmodSync(FAKE_ACP, 0o755);
    home = mkdtempSync(join(tmpdir(), "omb-grok-connectors-solo-"));
    // Match the signed-in account this fixture claims to exercise. A late
    // availability probe must not turn its fake CLI into a signed-out account.
    mkdirSync(join(home, ".grok"), { recursive: true });
    writeFileSync(join(home, ".grok", "auth.json"), '{"fixture":"offline"}\n', { mode: 0o600 });
    const data = join(home, ".sagax");
    mkdirSync(data, { recursive: true });
    writeFileSync(join(data, "config.json"), JSON.stringify({ instances: grokInstances() }));
    port = await freePortBlock([0, 1]);
    base = `http://127.0.0.1:${port}`;
    await boot();
    // Full access is turned on in the desktop app, never through this API:
    // fixture setup, the owned server stopped while its disposable data changes
    const created = await fetchCall(base, "POST", "/api/bots", { name: "Sender full", computer: "off", browser: false, modelSelection: { instanceId: "groksend", model: "grok-4.7" } });
    expect(created.status, created.text).toBe(201);
    fullBot = created.body.bot;
    expect((await fetchCall(base, "PATCH", `/api/bots/${fullBot!.id}`, { computer: "off", browser: false, grokAccountConnectors: true })).status).toBe(200);
    await waitForExit(child, { signal: "SIGTERM" });
    const saved = JSON.parse(readFileSync(join(data, "bots.json"), "utf8"));
    const row = saved.find((bot: { id: string }) => bot.id === fullBot!.id);
    Object.assign(row, { approvalMode: "full", autoApprove: false });
    for (const task of row.tasks ?? []) { delete task.approvalMode; delete task.autoApprove; delete task.approvalOwn; }
    writeFileSync(join(data, "bots.json"), JSON.stringify(saved, null, 2));
    await boot();
  }, 150_000);
  afterAll(async () => {
    if (child) await waitForExit(child, { signal: "SIGTERM" });
    if (home) await removeTempDir(home);
  });

  scenarios({ call: () => (method, path, body) => fetchCall(base, method, path, body), log: () => log, fullBot: async () => fullBot! });
});

posixOnly("organization server: the person's own Grok sign-in", () => {
  const ALICE: FakeOidcUser = { sub: "01J9GXALICE00000000000A0", name: "Alice", preferred_username: "alice", role: "admin", teams: [] };
  let home = "";
  let base = "";
  let log = "";
  let child: ChildProcess | undefined;
  let idp: FakeOidcProvider;
  let cookie = "";

  const signIn = async (): Promise<string> => {
    idp.user = { ...ALICE };
    const start = await fetch(`${base}/auth/oidc/start`, { redirect: "manual" });
    const binding = start.headers.getSetCookie().find((c) => c.includes("_oidc="))!.split(";")[0]!;
    const authorize = await fetch(start.headers.get("location")!, { redirect: "manual" });
    const callback = await fetch(authorize.headers.get("location")!, { redirect: "manual", headers: { cookie: binding } });
    const session = callback.headers.getSetCookie().find((c) => c.startsWith("omb_session_") && !c.includes("_oidc="));
    expect(callback.headers.get("location"), log.slice(-2000)).toBe("/");
    return session!.split(";")[0]!;
  };

  beforeAll(async () => {
    chmodSync(FAKE_ACP, 0o755);
    idp = await startFakeOidcProvider({ user: ALICE });
    const port = await freePortBlock([0, 1]);
    base = `http://127.0.0.1:${port}`;
    home = mkdtempSync(join(tmpdir(), "omb-grok-connectors-org-"));
    const data = join(home, ".sagax");
    mkdirSync(data, { recursive: true });
    mkdirSync(join(home, "link"), { recursive: true, mode: 0o750 });
    writeFileSync(join(home, "link", "pulsabot.json"), JSON.stringify({
      version: 1, issuer: idp.issuer, client_id: "pulsa-bot", server_id: idp.serverId, origin: base, link_token: idp.linkToken,
    }), { mode: 0o640 });
    writeFileSync(join(data, "config.json"), JSON.stringify({ instances: grokInstances(), organization: { allowFullAccess: true } }));
    child = spawn(process.execPath, ["--experimental-strip-types", join(SERVER_DIR, "index.ts")], {
      cwd: join(SERVER_DIR, ".."),
      env: {
        ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
        HOME: home, USERPROFILE: home, SAGAX_LOCAL_VM_TEST_NAMESPACE: process.env.SAGAX_LOCAL_VM_TEST_NAMESPACE ?? "", SAGAX_PORT: String(port), SAGAX_WEBHOOK_PORT: String(port + 1),
        SAGAX_IDENTITY: "perspicax",
        SAGAX_PERSPICAX_ISSUER: idp.issuer,
        SAGAX_PUBLIC_URL: base,
        SAGAX_PERSPICAX_LINK_FILE: join(home, "link", "pulsabot.json"),
        SAGAX_PERSPICAX_DIRECTORY_SECONDS: "3600",
        SAGAX_ORG_NAME: "Acme",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout!.on("data", (chunk) => (log += chunk));
    child.stderr!.on("data", (chunk) => (log += chunk));
    await waitForServerReady(child, base, () => log);
    cookie = await signIn();
    // Alice's own grok.com sign-in on this server: the marker a device
    // sign-in writes (principal-engine-logins.ts), so her turns run on it
    const principalId = (await fetchCall(base, "GET", "/api/config", undefined, { cookie })).body.viewer?.principalId as string;
    expect(principalId, log.slice(-2000)).toBeTruthy();
    const grokDir = join(data, "principals", principalId, "grok");
    mkdirSync(join(grokDir, ".grok"), { recursive: true });
    writeFileSync(join(grokDir, ".pulsabot-login.json"), JSON.stringify({ at: Date.now() }), { mode: 0o600 });
    writeFileSync(join(grokDir, ".grok", "auth.json"), "{\"fixture\":\"offline, not a credential\"}\n", { mode: 0o600 });
  }, 60_000);
  afterAll(async () => {
    if (child) await waitForExit(child, { signal: "SIGTERM" });
    await idp?.close();
    if (home) await removeTempDir(home);
  });

  scenarios({
    call: () => (method, path, body) => fetchCall(base, method, path, body, { cookie }),
    log: () => log,
    // an organization admin turns Full access on with its confirmation
    fullBot: async () => {
      const created = await fetchCall(base, "POST", "/api/bots", { name: "Sender full", computer: "off", browser: false, modelSelection: { instanceId: "groksend", model: "grok-4.7" } }, { cookie });
      expect(created.status, created.text).toBe(201);
      const bot = created.body.bot as { id: string; threadId: string };
      const optIn = await fetchCall(base, "PATCH", `/api/bots/${bot.id}`, { grokAccountConnectors: true }, { cookie });
      expect(optIn.status, optIn.text).toBe(200);
      for (const path of [`/api/bots/${bot.id}`, `/api/bots/${bot.id}/tasks/${bot.threadId}`]) {
        const patched = await fetchCall(base, "PATCH", path, { approvalMode: "full", confirmFullAccess: true }, { cookie });
        expect(patched.status, patched.text).toBe(200);
      }
      return bot;
    },
  });
});
