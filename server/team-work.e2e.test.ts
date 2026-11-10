// #3461 (lot 1 of #3451): an orchestrator bot's work as its panel reads it,
// on an isolated server with scripted engines. A bot hands work to another;
// GET /api/bots/:id/team-work lists the step working with its last action,
// then done with its duration; the `team.work` frame reaches the stream and
// is not sent per tool call; the person's line in the step's thread leaves
// exactly one quiet row in the orchestrator's conversation, and the
// orchestrator's next turn reads it once.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";
import { request } from "../scripts/mcp-server.ts";
import { openSse } from "./testing/sse.ts";

it("lists a hand-over as a step with its live state, signals it, and tells the orchestrator what the person wrote", async () => {
  const session = await launchVerificationServer(process.env, undefined, undefined, undefined, undefined, { scripted: true }, []);
  const cli = (...args: string[]) => runControlOmb(args, { env: { SAGAX_URL: session.info.url } }) as Promise<any>;
  const api = (path: string, body?: unknown, method = "POST") =>
    request(path, body === undefined ? {} : { method, body: JSON.stringify(body) }, session.info.url) as Promise<any>;
  const stream = await openSse(`${session.info.url}/api/events`);
  try {
    const orc = (await cli("new-bot", "--name", "Orca", "--section", "Code")).bot;
    const dev = (await cli("new-bot", "--name", "Devon", "--section", "Code")).bot;
    const planPath = join(session.info.dataDir, "room-plan.json");
    const gate = join(session.info.dataDir, "step.gate");
    writeFileSync(planPath, JSON.stringify({
      [orc.id]: { script: [
        { key: "hand", match: ["Ship the login fix"], reply: "Handed to Devon",
          steps: [{ tool: "send_to_bot", arguments: { bot_id: dev.id, title: "Fix the login", message: "Fix the login form and open a pull request." } }] },
        { key: "next", match: ["What is next"], reply: "Next is the review", expectContextIncludes: ["[Note from the app]", "Use the main branch"] },
        { key: "after", match: ["And after that"], reply: "Then the release" },
      ] },
      [dev.id]: { script: [
        { key: "step", match: ["Fix the login form"], gateFile: gate, reply: "Wrote the fix and opened the pull request." },
        { key: "person", match: ["Use the main branch"], reply: "Using main." },
      ] },
    }));
    const work = async () => api(`/api/bots/${orc.id}/team-work?since=${Date.now() - 3_600_000}`, undefined, "GET");

    await cli("send", "--bot", orc.id, "--task", orc.activeTaskId, "--text", "Ship the login fix.");
    // the step is listed while it runs, with the time of its last action
    // the step's thread runs in a repository folder on the server: code work
    const stepTask = async () => ((await api("/api/bots", undefined, "GET")).bots.find((bot: any) => bot.id === dev.id)?.tasks ?? [])
      .find((task: any) => task.openedBy?.botId === orc.id && task.cwd);
    await expect.poll(stepTask, { timeout: 30_000 }).toBeTruthy();
    mkdirSync(join((await stepTask()).cwd, ".git"), { recursive: true });
    await expect.poll(async () => (await work()).live?.[0]?.steps?.[0]?.status, { timeout: 30_000 }).toBe("running");
    const running = await work();
    expect(running.live).toHaveLength(1);
    expect(running.live[0]).toMatchObject({ name: "Fix the login", done: 0, total: 1, current: { botId: dev.id } });
    expect(running.live[0].live.state).toBe("working");
    expect(typeof running.live[0].live.lastActionAt).toBe("number");
    expect(running.team).toEqual([expect.objectContaining({ botId: dev.id, name: "Devon", live: expect.objectContaining({ state: "working" }) })]);
    const stepThread = running.live[0].steps[0].threadId as string;
    expect(stepThread).toBeTruthy();
    // the frame reached the stream, ids only
    const frame = await stream.until((candidate) => candidate.kind === "team.work" && candidate.botId === orc.id, 15_000);
    expect(Object.keys(frame).sort()).toEqual(expect.arrayContaining(["botId", "kind"]));

    writeFileSync(gate, "go");
    await expect.poll(async () => (await work()).doneToday?.length ?? 0, { timeout: 30_000 }).toBe(1);
    const done = await work();
    expect(done.live).toEqual([]);
    expect(done.doneToday[0]).toMatchObject({ name: "Fix the login", done: 1, total: 1, finished: true });
    expect(done.doneToday[0].durationMs).toBeGreaterThan(0);
    expect(done.doneToday[0].steps[0]).toMatchObject({ status: "completed", threadId: stepThread });
    // never per tool call: a handful of frames for the whole hand-over
    const frames = stream.frames.filter((candidate) => candidate.kind === "team.work");
    const runtimeEvents = stream.frames.filter((candidate) => candidate.kind === "runtime" && candidate.event?.threadId === stepThread);
    expect(frames.length).toBeLessThanOrEqual(4);
    expect(frames.length).toBeLessThan(Math.max(runtimeEvents.length, 5));

    // the person writes to the team bot in the step's thread
    await cli("send", "--bot", dev.id, "--task", stepThread, "--text", "Use the main branch.");
    const messages = async (threadId: string) => (await api(`/api/threads/${threadId}/messages`, undefined, "GET")).messages as any[];
    await expect.poll(async () => (await messages(orc.activeTaskId)).filter((message) => message.teamNote).length, { timeout: 30_000 }).toBe(1);
    const note = (await messages(orc.activeTaskId)).find((message) => message.teamNote);
    expect(note).toMatchObject({ kind: "text", teamNote: { botId: dev.id, botName: "Devon", threadId: stepThread, title: "Fix the login", text: "Use the main branch.", count: 1 } });
    // the team bot's answer stays in the step's chat
    await expect.poll(async () => (await messages(stepThread)).some((message) => message.text === "Using main."), { timeout: 30_000 }).toBe(true);
    expect((await messages(orc.activeTaskId)).some((message) => message.text === "Using main.")).toBe(false);
    // no turn of the orchestrator was started for it
    const evidence = () => existsSync(`${planPath}.evidence.jsonl`)
      ? readFileSync(`${planPath}.evidence.jsonl`, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];
    expect(evidence().filter((turn) => turn.botId === orc.id)).toHaveLength(1);

    // its next turn reads the note (the plan checks it), the one after does not again
    await cli("send", "--bot", orc.id, "--task", orc.activeTaskId, "--text", "What is next?");
    await expect.poll(async () => (await messages(orc.activeTaskId)).some((message) => message.text === "Next is the review"), { timeout: 30_000 }).toBe(true);
    await cli("send", "--bot", orc.id, "--task", orc.activeTaskId, "--text", "And after that?");
    await expect.poll(async () => (await messages(orc.activeTaskId)).some((message) => message.text === "Then the release"), { timeout: 30_000 }).toBe(true);
    const told = (turn: any) => JSON.stringify(turn.prompt ?? "");
    const orcTurns = evidence().filter((turn) => turn.botId === orc.id);
    expect(orcTurns).toHaveLength(3);
    expect(orcTurns.filter((turn) => told(turn).includes("[Note from the app]"))).toHaveLength(1);
  } finally {
    stream.close();
    await session.close();
  }
}, 120_000);
