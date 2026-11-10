import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  TEAM_SILENT_MS,
  TEAM_WORK_FRAME,
  buildTeamWork,
  strongestLive,
  teamLive,
  teamWorkFrameAllowed,
  teamWorkName,
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
