// A bot's allowed recipients (parité Grok Bot X3, JC 2026-10-21: « hors
// liste = carte, dans la liste = part sans carte »). Real server, scripted
// fake engine:
//
//   - the bot PATCH keeps a normalized list and refuses an entry that is
//     not a recipient
//   - an email whose every recipient is listed goes with no card
//   - an email with one recipient off the list keeps its card
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";

it("sends to listed recipients with no card and asks for anyone else", async () => {
  const fixture = await launchVerificationServer(process.env, undefined, undefined, undefined, undefined, { scripted: true });
  const { url, dataDir } = fixture.info;
  const api = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${url}${path}`, {
      method, headers: { "content-type": "application/json", origin: url },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json().catch(() => ({})) as any };
  };
  const cli = (...args: string[]) => runControlOmb([...args, "--url", url]) as Promise<any>;
  const messages = async (threadId: string): Promise<any[]> => (await api("GET", `/api/threads/${threadId}/messages?limit=100`)).body.messages ?? [];
  const send = { tool_name: "mcp__composio__GMAIL_SEND_EMAIL" };
  try {
    const { bot } = await cli("new-bot", "--name", "Mailer");
    await api("PATCH", `/api/bots/${bot.id}`, { approvalMode: "ask" });
    const threadId: string = bot.activeTaskId;

    expect((await api("PATCH", `/api/bots/${bot.id}`, { allowedRecipients: ["not a recipient"] })).status).toBe(400);
    const saved = await api("PATCH", `/api/bots/${bot.id}`, { allowedRecipients: ["Ana@Example.com", "(514) 555-1234"] });
    expect(saved.status).toBe(200);
    expect(saved.body.bot.allowedRecipients).toEqual(["email:ana@example.com", "phone:+15145551234"]);

    writeFileSync(join(dataDir, "room-plan.json"), JSON.stringify({
      [bot.id]: { script: [
        { key: "listed", match: ["MAIL ANA"], approve: { ...send, input: { recipient_email: "ana@example.com", subject: "Hi", body: "x" } },
          reply: "SENT TO ANA", replyIfDenied: "NOT SENT" },
        { key: "unlisted", match: ["MAIL EVE"], approve: { ...send, input: { recipient_email: "ana@example.com", cc: ["eve@example.com"], subject: "Hi", body: "x" } },
          reply: "SENT TO EVE", replyIfDenied: "NOT SENT TO EVE" },
      ] },
    }));

    await cli("send", "--bot", bot.id, "--task", bot.activeTaskId, "--text", "MAIL ANA");
    await expect.poll(async () => (await messages(threadId)).some((m) => m.text === "SENT TO ANA"), { timeout: 30_000 }).toBe(true);
    expect((await messages(threadId)).some((m) => m.kind === "options" && m.card?.requestId)).toBe(false);

    await cli("send", "--bot", bot.id, "--task", bot.activeTaskId, "--text", "MAIL EVE");
    await expect.poll(async () => (await messages(threadId)).some((m) => m.kind === "options" && m.card?.requestId && !m.card.answered), { timeout: 30_000 }).toBe(true);
    expect((await messages(threadId)).some((m) => m.text === "SENT TO EVE")).toBe(false);
  } finally {
    await fixture.close();
  }
}, 120_000);
