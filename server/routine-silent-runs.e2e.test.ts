// Routine runs work in the background (JC 2026-10-22): "when routine runs you
// don't need to show something within the chat or the sidebar (left)...
// simply let it run in the background". Through the real server and the fake
// engine: a run that ends with nothing to report leaves the person's
// conversation exactly as it was (no card, no prompt, no unread, no bump),
// and a run with a result posts ONE message, the bot's report only. Both keep
// their whole record for Automations > Logs and Open run.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";
import { removeTempDir } from "./testing/cleanup.ts";

const PROMPT = "Run the skill finance-invoice-sweep exactly as written. Post the list of invoices without a PO, silent if 0.";
const QUIET = "The 8:40 run is the invoicing-days boost. October 22 is outside days 1-5, so this pass ends with nothing to report.\n\nNOTHING_TO_REPORT";
const REPORT = "3 invoices without a PO: #1201, #1207, #1210. I drafted the reminders.";

it("a silent run leaves the chat and sidebar untouched; a reporting run posts one message, never the prompt", async () => {
  const scratch = mkdtempSync(join(tmpdir(), "sagax-silent-routines-"));
  const fixture = await launchVerificationServer({
    ...process.env,
    FAKE_CLAUDE_REPLIES: JSON.stringify([QUIET, REPORT, REPORT, QUIET]),
    FAKE_CLAUDE_REPLY_STATE: join(scratch, "reply-index"),
  });
  const api = async (method: string, path: string, body?: unknown, status = 200) => {
    const response = await fetch(`${fixture.info.url}${path}`, {
      method, headers: { "content-type": "application/json", origin: fixture.info.url },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const value = await response.json() as any;
    expect(response.status, `${method} ${path}: ${JSON.stringify(value)}`).toBe(status);
    return value;
  };
  const control = (args: string[]) => runControlOmb([...args, "--url", fixture.info.url]);
  const runState = async (id: string) => (await api("GET", "/api/routines")).runs.find((run: any) => run.id === id);
  const messages = async (id: string) => (await api("GET", `/api/threads/${id}/messages?limit=100`)).messages as any[];
  try {
    const { bot } = await control(["new-bot", "--name", "Scout"]) as any;
    const currentBot = async () => (await api("GET", "/api/bots")).bots.find((candidate: any) => candidate.id === bot.id);
    const main = (await currentBot()).threadId as string;
    const before = await messages(main);
    const mainBefore = (await currentBot()).tasks.find((task: any) => task.threadId === main);
    const { routine } = await api("POST", "/api/routines", {
      name: "[Finance] Acme invoices without PO", prompt: PROMPT, botId: bot.id, enabled: false,
      schedule: { type: "interval", everyMinutes: 60, anchorAt: Date.now() + 3_600_000 },
    }, 201);

    // 1. Silent: nothing reaches the person's conversation.
    const { run: quiet } = await api("POST", `/api/routines/${routine.id}/run`, undefined, 201);
    await expect.poll(async () => (await runState(quiet.id))?.status, { timeout: 20_000 }).toBe("completed");
    await control(["wait", "--bot", bot.id, "--task", (await runState(quiet.id)).threadId]);
    const quietRun = await runState(quiet.id);
    expect(quietRun).toMatchObject({ quiet: true, resultsThreadId: main });
    // Automations keeps the bot's note (without the marker)...
    expect(quietRun.output).toBe(QUIET.replace("\n\nNOTHING_TO_REPORT", ""));
    // ...and Open run keeps the whole transcript: the instructions, the answer.
    const quietTranscript = await messages(quietRun.threadId);
    expect(quietTranscript.some((message) => message.role === "user" && String(message.text).includes("finance-invoice-sweep"))).toBe(true);
    expect(quietTranscript.some((message) => message.role === "bot" && String(message.text).includes("October 22 is outside days 1-5"))).toBe(true);
    // The bot was told the contract in its system prompt.
    const dump = JSON.parse(readFileSync(fixture.fixtureDumpPath, "utf8"));
    expect(JSON.stringify(dump)).toContain("end your final message with the line NOTHING_TO_REPORT on its own");
    // The chat is exactly as it was: no card, no prompt, no answer.
    expect((await messages(main)).map((message) => message.id)).toEqual(before.map((message) => message.id));
    const afterQuiet = await currentBot();
    const mainAfterQuiet = afterQuiet.tasks.find((task: any) => task.threadId === main);
    expect(mainAfterQuiet.unread).toBeFalsy();
    expect(mainAfterQuiet.updatedAt).toBe(mainBefore.updatedAt);
    // The run's own task stays hidden from the sidebar, without a dot.
    expect(afterQuiet.tasks.find((task: any) => task.threadId === quietRun.threadId)).toMatchObject({ routineRunId: quiet.id, unread: false });
    expect(afterQuiet.tasks.filter((task: any) => !task.routineRunId).map((task: any) => task.threadId)).toEqual([main]);

    // 2. A result on a routine that does NOT post results (the default):
    // still nothing reaches the conversation; it lives in Automations.
    const { run: silentReport } = await api("POST", `/api/routines/${routine.id}/run`, undefined, 201);
    await expect.poll(async () => (await runState(silentReport.id))?.status, { timeout: 20_000 }).toBe("completed");
    await control(["wait", "--bot", bot.id, "--task", (await runState(silentReport.id)).threadId]);
    const silentReportRun = await runState(silentReport.id);
    expect(silentReportRun.quiet).toBeUndefined();
    expect(silentReportRun.output).toBe(REPORT);
    expect((await messages(main)).map((message) => message.id)).toEqual(before.map((message) => message.id));
    expect((await currentBot()).tasks.find((task: any) => task.threadId === main).unread).toBeFalsy();

    // 3. Turn the routine's own "post results" on: now a result posts ONE
    // message, the bot's report, the routine named under it, never the prompt.
    await api("PATCH", `/api/routines/${routine.id}`, { postResults: true });
    const { run: reported } = await api("POST", `/api/routines/${routine.id}/run`, undefined, 201);
    await expect.poll(async () => (await runState(reported.id))?.status, { timeout: 20_000 }).toBe("completed");
    await control(["wait", "--bot", bot.id, "--task", (await runState(reported.id)).threadId]);
    const reportedRun = await runState(reported.id);
    expect(reportedRun.quiet).toBeUndefined();
    const posted = (await messages(main)).filter((message) => !before.some((old) => old.id === message.id));
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ role: "bot", kind: "routine.run", text: `${REPORT}\n\nRoutine “[Finance] Acme invoices without PO”` });
    expect(posted[0].routineRun).toMatchObject({ status: "completed", summary: REPORT, executionThreadId: reportedRun.threadId });
    expect(JSON.stringify(await messages(main))).not.toContain("finance-invoice-sweep");
    expect((await currentBot()).tasks.find((task: any) => task.threadId === main).unread).toBe(true);

    // 4. A quiet run stays silent even with postResults on, and never
    // creates a visible sub-thread row under the bot.
    const countBeforeQuiet = (await messages(main)).length;
    const { run: quietOn } = await api("POST", `/api/routines/${routine.id}/run`, undefined, 201);
    await expect.poll(async () => (await runState(quietOn.id))?.status, { timeout: 20_000 }).toBe("completed");
    const quietOnRun = await runState(quietOn.id);
    expect(quietOnRun.quiet).toBe(true);
    expect((await messages(main)).length).toBe(countBeforeQuiet);
    expect((await currentBot()).tasks.filter((task: any) => !task.routineRunId).map((task: any) => task.threadId)).toEqual([main]);

    writeFileSync(join(fixture.info.dataDir, "silent-routines.evidence.json"), JSON.stringify({ quietRun, silentReportRun, reportedRun, quietOnRun, posted }, null, 2));
  } finally {
    await fixture.close();
    await removeTempDir(scratch);
  }
}, 120_000);
