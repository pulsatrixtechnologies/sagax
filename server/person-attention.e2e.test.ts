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
    // #4243, #4260: each item is its own keyed question card, in the
    // person's own conversation with the bot
    const itemCards = async () => (await messages(atlas.activeTaskId)).filter((message) => message.kind === "options" && message.card?.askKey?.startsWith("item:"));
    await test({ session, cli, api, nova, atlas, plan, save, messages, itemCards });
  } finally { await session.close(); }
}

/** Both items, one keyed card each, Done / Not for me, the ticket's words. */
function expectItemCards(cards: any[], scope: string) {
  expect(cards.map((message) => message.card.askKey).sort()).toEqual([`item:${scope}:t100201`, `item:${scope}:t100202`]);
  for (const message of cards) {
    expect(message.card).toMatchObject({ options: ["Done", "Not for me"], requestType: "question", noHold: true });
    expect(message.card.subtitle).toMatch(/^\*\*10020[12]\*\* \(board 1, /);
  }
}

async function handOff(f: any, step: Record<string, unknown>) {
  const stream = await openSse(`${f.session.info.url}/api/events`);
  try {
    f.plan[f.nova.id] = { steps: [step], reply: "Handed to Atlas", resumeReply: "Atlas reported back" };
    f.plan[f.atlas.id] = { reply: REPORT };
    f.save();
    await f.cli("send", "--bot", f.nova.id, "--task", f.nova.activeTaskId, "--text", "Have Atlas run the hourly dispatch pass.");
    // #4260 (Fixes #4238): a teammate's exchange's items take the keyed item
    // card path under the peer scope, "no unkeyed attention card per answer"
    await expect.poll(async () => (await f.itemCards()).length, { timeout: 30_000 }).toBe(2);
    expectItemCards(await f.itemCards(), "peer");
    expect((await f.messages(f.atlas.activeTaskId)).some((message: any) => message.attention)).toBe(false);
    // where it was said: Atlas's thread Nova opened, which holds the report
    const atlasThreads = (await f.api("/api/bots")).bots.find((bot: any) => bot.id === f.atlas.id).tasks.map((task: any) => task.threadId);
    let saidIn = false;
    for (const threadId of atlasThreads) if (threadId !== f.atlas.activeTaskId && (await f.messages(threadId)).some((message: any) => message.text === REPORT)) saidIn = true;
    expect(saidIn).toBe(true);
    // each card rings in the person's own conversation (the push hub reads notify frames)
    for (const ticket of ["100201", "100202"]) {
      const frame = await stream.until((candidate) => candidate.kind === "notify" && candidate.notification?.kind === "question" && String(candidate.notification?.title).startsWith(ticket), 15_000);
      expect(frame.notification).toMatchObject({ botId: f.atlas.id, threadId: f.atlas.activeTaskId });
    }
    // the conversation turns unread
    const atlasNow = (await f.api("/api/bots")).bots.find((bot: any) => bot.id === f.atlas.id);
    expect(atlasNow.tasks.find((task: any) => task.threadId === f.atlas.activeTaskId)?.unread).toBe(true);
    // one card per item, however the hand-off settles
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(await f.itemCards()).toHaveLength(2);
  } finally { stream.close(); }
}

it("carries a teammate's [HUMAIN] items from coordinated work to the person's chat as a card", () => fixture(async (f) => {
  await handOff(f, { arguments: { bot_ids: [f.atlas.id], message: "Run the hourly dispatch pass and report." } });
}), 60_000);

it("carries them from a one-way send too, where nothing goes back to the sender", () => fixture(async (f) => {
  await handOff(f, { tool: "send_to_bot", arguments: { bot_id: f.atlas.id, title: "Hourly dispatch", message: "Run the hourly dispatch pass." } });
}), 60_000);

it("a run with [HUMAIN] items gives one card per item, not two, and rings once per card", () => fixture(async (f) => {
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
    // #4243 (Refs #4233): each item of a run is its own keyed card under the
    // routine's prefix, never a second list on the run's card
    await expect.poll(async () => (await f.itemCards()).length, { timeout: 15_000 }).toBe(2);
    await new Promise((resolve) => setTimeout(resolve, 800));
    expectItemCards(await f.itemCards(), routine.id);
    const rows = await f.messages(f.atlas.activeTaskId);
    expect(rows.filter((message: any) => message.attention)).toHaveLength(0);
    expect(rows.filter((message: any) => message.kind === "routine.run" && message.routineRun?.runId === run.id)).toHaveLength(1);
    const rings = stream.frames.filter((frame) => frame.kind === "notify" && (frame.notification?.kind === "question" || frame.notification?.kind === "needs-you"));
    expect(rings.map((frame) => frame.notification.kind)).toEqual(["question", "question"]);
  } finally { stream.close(); }
}), 60_000);
