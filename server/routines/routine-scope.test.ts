// The Automations page scope (2026-10-09): who sees which routines and runs,
// the filters, the flags, what is withheld, and what Clear logs may remove.
import { describe, expect, it } from "vitest";

import {
  parseRoutineScopeQuery,
  routineRunClearable,
  routineScopeRefusal,
  scopedRoutineListing,
  type RoutineScopeCaller,
  type RoutineScopeDeps,
  type RoutineScopeFacts,
} from "./routine-scope.ts";
import type { Routine, RoutineRun } from "./routines.ts";

const TEAM_T = "TEAMT";
const TEAM_U = "TEAMU";

// Bots: mine (Mia's own), carol's (team T), dave's (team U), shared (Erin's,
// shared with team T), frank's (no team).
const BOTS: Record<string, { owner: string; teams: string[]; grants?: string[] }> = {
  "bot-mia": { owner: "pr_mia", teams: [TEAM_T] },
  "bot-carol": { owner: "pr_carol", teams: [TEAM_T] },
  "bot-dave": { owner: "pr_dave", teams: [TEAM_U] },
  "bot-erin": { owner: "pr_erin", teams: [], grants: [TEAM_T] },
  "bot-frank": { owner: "pr_frank", teams: [] },
};

const routine = (id: string, botId: string, extra: Partial<Routine> = {}): Routine => ({
  id, name: id, prompt: `secret prompt of ${id}`, target: "bot", botId, runOn: "bot-computer" as Routine["runOn"], enabled: true,
  schedule: { type: "interval", everyMinutes: 60, anchorAt: 0 } as Routine["schedule"], durationMinutes: 30,
  attachments: [], resultsThreadId: `thread-${id}`, nextRunAt: null, createdAt: 0, updatedAt: 0, ...extra,
});
const run = (id: string, routineId: string, botId: string, extra: Partial<RoutineRun> = {}): RoutineRun => ({
  id, routineId, routineName: routineId, botId, target: "bot", runOn: "bot-computer", scheduledFor: 0, status: "completed",
  manual: false, createdAt: 0, output: `output of ${id}`, prompt: "secret", threadId: `t-${id}`, ...extra,
} as RoutineRun);

const ROUTINES = [
  routine("r-mia", "bot-mia"),
  routine("r-carol", "bot-carol", { enabled: false }),
  routine("r-dave", "bot-dave", { failureStreak: 2 }),
  routine("r-erin", "bot-erin"),
  routine("r-frank", "bot-frank"),
];
const RUNS = [
  run("run-mia", "r-mia", "bot-mia"),
  run("run-carol", "r-carol", "bot-carol"),
  run("run-dave", "r-dave", "bot-dave", { status: "failed", error: "x".repeat(400) }),
  run("run-erin", "r-erin", "bot-erin"),
  run("run-frank", "r-frank", "bot-frank"),
  run("run-gone", "r-deleted", "bot-frank"),
];

function facts(value: { botId: string; runAs?: string }): RoutineScopeFacts {
  const bot = BOTS[value.botId];
  const teamIds = new Set<string>([...(bot?.teams ?? []), ...(bot?.grants ?? [])]);
  return { ownerId: bot?.owner ?? "", ownerName: (bot?.owner ?? "").replace("pr_", ""), teamIds: [...teamIds], bot: { id: value.botId, name: value.botId.toUpperCase() } };
}

/** Mia sees her own bot only (the private-threads rule). */
const deps: RoutineScopeDeps<Routine> = {
  mine: (value) => value.botId === "bot-mia",
  facts,
  canRun: () => true,
  canEdit: () => true,
  wire: (value) => value,
  teamName: (id) => ({ [TEAM_T]: "Team T", [TEAM_U]: "Team U" })[id],
};

const member: RoutineScopeCaller = { admin: false, viewTeam: false, viewAll: false, teamIds: [TEAM_T] };
const teamViewer: RoutineScopeCaller = { ...member, viewTeam: true };
const allViewer: RoutineScopeCaller = { ...member, viewAll: true };
const admin: RoutineScopeCaller = { admin: true, viewTeam: false, viewAll: false, teamIds: [] };

const list = (scope: "mine" | "team" | "all", caller: RoutineScopeCaller, extra = "") => {
  const query = parseRoutineScopeQuery(new URLSearchParams(`scope=${scope}${extra}`));
  if ("error" in query) throw new Error(query.error);
  return scopedRoutineListing(query, caller, ROUTINES, RUNS, deps);
};
const ids = (rows: { id: string }[]) => rows.map((row) => row.id).sort();

describe("parsing the scope", () => {
  it("no scope is mine; bad values are 400", () => {
    expect(parseRoutineScopeQuery(new URLSearchParams(""))).toEqual({ scope: "mine" });
    expect(parseRoutineScopeQuery(new URLSearchParams("scope=team&teamId=T1&botId=b-1&ownerId=pr_x&status=failing")))
      .toEqual({ scope: "team", teamId: "T1", botId: "b-1", ownerId: "pr_x", status: "failing" });
    expect(parseRoutineScopeQuery(new URLSearchParams("scope=everyone"))).toMatchObject({ code: "routine_scope_invalid" });
    expect(parseRoutineScopeQuery(new URLSearchParams("status=broken"))).toMatchObject({ code: "routine_scope_invalid" });
    expect(parseRoutineScopeQuery(new URLSearchParams("botId=a%20b"))).toMatchObject({ code: "routine_scope_invalid" });
  });
});

describe("who may ask for a scope", () => {
  it("a member without keys: mine only, 403 names the missing key", () => {
    expect(routineScopeRefusal(member, "mine")).toBeNull();
    expect(routineScopeRefusal(member, "team")).toMatchObject({ error: "forbidden", permission: "routines.viewTeam", code: "routine_scope_not_allowed" });
    expect(routineScopeRefusal(member, "all")).toMatchObject({ permission: "routines.viewAll" });
  });

  it("viewTeam opens team, not all; viewAll opens both; an admin both", () => {
    expect(routineScopeRefusal(teamViewer, "team")).toBeNull();
    expect(routineScopeRefusal(teamViewer, "all")).toMatchObject({ permission: "routines.viewAll" });
    expect(routineScopeRefusal(allViewer, "team")).toBeNull();
    expect(routineScopeRefusal(allViewer, "all")).toBeNull();
    expect(routineScopeRefusal(admin, "all")).toBeNull();
    expect(routineScopeRefusal(admin, "team")).toBeNull();
  });
});

describe("what each scope answers", () => {
  it("mine: only the member's own routines and runs, as before", () => {
    const got = list("mine", member);
    expect(ids(got.routines)).toEqual(["r-mia"]);
    expect(ids(got.runs)).toEqual(["run-mia"]);
    expect(got.allowed).toEqual({ mine: true, team: false, all: false });
  });

  it("team: mine plus the people of my teams and the bots shared with my teams; never another team's", () => {
    const got = list("team", teamViewer);
    expect(ids(got.routines)).toEqual(["r-carol", "r-erin", "r-mia"]);
    expect(ids(got.runs)).toEqual(["run-carol", "run-erin", "run-mia"]);
    expect(got.facets.teams).toEqual([{ id: TEAM_T, name: "Team T" }]);
  });

  it("all: every routine, and a run whose routine is gone", () => {
    const got = list("all", allViewer);
    expect(ids(got.routines)).toEqual(["r-carol", "r-dave", "r-erin", "r-frank", "r-mia"]);
    expect(ids(got.runs)).toEqual(["run-carol", "run-dave", "run-erin", "run-frank", "run-gone", "run-mia"]);
    expect(ids(list("all", admin).routines)).toHaveLength(5);
    expect(list("all", admin).allowed).toEqual({ mine: true, team: true, all: true });
  });

  it("filters apply: team, bot, owner, status", () => {
    expect(ids(list("all", admin, `&teamId=${TEAM_U}`).routines)).toEqual(["r-dave"]);
    expect(ids(list("all", admin, "&botId=bot-erin").routines)).toEqual(["r-erin"]);
    expect(ids(list("all", admin, "&ownerId=pr_carol").routines)).toEqual(["r-carol"]);
    expect(ids(list("all", admin, "&status=paused").routines)).toEqual(["r-carol"]);
    expect(ids(list("all", admin, "&status=failing").routines)).toEqual(["r-dave"]);
    expect(ids(list("all", admin, "&status=failing").runs)).toEqual(["run-dave"]);
    // A team filter outside my teams finds nothing in the team scope.
    expect(list("team", teamViewer, `&teamId=${TEAM_U}`).routines).toEqual([]);
    // The filters' choices cover the whole scope.
    expect(list("all", admin, "&botId=bot-erin").facets.botChoices.map((bot) => bot.id)).toHaveLength(5);
  });

  it("mine keeps an owner filter so shared bots' routines can be left out (#1676)", () => {
    const sharedMine: RoutineScopeDeps<Routine> = {
      ...deps,
      mine: (value) => value.botId === "bot-mia" || value.botId === "bot-erin",
    };
    const query = parseRoutineScopeQuery(new URLSearchParams("scope=mine&ownerId=pr_mia"));
    if ("error" in query) throw new Error(query.error);
    const mineOnly = scopedRoutineListing(query, member, ROUTINES, RUNS, sharedMine);
    expect(ids(mineOnly.routines)).toEqual(["r-mia"]);
    const allMine = scopedRoutineListing(
      parseRoutineScopeQuery(new URLSearchParams("scope=mine")) as Exclude<ReturnType<typeof parseRoutineScopeQuery>, { error: string }>,
      member, ROUTINES, RUNS, sharedMine,
    );
    expect(ids(allMine.routines)).toEqual(["r-erin", "r-mia"]);
    expect(allMine.facets.owners.map((owner) => owner.id).sort()).toEqual(["pr_erin", "pr_mia"]);
  });

  it("each routine carries owner, teams, bot and flags; others' are read-only and withheld", () => {
    const rows = list("team", teamViewer).routines;
    const own = rows.find((row) => row.id === "r-mia")!;
    expect(own).toMatchObject({ owner: { id: "pr_mia", name: "mia" }, teamIds: [TEAM_T], bot: { id: "bot-mia", name: "BOT-MIA" }, canRun: true, canEdit: true, prompt: "secret prompt of r-mia" });
    expect(own).not.toHaveProperty("redacted");
    const other = rows.find((row) => row.id === "r-carol")!;
    expect(other).toMatchObject({ owner: { id: "pr_carol" }, canRun: false, canEdit: false, redacted: true, prompt: "" });
    expect(other).not.toHaveProperty("resultsThreadId");
    expect(other).not.toHaveProperty("attachments");
    const runs = list("all", admin).runs;
    const otherRun = runs.find((row) => row.id === "run-dave")!;
    expect(otherRun).toMatchObject({ redacted: true, status: "failed" });
    for (const key of ["output", "prompt", "threadId"]) expect(otherRun).not.toHaveProperty(key);
    expect(otherRun.error).toHaveLength(300);
    expect(runs.find((row) => row.id === "run-mia")).toMatchObject({ output: "output of run-mia" });
  });
});

describe("Clear logs", () => {
  const clearable = (scope: "mine" | "team" | "all", caller: RoutineScopeCaller, extra = "") => {
    const query = parseRoutineScopeQuery(new URLSearchParams(`scope=${scope}${extra}`));
    if ("error" in query) throw new Error(query.error);
    const keep = routineRunClearable(query, caller, ROUTINES, deps);
    return RUNS.filter(keep).map((row) => row.id).sort();
  };

  it("clears only my own runs, even in the team scope", () => {
    expect(clearable("mine", member)).toEqual(["run-mia"]);
    expect(clearable("team", teamViewer)).toEqual(["run-mia"]);
  });

  it("with viewAll (or an admin) and scope all, every run; the filters narrow it", () => {
    expect(clearable("all", allViewer)).toHaveLength(6);
    expect(clearable("all", admin, "&botId=bot-dave")).toEqual(["run-dave"]);
    expect(clearable("all", admin, "&status=paused")).toEqual(["run-carol"]);
    expect(clearable("mine", admin)).toEqual(["run-mia"]);
  });
});
