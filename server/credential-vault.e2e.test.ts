// The credential vault through a real server: a bot's request_login posts a
// login card, the person saves a login from it and allows it once, the bot
// is resumed with a handle, and no answer, card or transcript ever carries
// the value. Fake values only.
import { mkdtempSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";
import { removeTempDir } from "./testing/cleanup.ts";
import { variants } from "./credential-fill.ts";

/** Every file of the server's data folder but the sealed vault itself
 * (threads, memory, notes, audit and admin activity, logs, backups): none
 * holds the value or one of its encodings. */
function expectDataClean(dir: string, secret: string): void {
  const files: string[] = [];
  const walk = (folder: string, depth: number) => {
    if (depth > 12) return;
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = `${folder}/${entry.name}`;
      if (entry.isDirectory()) walk(path, depth + 1);
      else if (entry.isFile() && entry.name !== "credential-vault.enc" && statSync(path).size < 8 * 1024 * 1024) files.push(path);
    }
  };
  walk(dir, 0);
  expect(files.length).toBeGreaterThan(0);
  const forms = variants(secret);
  for (const file of files) {
    const text = readFileSync(file).toString("latin1");
    for (const form of forms) expect(text.includes(form), `${file.slice(dir.length)} holds a form of the value`).toBe(false);
  }
}

const FAKE_PASSWORD = "fake-e2e-Pa55word-xyz";

it("asks for a login with a card, grants it once, resumes the bot with a handle and never echoes the value", async () => {
  const gates = mkdtempSync(join(tmpdir(), "sagax-vault-e2e-"));
  const gate = join(gates, "finish");
  const fixture = await launchVerificationServer({ FAKE_CLAUDE_MODE: "slow", FAKE_CLAUDE_SLOW_FINISH_GATE: gate, SAGAX_CREDENTIAL_VAULT_LOOPBACK: "1" });
  const seen: string[] = [];
  const api = async (method: string, path: string, body?: unknown, expected = 200, token?: string) => {
    const response = await fetch(fixture.info.url + path, {
      method,
      headers: { "content-type": "application/json", origin: fixture.info.url, ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    seen.push(text);
    expect(response.status, text).toBe(expected);
    return text ? JSON.parse(text) : null;
  };
  try {
    const bot = (await api("POST", "/api/bots", { name: "Vault fixture" }, 201)).bot;
    await runControlOmb(["send", "--bot", bot.id, "--task", bot.threadId, "--text", "Sign in to the billing portal.", "--url", fixture.info.url]);
    let token = "";
    await expect.poll(() => {
      try { token = JSON.parse(readFileSync(fixture.fixtureDumpPath, "utf8")).mcpConfig.mcpServers.agents.env.SAGAX_COMMS_TOKEN; }
      catch { return false; }
      return Boolean(token);
    }, { timeout: 15_000 }).toBe(true);

    const asked = await api("POST", "/api/internal/credentials/request", {
      fromBotId: bot.id, fromThreadId: bot.threadId, domain: "billing.example.test", reason: "To download the invoice.",
    }, 201, token);
    writeFileSync(gate, "finish");
    await expect.poll(async () => (await api("GET", "/api/bots?messages=0")).bots.find((candidate: any) => candidate.id === bot.id).busy,
      { timeout: 15_000 }).toBe(false);

    const transcript = await api("GET", `/api/threads/${bot.threadId}/messages`);
    const card = transcript.messages.find((message: any) => message.id === asked.messageId);
    expect(card).toMatchObject({ kind: "secret", secret: { target: "vaultLogin", vault: { domain: "billing.example.test", principalId: "local" } } });

    // A loopback GET answers nothing about the vault.
    const listGet = await fetch(`${fixture.info.url}/api/me/credentials/list`, { headers: { origin: fixture.info.url } });
    expect(listGet.status).not.toBe(200);

    // The resumed turn waits on the gate, so its capability is live while
    // the bot asks again below.
    unlinkSync(gate);
    const granted = await api("POST", `/api/bots/${bot.id}/vault-cards/${asked.messageId}/grant`, {
      threadId: bot.threadId,
      mode: "once",
      item: { kind: "login", name: "Billing", username: "ada.fake@example.test", password: FAKE_PASSWORD, domains: ["billing.example.test"] },
    });
    expect(granted.item).toMatchObject({ name: "Billing", hasPassword: true, grants: [{ botId: bot.id, mode: "once", threadId: bot.threadId }] });
    await expect.poll(async () => {
      const after = await api("GET", `/api/threads/${bot.threadId}/messages`);
      return after.messages.find((message: any) => message.id === asked.messageId)?.secret;
    }, { timeout: 15_000 }).toMatchObject({ provided: true, resumed: true, vault: { itemName: "Billing", mode: "once" } });

    // The resumed turn is told the handle; asked again, the bot gets it at once.
    // The warm engine process serves the resumed turn (same pid since #844),
    // so the proof of the resume is the new prompt, not a new process.
    await expect.poll(() => {
      try { return readFileSync(fixture.fixtureDumpPath, "utf8").includes(`cred_${granted.item.id}`); }
      catch { return false; }
    }, { timeout: 15_000 }).toBe(true);
    const resumedDump = readFileSync(fixture.fixtureDumpPath, "utf8");
    expect(resumedDump).toContain(`cred_${granted.item.id}`);
    expect(resumedDump).not.toContain(FAKE_PASSWORD);
    token = JSON.parse(resumedDump).mcpConfig.mcpServers.agents.env.SAGAX_COMMS_TOKEN;
    const again = await api("POST", "/api/internal/credentials/request", { fromBotId: bot.id, fromThreadId: bot.threadId, domain: "billing.example.test" }, 200, token);
    expect(again.granted[0]).toMatchObject({ handle: `cred_${granted.item.id}`, fields: ["username", "password"] });
    // A sign-in page met while working, on another address of the site: a
    // new card, since the login is bound to billing.example.test only.
    const elsewhere = await api("POST", "/api/internal/credentials/request", { fromBotId: bot.id, fromThreadId: bot.threadId, domain: "accounts.billing.example.test" }, 201, token);
    writeFileSync(gate, "finish");
    await expect.poll(async () => (await api("GET", "/api/bots?messages=0")).bots.find((candidate: any) => candidate.id === bot.id).busy,
      { timeout: 15_000 }).toBe(false);

    // Ticked "Also fill it on ...": the asked address joins the login's sites.
    const widened = await api("POST", `/api/bots/${bot.id}/vault-cards/${elsewhere.messageId}/grant`, { threadId: bot.threadId, itemId: granted.item.id, mode: "always", addSite: true });
    expect(widened.item.domains).toEqual(["billing.example.test", "accounts.billing.example.test"]);
    await expect.poll(async () => {
      const after = await api("GET", `/api/threads/${bot.threadId}/messages`);
      return after.messages.find((message: any) => message.id === elsewhere.messageId)?.secret;
    }, { timeout: 15_000 }).toMatchObject({ provided: true, vault: { itemName: "Billing", mode: "always" } });
    await expect.poll(async () => (await api("GET", "/api/bots?messages=0")).bots.find((candidate: any) => candidate.id === bot.id).busy,
      { timeout: 15_000 }).toBe(false);

    const listed = await api("POST", "/api/me/credentials/list", {});
    expect(listed.items).toHaveLength(1);
    const everything = (await api("GET", `/api/threads/${bot.threadId}/messages`)) as unknown;
    for (const text of [...seen, JSON.stringify(everything)]) expect(text).not.toContain(FAKE_PASSWORD);
    // What the engine was handed (prompts, resume notes) and every file the
    // server wrote: no value, no encoding of it.
    for (const form of variants(FAKE_PASSWORD)) expect(readFileSync(fixture.fixtureDumpPath, "utf8")).not.toContain(form);
    expectDataClean(fixture.info.dataDir, FAKE_PASSWORD);
    for (const form of variants(FAKE_PASSWORD)) expect(readFileSync(fixture.info.logPath, "utf8")).not.toContain(form);
  } finally {
    await fixture.close();
    await removeTempDir(gates);
  }
}, 120_000);
