// A card waiting in a bot-to-bot conversation (2026-10-19, owner report):
// a bot asked a teammate for work, the teammate's turn asked the person to
// approve a tool, and the conversation it waited in is never listed. The
// person saw the teammate busy, its model locked on Auto, and no card
// anywhere. Real server, scripted fake engine:
//
//   - the teammate's wire bot names that conversation (waitingApprovals),
//     with the bot that asked, so the app shows its card in the open
//     conversation; the entry leaves once the card is answered
//   - the teammate's own model still changes while that card waits: only
//     the person's selected thread holds a model change
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";

it("names a bot-to-bot conversation waiting on the person and keeps the bot's model free", async () => {
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
  const wire = async (botId: string) => ((await api("GET", "/api/bots?messages=0")).body.bots as any[]).find((bot) => bot.id === botId);
  const messages = async (threadId: string): Promise<any[]> => (await api("GET", `/api/threads/${threadId}/messages?limit=100`)).body.messages ?? [];
  try {
    const { bot: asker } = await cli("new-bot", "--name", "Asker");
    const { bot: teammate } = await cli("new-bot", "--name", "Teammate");
    // New bots start on Approve for me, which decides a read-only call itself: this test needs the person's card.
    for (const id of [asker.id, teammate.id]) await api("PATCH", `/api/bots/${id}`, { approvalMode: "ask" });
    writeFileSync(join(dataDir, "room-plan.json"), JSON.stringify({
      [asker.id]: { script: [
        { key: "ask", match: ["Ask Teammate to list the folder."], steps: [{ arguments: { bot_ids: [teammate.id], message: "LIST: list the folder." } }], reply: "Asked Teammate." },
        { key: "settled", match: ["Your downstream room requests have settled."], reply: "Teammate is done." },
      ] },
      [teammate.id]: { script: [
        { key: "list", match: ["LIST: list the folder."], approve: { tool_name: "Bash", input: { command: "ls -la" } },
          reply: "LISTED: the folder has three files.", replyIfDenied: "LISTED: not allowed." },
      ] },
    }));
    await cli("send", "--bot", asker.id, "--task", asker.activeTaskId, "--text", "Ask Teammate to list the folder.");

    // The teammate's work conversation waits on the person, and says so.
    await expect.poll(async () => (await wire(teammate.id))?.waitingApprovals?.length ?? 0, { timeout: 30_000 }).toBe(1);
    const waiting = await wire(teammate.id);
    const row = waiting.waitingApprovals[0];
    expect(row).toMatchObject({ openedByName: "Asker", kind: "work" });
    const work = (waiting.tasks as any[]).find((task) => task.threadId === row.threadId);
    expect(work).toMatchObject({ openedBy: { botId: asker.id }, activity: "waiting-on-you" });
    expect(work.threadId).not.toBe(waiting.threadId);
    const card = (await messages(row.threadId)).find((message) => message.kind === "options" && message.card?.requestId && !message.card.answered);
    expect(card, "the card is in the work conversation").toBeTruthy();
    // the asker's own wire carries none of it
    expect((await wire(asker.id)).waitingApprovals).toBeUndefined();

    // The teammate's model changes while that card waits.
    const changed = await api("PATCH", `/api/bots/${teammate.id}`, { modelSelection: { instanceId: "claude", model: "claude-opus-fake" } });
    expect(changed.status, JSON.stringify(changed.body)).toBe(200);
    expect((await wire(teammate.id)).modelSelection).toMatchObject({ instanceId: "claude", model: "claude-opus-fake" });
    expect((await wire(teammate.id)).modelSelection.auto).toBeUndefined();

    // Answered: the conversation goes back to work and leaves the list.
    // through the route the app answers with
    const answered = await api("POST", `/api/threads/${row.threadId}/respond`, { requestId: card.card.requestId, behavior: "allow" });
    expect(answered.status, JSON.stringify(answered.body)).toBe(200);
    await expect.poll(async () => (await wire(teammate.id))?.waitingApprovals, { timeout: 30_000 }).toBeUndefined();
  } finally {
    await fixture.close();
  }
}, 120_000);
