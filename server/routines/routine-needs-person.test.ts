// #4098: what of a routine waits on the person (Routine.needsPerson), as the
// server writes it on the list and the `routine` frame: each kind from the
// facts the chat's row gate reads, and its clearing the moment its fact does.
import { describe, expect, it } from "vitest";

import type { PersonAttentionCard } from "../../shared/person-attention.ts";
import type { RoutineNeedsPerson } from "../../shared/routines.ts";
import type { Routine, RoutineRun } from "./routines.ts";
import { outcomesOf } from "../../shared/outcomes.ts";
import { openRunItems, routineNeedMayMove, routineNeedsPerson, RoutineNeedsWatch, type RoutineNeedsDeps, type RoutineOpenRow } from "./routine-needs-person.ts";
import { scopedRoutineListing } from "./routine-scope.ts";

const NOW = 1_800_000_000_000;
const DAILY = { type: "cron", expression: "0 7 * * *", timeZone: "UTC" } as Routine["schedule"];
const HOURLY = { type: "interval", everyMinutes: 60, anchorAt: 0 } as Routine["schedule"];

const routine = (extra: Partial<Routine> = {}): Routine => ({
  id: "r1", name: "Digest", prompt: "p", target: "bot", botId: "b1", runOn: "maus", enabled: true, schedule: DAILY,
  durationMinutes: 30, nextRunAt: NOW + 3_600_000, createdAt: 1, updatedAt: 1, ...extra,
});
const run = (id: string, extra: Partial<RoutineRun> = {}): RoutineRun => ({
  id, routineId: "r1", routineName: "Digest", botId: "b1", target: "bot", runOn: "maus", scheduledFor: NOW - 60_000,
  status: "completed", manual: false, createdAt: NOW - 60_000, startedAt: NOW - 60_000, finishedAt: NOW - 30_000, threadId: `t-${id}`, ...extra,
} as RoutineRun);

function deps(runs: RoutineRun[], open: Set<string> = new Set(), toldAt = 1): RoutineNeedsDeps {
  return {
    runsOf: (routineId) => runs.filter((entry) => entry.routineId === routineId),
    cardOpen: (entry) => open.has(entry.id),
    problemToldAt: () => toldAt,
    now: () => NOW,
  };
}

const NONE = new Map<string, { text: string; since: number }>();

const card = (runId: string, extra: Partial<PersonAttentionCard> = {}): PersonAttentionCard => ({
  kind: "human", items: [{ text: "**Approve** the two invoices" }, { text: "Call the vendor back" }] as PersonAttentionCard["items"],
  botId: "b1", botName: "Bot", threadId: `t-${runId}`, sourceMessageId: `run:${runId}`, routineRunId: runId, routineName: "Digest", ...extra,
});

describe("Routine.needsPerson from the row gate's facts (#4098)", () => {
  it("question: a waiting run whose card is open, cleared once the card is answered", () => {
    const waiting = run("x1", { status: "waiting", finishedAt: undefined, attention: "Which deck should I send?" });
    expect(routineNeedsPerson(routine(), deps([waiting], new Set(["x1"])), NONE)).toEqual({
      kind: "question", text: "Which deck should I send?", runId: "x1", since: NOW - 60_000,
    });
    // the card answered (openCardIn false): nothing waits, even while the run still reads waiting
    expect(routineNeedsPerson(routine(), deps([waiting]), NONE)).toBeNull();
    // a run waiting on its teammates never waits on the person
    expect(routineNeedsPerson(routine(), deps([{ ...waiting, waitingOn: "teammates" }], new Set(["x1"])), NONE)).toBeNull();
  });

  it("items: items only the person can do on a run's row, cleared once handled or answered in words", () => {
    const rows: RoutineOpenRow[] = [{ threadId: "conv", message: { id: "m1", at: NOW - 20_000, kind: "routine.run", attention: card("x1") } }];
    const items = openRunItems(rows, () => false);
    expect(routineNeedsPerson(routine(), deps([run("x1")]), items)).toEqual({
      kind: "items", text: "Approve the two invoices; Call the vendor back", runId: "x1", since: NOW - 20_000,
    });
    // handled on the card
    const handled = openRunItems([{ threadId: "conv", message: { ...rows[0]!.message, attention: card("x1", { handledAt: NOW }) } }], () => false);
    expect(routineNeedsPerson(routine(), deps([run("x1")]), handled)).toBeNull();
    // the person wrote after it, in the conversation or in the run's thread (Today's rule)
    expect(routineNeedsPerson(routine(), deps([run("x1")]), openRunItems(rows, (threadId) => threadId === "conv"))).toBeNull();
    expect(routineNeedsPerson(routine(), deps([run("x1")]), openRunItems(rows, (threadId) => threadId === "t-x1"))).toBeNull();
    // a card that is no routine run's is not this routine's
    expect(openRunItems([{ threadId: "conv", message: { id: "m2", at: 1, attention: card("x1", { routineRunId: undefined }) } }], () => false).size).toBe(0);
  });

  it("problem: the streak the chat told and no good run since", () => {
    const failed = run("x1", { status: "failed", error: "The mailbox refused the sign-in" });
    expect(routineNeedsPerson(routine(), deps([failed], new Set(), 1), NONE)).toMatchObject({ kind: "problem", runId: "x1", text: "The mailbox refused the sign-in" });
    // a routine that runs several times a day is told at its third problem run
    expect(routineNeedsPerson(routine({ schedule: HOURLY }), deps([failed], new Set(), 3), NONE)).toBeNull();
    const third = run("x3", { status: "failed", error: "Down", problemRepeat: { firstRunId: "x1", since: NOW - 7_200_000, count: 3 } });
    expect(routineNeedsPerson(routine({ schedule: HOURLY }), deps([third], new Set(), 3), NONE)).toMatchObject({ kind: "problem", runId: "x3", since: NOW - 7_200_000 });
    // a good run recovers it
    const good = run("x4", { finishedAt: NOW - 1_000, startedAt: NOW - 2_000, scheduledFor: NOW - 2_000, createdAt: NOW - 2_000 });
    expect(routineNeedsPerson(routine(), deps([failed, good], new Set(), 1), NONE)).toBeNull();
  });

  it("paused: a pause after failures, cleared once turned back on", () => {
    const paused = routine({ enabled: false, autoPaused: { at: NOW - 5_000, failures: 5, runId: "x9" } as Routine["autoPaused"] });
    expect(routineNeedsPerson(paused, deps([]), NONE)).toEqual({ kind: "paused", text: "", failures: 5, since: NOW - 5_000, runId: "x9" });
    expect(routineNeedsPerson({ ...paused, enabled: true, autoPaused: undefined }, deps([]), NONE)).toBeNull();
  });

  it("goal: past its deadline or stalled", () => {
    const expired = routine({ goal: { text: "Inbox at zero", status: "expired", expiredAt: NOW - 1, progress: "12 left" } });
    expect(routineNeedsPerson(expired, deps([]), NONE)).toEqual({ kind: "goal", goal: "expired", text: "12 left", since: NOW - 1 });
    const stalled = routine({ goal: { text: "Inbox at zero", status: "active", stalled: 2, progress: "12 left", lastCheckedAt: NOW - 2 } });
    expect(routineNeedsPerson(stalled, deps([]), NONE)).toMatchObject({ kind: "goal", goal: "stalled", checks: 3 });
    expect(routineNeedsPerson({ ...stalled, goal: { ...stalled.goal!, stalled: 0 } }, deps([]), NONE)).toBeNull();
  });

  it("the server's verdict wins in outcomesOf: null is nothing, whatever the runs say", () => {
    const waiting = run("x1", { status: "waiting", finishedAt: undefined, attention: "Which deck?" });
    expect(outcomesOf([{ ...routine(), needsPerson: null }], [waiting], [], NOW)[0]).toMatchObject({ status: "on-track" });
    const need: RoutineNeedsPerson = { kind: "items", text: "Call the vendor back", runId: "x1", since: NOW };
    expect(outcomesOf([{ ...routine(), needsPerson: need }], [], [], NOW)[0]).toMatchObject({ status: "needs-you", needsPerson: need });
  });

  it("someone else's routine seen through a wider scope carries no need", () => {
    const need: RoutineNeedsPerson = { kind: "question", text: "Which deck?", runId: "x1", since: NOW };
    const listing = scopedRoutineListing({ scope: "all" }, { admin: true, viewTeam: false, viewAll: true, teamIds: [] }, [routine()], [], {
      mine: () => false,
      facts: () => ({ ownerId: "p2", ownerName: "Other", teamIds: [], bot: { id: "b1", name: "Bot" } }),
      canRun: () => false,
      canEdit: () => false,
      wire: (entry) => ({ ...entry, needsPerson: need }),
      teamName: () => undefined,
    });
    expect(listing.routines[0]).toMatchObject({ redacted: true, needsPerson: null });
  });
});

describe("RoutineNeedsWatch keeps the frame as fresh as the chat (#4098)", () => {
  it("sends the routine frame once its need moves, never twice for the same need", () => {
    let need: RoutineNeedsPerson | null = null;
    const sent: string[] = [];
    const later: Array<() => void> = [];
    const watch = new RoutineNeedsWatch({
      routines: () => [routine()],
      need: () => need,
      emit: (entry) => { sent.push(entry.id); watch.noteSent(entry.id, need); },
      later: (pass) => { later.push(pass); },
    });
    watch.noteSent("r1", null);
    watch.touch();
    watch.touch();
    expect(later).toHaveLength(1);
    later.shift()!();
    expect(sent).toEqual([]);
    need = { kind: "question", text: "Which deck?", runId: "x1", since: NOW };
    watch.touch();
    later.shift()!();
    expect(sent).toEqual(["r1"]);
    watch.touch();
    later.shift()!();
    expect(sent).toEqual(["r1"]);
    // the card answered: the frame clears it
    need = null;
    watch.touch();
    later.shift()!();
    expect(sent).toEqual(["r1", "r1"]);
  });

  it("a person's line, a card, items or a run's row may move a need; a bot's streamed words do not", () => {
    expect(routineNeedMayMove({ role: "user", kind: "text" })).toBe(true);
    expect(routineNeedMayMove({ role: "bot", kind: "text", card: { requestId: "q1" } })).toBe(true);
    expect(routineNeedMayMove({ role: "bot", kind: "text", attention: {} })).toBe(true);
    expect(routineNeedMayMove({ role: "bot", kind: "routine.run" })).toBe(true);
    expect(routineNeedMayMove({ role: "bot", kind: "text" })).toBe(false);
  });

  it("#4233: every pass hands every routine to the fix cards, changed or not", () => {
    const passes: string[][] = [];
    const watch = new RoutineNeedsWatch({
      routines: () => [routine()],
      need: () => null,
      emit: () => {},
      later: (pass) => pass(),
      each: (all) => { passes.push(all.map((entry) => entry.id)); },
    });
    watch.pass();
    watch.touch();
    expect(passes).toEqual([["r1"], ["r1"]]);
  });
});
