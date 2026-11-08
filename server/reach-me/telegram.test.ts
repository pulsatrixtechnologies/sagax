// "Me joindre" by Telegram (2026-10-26): the person's own bot, linked by a
// one-time /start code; only that chat answers. No network: fetch is a mock.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { ReachOutbound } from "./channel.ts";
import { createReachMeStore } from "./store.ts";
import { ReachTelegram } from "./telegram.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

const TOKEN = `123456789:${"A".repeat(35)}`;

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "sagax-reach-tg-"));
  dirs.push(dir);
  const settings = createReachMeStore(dir);
  const sealed = new Map<string, string>();
  const calls: Array<{ method: string; body: Record<string, unknown> }> = [];
  let updates: unknown[] = [];
  const fetch = (async (url: string, init: { body: string }) => {
    const method = url.split("/").pop()!;
    const body = JSON.parse(init.body) as Record<string, unknown>;
    calls.push({ method, body });
    const result = method === "getMe" ? { username: "my_sagax_bot" } : method === "getUpdates" ? updates : { message_id: 1 };
    return new Response(JSON.stringify({ ok: true, result }), { status: 200 });
  }) as unknown as typeof globalThis.fetch;
  const replies: string[] = [];
  let waiting = true;
  const telegram = new ReachTelegram({
    settings,
    secrets: { telegramToken: (person, bot) => sealed.get(`${person}/${bot}`), setTelegramToken: (person, bot, token) => { if (token) sealed.set(`${person}/${bot}`, token); else sealed.delete(`${person}/${bot}`); } },
    waiting: () => waiting,
    onReply: async (_person, text) => { replies.push(text); return { handled: true, outcome: "allowed" }; },
    language: () => "fr",
    fetch,
    schedule: () => () => {},
    log: () => {},
  });
  return { telegram, calls, replies, sealed, setUpdates: (next: unknown[]) => { updates = next; }, setWaiting: (next: boolean) => { waiting = next; } };
}

const OUT: ReachOutbound = { person: "pr_a", botId: "b1", botName: "Nimbus", code: "KM3X", kind: "approval", title: "Run a command?", line: "", confidential: false, needsKey: false, language: "fr" };

describe("Reach me by Telegram", () => {
  it("links the first chat that sends the one-time /start code, then sends there", async () => {
    const { telegram, calls, setUpdates } = setup();
    const connected = await telegram.connect("pr_a", "b1", TOKEN);
    expect(connected).toMatchObject({ ok: true, username: "my_sagax_bot" });
    const code = (connected as { link: string }).link.split("start=")[1]!;
    expect(JSON.stringify(telegram.view("pr_a", "b1"))).not.toContain(TOKEN);
    expect(telegram.channel().status("pr_a", "b1").ready).toBe(false);
    setUpdates([
      { update_id: 1, message: { chat: { id: 66, type: "private" }, text: "/start wrongcode" } },
      { update_id: 2, message: { chat: { id: 42, type: "private" }, text: `/start ${code}` } },
    ]);
    await telegram.poll();
    expect(telegram.view("pr_a", "b1")).toMatchObject({ connected: true, username: "my_sagax_bot" });
    expect(await telegram.channel().send(OUT)).toEqual({ ok: true });
    expect(calls.filter((call) => call.method === "sendMessage").at(-1)!.body.chat_id).toBe(42);
  });

  it("hands on the linked chat's replies only, and acknowledges them", async () => {
    const { telegram, replies, calls, setUpdates } = setup();
    const connected = await telegram.connect("pr_a", "b1", TOKEN) as { link: string };
    setUpdates([{ update_id: 1, message: { chat: { id: 42, type: "private" }, text: `/start ${connected.link.split("start=")[1]}` } }]);
    await telegram.poll();
    setUpdates([
      { update_id: 2, message: { chat: { id: 77, type: "private" }, text: "KM3X oui" } },
      { update_id: 3, message: { chat: { id: 42, type: "private" }, text: "KM3X oui" } },
    ]);
    await telegram.poll();
    expect(replies).toEqual(["KM3X oui"]);
    expect(calls.filter((call) => call.method === "sendMessage").at(-1)!.body).toMatchObject({ chat_id: 42, text: "Autorisé. Le bot reprend." });
  });

  it("a refused token is said plainly and nothing is kept", async () => {
    const { telegram, sealed } = setup();
    const refusing = new ReachTelegram({
      settings: createReachMeStore(dirs[0]!), secrets: { telegramToken: () => undefined, setTelegramToken: () => { throw new Error("no"); } },
      waiting: () => false, onReply: async () => ({ handled: false, outcome: "no_code" }), language: () => "en",
      fetch: (async () => new Response(JSON.stringify({ ok: false }), { status: 401 })) as unknown as typeof fetch, schedule: () => () => {},
    });
    expect(await refusing.connect("pr_a", "b1", TOKEN)).toMatchObject({ ok: false, status: 400 });
    telegram.disconnect("pr_a", "b1");
    expect(sealed.size).toBe(0);
  });
});
