// A bot's main thread is the open thread a person last wrote in
// (server/main-thread.ts). The stamp it reads, askedAt, comes from a
// person's own line only: work that merely lands in a thread (a routine, a
// webhook, a thread the bot opened, a teammate's hand-off or results, a
// team incident, a line relayed from Slack) never moves it. Clients get the
// answer (WireBot.mainThreadId), never the stamp. Real server, scripted
// fake engine.
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";

/** An isolated server on the scripted fake engine, and what these tests read from it. */
async function launch() {
  const fixture = await launchVerificationServer(process.env, undefined, undefined, undefined, undefined, { scripted: true });
  const { url, dataDir } = fixture.info;
  const api = async (method: string, path: string, body?: unknown, status = 200) => {
    const response = await fetch(`${url}${path}`, {
      method, headers: { "content-type": "application/json", origin: url },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const value = await response.json() as any;
    expect(response.status, `${method} ${path}: ${JSON.stringify(value)}`).toBe(status);
    return value;
  };
  const cli = (...args: string[]) => runControlOmb([...args, "--url", url]) as Promise<any>;
  const wire = async (botId: string) => (await api("GET", "/api/bots")).bots.find((bot: any) => bot.id === botId);
  const tasks = async (botId: string) => (await wire(botId)).tasks as any[];
  /** The stamps as the server keeps them, written as each one is made. */
  const stamps = (botId: string) => Object.fromEntries((JSON.parse(readFileSync(join(dataDir, "bots.json"), "utf8")) as any[])
    .find((bot) => bot.id === botId).tasks.filter((task: any) => task.askedAt !== undefined).map((task: any) => [task.threadId, task.askedAt]));
  const thread = async (botId: string, title: string) => {
    await expect.poll(async () => (await tasks(botId)).some((task) => task.title === title), { timeout: 20_000 }).toBe(true);
    return (await tasks(botId)).find((task) => task.title === title);
  };
  const idle = (botId: string) => expect.poll(async () => (await tasks(botId)).some((task) => task.busy), { timeout: 20_000 }).toBe(false);
  const said = async (threadId: string) => ((await api("GET", `/api/threads/${threadId}/messages?limit=50`)).messages as any[])
    .map((message) => message.peerAsk ? `@${message.peerAsk.name}: ${message.text}` : message.relayed ? `relayed: ${message.text}` : message.text);
  /** The scripted turn ran there, and its bot is free for the next one. */
  const replied = async (botId: string, threadId: string, text: string) => {
    await expect.poll(() => said(threadId), { timeout: 20_000 }).toContain(text);
    await idle(botId);
  };
  const finished = async (find: (run: any) => boolean) => {
    await expect.poll(async () => (await api("GET", "/api/routines")).runs.find(find)?.status, { timeout: 20_000 }).toBe("completed");
    return (await api("GET", "/api/routines")).runs.find(find).threadId as string;
  };
  return { fixture, url, dataDir, api, cli, wire, tasks, stamps, thread, idle, said, replied, finished };
}

it("stamps askedAt where a person writes, never for a routine, a webhook, start_thread, a teammate's hand-off or a Slack relay", async () => {
  const { fixture, dataDir, api, cli, wire, stamps, thread, idle, said, replied, finished } = await launch();
  try {
    // One turn at a time per bot, and each step settles before the next, so
    // every turn meets its own scripted entry.
    await api("PUT", "/api/config", { threads: { maxConcurrentPerBot: 1 } });
    const { bot } = await cli("new-bot", "--name", "Asker");
    const { bot: teammate } = await cli("new-bot", "--name", "Teammate");
    writeFileSync(join(dataDir, "room-plan.json"), JSON.stringify({
      [bot.id]: { turns: [
        { steps: [{ tool: "start_thread", arguments: { title: "Side job", message: "Check the side job." } }], reply: "Opened a side job." },
        { reply: "Side job checked." },
        { reply: "Relayed line handled." },
        { reply: "Routine report." },
        { reply: "Webhook handled." },
        { reply: "Hand-off done." },
      ] },
      [teammate.id]: { turns: [
        { steps: [{ arguments: { bot_ids: [bot.id], message: "Take this over.", thread: "new", reply: "none" } }], reply: "Handed it over." },
      ] },
    }));
    const first = bot.activeTaskId as string;
    await cli("send", "--bot", bot.id, "--task", first, "--text", "Open a side job.");
    const side = await thread(bot.id, "Side job");
    await replied(bot.id, side.threadId, "Side job checked.");
    const asked = stamps(bot.id);
    expect(asked).toEqual({ [first]: expect.any(Number) });
    expect(side.openedBy).toMatchObject({ botId: bot.id });

    // Slack's worker relays a person's line through the guarded route.
    const { task: relayed } = await api("POST", `/api/bots/${bot.id}/tasks`, { title: "From Slack" }, 201);
    // A guarded send needs the thread in Ask exactly; Sagax starts a thread in Approve for me.
    await api("PATCH", `/api/bots/${bot.id}/tasks/${relayed.threadId}`, { approvalMode: "ask" });
    await api("POST", `/api/bots/${bot.id}/messages/guarded`, {
      threadId: relayed.threadId, sendId: randomUUID(), text: "Sent from Slack.", expectedActiveLeafId: null,
    }, 202);
    await replied(bot.id, relayed.threadId, "Relayed line handled.");
    expect(await said(relayed.threadId)).toContain("relayed: Sent from Slack.");

    const { routine } = await api("POST", "/api/routines", {
      name: "Morning report", prompt: "Report this run's state.", botId: bot.id, enabled: false,
      schedule: { type: "interval", everyMinutes: 60, anchorAt: Date.now() + 3_600_000 },
    }, 201);
    const { run } = await api("POST", `/api/routines/${routine.id}/run`, undefined, 201);
    const routineThread = await finished((candidate) => candidate.id === run.id);
    await replied(bot.id, routineThread, "Routine report.");
    // It reported into the one thread a person wrote in.
    expect(run.resultsThreadId).toBe(first);

    const hook = await api("POST", "/api/webhooks", { name: "Build", prompt: "Handle the build event.", botId: bot.id, runOn: "maus" }, 201);
    const delivered = await fetch(hook.credential.endpointUrl, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "main-thread-hook", authorization: `Bearer ${hook.credential.token}` },
      body: "{}",
    });
    expect(delivered.status).toBe(202);
    const webhookThread = await finished((candidate) => candidate.webhookId === hook.webhook.id);
    await replied(bot.id, webhookThread, "Webhook handled.");

    await cli("send", "--bot", teammate.id, "--task", teammate.activeTaskId, "--text", "Hand this to Asker.");
    // A thread opened with coordinate_bots is titled by its message.
    const handoff = await thread(bot.id, "Take this over.");
    await replied(bot.id, handoff.threadId, "Hand-off done.");
    await idle(teammate.id);
    // The hand-off (coordinate_bots with thread "new"
    // and reply "none") is an assignment on the job runtime: its request line
    // in the opened thread is the teammate's, never the person's.
    const handed = (await api("GET", `/api/threads/${handoff.threadId}/messages?limit=50`)).messages as any[];
    expect(handed.some((message) => message.from?.botId === teammate.id && message.roomRequest?.phase === "request" && String(message.text).includes("Take this over."))).toBe(true);
    expect(handed.filter((message) => message.role === "user")).toEqual([]);
    expect(handoff.openedBy).toMatchObject({ botId: teammate.id });

    // Nothing since the person's one line stamped anything: not the side
    // job, the Slack thread, the routine's or webhook's run, or the hand-off.
    expect(stamps(bot.id)).toEqual(asked);
    const after = await wire(bot.id);
    expect(after.mainThreadId).toBe(first);
    expect(JSON.stringify(after)).not.toContain("askedAt");
  } finally {
    await fixture.close();
  }
}, 120_000);

// With threads hidden a person sees a bot's main thread, and a sibling only
// while it has news for them. A teammate's work, its results and a team
// incident each land in the conversation they belong to and move no main
// thread; the results and the incident's report mark theirs unread.
it("moves no main thread for a teammate's work or results or a team incident; results and incidents are news where they land", async () => {
  const { fixture, dataDir, api, cli, wire, tasks, stamps, thread, idle, said, replied } = await launch();
  try {
    await api("PUT", "/api/config", { threads: { maxConcurrentPerBot: 1 } });
    const asker = (await cli("new-bot", "--name", "Asker", "--section", "Ops")).bot;
    const teammate = (await cli("new-bot", "--name", "Teammate", "--section", "Ops")).bot;
    const chief = (await cli("new-bot", "--name", "Chief", "--section", "Ops")).bot;
    await api("PATCH", `/api/bots/${chief.id}`, { chiefOfStaff: true });
    writeFileSync(join(dataDir, "room-plan.json"), JSON.stringify({
      [asker.id]: { script: [
        { key: "open", match: ["Open a side job that asks Teammate."],
          steps: [{ tool: "start_thread", arguments: { title: "Side job", message: "Ask Teammate to check the books." } }], reply: "Opened a side job." },
        { key: "ask", match: ["Ask Teammate to check the books."], steps: [{ arguments: { bot_ids: [teammate.id], message: "BOOKS: check the books." } }], reply: "Asked Teammate." },
        { key: "review", match: ["Your downstream room requests have settled."], reply: "Side job done: the books balance." },
      ] },
      [teammate.id]: { script: [
        { key: "books", match: ["BOOKS: check the books."], reply: "The books balance." },
        { key: "crash", match: ["Reconcile the invoices."], fail: true },
      ] },
      [chief.id]: { script: [{ key: "incident", match: ["Incident report"], reply: "Incident noted." }] },
    }));

    // The person asks once, in the Asker's first thread. The side job it
    // opens asks Teammate, and resumes with Teammate's results.
    await cli("send", "--bot", asker.id, "--task", asker.activeTaskId, "--text", "Open a side job that asks Teammate.");
    const side = await thread(asker.id, "Side job");
    await replied(asker.id, side.threadId, "Side job done: the books balance.");
    const work = (await tasks(teammate.id)).find((task) => task.openedBy?.kind === "work");
    expect(await said(work.threadId)).toContain("The books balance.");
    await idle(teammate.id);

    // The person's own request to Teammate breaks; the Chief hears of it.
    await cli("send", "--bot", teammate.id, "--task", teammate.activeTaskId, "--text", "Reconcile the invoices.");
    const incidents = await thread(chief.id, "Team incidents");
    await replied(chief.id, incidents.threadId, "Incident noted.");

    // Each main thread is where its person wrote, or the selection where nobody has.
    expect(Object.keys(stamps(asker.id))).toEqual([asker.activeTaskId]);
    expect(Object.keys(stamps(teammate.id))).toEqual([teammate.activeTaskId]);
    expect(stamps(chief.id)).toEqual({});
    expect((await wire(asker.id)).mainThreadId).toBe(asker.activeTaskId);
    expect((await wire(teammate.id)).mainThreadId).toBe(teammate.activeTaskId);
    expect((await wire(chief.id)).mainThreadId).toBe(chief.activeTaskId);
    // The side job's results and the incident's report are news in their own
    // threads, so an activity row reaches them while threads are hidden.
    expect((await tasks(asker.id)).find((task) => task.threadId === side.threadId).unread).toBe(true);
    expect((await tasks(chief.id)).find((task) => task.threadId === incidents.threadId).unread).toBe(true);
  } finally {
    await fixture.close();
  }
}, 120_000);

// Two kinds of news used to land with no unread mark, out of reach with
// threads hidden: a person's own job's answer after its teammates report
// (read during the review, the answer arrived silently), and a
// delivery:"post" webhook's post in its "Updates" thread.
it("marks a job's review answer and a webhook post unread where they land", async () => {
  const { fixture, dataDir, api, cli, tasks, replied } = await launch();
  try {
    const asker = (await cli("new-bot", "--name", "Asker", "--section", "Ops")).bot;
    const teammate = (await cli("new-bot", "--name", "Teammate", "--section", "Ops")).bot;
    const gate = join(dataDir, "review.gate");
    writeFileSync(join(dataDir, "room-plan.json"), JSON.stringify({
      [asker.id]: { script: [
        { key: "ask", match: ["Ask Teammate to check the books."], steps: [{ arguments: { bot_ids: [teammate.id], message: "BOOKS: check the books." } }], reply: "Asked Teammate." },
        { key: "review", match: ["Your downstream room requests have settled."], gateFile: gate, reply: "Reviewed: the books balance." },
      ] },
      [teammate.id]: { script: [{ key: "books", match: ["BOOKS: check the books."], reply: "The books balance." }] },
    }));
    const unread = async (botId: string, threadId: string) => (await tasks(botId)).find((task) => task.threadId === threadId)?.unread;
    await cli("send", "--bot", asker.id, "--task", asker.activeTaskId, "--text", "Ask Teammate to check the books.");
    // The review is running when the person reads the thread.
    await expect.poll(async () => ((await api("GET", `/api/threads/${asker.activeTaskId}/messages?limit=50`)).messages as any[])
      .some((message) => message.tool?.name?.startsWith("Resumed with Teammate results")), { timeout: 20_000 }).toBe(true);
    await api("POST", `/api/bots/${asker.id}/read`, { threadId: asker.activeTaskId });
    expect(await unread(asker.id, asker.activeTaskId)).toBe(false);
    writeFileSync(gate, "open");
    await replied(asker.id, asker.activeTaskId, "Reviewed: the books balance.");
    expect(await unread(asker.id, asker.activeTaskId)).toBe(true);

    const hook = await api("POST", "/api/webhooks", { name: "Deploys", prompt: "", botId: asker.id, delivery: "post" }, 201);
    const delivered = await fetch(hook.credential.endpointUrl, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "deploy-finished", authorization: `Bearer ${hook.credential.token}` },
      body: JSON.stringify({ text: "Deploy finished." }),
    });
    expect(delivered.ok).toBe(true);
    await expect.poll(async () => (await tasks(asker.id)).find((task) => task.title === "Updates")?.unread, { timeout: 20_000 }).toBe(true);
  } finally {
    await fixture.close();
  }
}, 120_000);
