// "Toujours permettre" on every card (JC, 2026-10-19: "On doit avoir des
// cartes, mais avoir la possibilité de faire TOUJOURS le Toujours
// permettre."), through a real isolated server and fake engines only:
//
//   engine card   a Claude broker call: Always allow keeps the exact command;
//                 the same command then runs with no card and a decision row
//                 names the rule; another command keeps its card; revoking the
//                 rule brings the card back
//   security key  a class the person protects with a key: saving the rule
//                 signs with the key, and the same call still asks each time
//   in bulk       the Approvals screen keeps each card's own rule
//   act card      a sagax_settings change held at Ask: Always allow keeps that
//                 setting of that bot; another setting keeps its card;
//                 revoking brings it back
//   engines       Codex and an ACP engine (#827): the same rule, the same
//                 silence on the next turn, journaled
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { connect, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

import { launchVerificationServer, type VerificationServer } from "../scripts/control-omb.ts";
import { removeTempDir, waitForExit } from "./testing/cleanup.ts";
import { fakeAuthenticator } from "./testing/fake-authenticator.ts";
import { freePortBlock } from "./testing/ports.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));

type Api = (method: string, path: string, body?: unknown, status?: number, token?: string) => Promise<any>;

function client(fixture: VerificationServer, owner?: string): { api: Api; call: (method: string, path: string, body?: unknown) => Promise<{ status: number; body: any }> } {
  const { url } = fixture.info;
  const call = async (method: string, path: string, body?: unknown, token?: string) => {
    const response = await fetch(url + path, {
      method,
      headers: { origin: url, "content-type": "application/json", ...(owner ? { "x-openmausbot-desktop-owner": owner } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await response.text();
    let parsed: any = {};
    try { parsed = JSON.parse(text); } catch { /* not JSON */ }
    return { status: response.status, body: parsed };
  };
  const api: Api = async (method, path, body, status = 200, token) => {
    const result = await call(method, path, body, token);
    expect(result.status, `${method} ${path}: ${JSON.stringify(result.body)}`).toBe(status);
    return result.body;
  };
  return { api, call };
}

function decisions(dataDir: string): any[] {
  const dir = join(dataDir, "decisions");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => readFileSync(join(dir, name), "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)));
}

it("an engine's card: Always allow keeps the command's program, a security key still asks, bulk keeps each card's rule, revoking brings the card back", async () => {
  const owner = randomBytes(32).toString("base64url");
  const fixture = await launchVerificationServer({ ...process.env, FAKE_CLAUDE_MODE: "hang", SAGAX_TEST_DESKTOP_OWNER_TOKEN: owner });
  const { url, dataDir } = fixture.info;
  const localhost = `http://localhost:${new URL(url).port}`;
  const { api, call } = client(fixture, owner);
  const sockets: Socket[] = [];
  const key = fakeAuthenticator();
  const ceremony = async (start: { ceremonyId: string; kind: string }) => {
    const options = (await api("GET", `/api/security-keys/ceremony/${start.ceremonyId}`)).options;
    const response = start.kind === "register" ? key.register(options, localhost, "localhost") : key.assert(options, localhost, "localhost");
    await api("POST", `/api/security-keys/ceremony/${start.ceremonyId}`, { response });
  };
  let threadId = "";
  const card = async (id: string) =>
    (await api("GET", `/api/threads/${threadId}/messages?limit=200`)).messages.find((message: any) => message.card?.requestId === id)?.card;
  let socketPath = "";
  /** Ask the broker like the engine; the reply settles when someone (or a rule) answers. */
  const ask = async (command: string) => {
    const socket = connect(socketPath);
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => { socket.once("connect", resolve); socket.once("error", reject); });
    const id = randomUUID();
    let buffer = "";
    let answer: any;
    socket.on("data", (chunk) => {
      buffer += chunk;
      if (buffer.includes("\n") && !answer) answer = JSON.parse(buffer.split("\n")[0]!);
    });
    socket.write(JSON.stringify({ t: "ask", id, tool: "Bash", input: { command } }) + "\n");
    return { id, answer: () => answer };
  };
  const shown = async (id: string) => expect.poll(async () => Boolean(await card(id)), { timeout: 15_000 }).toBe(true);
  try {
    const bot = (await api("POST", "/api/bots", { name: "Katarina", modelSelection: { instanceId: "claude", model: "claude-sonnet-5" } }, 201)).bot;
    threadId = bot.threadId;
    await api("PATCH", `/api/bots/${bot.id}/tasks/${bot.threadId}`, { approvalMode: "ask" });
    const dump = join(dataDir, "fake-claude-dump.json");
    rmSync(dump, { force: true });
    await api("POST", `/api/bots/${bot.id}/messages`, { threadId, text: "Hold this turn while its approvals are exercised." }, 202);
    await expect.poll(() => existsSync(dump), { timeout: 15_000 }).toBe(true);
    socketPath = JSON.parse(readFileSync(dump, "utf8")).mcpConfig.mcpServers.ogb.args.at(-1) as string;

    // ── the card offers Always allow with its scope: since 2026-10-20 (JC,
    // #875) a plain command line is kept as its one program in its folder
    const first = await ask("printf always-a");
    await shown(first.id);
    const offered = (await card(first.id)).ownerRule;
    expect(offered).toMatchObject({ tool: "Bash", scope: { program: "printf" } });
    expect(offered.description).toContain("printf");
    expect((await api("POST", `/api/threads/${threadId}/respond`, { requestId: first.id, behavior: "allow", rule: "allow" })).outcome).toBe("allowed-once");
    await expect.poll(() => first.answer()?.behavior, { timeout: 10_000 }).toBe("allow");
    const rules = (await api("GET", "/api/approval-rules")).rules as any[];
    const saved = rules.find((row) => row.botId === bot.id && row.scope?.program === "printf");
    expect(saved).toMatchObject({ behavior: "allow", tool: "Bash", botName: "Katarina" });

    // the same command: no card, and the journal names the rule
    const again = await ask("printf always-a");
    await expect.poll(() => again.answer()?.behavior, { timeout: 10_000 }).toBe("allow");
    expect(await card(again.id)).toBeUndefined();
    await expect.poll(() => decisions(dataDir).find((row) => row.requestId === again.id), { timeout: 5_000 })
      .toMatchObject({ decision: "auto-approved", source: "owner-rule", rule: saved.id });

    // a chain with another program keeps its card
    const other = await ask("printf always-a; date");
    await shown(other.id);
    expect(other.answer()).toBeUndefined();
    await api("POST", `/api/threads/${threadId}/respond`, { requestId: other.id, behavior: "deny" });

    // revoked: the card comes back
    await api("DELETE", `/api/approval-rules/${saved.id}`);
    const revoked = await ask("printf always-a");
    await shown(revoked.id);
    expect(revoked.answer()).toBeUndefined();
    await api("POST", `/api/threads/${threadId}/respond`, { requestId: revoked.id, behavior: "deny" });

    // ── in bulk: each card keeps its own rule ───────────────────────────
    const bulkA = await ask("printf bulk-a");
    const bulkB = await ask("touch /tmp/sagax-bulk-b");
    await shown(bulkA.id);
    await shown(bulkB.id);
    const inbox = (await api("GET", "/api/approvals")).pending as any[];
    expect(inbox.find((row) => row.requestId === bulkA.id)?.alwaysRule).toContain("printf");
    const bulk = await api("POST", "/api/approvals/bulk", { decision: "allow", rule: "allow", items: [{ threadId, requestId: bulkA.id }, { threadId, requestId: bulkB.id }] });
    expect(bulk.answered).toBe(2);
    await expect.poll(() => [bulkA.answer()?.behavior, bulkB.answer()?.behavior], { timeout: 10_000 }).toEqual(["allow", "allow"]);
    const afterBulk = (await api("GET", "/api/approval-rules")).rules as any[];
    expect(afterBulk.filter((row) => row.botId === bot.id && ["printf", "touch"].includes(row.scope?.program)).map((row) => row.scope.program).sort()).toEqual(["printf", "touch"]);
    const bulkAgain = await ask("touch /tmp/sagax-bulk-b");
    await expect.poll(() => bulkAgain.answer()?.behavior, { timeout: 10_000 }).toBe("allow");
    expect(await card(bulkAgain.id)).toBeUndefined();
    // a bulk Always allow with a Deny is refused whole
    expect((await call("POST", "/api/approvals/bulk", { decision: "deny", rule: "allow", items: [{ threadId, requestId: bulkA.id }] })).status).toBe(400);

    // ── a security key the person chose still asks each time ────────────
    await ceremony(await api("POST", "/api/security-keys/register", { name: "Fixture key", via: "desktop-window" }));
    await api("PUT", "/api/security-keys/classes", { classes: ["destructive"] });
    const guarded = await ask("rm /tmp/sagax-always-allow-fixture");
    await shown(guarded.id);
    expect((await card(guarded.id)).ownerRule).toBeTruthy();
    const refused = await call("POST", `/api/threads/${threadId}/respond`, { requestId: guarded.id, behavior: "allow", rule: "allow" });
    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({ code: "step_up_required" });
    const signed = await api("POST", "/api/security-keys/begin", { target: refused.body.target, via: "desktop-window" });
    await ceremony(signed);
    await api("POST", `/api/threads/${threadId}/respond`, { requestId: guarded.id, behavior: "allow", rule: "allow", stepUp: signed.ceremonyId });
    await expect.poll(() => guarded.answer()?.behavior, { timeout: 10_000 }).toBe("allow");
    expect(((await api("GET", "/api/approval-rules")).rules as any[]).some((row) => row.scope?.program === "rm")).toBe(true);
    // the rule is kept, and the key is still asked
    const guardedAgain = await ask("rm /tmp/sagax-always-allow-fixture");
    await shown(guardedAgain.id);
    expect(guardedAgain.answer()).toBeUndefined();
    expect((await call("POST", `/api/threads/${threadId}/respond`, { requestId: guardedAgain.id, behavior: "allow" })).body).toMatchObject({ code: "step_up_required" });
  } finally {
    for (const socket of sockets) socket.destroy();
    await fixture.close();
  }
}, 120_000);

it("an act card (sagax_settings): Always allow keeps that setting of that bot, another setting keeps its card, revoking brings it back", async () => {
  const fixture = await launchVerificationServer({ ...process.env, FAKE_CLAUDE_MODE: "hang" });
  const { dataDir } = fixture.info;
  const { api } = client(fixture);
  const dump = join(dataDir, "fake-claude-dump.json");
  const turn = async (botId: string, threadId: string, text: string): Promise<string> => {
    rmSync(dump, { force: true });
    await api("POST", `/api/bots/${botId}/messages`, { threadId, text }, 202);
    let comms = "";
    await expect.poll(() => {
      if (!existsSync(dump)) return false;
      try { comms = JSON.parse(readFileSync(dump, "utf8")).mcpConfig.mcpServers.agents.env.SAGAX_COMMS_TOKEN; } catch { return false; }
      return Boolean(comms);
    }, { timeout: 20_000 }).toBe(true);
    return comms;
  };
  try {
    const scout = (await api("POST", "/api/bots", { name: "Scout" }, 201)).bot;
    const helper = (await api("POST", "/api/bots", { name: "Helper" }, 201)).bot;
    // at Ask, the speaking bot's own changes wait for the person's card
    await api("PATCH", `/api/bots/${scout.id}`, { approvalMode: "ask" });
    await api("PATCH", `/api/bots/${scout.id}/tasks/${scout.threadId}`, { approvalMode: "ask" });
    const comms = await turn(scout.id, scout.threadId, "Rename my helper.");
    const settings = (args: Record<string, unknown>) => api("POST", "/api/internal/settings", args, 200, comms);
    const actCards = async () => (await api("GET", `/api/threads/${scout.threadId}/messages?limit=200`)).messages.filter((message: any) => message.card?.botActRequest);
    const title = async () => (await api("GET", "/api/bots?messages=0")).bots.find((bot: any) => bot.id === helper.id).title;

    expect((await settings({ action: "set", key: "bot.title", target: helper.id, value: "Night shift" })).text).toContain("Approval needed.");
    const held = (await actCards()).at(-1).card;
    expect(held.ownerRule).toMatchObject({ tool: "sagax_settings", scope: { setting: "bot.title", target: helper.id } });
    expect(held.ownerRule.description).toContain("Helper");
    expect(held.ownerRule.description).not.toContain(helper.id);
    await api("POST", `/api/threads/${scout.threadId}/respond`, { requestId: held.requestId, behavior: "allow", rule: "allow" });
    expect(await title()).toBe("Night shift");
    const rule = ((await api("GET", "/api/approval-rules")).rules as any[]).find((row) => row.tool === "sagax_settings");
    expect(rule).toMatchObject({ botId: scout.id, scope: { setting: "bot.title", target: helper.id }, behavior: "allow" });

    // the same setting of the same bot: no card, done, journaled
    const before = (await actCards()).length;
    expect((await settings({ action: "set", key: "bot.title", target: helper.id, value: "Day shift" })).text).toMatch(/^Done/);
    expect(await title()).toBe("Day shift");
    expect((await actCards()).length).toBe(before);
    await expect.poll(() => decisions(dataDir).some((row) => row.tool === "act" && row.source === "owner-rule" && row.rule === rule.id), { timeout: 5_000 }).toBe(true);

    // another setting, or the same setting of another bot: its card
    expect((await settings({ action: "set", key: "bot.description", target: helper.id, value: "Night desk" })).text).toContain("Approval needed.");
    expect((await settings({ action: "set", key: "bot.title", target: scout.id, value: "Lead" })).text).toContain("Approval needed.");

    // revoked: the card comes back
    await api("DELETE", `/api/approval-rules/${rule.id}`);
    expect((await settings({ action: "set", key: "bot.title", target: helper.id, value: "Weekend" })).text).toContain("Approval needed.");
    expect(await title()).toBe("Day shift");
  } finally {
    await fixture.close();
  }
}, 120_000);

it("every engine (#827): Codex and an ACP engine get the same Always allow, and the next turn asks nothing", async () => {
  const home = mkdtempSync(join(tmpdir(), "omb-always-engines-"));
  const data = join(home, ".sagax");
  mkdirSync(data, { recursive: true });
  const testing = join(SERVER_DIR, "testing");
  writeFileSync(join(data, "config.json"), JSON.stringify({
    instances: {
      codex: { driver: "codex", environment: { FAKE_CODEX_MODE: "approval" }, config: { cli: join(testing, "fake-codex-app-server.ts") } },
      grok: { driver: "grokAgent", environment: { FAKE_ACP_MODE: "permission" }, config: { cli: join(testing, "fake-acp-cli.ts"), fullAuto: false } },
    },
  }));
  const port = await freePortBlock([0, 1]);
  const base = `http://127.0.0.1:${port}`;
  let log = "";
  const child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
    cwd: join(SERVER_DIR, ".."),
    env: {
      ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
      HOME: home, USERPROFILE: home, SAGAX_LOCAL_VM_TEST_NAMESPACE: process.env.SAGAX_LOCAL_VM_TEST_NAMESPACE ?? "", SAGAX_PORT: String(port), SAGAX_WEBHOOK_PORT: String(port + 1),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout!.on("data", (chunk) => (log += chunk));
  child.stderr!.on("data", (chunk) => (log += chunk));
  const api: Api = async (method, path, body, status = 200) => {
    const response = await fetch(base + path, {
      method, headers: { origin: base, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15_000),
    });
    const text = await response.text();
    let parsed: any = {};
    try { parsed = JSON.parse(text); } catch { /* not JSON */ }
    expect(response.status, `${method} ${path}: ${text}\n${log.slice(-2000)}`).toBe(status);
    return parsed;
  };
  try {
    await expect.poll(async () => {
      try { return (await fetch(`${base}/api/health`)).ok; } catch { return false; }
    }, { timeout: 30_000 }).toBe(true);
    for (const engine of [{ instanceId: "codex", model: "gpt-5-codex" }, { instanceId: "grok", model: "grok-code" }]) {
      const bot = (await api("POST", "/api/bots", { name: `Engine ${engine.instanceId}`, modelSelection: engine }, 201)).bot;
      await api("PATCH", `/api/bots/${bot.id}`, { approvalMode: "ask" });
      await api("PATCH", `/api/bots/${bot.id}/tasks/${bot.threadId}`, { approvalMode: "ask" });
      const cards = async () => (await api("GET", `/api/threads/${bot.threadId}/messages?limit=200`)).messages.filter((message: any) => message.kind === "options" && message.card?.requestId && message.card.requestType === "permission");
      await api("POST", `/api/bots/${bot.id}/messages`, { threadId: bot.threadId, text: "Run the fixture command." }, 202);
      await expect.poll(async () => (await cards()).length, { timeout: 30_000 }).toBe(1);
      const first = (await cards())[0].card;
      expect(first.ownerRule, engine.instanceId).toBeTruthy();
      await api("POST", `/api/threads/${bot.threadId}/respond`, { requestId: first.requestId, behavior: "allow", rule: "allow" });
      await expect.poll(async () => (await api("GET", "/api/bots?messages=0")).bots.find((row: any) => row.id === bot.id).busy, { timeout: 30_000 }).toBeFalsy();
      // the next turn asks the same: no new card, journaled with the rule
      await api("POST", `/api/bots/${bot.id}/messages`, { threadId: bot.threadId, text: "Again, please." }, 202);
      await expect.poll(() => decisions(data).filter((row) => row.botId === bot.id && row.source === "owner-rule").length, { timeout: 30_000 }).toBeGreaterThan(0);
      expect((await cards()).length, engine.instanceId).toBe(1);
      await expect.poll(async () => (await api("GET", "/api/bots?messages=0")).bots.find((row: any) => row.id === bot.id).busy, { timeout: 30_000 }).toBeFalsy();
    }
  } finally {
    await waitForExit(child, { signal: "SIGTERM" });
    await removeTempDir(home);
  }
}, 150_000);

it("a proposal card (a routine for another bot): Always allow keeps that kind for that bot, another bot keeps its card, revoking brings it back", async () => {
  const fixture = await launchVerificationServer({ ...process.env, FAKE_CLAUDE_MODE: "hang" });
  const { dataDir } = fixture.info;
  const { api } = client(fixture);
  const dump = join(dataDir, "fake-claude-dump.json");
  try {
    const scout = (await api("POST", "/api/bots", { name: "Scout" }, 201)).bot;
    const helper = (await api("POST", "/api/bots", { name: "Helper" }, 201)).bot;
    const third = (await api("POST", "/api/bots", { name: "Third" }, 201)).bot;
    await api("PATCH", `/api/bots/${scout.id}`, { approvalMode: "ask" });
    await api("PATCH", `/api/bots/${scout.id}/tasks/${scout.threadId}`, { approvalMode: "ask" });
    rmSync(dump, { force: true });
    await api("POST", `/api/bots/${scout.id}/messages`, { threadId: scout.threadId, text: "Plan routines for the team." }, 202);
    let comms = "";
    await expect.poll(() => {
      if (!existsSync(dump)) return false;
      try { comms = JSON.parse(readFileSync(dump, "utf8")).mcpConfig.mcpServers.agents.env.SAGAX_COMMS_TOKEN; } catch { return false; }
      return Boolean(comms);
    }, { timeout: 20_000 }).toBe(true);
    const schedule = { type: "cron", expression: "0 9 1 * *", timeZone: "America/New_York" };
    const propose = (name: string, forBotId: string) => api("POST", "/api/internal/routine-requests",
      { fromBotId: scout.id, fromThreadId: scout.threadId, action: "create", routine: { name, instructions: `Summarize fixture results for ${name}.`, schedule }, forBotId }, 201, comms);
    const cardOf = async (requestId: string) => (await api("GET", `/api/threads/${scout.threadId}/messages?limit=200`)).messages.find((message: any) => message.card?.requestId === requestId)?.card;

    const first = await propose("Monthly A", helper.id);
    const card = await cardOf(first.requestId);
    expect(card.ownerRule).toMatchObject({ tool: "sagax:routine", scope: { action: "create", for: helper.id } });
    expect(card.ownerRule.description).toContain("Helper");
    await api("POST", `/api/threads/${scout.threadId}/respond`, { requestId: first.requestId, behavior: "allow", rule: "allow" });
    const rule = ((await api("GET", "/api/approval-rules")).rules as any[]).find((row) => row.tool === "sagax:routine");
    expect(rule).toMatchObject({ botId: scout.id, behavior: "allow" });

    const second = await propose("Monthly B", helper.id);
    expect(second).toMatchObject({ state: "applied", appliedBy: "rule" });
    expect((await cardOf(second.requestId)).answered).toBe("allow");
    await expect.poll(() => decisions(dataDir).some((row) => row.requestId === second.requestId && row.source === "owner-rule" && row.rule === rule.id), { timeout: 5_000 }).toBe(true);

    const other = await propose("Monthly C", third.id);
    expect(other.state).not.toBe("applied");
    expect((await cardOf(other.requestId)).answered).toBeUndefined();

    await api("DELETE", `/api/approval-rules/${rule.id}`);
    const revoked = await propose("Monthly D", helper.id);
    expect(revoked.state).not.toBe("applied");
    expect((await cardOf(revoked.requestId)).answered).toBeUndefined();
  } finally {
    await fixture.close();
  }
}, 120_000);
