// #5233: a bot of the person stops the turn running in a conversation of
// another of their bots, through sagax_settings (thread.running = false), on
// a real server on an isolated fixture. The fake engine hangs, as a local
// model that no longer answers does: the turn only ends when it is stopped.
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { expect, it } from "vitest";

import { launchVerificationServer } from "../scripts/control-omb.ts";

it("stops another bot's running turn for the person, that thread only, and reads whether it runs", async () => {
  const fixture = await launchVerificationServer({ FAKE_CLAUDE_MODE: "hang" });
  const { url, dataDir } = fixture.info;
  const api = async (method: string, path: string, body?: unknown, status = 200, token?: string) => {
    const response = await fetch(url + path, {
      method,
      headers: { origin: url, "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15_000),
    });
    const result = await response.json() as any;
    expect(response.status, `${method} ${path}: ${JSON.stringify(result)}`).toBe(status);
    return result;
  };
  const dump = join(dataDir, "fake-claude-dump.json");
  /** Start a turn and return its capability (the agents MCP server's token). */
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
  const settings = (comms: string, args: Record<string, unknown>, status = 200) => api("POST", "/api/internal/settings", args, status, comms);
  const busy = async (botId: string, threadId: string): Promise<boolean> => {
    const bot = (await api("GET", "/api/bots?messages=0")).bots.find((row: any) => row.id === botId);
    return Boolean((bot.tasks as any[]).find((task) => task.threadId === threadId)?.busy);
  };
  try {
    const scout = (await api("POST", "/api/bots", { name: "Scout" }, 201)).bot;
    const helper = (await api("POST", "/api/bots", { name: "Helper" }, 201)).bot;
    await api("PATCH", `/api/bots/${scout.id}`, { approvalMode: "auto" });
    // Helper's turn hangs: it stays working until someone stops it
    await turn(helper.id, helper.threadId, "Fetch that very large page.");
    await expect.poll(() => busy(helper.id, helper.threadId), { timeout: 20_000 }).toBe(true);
    // the person asks Scout to stop it
    const comms = await turn(scout.id, scout.threadId, "Stop Helper, it is stuck.");
    expect((await settings(comms, { action: "get", key: "thread.running", target: helper.threadId })).text).toBe(JSON.stringify({ key: "thread.running", value: true }));
    expect((await settings(comms, { action: "set", key: "thread.running", target: helper.threadId, value: false })).text).toMatch(/^Done/);
    await expect.poll(() => busy(helper.id, helper.threadId), { timeout: 20_000 }).toBe(false);
    // that thread only: Scout's own turn still runs
    expect(await busy(scout.id, scout.threadId)).toBe(true);
    // a turn never starts from here
    expect(JSON.stringify(await settings(comms, { action: "set", key: "thread.running", target: helper.threadId, value: true }, 400))).toContain("value is false");
  } finally {
    await fixture.close();
  }
}, 120_000);
