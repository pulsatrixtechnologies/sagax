// 2026-11-02, through a real server on an isolated fixture: a person's turn
// that ends on "I'll ..." is continued once with the internal note; the
// continued turn is not continued again, and a turn that ends on a question
// is never continued.
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";
import { removeTempDir } from "./testing/cleanup.ts";

it("continues an announced turn once, and never one that asks the person", async () => {
  const dir = mkdtempSync(join(tmpdir(), "omb-unfinished-"));
  const fixture = await launchVerificationServer({
    FAKE_CLAUDE_REPLIES: JSON.stringify([
      "I'll open the routine board now.",
      "I can't open pages for you from here. Open Routines in the sidebar.",
      "Which routine do you mean?",
    ]),
    FAKE_CLAUDE_REPLY_STATE: join(dir, "replies"),
  });
  const api = async (path: string) => {
    const response = await fetch(fixture.info.url + path, { headers: { origin: fixture.info.url } });
    expect(response.status).toBe(200);
    return await response.json() as any;
  };
  const control = (...args: string[]) => runControlOmb([...args, "--url", fixture.info.url]) as Promise<any>;
  try {
    const bot = (await (await fetch(fixture.info.url + "/api/bots", { method: "POST", headers: { "content-type": "application/json", origin: fixture.info.url }, body: JSON.stringify({ name: "Scout" }) })).json() as any).bot;
    const transcript = async (): Promise<any[]> => (await api(`/api/threads/${bot.threadId}/messages`)).messages;
    // the bot's words since the person first wrote (the intro greeting is before)
    const botTexts = async () => {
      const rows = await transcript();
      const first = rows.findIndex((message) => message.role === "user");
      return first < 0 ? [] : rows.slice(first).filter((message) => message.role === "bot" && message.kind === "text").map((message) => message.text);
    };

    await control("send", "--bot", bot.id, "--task", bot.threadId, "--text", "Open the routine board");
    await expect.poll(botTexts, { timeout: 30_000 }).toEqual(["I'll open the routine board now.", "I can't open pages for you from here. Open Routines in the sidebar."]);
    const prompt = JSON.stringify(JSON.parse(readFileSync(fixture.fixtureDumpPath, "utf8")).prompt ?? {});
    expect(prompt).toContain("[Sagax note, not from the person]");
    // the note is not the person's words in the conversation
    expect((await transcript()).filter((message) => message.role === "user").map((message) => message.text)).toEqual(["Open the routine board"]);
    expect((await control("wait", "--bot", bot.id, "--task", bot.threadId, "--timeout", "20")).status).toBe("settled");
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    expect(await botTexts()).toHaveLength(2);

    await control("send", "--bot", bot.id, "--task", bot.threadId, "--text", "Pause one of them");
    await expect.poll(async () => (await botTexts()).at(-1), { timeout: 30_000 }).toBe("Which routine do you mean?");
    expect((await control("wait", "--bot", bot.id, "--task", bot.threadId, "--timeout", "20")).status).toBe("settled");
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    expect(await botTexts()).toHaveLength(3);
  } finally {
    await fixture.close();
    await removeTempDir(dir);
  }
}, 120_000);
