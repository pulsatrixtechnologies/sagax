// sagax_settings through a real server on an isolated fixture (JC,
// 2026-10-19: "Tout doit être modifiable via les bots"). A bot's turn calls
// the internal route with its own capability, as the agents MCP tool does:
// - bot, routine, group and server families: the owner's bot at Approve for
//   me applies the change with no card, and the admin journal records it;
// - a deletion and an organization setting wait on a card, and the card's
//   Allow applies it as the person;
// - a person paired with chat access only is refused with the reason: a
//   bot never does what its person could not do by hand.
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { expect, it } from "vitest";

import { launchVerificationServer } from "../scripts/control-omb.ts";

it("applies the owner's own settings at once, holds the sensitive ones on a card, and refuses what the person cannot do", async () => {
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
  const turn = async (botId: string, threadId: string, text: string, token?: string): Promise<string> => {
    rmSync(dump, { force: true });
    await api("POST", `/api/bots/${botId}/messages`, { threadId, text }, 202, token);
    let comms = "";
    await expect.poll(() => {
      if (!existsSync(dump)) return false;
      try { comms = JSON.parse(readFileSync(dump, "utf8")).mcpConfig.mcpServers.agents.env.SAGAX_COMMS_TOKEN; } catch { return false; }
      return Boolean(comms);
    }, { timeout: 20_000 }).toBe(true);
    return comms;
  };
  const settings = (comms: string, args: Record<string, unknown>, status = 200) => api("POST", "/api/internal/settings", args, status, comms);
  const journal = (): any[] => {
    const dir = join(dataDir, "admin-activity");
    if (!existsSync(dir)) return [];
    return readdirSync(dir).flatMap((name) => readFileSync(join(dir, name), "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)))
      .filter((row) => row.action === "setting.change");
  };
  const botOf = async (id: string) => (await api("GET", "/api/bots?messages=0")).bots.find((bot: any) => bot.id === id);
  try {
    const scout = (await api("POST", "/api/bots", { name: "Scout" }, 201)).bot;
    const helper = (await api("POST", "/api/bots", { name: "Helper" }, 201)).bot;
    // the person set Helper to Ask by hand; Scout (Approve for me) works for them
    await api("PATCH", `/api/bots/${helper.id}`, { approvalMode: "ask" });
    expect((await botOf(scout.id)).approvalMode).toBe("auto");
    const comms = await turn(scout.id, scout.threadId, "Set my bots up.");

    // ── bot family: applied at once, no card, journaled ─────────────────
    expect((await settings(comms, { action: "set", key: "bot.approvalMode", target: helper.id, value: "auto" })).text).toMatch(/^Done/);
    expect((await botOf(helper.id)).approvalMode).toBe("auto");
    expect((await settings(comms, { action: "set", key: "bot.title", target: helper.id, value: "Night shift" })).text).toMatch(/^Done/);
    expect((await settings(comms, { action: "get", key: "bot.title", target: helper.id })).text).toBe(JSON.stringify({ key: "bot.title", value: "Night shift" }));
    // above the speaking bot's own level: a card
    expect((await settings(comms, { action: "set", key: "bot.approvalMode", target: helper.id, value: "full" })).text).toContain("Approval needed.");

    // ── routine family ───────────────────────────────────────────────────
    const routine = (await api("POST", "/api/routines", { name: "Morning", prompt: "Say hi", botId: helper.id, schedule: { type: "daily", time: "08:00", weekdays: [1, 2, 3, 4, 5] } }, 201)).routine;
    expect((await settings(comms, { action: "set", key: "routine.schedule", target: routine.id, value: { type: "daily", time: "09:30", weekdays: [1] } })).text).toMatch(/^Done/);
    expect((await settings(comms, { action: "set", key: "routine.thread", target: routine.id, value: helper.threadId })).text).toMatch(/^Done/);
    const saved = (await api("GET", "/api/routines")).routines.find((row: any) => row.id === routine.id);
    expect(saved).toMatchObject({ schedule: { type: "daily", time: "09:30", weekdays: [1] }, resultsThreadId: helper.threadId });

    // ── group family ─────────────────────────────────────────────────────
    const group = (await api("POST", "/api/groups", { memberIds: [scout.id, helper.id], name: "Desk" }, 201)).group;
    expect((await settings(comms, { action: "set", key: "group.name", target: group.id, value: "Front desk" })).text).toMatch(/^Done/);
    expect((await api("GET", "/api/groups")).groups.find((row: any) => row.id === group.id).name).toBe("Front desk");

    // ── server family (the person's own server) ──────────────────────────
    expect((await settings(comms, { action: "set", key: "server.showToolCalls", value: true })).text).toMatch(/^Done/);

    // ── journal: one row per applied change, with the bot that made it ───
    await expect.poll(() => journal().map((row) => row.changed[0]), { timeout: 5_000 })
      .toEqual(["bot.approvalMode", "bot.title", "routine.schedule", "routine.thread", "group.name", "server.showToolCalls"]);
    expect(journal()[0]).toMatchObject({ category: "setting", after: { "bot.approvalMode": "auto", how: "run", bot: scout.id } });

    // ── sensitive: a deletion and an organization setting wait on a card ─
    expect((await settings(comms, { action: "set", key: "routine.delete", target: routine.id, value: true })).text).toContain("Approval needed.");
    expect((await settings(comms, { action: "set", key: "org.allowFullAccess", value: true })).text).toContain("Approval needed.");
    expect((await api("GET", "/api/routines")).routines.some((row: any) => row.id === routine.id)).toBe(true);
    const cards = (await api("GET", `/api/threads/${scout.threadId}/messages`)).messages.filter((message: any) => message.card?.botActRequest);
    expect(cards.map((message: any) => message.card.subtitle)).toEqual([
      expect.stringContaining("bot.approvalMode"),
      expect.stringContaining("routine.delete"),
      expect.stringContaining("org.allowFullAccess"),
    ]);
    // the person's Allow applies the deletion as them, and it is journaled
    await api("POST", `/api/threads/${scout.threadId}/respond`, { requestId: cards[1].card.requestId, behavior: "allow" });
    expect((await api("GET", "/api/routines")).routines.some((row: any) => row.id === routine.id)).toBe(false);
    await expect.poll(() => journal().at(-1)?.after, { timeout: 5_000 }).toMatchObject({ "routine.delete": true, how: "allowed" });

    // ── a person with chat access only: refused with the reason ──────────
    const pairing = await api("POST", "/api/auth/pairing", { label: "Member fixture", scopes: ["client"] });
    const member = (await api("POST", "/api/auth/pair", { code: pairing.code })).token as string;
    const memberComms = await turn(helper.id, helper.threadId, "Turn on tool calls for everyone.", member);
    expect(memberComms).not.toBe(comms);
    const refused = await settings(memberComms, { action: "set", key: "server.showToolCalls", value: false }, 403);
    expect(refused.error).toContain("rights they do not have");
    expect(journal().filter((row) => row.changed[0] === "server.showToolCalls")).toHaveLength(1);
  } finally {
    await fixture.close();
  }
}, 120_000);
