// The Primary Bot's scope, its archive and the models threads follow
// (prod 2026-10-20, Sagax 0.6.4, Melonie), through a real isolated server and
// fake engines only:
//
//   scope     a new Primary Bot with no managed team sees and lists the
//             person's bots of the Built-in team (list_bots, list_team_setup)
//   archive   archive_bot is idempotent; a temporary agent archived by
//             delete_agent leaves every list, reads back archived, and a
//             second archive says so; a creator archives its own at once
//   models    a bot's new default moves its main thread and a thread whose
//             model was only a copy of the old default
//   primary   "Fais de DOGE mon bot principal": bot.primary on the person's
//             words, at once
import { randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { expect, it } from "vitest";

import { launchVerificationServer } from "../scripts/control-omb.ts";

it("the Primary Bot sees every bot of its person, archives idempotently, and threads follow a new default model", async () => {
  const owner = randomBytes(32).toString("base64url");
  const fixture = await launchVerificationServer({ ...process.env, FAKE_CLAUDE_MODE: "hang", SAGAX_TEST_DESKTOP_OWNER_TOKEN: owner }, undefined, undefined, undefined, undefined, undefined, ["codex"]);
  const { url, dataDir } = fixture.info;
  const call = async (method: string, path: string, body?: unknown, token?: string) => {
    const response = await fetch(url + path, {
      method,
      headers: { origin: url, "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : { "x-openmausbot-desktop-owner": owner }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await response.text();
    let parsed: any = {};
    try { parsed = JSON.parse(text); } catch { /* not JSON */ }
    return { status: response.status, body: parsed };
  };
  const api = async (method: string, path: string, body?: unknown, status = 200) => {
    const result = await call(method, path, body);
    expect(result.status, `${method} ${path}: ${JSON.stringify(result.body)}`).toBe(status);
    return result.body;
  };
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
  const stop = async (botId: string, threadId: string) => {
    await api("POST", `/api/bots/${botId}/interrupt`, { threadId });
    await expect.poll(async () => (await api("GET", "/api/bots?messages=0")).bots.find((bot: any) => bot.id === botId)?.busy ?? false, { timeout: 15_000 }).toBe(false);
  };
  const bots = async () => (await api("GET", "/api/bots?messages=0")).bots as any[];
  const openCards = async (threadId: string) => ((await api("GET", `/api/threads/${threadId}/messages?limit=200`)).messages as any[])
    .filter((message) => message.card?.options?.length && !message.card.answered && !message.card.dismissed && !message.card.expired);
  const journal = (): any[] => {
    const dir = join(dataDir, "admin-activity");
    if (!existsSync(dir)) return [];
    return readdirSync(dir).flatMap((name) => readFileSync(join(dir, name), "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)));
  };
  try {
    const instances = (await api("GET", "/api/instances")).instances;
    const claude = { instanceId: "claude", model: instances.find((item: any) => item.instanceId === "claude").models.default };
    const codex = { instanceId: "codex", model: instances.find((item: any) => item.instanceId === "codex").models.default };
    const melonie = (await api("POST", "/api/bots", { name: "Melonie", modelSelection: claude }, 201)).bot;
    await api("POST", `/api/bots/${melonie.id}/primary`, {});
    await api("PATCH", `/api/bots/${melonie.id}`, { approvalMode: "ask" });
    await api("PATCH", `/api/bots/${melonie.id}/tasks/${melonie.threadId}`, { approvalMode: "ask" });
    const builtIn: any[] = [];
    for (const name of ["SWAT", "DOGE", "Bot Designer", "Disk Saver"]) {
      builtIn.push((await api("POST", "/api/bots", { name, section: "Built-in", modelSelection: claude }, 201)).bot);
    }
    expect((await bots()).find((bot) => bot.id === melonie.id).managedSections ?? []).toEqual([]);

    // ── scope: every bot of the person, no managed team needed ─────────
    let comms = await turn(melonie.id, melonie.threadId, "Montre-moi mes bots.");
    const listed = async () => ((await call("GET", "/api/internal/agents", undefined, comms)).body.bots as any[]).map((bot) => bot.name);
    const catalog = async () => (await call("GET", "/api/internal/team-setup-catalog", undefined, comms)).body;
    expect(await listed()).toEqual(expect.arrayContaining(["SWAT", "DOGE", "Bot Designer", "Disk Saver"]));
    const setup = await catalog();
    expect(setup.bots.map((bot: any) => bot.name), JSON.stringify(setup)).toEqual(expect.arrayContaining(["Melonie", "SWAT", "DOGE", "Bot Designer", "Disk Saver"]));
    expect(setup.teams).toContain("Built-in");
    // a teammate's turn reaches the Built-in bot too (same rule as the list)
    const asked = await call("POST", "/api/internal/delegate-bot", { fromBotId: melonie.id, fromThreadId: melonie.threadId, toBotId: builtIn[2].id, message: "ping" }, comms);
    expect(JSON.stringify(asked.body)).not.toMatch(/different section/);

    // ── archive: a temporary agent ─────────────────────────────────────
    const agentApi = (name: string, args: unknown) => call("POST", `/api/internal/agent-api/${name}`, args, comms);
    const temp = await agentApi("create_agent", { name: "perf-test-061" });
    expect(temp.status, JSON.stringify(temp.body)).toBeLessThan(300);
    const tempId = String(temp.body.agent?.agent_id ?? temp.body.agent?.id);
    expect(await listed()).toContain("perf-test-061");
    expect((await agentApi("delete_agent", { agent_id: tempId })).status).toBeLessThan(300);
    expect(await listed()).not.toContain("perf-test-061");
    expect((await catalog()).bots.map((bot: any) => bot.name)).not.toContain("perf-test-061");
    const settings = (args: Record<string, unknown>) => call("POST", "/api/internal/settings", args, comms);
    const readBack = await settings({ action: "get", key: "bot.hidden", target: tempId });
    expect(readBack.status, JSON.stringify(readBack.body)).toBe(200);
    expect(JSON.parse(readBack.body.text)).toMatchObject({ key: "bot.hidden", value: true });
    const again = await settings({ action: "set", key: "bot.hidden", target: tempId, value: true, quote: "Archive perf-test-061" });
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    expect(again.body.text).toMatch(/already archived/);
    expect((await settings({ action: "set", key: "bot.hidden", target: tempId, value: false })).status).toBe(409);
    // its creator archives an active one at once, then it is gone
    const temp2 = await agentApi("create_agent", { name: "perf-test-062" });
    const temp2Id = String(temp2.body.agent?.agent_id ?? temp2.body.agent?.id);
    const archivedTemp = await settings({ action: "set", key: "bot.hidden", target: temp2Id, value: true });
    expect(archivedTemp.status, JSON.stringify(archivedTemp.body)).toBe(200);
    expect(archivedTemp.body.text).toMatch(/^Done/);
    expect(await listed()).not.toContain("perf-test-062");
    await stop(melonie.id, melonie.threadId);

    // ── archive: an ordinary bot, twice ────────────────────────────────
    comms = await turn(melonie.id, melonie.threadId, "Archive Disk Saver.");
    const first = await settings({ action: "set", key: "bot.hidden", target: builtIn[3].id, value: true, quote: "Archive Disk Saver" });
    expect(first.body.text, JSON.stringify(first.body)).toMatch(/^Done/);
    const second = await settings({ action: "set", key: "bot.hidden", target: builtIn[3].id, value: true, quote: "Archive Disk Saver" });
    expect(second.status, JSON.stringify(second.body)).toBe(200);
    expect(second.body.text).toMatch(/already archived/);
    expect(JSON.parse((await settings({ action: "get", key: "bot.hidden", target: builtIn[3].id })).body.text).value).toBe(true);
    expect(await listed()).not.toContain("Disk Saver");
    expect((await catalog()).bots.map((bot: any) => bot.name)).not.toContain("Disk Saver");
    await stop(melonie.id, melonie.threadId);

    // ── models: threads follow the bot's new default ───────────────────
    const swat = builtIn[0];
    const { task: copy } = await api("POST", `/api/bots/${swat.id}/tasks`, { title: "Copy of the default" }, 201);
    await api("PATCH", `/api/bots/${swat.id}/tasks/${copy.threadId}`, { modelSelection: codex });
    await api("PATCH", `/api/bots/${swat.id}`, { modelSelection: codex });
    // now its own model is only a copy of the bot's
    await api("PATCH", `/api/bots/${swat.id}`, { modelSelection: claude });
    const state = (await bots()).find((bot) => bot.id === swat.id);
    expect(state.modelSelection).toMatchObject(claude);
    const thread = (id: string) => state.tasks.find((task: any) => task.threadId === id);
    expect(thread(swat.threadId)).toMatchObject({ modelSelection: claude, followsBotModel: true });
    expect(thread(copy.threadId)).toMatchObject({ modelSelection: claude, followsBotModel: true });

    // ── primary: on the person's words ─────────────────────────────────
    comms = await turn(melonie.id, melonie.threadId, "Fais de DOGE mon bot principal.");
    const primary = await settings({ action: "set", key: "bot.primary", target: builtIn[1].id, value: true, quote: "Fais de DOGE mon bot principal" });
    expect(primary.status, JSON.stringify(primary.body)).toBe(200);
    expect(primary.body.text, JSON.stringify(primary.body)).toMatch(/^Done/);
    const after = await bots();
    expect(after.find((bot) => bot.id === builtIn[1].id).chiefOfStaff).toBe(true);
    expect(after.find((bot) => bot.id === melonie.id).chiefOfStaff ?? false).toBe(false);
    void journal;
    void openCards;
  } finally {
    await fixture.close();
  }
}, 180_000);
