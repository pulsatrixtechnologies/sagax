// Unified chat (2026-11-05): background work never floods the person's
// thread list, and the server archives what finished (background-sweep.ts).
import { rmSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";

import { personThreads } from "../../shared/background-threads.ts";
import { DATA_DIR } from "../config.ts";
import type { ModelSelection } from "../contracts.ts";
import { Store, toWireTask } from "../store.ts";
import { backgroundIdleMs, planBackgroundSweep, RESERVED_RUN_PREFIX, sweepSummary, type SweepBot } from "./background-sweep.ts";

const selection = (): ModelSelection => ({ instanceId: "claude", model: "default" });
const OWNER = "pr_00000000-0000-4000-8000-000000000001";
const HOUR = 60 * 60_000;

/** The threads the person's list shows for a bot, as every client derives them. */
function listed(store: Store, botId: string): string[] {
  const bot = store.bot(botId)!;
  const wire = store.tasks(botId).map((task) => toWireTask(task, bot.modelSelection));
  return personThreads(wire, bot.threadId).map((task) => task.threadId);
}

describe("10 routine runs and 5 hand-offs", () => {
  beforeEach(() => rmSync(DATA_DIR, { recursive: true, force: true }));

  it("open 0 new visible threads, and the sweep archives them once idle without touching the person's", () => {
    const store = new Store(selection);
    const scout = store.createBot({}, { seedMessages: false });
    const parker = store.createBot({}, { seedMessages: false });
    const before = { scout: listed(store, scout.id), parker: listed(store, parker.id) };
    expect(before.scout).toHaveLength(1);

    // the routine engine's createTask (server/index.ts): tagged with its run in the creating frame
    const runs = Array.from({ length: 10 }, (_, index) =>
      store.createTask(scout.id, `Watch · run ${index}`, false, undefined, undefined, undefined, OWNER,
        undefined, false, undefined, false, undefined, `run-${index}`)!);
    // each run hands work to a teammate: delegate_bot / coordinate_bots open "@Scout · work" there
    const handoffs = runs.slice(0, 5).map((run) =>
      store.createTask(parker.id, "@Scout · work", false, undefined,
        { botId: scout.id, name: "Scout", kind: "work", threadId: run.threadId, at: Date.now() })!);
    // and the runs open threads of their own: start_thread on itself, an AI client's send_prompt
    store.createTask(scout.id, "Read webhook message", false, undefined, { botId: scout.id, name: "Scout", at: Date.now() })!;
    const agent = store.createTask(scout.id, undefined, false, undefined, { botId: "agent:claude", name: "Claude", kind: "agent", at: Date.now() }, undefined, OWNER)!;
    store.setTaskAskedAt(scout.id, agent.threadId, Date.now()); // the AI client writes as the person

    expect(listed(store, scout.id)).toEqual(before.scout);
    expect(listed(store, parker.id)).toEqual(before.parker);
    expect(runs.length + handoffs.length).toBe(15);

    // A bot-opened thread the person wrote in is theirs: listed, and never swept.
    const adopted = store.createTask(scout.id, "Billing check", false, undefined, { botId: scout.id, name: "Scout", at: Date.now() })!;
    store.setTaskAskedAt(scout.id, adopted.threadId, Date.now());
    expect(listed(store, scout.id)).toContain(adopted.threadId);

    const bots: SweepBot[] = [scout, parker].map((bot) => ({ id: bot.id, threadId: store.bot(bot.id)!.threadId, tasks: store.tasks(bot.id) }));
    const busyHandoff = handoffs[4]!.threadId;
    const plan = planBackgroundSweep(bots, {
      now: Date.now() + HOUR, idleMs: 30 * 60_000,
      held: (_botId, threadId) => threadId === busyHandoff,
      personWroteIn: () => false,
    });
    expect(sweepSummary(plan)).toBe("ai-client 1, bot-opened 1, routine-run 10, handoff 4");
    const swept = new Set(plan.map((entry) => entry.threadId));
    expect(swept.has(adopted.threadId)).toBe(false);
    expect(swept.has(busyHandoff)).toBe(false);
    expect(swept.has(scout.threadId) || swept.has(parker.threadId)).toBe(false);

    expect(store.autoArchiveTasks(plan)).toBe(16);
    const task = store.taskByThread(parker.id, handoffs[0]!.threadId)!;
    expect(task.archivedAt).toBeTypeOf("number");
    expect(task.autoArchived).toBe(true);
    // nothing deleted
    expect(store.tasks(scout.id)).toHaveLength(1 + 10 + 2 + 1);
    expect(store.tasks(parker.id)).toHaveLength(1 + 5);

    // a person's write brings an auto-archived thread back; their own archive stays
    store.restoreAutoArchived(parker.id, handoffs[0]!.threadId);
    expect(store.taskByThread(parker.id, handoffs[0]!.threadId)!.archivedAt).toBeUndefined();
    store.patchTask(parker.id, handoffs[1]!.threadId, { archivedAt: 5 });
    expect(store.taskByThread(parker.id, handoffs[1]!.threadId)!.autoArchived).toBeUndefined();
    store.restoreAutoArchived(parker.id, handoffs[1]!.threadId);
    expect(store.taskByThread(parker.id, handoffs[1]!.threadId)!.archivedAt).toBe(5);
  });
});

describe("planBackgroundSweep", () => {
  const base = { now: 10 * HOUR, idleMs: 30 * 60_000, held: () => false, personWroteIn: () => false };
  const bot = (tasks: SweepBot["tasks"]): SweepBot[] => [{ id: "b", threadId: "open", tasks }];

  it("leaves the person's threads, recent, pinned, confidential, busy, waiting and opened-ahead ones", () => {
    const old = 1;
    const work = { botId: "m", kind: "work" };
    expect(planBackgroundSweep(bot([
      { threadId: "own", createdAt: old },
      { threadId: "open", createdAt: old, openedBy: work },
      { threadId: "fresh", createdAt: base.now - 60_000, openedBy: work },
      { threadId: "pinned", createdAt: old, openedBy: work, pinned: true },
      { threadId: "secret", createdAt: old, openedBy: work, confidential: true },
      { threadId: "busy", createdAt: old, openedBy: work, busy: true },
      { threadId: "waiting", createdAt: old, openedBy: work, activity: "waiting-on-you" },
      { threadId: "archived", createdAt: old, openedBy: work, archivedAt: 3 },
      { threadId: "ahead", createdAt: old, routineRunId: `${RESERVED_RUN_PREFIX}r1` },
      { threadId: "asked", createdAt: old, openedBy: { botId: "b" }, askedAt: 2 },
      { threadId: "due", createdAt: old, openedBy: work },
    ]), base).map((entry) => entry.threadId)).toEqual(["due"]);
  });

  it("reads the transcript for a person's line, except in a routine run", () => {
    const plan = planBackgroundSweep(bot([
      { threadId: "agent", createdAt: 1, openedBy: { botId: "agent:x", kind: "agent" }, askedAt: 2 },
      { threadId: "typed", createdAt: 1, openedBy: { botId: "agent:x", kind: "agent" }, askedAt: 2 },
      { threadId: "run", createdAt: 1, routineRunId: "r" },
    ]), { ...base, personWroteIn: (threadId) => threadId !== "agent" });
    expect(plan.map((entry) => entry.threadId)).toEqual(["agent", "run"]);
  });

  it("idles 30 minutes by default, SAGAX_BACKGROUND_ARCHIVE_IDLE_MIN otherwise", () => {
    expect(backgroundIdleMs({})).toBe(30 * 60_000);
    expect(backgroundIdleMs({ SAGAX_BACKGROUND_ARCHIVE_IDLE_MIN: "5" })).toBe(5 * 60_000);
    expect(backgroundIdleMs({ SAGAX_BACKGROUND_ARCHIVE_IDLE_MIN: "0" })).toBe(30 * 60_000);
  });
});
