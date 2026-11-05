// 2026-11-05: a bot's result that needs the person reaches the person,
// whatever thread it came from. Reproduces the production case: a bot hands
// a dispatch pass to a teammate, the teammate's turn ends in the thread the
// first bot opened ("@Nova · work") with [HUMAIN] items, and the person's
// own conversation with the teammate got nothing (no card, no notification).
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";
import { request } from "../scripts/mcp-server.ts";
import { openSse } from "./testing/sse.ts";

const REPORT = [
  "- [HUMAIN] **100201** (board 1, Acme) : security notice, still New. Someone must decide which client it belongs to.",
  "- [HUMAIN] **100202** (board 1, Globex) : the close was refused; set it to Completed by hand.",
  "",
  "No writes. The run is closed.",
].join("\n");

async function fixture(test: (f: any) => Promise<void>) {
  const session = await launchVerificationServer(process.env, undefined, undefined, undefined, undefined, { scripted: true }, []);
  const cli = (...args: string[]) => runControlOmb(args, { env: { SAGAX_URL: session.info.url } }) as Promise<any>;
  const api = (path: string, body?: unknown, method = "POST") => request(path, body === undefined ? {} : { method, body: JSON.stringify(body) }, session.info.url) as Promise<any>;
  try {
    const nova = (await cli("new-bot", "--name", "Nova", "--section", "Operations")).bot;
    const atlas = (await cli("new-bot", "--name", "Atlas", "--section", "Operations")).bot;
    const planPath = join(session.info.dataDir, "room-plan.json");
    const plan: Record<string, any> = {};
    const save = () => writeFileSync(planPath, JSON.stringify(plan));
    const messages = async (threadId: string) => (await api(`/api/threads/${threadId}/messages`)).messages as any[];
    const card = async () => (await messages(atlas.activeTaskId)).find((message) => message.attention) ?? null;
    await test({ session, cli, api, nova, atlas, plan, save, messages, card });
  } finally { await session.close(); }
}

async function handOff(f: any, step: Record<string, unknown>) {
  const stream = await openSse(`${f.session.info.url}/api/events`);
  try {
    f.plan[f.nova.id] = { steps: [step], reply: "Handed to Atlas", resumeReply: "Atlas reported back" };
    f.plan[f.atlas.id] = { reply: REPORT };
    f.save();
    await f.cli("send", "--bot", f.nova.id, "--task", f.nova.activeTaskId, "--text", "Have Atlas run the hourly dispatch pass.");
    await expect.poll(f.card, { timeout: 30_000 }).toBeTruthy();
    const card = await f.card();
    // the card, in the person's own conversation with Atlas
    expect(card.attention).toMatchObject({
      kind: "human", botId: f.atlas.id, botName: "Atlas", openedBy: { botId: f.nova.id, name: "Nova" },
      items: [{ ticketId: 100201 }, { ticketId: 100202 }],
    });
    expect(card.attention.threadId).not.toBe(f.atlas.activeTaskId);
    // where it was said: Atlas's thread Nova opened, which holds the report
    expect((await f.messages(card.attention.threadId)).some((message: any) => message.text === REPORT)).toBe(true);
    // and a notification that reaches desktop and phone (the push hub reads notify frames)
    const frame = await stream.until((candidate) => candidate.kind === "notify" && candidate.notification?.kind === "needs-you", 15_000);
    expect(frame.notification).toMatchObject({ botId: f.atlas.id, threadId: f.atlas.activeTaskId, title: "Atlas needs you" });
    expect(frame.notification.quietOnPhones).toBeUndefined();
    // the conversation turns unread
    const atlasNow = (await f.api("/api/bots")).bots.find((bot: any) => bot.id === f.atlas.id);
    expect(atlasNow.tasks.find((task: any) => task.threadId === f.atlas.activeTaskId)?.unread).toBe(true);
    // one card, however the hand-off settles
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect((await f.messages(f.atlas.activeTaskId)).filter((message: any) => message.attention)).toHaveLength(1);
  } finally { stream.close(); }
}

it("carries a teammate's [HUMAIN] items from coordinated work to the person's chat as a card", () => fixture(async (f) => {
  await handOff(f, { arguments: { bot_ids: [f.atlas.id], message: "Run the hourly dispatch pass and report." } });
}), 60_000);

it("carries them from a one-way send too, where nothing goes back to the sender", () => fixture(async (f) => {
  await handOff(f, { tool: "send_to_bot", arguments: { bot_id: f.atlas.id, title: "Hourly dispatch", message: "Run the hourly dispatch pass." } });
}), 60_000);

it("a run with [HUMAIN] items gives one card, not two, and rings once", () => fixture(async (f) => {
  const stream = await openSse(`${f.session.info.url}/api/events`);
  try {
    f.plan[f.atlas.id] = { reply: REPORT };
    f.save();
    // postResults off: items for the person post all the same
    const { routine } = await f.api("/api/routines", {
      name: "Hourly new tickets", prompt: "Run the hourly dispatch pass.", botId: f.atlas.id, enabled: false, postResults: false,
      schedule: { type: "interval", everyMinutes: 60, anchorAt: Date.now() + 3_600_000 },
    });
    const { run } = await f.api(`/api/routines/${routine.id}/run`, {});
    const runState = async () => (await f.api("/api/routines", undefined, "GET")).runs.find((entry: any) => entry.id === run.id);
    await expect.poll(async () => (await runState())?.status, { timeout: 30_000 }).toBe("completed");
    await stream.until((frame) => frame.kind === "notify" && frame.notification?.kind === "needs-you", 15_000);
    await new Promise((resolve) => setTimeout(resolve, 800));
    const carried = (await f.messages(f.atlas.activeTaskId)).filter((message: any) => message.attention);
    // the run's own card is the card
    expect(carried).toHaveLength(1);
    expect(carried[0]).toMatchObject({ kind: "routine.run", routineRun: { runId: run.id }, attention: { items: [{ ticketId: 100201 }, { ticketId: 100202 }] } });
    expect(stream.frames.filter((frame) => frame.kind === "notify" && frame.notification?.kind === "needs-you")).toHaveLength(1);
  } finally { stream.close(); }
}), 60_000);
