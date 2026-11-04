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
import { launchVerificationServer, runControlOmb } from "../../scripts/control-omb.ts";

it("answers each teammate's exact approval from the human initiating chat and keeps models free", async () => {
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
    const { bot: witness } = await cli("new-bot", "--name", "Witness");
    // New bots start on Approve for me, which decides a read-only call itself: this test needs the person's card.
    for (const id of [asker.id, teammate.id, witness.id]) await api("PATCH", `/api/bots/${id}`, { approvalMode: "ask" });
    writeFileSync(join(dataDir, "room-plan.json"), JSON.stringify({
      [asker.id]: { script: [
        { key: "ask", match: ["Ask Teammate to list the folder."], steps: [{ arguments: { bot_ids: [teammate.id, witness.id], message: "LIST: list the folder." } }], reply: "Asked Teammate and Witness." },
        { key: "settled", match: ["Your downstream room requests have settled."], reply: "Teammate is done." },
      ] },
      [teammate.id]: { script: [
        { key: "list", match: ["LIST: list the folder."], approve: { tool_name: "Bash", input: { command: "ls -la" } },
          reply: "LISTED: the folder has three files.", replyIfDenied: "LISTED: not allowed." },
      ] },
      [witness.id]: { script: [
        { key: "list", match: ["LIST: list the folder."], approve: { tool_name: "Bash", input: { command: "ls -la witness" } },
          reply: "WITNESS: allowed.", replyIfDenied: "WITNESS: not allowed." },
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
    // The root chat carries a linked, actionable view. The two source calls
    // remain distinct, and the global inbox lists each decision only once.
    expect((await wire(asker.id)).waitingApprovals).toBeUndefined();
    const rootThread = (await wire(asker.id)).threadId;
    await expect.poll(async () => (await messages(rootThread)).filter(message => message.card?.approvalOrigin && !message.card.answered).length, { timeout: 30_000 }).toBe(2);
    const mirror = (await messages(rootThread)).find(message => message.card?.approvalOrigin?.threadId === row.threadId);
    expect(mirror?.card).toMatchObject({ approvalOrigin: { threadId: row.threadId, messageId: card.id, requestId: card.card.requestId } });
    const other = (await messages(rootThread)).find(message => message.card?.approvalOrigin && message.id !== mirror.id);
    expect((await api("GET", "/api/approvals")).body.pending).toHaveLength(2);

    // The teammate's model changes while that card waits.
    const changed = await api("PATCH", `/api/bots/${teammate.id}`, { modelSelection: { instanceId: "claude", model: "claude-opus-fake" } });
    expect(changed.status, JSON.stringify(changed.body)).toBe(200);
    expect((await wire(teammate.id)).modelSelection).toMatchObject({ instanceId: "claude", model: "claude-opus-fake" });
    expect((await wire(teammate.id)).modelSelection.auto).toBeUndefined();

    // Answered: the conversation goes back to work and leaves the list.
    // through the route the app answers with
    const answered = await api("POST", `/api/threads/${rootThread}/respond`, { requestId: mirror.card.requestId, behavior: "allow" });
    expect(answered.status, JSON.stringify(answered.body)).toBe(200);
    await expect.poll(async () => (await wire(teammate.id))?.waitingApprovals, { timeout: 30_000 }).toBeUndefined();
    await expect.poll(async () => (await messages(rootThread)).find(message => message.id === mirror.id)?.card?.answered).toBe("allow");
    expect((await messages(other.card.approvalOrigin.threadId)).find(message => message.card?.requestId === other.card.approvalOrigin.requestId)?.card?.answered).toBeUndefined();
    // Both HTTP response forms preserve the execution thread's authority.
    const denied = await api("POST", `/api/bots/${asker.id}/respond`, { threadId: rootThread, requestId: other.card.requestId, behavior: "deny" });
    expect(denied.status, JSON.stringify(denied.body)).toBe(200);
    await expect.poll(async () => (await messages(rootThread)).find(message => message.id === other.id)?.card?.answered).toBe("deny");
    await expect.poll(async () => (await messages(other.card.approvalOrigin.threadId)).some(message => message.text?.includes("WITNESS: not allowed.")), { timeout: 30_000 }).toBe(true);
    const replay = await api("POST", `/api/threads/${rootThread}/respond`, { requestId: mirror.card.requestId, behavior: "allow" });
    expect(replay.status).toBe(409);
    const history = (await api("GET", "/api/approvals?history=1")).body.history as any[];
    expect(history.filter(entry => entry.requestId === mirror.card.approvalOrigin.requestId && entry.decision === "user-approved")).toHaveLength(1);
    expect(history.filter(entry => entry.requestId === other.card.approvalOrigin.requestId && entry.decision === "user-denied")).toHaveLength(1);
    writeFileSync(`${fixture.info.logPath}.origin-approvals.json`, JSON.stringify({
      rootThread,
      allowed: { sourceThread: row.threadId, requestId: mirror.card.approvalOrigin.requestId, viewRequestId: mirror.card.requestId, status: answered.status },
      denied: { sourceThread: other.card.approvalOrigin.threadId, requestId: other.card.approvalOrigin.requestId, viewRequestId: other.card.requestId, status: denied.status },
      replayStatus: replay.status,
      history: history.filter(entry => [mirror.card.approvalOrigin.requestId, other.card.approvalOrigin.requestId].includes(entry.requestId)),
    }, null, 2));
  } finally {
    await fixture.close();
  }
}, 120_000);
