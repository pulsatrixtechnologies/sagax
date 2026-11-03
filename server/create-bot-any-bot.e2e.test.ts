import { existsSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer } from "../scripts/control-omb.ts";
import { removeTempDir } from "./testing/cleanup.ts";

// 2026-10-17 (server/bots/bot-creation.ts): any bot of the person creates bots,
// with the Primary Bot's safety and a depth limit.
it("a bot that is not the Primary Bot creates a bot for its person, and a bot-made bot or a confidential thread cannot", async () => {
  const temp = mkdtempSync(join(tmpdir(), "omb-any-bot-creates-"));
  const gate = join(temp, "finish");
  const fixture = await launchVerificationServer({ FAKE_CLAUDE_MODE: "slow", FAKE_CLAUDE_SLOW_FINISH_GATE: gate });
  const api = async (method: string, path: string, body?: unknown, expected = 200, token?: string) => {
    const response = await fetch(fixture.info.url + path, { method,
      headers: { "content-type": "application/json", origin: fixture.info.url,
        ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const result = await response.json() as any;
    expect(response.status, `${method} ${path}: ${JSON.stringify(result)}`).toBe(expected);
    return result;
  };
  // One slow turn of `botId` in `threadId`, started by the person at this
  // computer: its agents env, while the turn is still running.
  const turn = async (botId: string, threadId?: string) => {
    if (existsSync(gate)) unlinkSync(gate);
    if (existsSync(fixture.fixtureDumpPath)) unlinkSync(fixture.fixtureDumpPath);
    await api("POST", `/api/bots/${botId}/messages`, { text: "Please add a reviewer bot.", ...(threadId ? { threadId } : {}) }, 202);
    await expect.poll(() => existsSync(fixture.fixtureDumpPath), { timeout: 15_000 }).toBe(true);
    return JSON.parse(readFileSync(fixture.fixtureDumpPath, "utf8")).mcpConfig.mcpServers.agents.env as Record<string, string>;
  };
  const idle = (botId: string) => expect.poll(async () => !(await api("GET", "/api/bots")).bots.find((bot: any) => bot.id === botId).busy, { timeout: 20_000 }).toBe(true);
  const finish = async (botId: string) => { writeFileSync(gate, "finish"); await idle(botId); };
  const create = (botId: string, threadId: string, token: string, name: string, expected = 201, extra: Record<string, unknown> = {}) => api("POST", "/api/internal/create-bot", {
    fromBotId: botId, fromThreadId: threadId, name, role: "Reviewer", instructions: "Review the work you are given.", ...extra,
  }, expected, token);
  try {
    const primary = (await api("POST", "/api/bots", { name: "Primary", section: "Design" }, 201)).bot;
    await api("PATCH", `/api/bots/${primary.id}`, { chiefOfStaff: true });
    const maker = (await api("POST", "/api/bots", { name: "Maker", section: "Design" }, 201)).bot;
    // At Ask every time the creation waits on a card (at Approve for me the
    // person's own request applies at once, #1138: checked at the end).
    await api("PATCH", `/api/bots/${maker.id}`, { approvalMode: "ask" });

    // The person asks Maker in its own conversation: create_bot is offered
    // and the creation waits on the same card a Primary Bot gets.
    let env = await turn(maker.id);
    expect(env.SAGAX_CHIEF_OF_STAFF).toBe("0");
    expect(env.SAGAX_CREATE_BOTS).toBe("1");
    const before = (await api("GET", "/api/bots")).bots.length;
    // a suggestion nobody asked for stays the Primary Bot's
    expect(await create(maker.id, maker.threadId, env.SAGAX_COMMS_TOKEN!, "Unasked", 403, { suggestion: true })).toMatchObject({ code: "suggestion_primary_only" });
    const card = await create(maker.id, maker.threadId, env.SAGAX_COMMS_TOKEN!, "Reviewer");
    expect(card).toMatchObject({ state: "pending", applied: false });
    expect((await api("GET", "/api/bots")).bots.length).toBe(before);
    await finish(maker.id);
    const answered = await api("POST", `/api/threads/${maker.threadId}/respond`, { requestId: card.requestId, behavior: "allow" });
    await idle(maker.id);
    const createdId = answered.result.bots[0].id as string;
    const bots = (await api("GET", "/api/bots")).bots;
    expect(bots.length).toBe(before + 1);
    const made = bots.find((bot: any) => bot.id === createdId);
    expect(made).toMatchObject({ name: "Reviewer", section: "Design", approvePeerComms: false, soul: "Review the work you are given." });
    expect(made.chiefOfStaff ?? false).toBe(false);
    // the same owner as its maker, and the depth mark never leaves the server
    expect(made.ownerUserId).toBe(bots.find((bot: any) => bot.id === maker.id).ownerUserId);
    expect(made).not.toHaveProperty("createdByBot");

    // The bot Maker made cannot make another: not offered, refused anyway.
    env = await turn(createdId);
    expect(env.SAGAX_CREATE_BOTS).toBe("0");
    expect(await create(createdId, made.threadId, env.SAGAX_COMMS_TOKEN!, "Grandchild", 409)).toMatchObject({ code: "too_deep" });
    await finish(createdId);

    // A confidential thread creates no bot, whoever asks.
    const secret = (await api("POST", `/api/bots/${maker.id}/tasks`, { title: "Private work", confidential: true }, 201)).task;
    env = await turn(maker.id, secret.threadId);
    expect(await create(maker.id, secret.threadId, env.SAGAX_COMMS_TOKEN!, "Leaky", 403)).toMatchObject({ code: "confidential_thread" });
    await finish(maker.id);
    expect((await api("GET", "/api/bots")).bots.some((bot: any) => bot.name === "Leaky" || bot.name === "Grandchild" || bot.name === "Unasked")).toBe(false);

    // At Approve for me (the new-bot default) the person's own request in
    // Maker's conversation creates the bot at once, without a card (#1138).
    await api("PATCH", `/api/bots/${maker.id}`, { approvalMode: "auto" });
    env = await turn(maker.id, maker.threadId);
    const count = (await api("GET", "/api/bots")).bots.length;
    const applied = await create(maker.id, maker.threadId, env.SAGAX_COMMS_TOKEN!, "Quick reviewer");
    expect(applied).toMatchObject({ state: "applied", name: "Quick reviewer", section: "Design" });
    await finish(maker.id);
    const after = (await api("GET", "/api/bots")).bots;
    expect(after.length).toBe(count + 1);
    expect(after.find((bot: any) => bot.id === applied.id)).toMatchObject({ name: "Quick reviewer", approvePeerComms: false });
  } finally {
    writeFileSync(gate, "finish");
    await fixture.close();
    await removeTempDir(temp);
  }
}, 90_000);
