import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  TEAM_SILENT_MS,
  TEAM_WORK_FRAME,
  TEAM_WORK_STALE_MS,
  buildTeamWork,
  strongestLive,
  teamLive,
  teamWorkFrameAllowed,
  teamWorkClearSteps,
  teamWorkName,
  teamWorkSettled,
  type TeamLive,
  type TeamStepStatus,
  type TeamOpenTurn,
  type TeamWorkInput,
} from "./team-work.ts";

const vectors = JSON.parse(readFileSync(new URL("./team-work.vectors.json", import.meta.url), "utf8")) as {
  live: Array<{ name: string; input: { status?: TeamStepStatus; turn?: TeamOpenTurn }; now: number; expect: TeamLive }>;
  build: Array<{ name: string; input: TeamWorkInput; expect: { live?: unknown[]; doneToday?: unknown[]; team?: string[] } }>;
};

describe("team live state (shared vectors, also run by the desktop and the phone)", () => {
  for (const item of vectors.live) {
    it(item.name, () => {
      expect(teamLive(item.input, item.now)).toEqual(item.expect);
    });
  }

  it("silent is three minutes, one constant", () => {
    expect(TEAM_SILENT_MS).toBe(180_000);
  });

  it("the strongest state wins: working, then silent, then waiting, then idle", () => {
    const working: TeamLive = { state: "working", lastActionAt: 5 };
    const newer: TeamLive = { state: "working", lastActionAt: 9 };
    const silent: TeamLive = { state: "silent", lastActionAt: 1, silentMs: 200_000 };
    const waiting: TeamLive = { state: "waiting", wait: "start" };
    expect(strongestLive([waiting, silent, working, newer])).toBe(newer);
    expect(strongestLive([waiting, silent])).toBe(silent);
    expect(strongestLive([waiting])).toBe(waiting);
    expect(strongestLive([])).toEqual({ state: "idle" });
  });
});

describe("team work read model (shared vectors)", () => {
  for (const item of vectors.build) {
    it(item.name, () => {
      const work = buildTeamWork(item.input);
      if (item.expect.live) expect(work.live).toMatchObject(item.expect.live);
      if (item.expect.live) expect(work.live).toHaveLength(item.expect.live.length);
      if (item.expect.doneToday) expect(work.doneToday).toMatchObject(item.expect.doneToday);
      if (item.expect.doneToday) expect(work.doneToday).toHaveLength(item.expect.doneToday.length);
      if (item.expect.team) expect(work.team.map((bot) => bot.botId)).toEqual(item.expect.team);
    });
  }

  it("names a team bot only when the server gave its name, and opens its strongest step", () => {
    const work = buildTeamWork({
      orchestratorId: "orc", now: 1_000_000, since: 0,
      names: new Map([["dev", { name: "Dev", title: "Developer" }]]),
      steps: [
        { id: "a", botId: "dev", requesterBotId: "orc", threadId: "ta", title: "Old", mode: "work", status: "completed", createdAt: 0, finishedAt: 10, coding: true },
        { id: "b", botId: "dev", requesterBotId: "orc", threadId: "tb", title: "New", mode: "work", status: "running", createdAt: 20, startedAt: 20,
          turn: { startedAt: 20, lastActionAt: 999_000 }, coding: true },
        { id: "c", botId: "gone", requesterBotId: "orc", title: "Hidden bot", mode: "work", status: "queued", createdAt: 30, coding: true },
      ],
    });
    expect(work.team.find((bot) => bot.botId === "dev")).toMatchObject({ name: "Dev", title: "Developer", live: { state: "working" }, stepId: "b", threadId: "tb" });
    const gone = work.team.find((bot) => bot.botId === "gone")!;
    expect(gone.name).toBeUndefined();
    expect(gone.threadId).toBeUndefined();
  });

  it("a team bot's other open turns raise its state", () => {
    const work = buildTeamWork({
      orchestratorId: "orc", now: 1_000_000, since: 0,
      openTurns: new Map([["dev", [{ startedAt: 0, lastActionAt: 999_000 }]]]),
      steps: [{ id: "a", botId: "dev", requesterBotId: "orc", title: "Queued", mode: "work", status: "queued", createdAt: 0, coding: true }],
    });
    expect(work.team[0]!.live.state).toBe("working");
    // the step itself still waits to start
    expect(work.live[0]!.live).toEqual({ state: "waiting", wait: "start" });
  });

  it("folds names without being fuzzy", () => {
    expect(teamWorkName("  Login\tFix ")).toBe("login fix");
    expect(teamWorkName("Login fixes")).not.toBe(teamWorkName("Login fix"));
  });
});

describe("team work frame", () => {
  it("reaches the person it is for, and the operator's stream on a one-person server", () => {
    const frame = { kind: TEAM_WORK_FRAME, botId: "orc", audience: "Ana" };
    expect(teamWorkFrameAllowed(frame, "ana", "local")).toBe(true);
    expect(teamWorkFrameAllowed(frame, "ben", "local")).toBe(false);
    expect(teamWorkFrameAllowed(frame, undefined, "ana")).toBe(true);
    expect(teamWorkFrameAllowed({ kind: TEAM_WORK_FRAME, botId: "orc" }, "ben", "local")).toBe(true);
    expect(teamWorkFrameAllowed({ kind: "other", audience: "ana" }, "ben", "local")).toBe(true);
  });
});

// #4421: a piece of work ends without every planned step handed out (the
// orchestrator's close, or the person's clear), and a row nothing touched
// for long says it is stale instead of "next step not handed out yet".
describe("a piece of work that ends before its plan is handed out (#4421)", () => {
  const plan = [{ name: "Build" }, { name: "Test" }, { name: "Ship" }];
  const built = { id: "h1", botId: "dev", requesterBotId: "orc", threadId: "t1", title: "Build", work: "Release", step: "Build", plan,
    mode: "work" as const, status: "completed" as const, createdAt: 100_000, startedAt: 100_000, finishedAt: 200_000, coding: true };
  const read = (ended?: { at: number; outcome: "done" | "dropped" | "cleared"; why?: string }, extra: TeamWorkInput["steps"] = [], now = 1_000_000) =>
    buildTeamWork({ orchestratorId: "orc", now, since: 0, steps: [{ ...built, ...(ended ? { ended } : {}) }, ...extra] });

  it("a plan of three, one handed out: listed, 1/3, two to come", () => {
    const work = read();
    expect(work.live).toHaveLength(1);
    expect(work.live[0]).toMatchObject({ key: "work:release", done: 1, total: 3, finished: false });
    expect(work.live[0]!.toCome.map((step) => step.name)).toEqual(["Test", "Ship"]);
  });

  it("closed as dropped by the orchestrator: the row leaves", () => {
    const work = read({ at: 300_000, outcome: "dropped", why: "Taken over elsewhere" });
    expect(work.live).toEqual([]);
    expect(work.doneToday).toEqual([]);
  });

  it("cleared by the person: the row leaves", () => {
    const work = read({ at: 300_000, outcome: "cleared" });
    expect(work.live).toEqual([]);
    expect(work.doneToday).toEqual([]);
  });

  it("closed as done: it leaves the live list for Done today, nothing to come, with the words why", () => {
    const work = read({ at: 300_000, outcome: "done", why: "Merged by another session" });
    expect(work.live).toEqual([]);
    expect(work.doneToday).toHaveLength(1);
    expect(work.doneToday[0]).toMatchObject({ finished: true, endedAt: 300_000, toCome: [], closed: { why: "Merged by another session" } });
  });

  it("a step handed out after the end opens the work again", () => {
    const test = { ...built, id: "h2", threadId: "t2", title: "Test", step: "Test", plan: undefined, status: "running" as const, createdAt: 400_000, startedAt: 400_000, finishedAt: undefined };
    const work = read({ at: 300_000, outcome: "dropped" }, [test]);
    expect(work.live).toHaveLength(1);
    expect(work.live[0]).toMatchObject({ done: 1, total: 3 });
  });

  it("nothing touched for TEAM_WORK_STALE_MS with no step live: stale since its newest action", () => {
    expect(read(undefined, [], 200_000 + TEAM_WORK_STALE_MS - 1).live[0]!.staleSince).toBeUndefined();
    expect(read(undefined, [], 200_000 + TEAM_WORK_STALE_MS).live[0]!.staleSince).toBe(200_000);
    // a step still running is never stale
    const running = { ...built, id: "h2", threadId: "t2", title: "Test", step: "Test", plan: undefined, status: "running" as const, createdAt: 150_000, startedAt: 150_000, finishedAt: undefined,
      turn: { startedAt: 150_000, lastActionAt: 150_000, toolSince: 150_000 } };
    expect(read(undefined, [running], 200_000 + 2 * TEAM_WORK_STALE_MS).live[0]!.staleSince).toBeUndefined();
  });

  it("Clear finished takes the settled rows, a named clear takes its row, and nothing that runs", () => {
    const running = { id: "h9", botId: "dev", requesterBotId: "orc", threadId: "t9", title: "Hotfix", mode: "work" as const, status: "running" as const, createdAt: 500_000, startedAt: 500_000, coding: true };
    const work = read(undefined, [running]);
    expect(work.live.map((item) => teamWorkSettled(item))).toEqual([false, true]);
    expect(teamWorkClearSteps(work, { finished: true })).toEqual(["h1"]);
    expect(teamWorkClearSteps(work, { keys: ["step:h9"] })).toEqual(["h9"]);
    expect(teamWorkClearSteps(work, { keys: ["work:unknown"] })).toEqual([]);
  });
});
