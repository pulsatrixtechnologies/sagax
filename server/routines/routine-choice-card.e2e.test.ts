// 2026-11-03, GOX (Sagax 0.8.35): Ember's run of "Projet CW #801 : temps et
// cédule" called ask_choice. The card was a passive options row in the run's
// hidden task (no requestId), the run ended Completed six seconds later, and
// JC never saw it: not in his chat, not in Approvals, not as a notification,
// not through list_pending_approvals (the member API). This is that path on a
// real isolated server: a routine run's turn calls ask_choice on the internal
// card route with its own capability, then ends.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

import { launchVerificationServer } from "../../scripts/control-omb.ts";
import { removeTempDir } from "../testing/cleanup.ts";
import { openSse } from "../testing/sse.ts";

it("a routine run's choice card reaches its person in the chat, the inbox, a notification and the member API, and holds the run until answered", async () => {
  const gates = mkdtempSync(join(tmpdir(), "omb-routine-choice-"));
  const gate = join(gates, "finish");
  const fixture = await launchVerificationServer({ FAKE_CLAUDE_MODE: "slow", FAKE_CLAUDE_SLOW_FINISH_GATE: gate });
  const { url } = fixture.info;
  const api = async (method: string, path: string, body?: unknown, expected = 200, token?: string) => {
    const response = await fetch(url + path, {
      method, headers: { "content-type": "application/json", origin: url, ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(45_000),
    });
    const result = await response.json() as any;
    expect(response.status, `${method} ${path}: ${JSON.stringify(result)}`).toBe(expected);
    return result;
  };
  const dump = () => JSON.parse(readFileSync(fixture.fixtureDumpPath, "utf8"));
  const runState = async (id: string) => (await api("GET", "/api/routines")).runs.find((run: any) => run.id === id);
  const messages = async (threadId: string) => (await api("GET", `/api/threads/${threadId}/messages?limit=100`)).messages as any[];
  const stream = await openSse(`${url}/api/events`, { origin: url });
  try {
    const bot = (await api("POST", "/api/bots", { name: "Ember fixture" }, 201)).bot;
    const { routine } = await api("POST", "/api/routines", {
      name: "Projet CW #801 : temps et cédule", prompt: "Prepare the day's batch and let the person choose it.", botId: bot.id, enabled: false,
      schedule: { type: "cron", expression: "30 18 * * 1-5", timeZone: "America/Toronto" },
    }, 201);
    const { run } = await api("POST", `/api/routines/${routine.id}/run`, undefined, 201);

    // the run's own turn is live: its capability is the one the bot's tools hold
    let token = "";
    let threadId = "";
    await expect.poll(async () => {
      const current = await runState(run.id);
      if (current?.status !== "running" || !current.threadId) return false;
      try {
        const env = dump().mcpConfig.mcpServers.agents.env;
        if (env.SAGAX_THREAD_ID !== current.threadId) return false;
        token = env.SAGAX_COMMS_TOKEN;
        threadId = current.threadId;
      } catch { return false; }
      return Boolean(token);
    }, { timeout: 20_000 }).toBe(true);

    const question = "Which batch of time entries do I write on project 801 today?";
    const options = ["Batch A: 3 entries, 6.5 h", "Batch B: 2 entries, 4 h", "Nothing today"];
    const raised = await api("POST", "/api/internal/options-card", { tool: "ask_choice", title: "Project 801 time", question, options }, 201, token);
    expect(raised).toMatchObject({ messageId: expect.any(String), waitsForPerson: true });
    writeFileSync(gate, "finish");

    // ── the run waits for its person, never Completed ──────────────────
    await expect.poll(async () => (await runState(run.id))?.status, { timeout: 15_000 }).toBe("waiting");
    const runTask = async () => (await api("GET", "/api/bots?messages=0")).bots.find((candidate: any) => candidate.id === bot.id).tasks.find((entry: any) => entry.threadId === threadId);
    await expect.poll(async () => (await runTask())?.busy ?? false, { timeout: 15_000 }).toBe(false);
    const waiting = await runState(run.id);
    expect(waiting).toMatchObject({ status: "waiting", attention: `Waiting for your answer: ${question}` });
    expect(waiting.finishedAt).toBeUndefined();

    // ── in the run's conversation: a real question card, with a requestId ──
    const card = (await messages(threadId)).find((message) => message.id === raised.messageId);
    expect(card).toMatchObject({ kind: "options", card: { requestType: "question", subtitle: question, options } });
    const requestId = card.card.requestId as string;
    expect(requestId).toMatch(/^ask-choice-/);
    expect(card.card.questionRequest.questions[0]).toMatchObject({ question, header: "Project 801 time" });

    // ── in the person's chat: the run's line says it waits, and opens the run ──
    const receipt = (await messages(bot.threadId)).find((message) => message.kind === "routine.run" && message.routineRun?.runId === run.id);
    expect(receipt?.routineRun).toMatchObject({ status: "waiting", executionThreadId: threadId, summary: `Waiting for your answer: ${question}` });

    // ── in the Approvals inbox ─────────────────────────────────────────
    const pending = (await api("GET", "/api/approvals")).pending as any[];
    expect(pending.find((entry) => entry.requestId === requestId)).toMatchObject({ kind: "question", threadId, decidable: true, botName: "Ember fixture" });

    // ── the run's task is listed for the person (what list_pending_approvals
    // walks; org-member-api.e2e.test.ts M11 reads it through the member API),
    // and is not busy: the answer starts a turn instead of queuing behind one
    expect(await runTask()).toMatchObject({ routineRunId: run.id, busy: false });

    // ── a notification the person's devices take, with its choices ─────
    await expect.poll(() => stream.frames.some((event: any) => event.kind === "notify" && event.notification?.kind === "question"
      && event.notification.threadId === threadId && event.notification.requestId === requestId), { timeout: 10_000 }).toBe(true);
    const notice = stream.frames.find((event: any) => event.kind === "notify" && event.notification?.requestId === requestId).notification;
    expect(notice.choices).toEqual(options);

    // ── the person answers; the same run goes on and completes ─────────
    const answered = await api("POST", `/api/threads/${threadId}/respond`, { requestId, behavior: "answer", message: options[0] });
    expect(answered).toMatchObject({ ok: true });
    await expect.poll(async () => (await runState(run.id))?.status, { timeout: 20_000 }).toBe("completed");
    expect((await messages(threadId)).find((message) => message.id === raised.messageId).card).toMatchObject({ answered: "answer", answeredText: options[0] });
    expect((await messages(threadId)).some((message) => message.role === "user" && message.text === options[0])).toBe(true);
    expect((await api("GET", "/api/approvals")).pending.find((entry: any) => entry.requestId === requestId)).toBeUndefined();
  } finally {
    stream.close();
    await fixture.close();
    await removeTempDir(gates);
  }
}, 300_000);
