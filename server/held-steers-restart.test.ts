// Regression for lot 6 defects D1/D2: a message accepted into a running turn
// must survive a server stop (crash or graceful) and be answered once.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { FAKE_CLAUDE_CLI, QualServer, sleep, type ServerPaths } from "../scripts/qualification/harness.ts";
import type { EngineProfile } from "../scripts/qualification/engines.ts";
import { heldSteersDir, listHeldSteers } from "./held-steers.ts";

const fakeProfile: EngineProfile = {
  kind: "fake",
  label: "fake claude",
  claudeCli: FAKE_CLAUDE_CLI,
  model: { instanceId: "claude", model: "claude-fake" },
  passEnv: [],
  engineEnv: (paths: ServerPaths) => ({
    FAKE_CLAUDE_MODE: "slow",
    FAKE_CLAUDE_GATE_DIR: paths.gates,
    FAKE_CLAUDE_HOLD_AFTER_TOOL: "1",
    FAKE_CLAUDE_PROMPTS: paths.prompts,
    FAKE_CLAUDE_LAUNCH_LOG: paths.launchLog,
  }),
};

const servers: QualServer[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await server.close().catch(() => undefined);
});

async function waitUntil(what: string, predicate: () => Promise<boolean> | boolean, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await sleep(100);
  }
  throw new Error(`waited for ${what} (${timeoutMs} ms)`);
}

async function botSnapshot(server: QualServer, botId: string): Promise<any> {
  const response = await server.api("GET", "/api/bots?messages=0");
  return (response.body.bots as any[]).find((bot) => bot.id === botId);
}

async function startHeld(server: QualServer) {
  const created = await server.api("POST", "/api/bots", { name: "Held steers restart" });
  expect(created.status).toBe(201);
  const bot = created.body.bot as { id: string; threadId: string };
  const modelled = await server.api("PATCH", `/api/bots/${bot.id}`, {
    modelSelection: fakeProfile.model,
  });
  expect(modelled.status).toBeLessThan(300);
  const first = await server.api("POST", `/api/bots/${bot.id}/messages`, {
    text: "Start a long synthetic report. [gate:held]", threadId: bot.threadId,
  });
  expect(first.status).toBe(202);
  await waitUntil("busy", async () => (await botSnapshot(server, bot.id))?.busy === true);
  await waitUntil("tool row", async () => {
    const messages = await server.api("GET", `/api/threads/${bot.threadId}/messages?limit=50`);
    return (messages.body.messages as any[]).some((message) => message.kind === "activity");
  });
  return bot;
}

describe("held steers across restart", () => {
  it("records a steered message durably while the turn holds it", async () => {
    const server = await QualServer.start({ profile: fakeProfile });
    servers.push(server);
    const bot = await startHeld(server);
    const second = await server.api("POST", `/api/bots/${bot.id}/messages`, {
      text: "A second synthetic message sent behind the held turn. [QM-held-durable]",
      threadId: bot.threadId,
    });
    expect(second.status).toBe(202);
    expect(second.body).toMatchObject({ steered: true, message: { id: expect.any(String) } });
    await waitUntil("held-steers.json", () => listHeldSteers(server.dataDir).length === 1);
    expect(listHeldSteers(server.dataDir)).toEqual([
      expect.objectContaining({
        botId: bot.id,
        threadId: bot.threadId,
        messageId: second.body.message.id,
        text: expect.stringContaining("QM-held-durable"),
      }),
    ]);
  }, 60_000);

  it("D2 graceful stop: resume prompt carries the message sent behind the turn", async () => {
    const server = await QualServer.start({ profile: fakeProfile });
    servers.push(server);
    const bot = await startHeld(server);
    const marker = "QM-held-graceful";
    const second = await server.api("POST", `/api/bots/${bot.id}/messages`, {
      text: `A second synthetic message sent behind the held turn. [${marker}]`,
      threadId: bot.threadId,
    });
    expect(second.status).toBe(202);
    expect(second.body.steered).toBe(true);
    await waitUntil("held journal", () => listHeldSteers(server.dataDir).some((row) => row.text.includes(marker)));
    await server.restart("SIGTERM");
    await waitUntil("resume activity", async () => {
      const messages = await server.api("GET", `/api/threads/${bot.threadId}/messages?limit=100`);
      return (messages.body.messages as any[]).some((message) => message.kind === "activity" && message.tool?.name === "Resuming after a restart");
    });
    server.openGate("held");
    await waitUntil("idle after resume", async () => (await botSnapshot(server, bot.id))?.busy !== true, 30_000);
    const prompts = server.promptLog().join("\n");
    const messages = (await server.api("GET", `/api/threads/${bot.threadId}/messages?limit=100`)).body.messages as any[];
    const texts = messages.filter((message) => message.role === "bot" && message.kind === "text").map((message) => String(message.text ?? ""));
    expect(prompts.includes(marker) || texts.some((text) => text.includes(marker))).toBe(true);
    expect(listHeldSteers(server.dataDir)).toEqual([]);
  }, 90_000);

  it("D1 crash: held message is answered once as a follow-up after SIGKILL", async () => {
    const server = await QualServer.start({ profile: fakeProfile });
    servers.push(server);
    const bot = await startHeld(server);
    const marker = "QM-held-crash";
    const second = await server.api("POST", `/api/bots/${bot.id}/messages`, {
      text: `A second synthetic message sent behind the held turn. [${marker}]`,
      threadId: bot.threadId,
    });
    expect(second.status).toBe(202);
    expect(second.body.steered).toBe(true);
    await waitUntil("held journal", () => listHeldSteers(server.dataDir).some((row) => row.text.includes(marker)));
    // Prove the per-thread journal is on disk before the kill (acceptance durability).
    expect(existsSync(join(heldSteersDir(server.dataDir), `${bot.threadId}.json`))).toBe(true);
    expect(listHeldSteers(server.dataDir, bot.threadId).length).toBeGreaterThan(0);
    await server.restart("SIGKILL");
    await waitUntil("cut or continue activity", async () => {
      const messages = await server.api("GET", `/api/threads/${bot.threadId}/messages?limit=100`);
      return (messages.body.messages as any[]).some((message) =>
        message.kind === "activity" && /restarted before this finished|Continuing messages sent before the restart/i.test(JSON.stringify(message.tool ?? "")));
    });
    // Delivery is the marker reaching an engine prompt (or a reply). Do not
    // require idle first: a follow-up can start after the cut row appears.
    await waitUntil("held message reached an engine", async () => {
      const prompts = server.promptLog().join("\n");
      if (prompts.includes(marker)) return true;
      const messages = (await server.api("GET", `/api/threads/${bot.threadId}/messages?limit=100`)).body.messages as any[];
      return messages.some((message) => message.role === "bot" && message.kind === "text" && String(message.text ?? "").includes(marker));
    }, 30_000);
    // The fake hold-after-tool fixture may still be waiting on the earlier
    // turn's gate; release it so the follow-up can settle cleanly.
    server.openGate("held");
    await waitUntil("idle after crash recovery", async () => (await botSnapshot(server, bot.id))?.busy !== true, 30_000);
    const messages = (await server.api("GET", `/api/threads/${bot.threadId}/messages?limit=100`)).body.messages as any[];
    const userKept = messages.some((message) => message.role === "user" && String(message.text ?? "").includes(marker));
    expect(userKept).toBe(true);
    expect(listHeldSteers(server.dataDir)).toEqual([]);
  }, 90_000);
});
