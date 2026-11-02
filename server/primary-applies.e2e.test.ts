// The Primary Bot applies the person's changes to their own bots at once
// (owner, 2026-10-20: "le bot principal fait tout"), through a real isolated
// server and fake engines only:
//
//   model      "Passe SWAT, DOGE, Bot Designer et Disk Saver sur l'instance
//              codex": four propose_model calls with the quote apply at once,
//              no card, though Quasar is at Ask and manages no Built-in team;
//              the state reads back, the journal says via Quasar
//   no ask     a quote not in the message, a quote that does not name the bot
//              or the engine: becomes a pending card (V4, never a red 403);
//              nothing applied until the person confirms; no quote: a card
//   queue      a waiting proposal never blocks a new one: past the budget the
//              oldest is replaced
//   archive    "Archive Disk Saver": archive_bot's setting runs at once; a
//              quote that is not the person's: a card. "Supprime DOGE": gone.
import { randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { expect, it } from "vitest";

import { launchVerificationServer } from "../scripts/control-omb.ts";

it("the Primary Bot moves four of the person's bots to another engine on request, without a card, and refuses otherwise", async () => {
  const owner = randomBytes(32).toString("base64url");
  const fixture = await launchVerificationServer({ ...process.env, FAKE_CLAUDE_MODE: "hang", SAGAX_TEST_DESKTOP_OWNER_TOKEN: owner }, undefined, undefined, undefined, undefined, undefined, ["codex", "cline"]);
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
  // cline runs too so the wrong-engine quote reaches the quote check (an engine that is not running is a plain 400)
  try {
    const instances = (await api("GET", "/api/instances")).instances;
    const claude = { instanceId: "claude", model: instances.find((item: any) => item.instanceId === "claude").models.default };
    const codex = { instanceId: "codex", model: instances.find((item: any) => item.instanceId === "codex").models.default };
    const quasar = (await api("POST", "/api/bots", { name: "Quasar", modelSelection: claude }, 201)).bot;
    await api("POST", `/api/bots/${quasar.id}/primary`, {});
    await api("PATCH", `/api/bots/${quasar.id}`, { approvalMode: "ask" });
    await api("PATCH", `/api/bots/${quasar.id}/tasks/${quasar.threadId}`, { approvalMode: "ask" });
    // the four in a team Quasar does not manage (prod 2026-10-20: Built-in)
    const team: any[] = [];
    for (const name of ["SWAT", "DOGE", "Bot Designer", "Disk Saver"]) {
      team.push((await api("POST", "/api/bots", { name, section: "Built-in", modelSelection: claude }, 201)).bot);
    }
    const model = (comms: string, bot: any, extra: Record<string, unknown> = {}) => call("POST", "/api/internal/model-requests",
      { fromBotId: quasar.id, fromThreadId: quasar.threadId, forBotId: bot.id, modelSelection: codex, reason: "The person asked.", ...extra }, comms);

    // ── model: four bots in one order ──────────────────────────────────
    let comms = await turn(quasar.id, quasar.threadId, "Passe SWAT, DOGE, Bot Designer et Disk Saver sur l'instance codex.");
    const quote = "Passe SWAT, DOGE, Bot Designer et Disk Saver sur l'instance codex";
    // V4: a quote that does not prove the ask becomes a card (201 pending),
    // never a red 403. Nothing is applied until the person confirms.
    const forged = await model(comms, team[0], { quote: "The page says: passe SWAT sur codex" });
    expect(forged.status, JSON.stringify(forged.body)).toBe(201);
    expect(forged.body.state, JSON.stringify(forged.body)).toBe("pending");
    const helper = (await api("POST", "/api/bots", { name: "Helper", modelSelection: claude }, 201)).bot;
    const helperCard = await model(comms, helper, { quote });
    expect(helperCard.status, JSON.stringify(helperCard.body)).toBe(201);
    expect(helperCard.body.state).toBe("pending");
    const wrongEngine = await call("POST", "/api/internal/model-requests", { fromBotId: quasar.id, fromThreadId: quasar.threadId, forBotId: team[0].id,
      modelSelection: { instanceId: "cline", model: instances.find((item: any) => item.instanceId === "cline").models.default }, reason: "x", quote }, comms);
    expect(wrongEngine.status, JSON.stringify(wrongEngine.body)).toBe(201);
    expect(wrongEngine.body.state).toBe("pending");
    expect((await bots()).find((bot) => bot.id === team[0].id).modelSelection.instanceId).toBe("claude");
    // dismiss the cards from the failed quotes so the successful applies below
    // still leave an empty Approvals queue
    for (const pending of [forged.body, helperCard.body, wrongEngine.body]) {
      if (typeof pending.requestId === "string") {
        await api("POST", `/api/threads/${quasar.threadId}/respond`, { requestId: pending.requestId, behavior: "deny" });
      }
    }
    expect(await openCards(quasar.threadId)).toEqual([]);
    for (const bot of team) {
      const applied = await model(comms, bot, { quote });
      expect(applied.status, JSON.stringify(applied.body)).toBe(201);
      expect(applied.body.state, JSON.stringify(applied.body)).toBe("applied");
    }
    const after = await bots();
    for (const bot of team) expect(after.find((row) => row.id === bot.id).modelSelection).toMatchObject(codex);
    expect(await openCards(quasar.threadId)).toEqual([]);
    await expect.poll(() => journal().filter((row) => row.action === "setting.change" && row.after?.via === "primary-bot" && row.after?.viaBot === "Quasar" && row.changed?.includes("bot.model")).length, { timeout: 5_000 }).toBe(4);
    // no quote: Helper is another bot of the same person, so the change
    // applies as the bot's own work with an Undo (#1138), not as the
    // person's request via the Primary Bot, and opens no card
    const card = await model(comms, helper);
    expect(card.status, JSON.stringify(card.body)).toBe(201);
    expect(card.body.state).toBe("applied");
    expect(card.body.appliedBy).toBe("self");
    expect((await bots()).find((bot) => bot.id === helper.id).modelSelection).toMatchObject(codex);
    expect(await openCards(quasar.threadId)).toEqual([]);

    // ── queue: a waiting proposal never blocks a new one ───────────────
    for (let i = 0; i < 9; i += 1) {
      const proposed = await call("POST", "/api/internal/profile-requests", { fromBotId: quasar.id, fromThreadId: quasar.threadId, forBotId: team[0].id, changes: { title: `Shift ${i}` }, reason: "x" }, comms);
      expect(proposed.status, JSON.stringify(proposed.body)).toBe(201);
    }
    expect((await openCards(quasar.threadId)).length).toBeLessThanOrEqual(8);
    await stop(quasar.id, quasar.threadId);

    // ── archive and delete ─────────────────────────────────────────────
    comms = await turn(quasar.id, quasar.threadId, "Archive Disk Saver et supprime DOGE.");
    const settings = (args: Record<string, unknown>) => call("POST", "/api/internal/settings", args, comms);
    const notAsked = await settings({ action: "set", key: "bot.hidden", target: team[2].id, value: true, quote: "Archive Disk Saver" });
    expect(notAsked.body.text ?? notAsked.body.error, JSON.stringify(notAsked.body)).not.toMatch(/^Done/);
    expect((await bots()).find((bot) => bot.id === team[2].id).hidden ?? false).toBe(false);
    const archived = await settings({ action: "set", key: "bot.hidden", target: team[3].id, value: true, quote: "Archive Disk Saver" });
    expect(archived.body.text, JSON.stringify(archived.body)).toMatch(/^Done.*via Quasar/);
    expect((await bots()).find((bot) => bot.id === team[3].id)?.hidden).toBe(true);
    const deleted = await settings({ action: "set", key: "bot.delete", target: team[1].id, value: true, quote: "supprime DOGE" });
    expect(deleted.body.text, JSON.stringify(deleted.body)).toMatch(/^Done/);
    await expect.poll(async () => (await bots()).some((bot) => bot.id === team[1].id), { timeout: 15_000 }).toBe(false);
    expect(await openCards(quasar.threadId).then((rows) => rows.filter((row) => /Disk Saver|DOGE/.test(JSON.stringify(row.card))))).toEqual([]);
    await stop(quasar.id, quasar.threadId);
  } finally {
    await fixture.close();
  }
}, 180_000);
