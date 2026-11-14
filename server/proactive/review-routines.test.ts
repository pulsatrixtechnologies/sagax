// #4250 (S8): the end of day and weekly reviews are routines of the bot,
// created only on the person's yes, with a code pre-check that reads the
// run log and the one list of items waiting on the person
// (shared/waiting-items.ts): no model turn. Tests as
// server/proactive/brief-routine.test.ts.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { nextOccurrence, RoutineManager, type RoutineManagerOptions } from "../routines/routines.ts";
import type { RoutineRun } from "../routines/routine-run-types.ts";
import { loadRoutinePrecheck, parseRoutinePrecheck } from "../routines/routine-precheck.ts";
import { SignalLedger } from "./signal-ledger.ts";
import { BriefStore } from "./background-brief.ts";
import { createBackgroundBriefRoutes } from "../routes/background-brief.ts";
import {
  composeReview,
  personReviewData,
  REVIEW_WINDOW_MS,
  reviewCheckKind,
  reviewKindOf,
  reviewRoutineOf,
  ReviewRoutines,
  reviewSchedule,
  runReview,
  type ReviewKind,
  type ReviewWaiting,
} from "./review-routines.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "sagax-review-routine-"));
  dirs.push(dir);
  return dir;
}

// a Monday, 10:00 UTC
const START = Date.parse("2026-11-09T10:00:00Z");
const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

function run(row: Partial<RoutineRun> & Pick<RoutineRun, "routineId" | "routineName" | "status" | "finishedAt">): RoutineRun {
  return { id: `run-${Math.random().toString(36).slice(2)}`, botId: "main", target: "bot", runOn: "maus", scheduledFor: row.finishedAt!, manual: false, ...row } as RoutineRun;
}

/** A real routine manager whose review code checks run the review. */
function harness() {
  const dir = tempDir();
  let now = START;
  const turns: string[] = [];
  const delivered: Array<{ botId: string; kind: ReviewKind; text: string }> = [];
  const history: RoutineRun[] = [];
  /** The person's Today rows read as waiting items (shared/waiting-items.ts). */
  const waiting: ReviewWaiting[] = [];
  // the signal ledger keeps its own entries (wake events, deferred runs,
  // cards); the review never reads it for what waits
  const ledger = new SignalLedger({ now: () => now, schedule: (fn) => fn() });
  const options: RoutineManagerOptions = {
    file: join(dir, "routines.json"),
    now: () => now,
    botState: () => "ready",
    createTask: () => ({ threadId: "thread-1" }),
    startTurn: async (_botId, _threadId, prompt) => { turns.push(prompt); },
    evaluateCode: async (routine, precheck) => {
      const kind = reviewCheckKind(precheck.check);
      if (!kind) throw new Error("not a review");
      const data = personReviewData({
        person: "person-1",
        bots: new Set(["main", "helper"]),
        runs: [...history, ...manager.listRuns()],
        waiting,
        singlePerson: false,
      });
      const reason = runReview({
        kind, language: "fr", now, ...data,
        botName: (id) => (id === "main" ? "Assistant" : "Aide"),
        deliver: (text) => { delivered.push({ botId: routine.botId, kind, text }); return true; },
      });
      return { wake: false, reason };
    },
  };
  const manager = new RoutineManager(options);
  const reviews = new ReviewRoutines({
    routines: () => ({
      list: () => manager.listRoutines(),
      create: (row, runAs) => manager.create(row, undefined, runAs ? { runAs } : undefined),
      update: (id, patch) => manager.update(id, patch),
    }),
    language: () => "fr",
    runAs: () => undefined,
  });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  const tickAt = async (at: number) => {
    now = at;
    await manager.tick();
    await settle(); await settle(); await settle();
    await manager.tick();
  };
  return { dir, manager, reviews, turns, delivered, history, waiting, ledger, tickAt, setNow: (at: number) => { now = at; } };
}

describe("#4250 S8: no review without the person's yes", () => {
  it("a bot with no review routine: a whole week of passes reads nothing, posts nothing and starts no turn", async () => {
    const h = harness();
    h.history.push(run({ routineId: "r1", routineName: "Factures", status: "completed", finishedAt: START - HOUR }));
    for (let at = START; at < START + 7 * DAY; at += 3 * HOUR) await h.tickAt(at);
    expect(h.manager.listRoutines()).toEqual([]);
    expect(h.delivered).toEqual([]);
    expect(h.turns).toEqual([]);
    expect(h.manager.listRuns()).toEqual([]);
    expect(h.reviews.on("main", "end_of_day")).toBe(false);
    expect(h.reviews.on("main", "weekly")).toBe(false);
  });
});

describe("#4250 S8: the person's yes creates the routine", () => {
  it("end of day: one routine with its code pre-check, every day at 17:30 in the person's zone; a second yes adds none; off pauses it", () => {
    const h = harness();
    const routine = h.reviews.set("main", "end_of_day", true, "America/Toronto")!;
    expect(routine).toMatchObject({
      botId: "main", enabled: true, name: "Fin de journée",
      schedule: { type: "cron", expression: "30 17 * * *", timeZone: "America/Toronto" },
      precheck: { kind: "code", check: "end_of_day_review" },
      postResults: false,
    });
    expect(reviewKindOf(routine)).toBe("end_of_day");
    expect(h.reviews.on("main", "end_of_day")).toBe(true);
    h.reviews.set("main", "end_of_day", true, "Europe/Paris");
    expect(h.manager.listRoutines()).toHaveLength(1);
    // the yes again keeps what the person set in the routines list (its zone included)
    expect(h.manager.listRoutines()[0]!.schedule).toMatchObject({ timeZone: "America/Toronto" });
    h.reviews.set("main", "end_of_day", false);
    expect(h.manager.listRoutines()).toHaveLength(1);
    expect(h.reviews.on("main", "end_of_day")).toBe(false);
    // off with no routine creates nothing
    expect(h.reviews.set("main", "weekly", false)).toBeNull();
    expect(h.manager.listRoutines()).toHaveLength(1);
  });

  it("weekly: every Friday at 16:00, its own routine beside the end of day", () => {
    const h = harness();
    h.reviews.set("main", "end_of_day", true, "UTC");
    const weekly = h.reviews.set("main", "weekly", true, "UTC")!;
    expect(weekly).toMatchObject({ name: "Revue de la semaine", schedule: { type: "cron", expression: "0 16 * * 5", timeZone: "UTC" }, precheck: { kind: "code", check: "weekly_review" } });
    expect(reviewRoutineOf(h.manager.listRoutines(), "main", "weekly")?.id).toBe(weekly.id);
    expect(reviewRoutineOf(h.manager.listRoutines(), "main", "end_of_day")?.id).not.toBe(weekly.id);
    expect(reviewSchedule("weekly", "UTC")).toEqual({ type: "cron", expression: "0 16 * * 5", timeZone: "UTC" });
  });

  it("the routine file stays readable by a version that does not know the review checks: the routine is kept, only its pre-check is dropped", () => {
    const h = harness();
    h.reviews.set("main", "end_of_day", true, "UTC");
    const stored = JSON.parse(readFileSync(join(h.dir, "routines.json"), "utf8")) as { routines: Array<{ precheck: unknown; name: string }> };
    const row = stored.routines[0]!;
    expect(row.precheck).toEqual({ kind: "code", check: "end_of_day_review" });
    // the previous version's reader is the same schema without the new names: an unknown check is undefined, never a throw
    expect(loadRoutinePrecheck({ kind: "code", check: "some_future_check" })).toBeUndefined();
    expect(() => parseRoutinePrecheck({ kind: "code", check: "weekly_review" })).not.toThrow();
  });
});

describe("#4250 S8: the scheduled review reads the run log and what waits, no model turn", () => {
  it("end of day: what the bots did, what waits, what failed; posted once, no turn", async () => {
    const h = harness();
    const routine = h.reviews.set("main", "end_of_day", true, "UTC")!;
    const due = nextOccurrence(routine.schedule, START, undefined)!;
    expect(new Date(due).toISOString()).toBe("2026-11-09T17:30:00.000Z");
    h.history.push(
      run({ routineId: "r1", routineName: "Factures", status: "completed", finishedAt: due - 5 * HOUR }),
      run({ routineId: "r1", routineName: "Factures", status: "completed", finishedAt: due - 2 * HOUR }),
      run({ routineId: "r2", routineName: "Billets", botId: "helper", status: "failed", error: "Le serveur ne répond pas", finishedAt: due - HOUR }),
      run({ routineId: "r3", routineName: "Courriel", status: "completed", problems: "Deux messages illisibles", finishedAt: due - HOUR }),
      // yesterday's run is outside the day
      run({ routineId: "r4", routineName: "Ancien", status: "completed", finishedAt: due - 2 * DAY }),
      // a quiet pre-check is not work done
      run({ routineId: "r5", routineName: "Veille", status: "nothing_to_report", finishedAt: due - HOUR }),
    );
    h.setNow(due - 3 * HOUR);
    h.waiting.push({ id: "req-1", botId: "main", title: "Renouveler le contrat ?", at: due - 3 * HOUR });
    await h.tickAt(due);
    expect(h.turns).toEqual([]);
    expect(h.delivered).toHaveLength(1);
    const text = h.delivered[0]!.text;
    expect(text.split("\n")[0]).toBe("**Fin de journée**");
    expect(text).toContain("**Ce que tes bots ont fait**");
    expect(text).toContain("- Assistant · Factures : 2 passes");
    expect(text).not.toContain("Ancien");
    expect(text).not.toContain("Veille");
    expect(text).toContain("**Ce qui t'attend**");
    expect(text).toContain("- Renouveler le contrat ? (Assistant)");
    expect(text).toContain("**Ce qui a échoué**");
    expect(text).toContain("- Aide · Billets : 1 échec, dernier : Le serveur ne répond pas");
    expect(text).toContain("- Assistant · Courriel : 1 échec, dernier : Deux messages illisibles");
    const own = h.manager.listRuns().find((row) => row.routineId === routine.id)!;
    expect(own).toMatchObject({ status: "nothing_to_report" });
    // the rest of the day: no second review
    for (let at = due + HOUR; at < due + 23 * HOUR; at += HOUR) await h.tickAt(at);
    expect(h.delivered).toHaveLength(1);
    expect(h.turns).toEqual([]);
  });

  it("nothing done, nothing waiting, nothing failed: nothing is posted", async () => {
    const h = harness();
    const routine = h.reviews.set("main", "end_of_day", true, "UTC")!;
    await h.tickAt(nextOccurrence(routine.schedule, START, undefined)!);
    expect(h.delivered).toEqual([]);
    expect(h.turns).toEqual([]);
    expect(h.manager.listRuns()[0]).toMatchObject({ status: "nothing_to_report", quietReason: "Rien à revoir : aucune revue envoyée." });
  });

  it("weekly: seven days of runs, and no count of answers it cannot know", async () => {
    const h = harness();
    const routine = h.reviews.set("main", "weekly", true, "UTC")!;
    const due = nextOccurrence(routine.schedule, START, undefined)!;
    expect(new Date(due).toISOString()).toBe("2026-11-13T16:00:00.000Z");
    h.history.push(
      run({ routineId: "r1", routineName: "Factures", status: "completed", finishedAt: due - 6 * DAY }),
      run({ routineId: "r1", routineName: "Factures", status: "completed", finishedAt: due - DAY }),
      run({ routineId: "r1", routineName: "Factures", status: "completed", finishedAt: due - 8 * DAY }),
    );
    await h.tickAt(due);
    expect(h.delivered).toHaveLength(1);
    const text = h.delivered[0]!.text;
    expect(text.split("\n")[0]).toBe("**Revue de la semaine**");
    expect(text).toContain("- Assistant · Factures : 2 passes");
    expect(text).not.toContain("répondu");
    expect(routine.prompt).not.toContain("répondu");
    expect(h.turns).toEqual([]);
  });
});

describe("#4250 S8: one person's review reads only that person's runs and waiting items", () => {
  it("another person's bot or run never enters the review", () => {
    const data = personReviewData({
      person: "person-1",
      bots: new Set(["main"]),
      runs: [
        run({ routineId: "r1", routineName: "Mine", status: "completed", finishedAt: START }),
        run({ routineId: "r2", routineName: "Theirs", botId: "other", status: "completed", finishedAt: START }),
        run({ routineId: "r3", routineName: "As them", runAs: "person-2", status: "completed", finishedAt: START }),
      ],
      waiting: [
        { id: "a", botId: "main", title: "Mine", at: START },
        { id: "b", botId: "other", title: "Theirs", at: START },
      ],
      singlePerson: false,
    });
    expect(data.runs.map((row) => row.routineName)).toEqual(["Mine"]);
    expect(data.waiting.map((row) => row.title)).toEqual(["Mine"]);
  });

  it("the window is a day for the end of day and a week for the weekly review", () => {
    expect(REVIEW_WINDOW_MS.end_of_day).toBe(DAY);
    expect(REVIEW_WINDOW_MS.weekly).toBe(7 * DAY);
    const review = composeReview({
      kind: "end_of_day", language: "en", now: START,
      runs: Array.from({ length: 12 }, (_, index) => run({ routineId: `r${index}`, routineName: `Job ${index}`, status: "completed", finishedAt: START - HOUR })),
      waiting: [], botName: () => "Assistant",
    })!;
    expect(review.text.split("\n")[0]).toBe("**End of day**");
    expect(review.text).toContain("**What your bots did**");
    expect(review.text).toContain("- Assistant · Job 0: 1 run");
    expect(review.text).toContain("And 4 more.");
  });
});

describe("#4250 S8 review fix: what waits is the one waiting list, never the ledger", () => {
  it("a wake event, a deferred run, a needs-you notice and a card answered after its last reminder are never listed; only an open Today item is", async () => {
    const h = harness();
    const routine = h.reviews.set("main", "end_of_day", true, "UTC")!;
    const due = nextOccurrence(routine.schedule, START, undefined)!;
    h.setNow(due - 2 * HOUR);
    // what ProactiveWaker writes for every mail, invite and webhook post
    h.ledger.note("person-1", { key: "mail:abc", kind: "event", level: "card", bot: "main", label: "Nouveau courriel de la banque" });
    h.ledger.note("person-1", { key: "run:r9", kind: "event", level: "card", bot: "main", label: "Routine failed: Factures" });
    // a run deferred while its target was busy, and a needs-you notice
    h.ledger.note("person-1", { key: "run-deferred:r7", kind: "event", level: "card", bot: "helper", label: "Passe reportée" });
    h.ledger.note("person-1", { key: "needs-you:m1", kind: "needs-you", level: "card", bot: "main", label: "Besoin de toi" });
    // a reach card answered after its last reminder: the ledger never settled it
    h.ledger.told("person-1", { key: "reach:card-1", kind: "reach-card", level: "urgent", bot: "main", label: "Carte déjà répondue" });
    // the one item still open in the person's Today
    h.waiting.push({ id: "card-2", botId: "helper", title: "Approuver la facture ?", at: due - HOUR });
    await h.tickAt(due);
    expect(h.delivered).toHaveLength(1);
    const text = h.delivered[0]!.text;
    expect(text).toContain("**Ce qui t'attend**\n- Approuver la facture ? (Aide)");
    expect(text.split("\n").filter((line) => line.startsWith("- "))).toEqual(["- Approuver la facture ? (Aide)"]);
    for (const label of ["Nouveau courriel", "Routine failed", "Passe reportée", "Besoin de toi", "Carte déjà répondue"]) expect(text).not.toContain(label);
    expect(h.manager.listRuns().find((row) => row.routineId === routine.id)).toMatchObject({ quietReason: "Revue envoyée. Passes : 0. En attente : 1. Échecs : 0." });
  });

  it("with only ledger entries and nothing in Today, nothing is posted", async () => {
    const h = harness();
    const routine = h.reviews.set("main", "end_of_day", true, "UTC")!;
    const due = nextOccurrence(routine.schedule, START, undefined)!;
    h.setNow(due - HOUR);
    h.ledger.note("person-1", { key: "mail:abc", kind: "event", level: "card", bot: "main", label: "Courriel" });
    await h.tickAt(due);
    expect(h.delivered).toEqual([]);
  });

  it("an item of a confidential conversation is named without its words", () => {
    const review = composeReview({
      kind: "end_of_day", language: "en", now: START, runs: [],
      waiting: [{ id: "x", botId: "main", title: "Secret salary question", at: START - HOUR, confidential: true }],
      botName: () => "Assistant",
    })!;
    expect(review.text).toContain("- An item that waits for your answer (Assistant)");
    expect(review.text).not.toContain("Secret");
  });
});

describe("#4250 S8: the switch in Settings is the person's yes", () => {
  it("PUT reviews creates or pauses the routine in the page's zone and leaves the brief alone", async () => {
    const h = harness();
    const store = new BriefStore(join(h.dir, "brief.json"));
    const route = createBackgroundBriefRoutes({
      store, owns: () => true, fastModel: () => null, keep: () => {}, connected: () => [],
      reads: async () => ({ tools: [], pieces: [] }) as never,
      reviews: { set: (botId, kind, on, timeZone) => h.reviews.set(botId, kind, on, timeZone), on: (botId, kind) => h.reviews.on(botId, kind) },
    });
    const call = async (body: unknown) => {
      let out: { status: number; body: Record<string, unknown> } = { status: 0, body: {} };
      await route({
        res: { setHeader: () => {} }, path: "/api/bots/main/background-brief", method: "PUT", auth: {} as never, req: {} as never,
        readBody: async () => body,
        json: (_res: unknown, status: number, payload: Record<string, unknown>) => { out = { status, body: payload }; },
      } as never);
      return out;
    };
    expect(await call({ reviews: { endOfDay: true }, timeZone: "Europe/Paris" })).toEqual({ status: 200, body: { reviews: { endOfDay: true, weekly: false } } });
    expect(reviewRoutineOf(h.manager.listRoutines(), "main", "end_of_day")?.schedule).toMatchObject({ timeZone: "Europe/Paris" });
    expect(store.saved("main")).toBe(false);
    expect(await call({ reviews: { endOfDay: false, weekly: true }, timeZone: "Europe/Paris" })).toEqual({ status: 200, body: { reviews: { endOfDay: false, weekly: true } } });
    expect(h.manager.listRoutines()).toHaveLength(2);
    // a review switch never saves the brief's settings
    expect(store.saved("main")).toBe(false);
  });
});
