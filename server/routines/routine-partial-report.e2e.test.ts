// #3152 (QA pass 7, prod 0.8.76, run 2cdbe6e9): a routine run that ended
// "completed with problems" (the bot's RUN_STATUS partial) with four GO
// waiting on the person never reached the bot's chat; it stayed in the run's
// own thread. Through the real server and the fake engine: such a run, Run
// now or scheduled, with the routine's "post results" off, posts its card in
// the person's one conversation, without the raw RUN_STATUS marker, and
// its report reads as prose, never a markdown table.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

import { launchVerificationServer, runControlOmb } from "../../scripts/control-omb.ts";
import { removeTempDir } from "../testing/cleanup.ts";

const PARTIAL = [
  "RUN_STATUS: partial: lecture des droits d'outils refusée (session personne absente).",
  "",
  "| Point | État | GO |",
  "|---|---|---|",
  "| Sagax 0.8.76 | à surveiller | GO requis |",
  "| Jeton GitHub | refusé | GO requis |",
  "",
  "Quatre GO attendent la personne : surveiller Sagax 0.8.76, renouveler le jeton GitHub, retirer iMessage et REA, garder Flow 0.22.0.",
].join("\n");

it("a run completed with problems posts in the bot's chat, Run now and scheduled, without the raw marker or a table", async () => {
  const scratch = mkdtempSync(join(tmpdir(), "sagax-partial-routines-"));
  const fixture = await launchVerificationServer({
    ...process.env,
    FAKE_CLAUDE_REPLIES: JSON.stringify([PARTIAL, PARTIAL]),
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
    const { bot } = await control(["new-bot", "--name", "Reviewer"]) as any;
    const main = (await api("GET", "/api/bots")).bots.find((candidate: any) => candidate.id === bot.id).threadId as string;
    const { routine } = await api("POST", "/api/routines", {
      name: "Skills, plugins and connectors review", prompt: "Review skills, plugins and connectors.", botId: bot.id, enabled: false,
      schedule: { type: "interval", everyMinutes: 60, anchorAt: Date.now() + 3_600_000 },
    }, 201);
    const settle = async (runId: string) => {
      await expect.poll(async () => (await runState(runId))?.status, { timeout: 30_000 }).toBe("completed");
      return runState(runId);
    };
    const cardOf = async (runId: string) => (await messages(main)).find((message) => message.kind === "routine.run" && message.routineRun?.runId === runId);
    const checkCard = async (run: any) => {
      expect(run.problems).toContain("lecture des droits d'outils refusée");
      await expect.poll(async () => Boolean(await cardOf(run.id)), { timeout: 10_000 }).toBe(true);
      const card = await cardOf(run.id);
      const shown = `${card.text}\n${card.routineRun.summary ?? ""}\n${card.routineRun.report ?? ""}`;
      expect(shown).not.toMatch(/RUN[_ ]STATUS/);
      expect(shown).not.toMatch(/^\s*\|.*\|\s*$/m);
      expect(shown).toContain("Quatre GO attendent la personne");
      expect(shown).toContain("Sagax 0.8.76");
      // the run's own record keeps no raw marker either
      expect(String(run.output ?? "")).not.toMatch(/RUN[_ ]STATUS/);
    };

    // 1. Run now by the person, "post results" off.
    const started = await api("POST", `/api/routines/${routine.id}/run`, {}, 201);
    const runNow = await settle((started.run ?? started).id);
    await checkCard(runNow);

    // 2. Scheduled, "post results" off.
    const previous = new Set((await api("GET", "/api/routines")).runs.map((run: any) => run.id));
    const at = Date.now() + 1_000;
    await api("PATCH", `/api/routines/${routine.id}`, { enabled: true, schedule: { type: "once", at } });
    let scheduledId = "";
    await expect.poll(async () => {
      scheduledId = (await api("GET", "/api/routines")).runs.find((candidate: any) => candidate.routineId === routine.id && !previous.has(candidate.id))?.id ?? "";
      return scheduledId;
    }, { timeout: 20_000 }).not.toBe("");
    const scheduled = await settle(scheduledId);
    await checkCard(scheduled);
    expect((await api("GET", "/api/bots")).bots.find((candidate: any) => candidate.id === bot.id).tasks.find((task: any) => task.threadId === main).unread).toBe(true);
  } finally {
    await fixture.close();
    await removeTempDir(scratch);
  }
}, 120_000);
