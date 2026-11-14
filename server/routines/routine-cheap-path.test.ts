// #4250 (S6 `suggest-the-cheap-path`): a routine that runs several times a
// day and keeps ending quiet after the same read gets ONE proposal, on a
// keyed card, to make that read its pre-check (or its product trigger on a
// linked server); never twice, a restart included; retired the moment the
// routine has a pre-check, stopped repeating or was deleted.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { ENGLISH_WORDS } from "../../shared/approval-describe.ts";
import { serverCardKind, serverCardRoutineId } from "../../shared/fix-card-keys.ts";
import { SignalLedger, signalLedgerDirStorage } from "../proactive/signal-ledger.ts";
import {
  CHEAP_PATH_KIND,
  CHEAP_PATH_QUIET_RUNS,
  cheapPathCardInput,
  cheapPathFinding,
  cheapPathKey,
  firstToolStep,
  RoutineCheapPathCards,
  type CheapPathActivityRow,
  type CheapPathCardInput,
  type CheapPathRoutine,
  type CheapPathRun,
} from "./routine-cheap-path.ts";

const T0 = 1_800_000_000_000;
const EVERY_15 = { type: "interval", everyMinutes: 15, anchorAt: 0 };
const READ = "mcp__desk__ticket_list";
const routine = (extra: Partial<CheapPathRoutine> = {}): CheapPathRoutine => ({
  id: "r1", name: "Board sweep", botId: "b1", enabled: true, target: "bot", schedule: EVERY_15, ...extra,
});

/** What a real run does before its first product read: Claude's ToolSearch
 * (tool search is on by default, product tools are deferred), a skill, its
 * task list, a read of the bot's own state, a sub-agent's step and a
 * sign-in row. */
const HOUSEKEEPING: CheapPathActivityRow["tool"][] = [
  { name: "ToolSearch", input: "{\"query\":\"select:mcp__desk__ticket_list\"}" },
  { name: "Skill", input: "{\"skill\":\"triage\"}" },
  { name: "TodoWrite", input: "{\"todos\":[]}" },
  { name: "mcp__agents__list_routines", input: "{}" },
  { name: "mcp__ogb__memory", input: "{\"action\":\"read\"}" },
  { name: "mcp__desk__ticket_count", input: "{}", parentItemId: "toolu_sub" },
  { name: "mcp__desk__sign_in", setup: true },
];

/** Runs and their transcripts: each run opens with the engine's
 * housekeeping, then reads `tool`. */
function history(count: number, opts: { tool?: string; args?: (index: number) => unknown; quiet?: (index: number) => boolean; before?: CheapPathActivityRow["tool"][] } = {}) {
  const runs: CheapPathRun[] = [];
  const rows = new Map<string, CheapPathActivityRow[]>();
  for (let index = 0; index < count; index += 1) {
    const at = T0 + index * 15 * 60_000;
    const quiet = opts.quiet ? opts.quiet(index) : true;
    const run: CheapPathRun = { id: `x${index}`, status: "completed", createdAt: at, startedAt: at, finishedAt: at + 60_000, threadId: "run-thread", ...(quiet ? { quiet: true as const } : {}) };
    runs.push(run);
    const list = rows.get("run-thread") ?? [];
    list.push(
      { kind: "text", at: at + 1 },
      ...(opts.before ?? HOUSEKEEPING).map((tool, step) => ({ kind: "activity", at: at + 2 + step, tool })),
      { kind: "activity", at: at + 100, tool: { name: opts.tool ?? READ, input: JSON.stringify(opts.args ? opts.args(index) : { board: 12, open: true }) } },
      { kind: "activity", at: at + 101, tool: { name: "mcp__desk__ticket_get", input: "{\"id\":1}" } },
      { kind: "text", at: at + 102 },
    );
    rows.set("run-thread", list);
  }
  const step = (run: CheapPathRun) => firstToolStep(run, rows.get(run.threadId ?? "") ?? []);
  return { runs, step };
}

describe("cheapPathFinding", () => {
  it("finds the read every quiet run opened with, its arguments kept when they are the same", () => {
    const { runs, step } = history(CHEAP_PATH_QUIET_RUNS);
    expect(cheapPathFinding(routine(), runs, step, T0)).toEqual({ tool: READ, args: { board: 12, open: true }, product: false, count: CHEAP_PATH_QUIET_RUNS });
  });

  it("passes over ToolSearch, skills, the task list, the app's own tools, sub-agent and setup rows to the first product read", () => {
    const { runs, step } = history(CHEAP_PATH_QUIET_RUNS);
    expect(step(runs[0]!)).toEqual({ tool: READ, args: { board: 12, open: true } });
    expect(cheapPathFinding(routine(), runs, step, T0)?.tool).toBe(READ);
    // a run that never read a product or a server has no first read
    const none = history(1, { tool: "mcp__agents__list_routines" });
    expect(firstToolStep(none.runs[0]!, [{ kind: "activity", at: T0 + 2, tool: { name: "ToolSearch" } }])).toBeNull();
    // a product's own tool (declared productId) counts without a server prefix
    expect(firstToolStep(none.runs[0]!, [
      { kind: "activity", at: T0 + 2, tool: { name: "ToolSearch" } },
      { kind: "activity", at: T0 + 3, tool: { name: "desk_ticket_list", productId: "desk", input: "{}" } },
    ])).toEqual({ tool: "desk_ticket_list", args: {}, product: true });
  });

  it("needs enough quiet runs in a row", () => {
    expect(cheapPathFinding(routine(), history(CHEAP_PATH_QUIET_RUNS - 1).runs, history(CHEAP_PATH_QUIET_RUNS - 1).step, T0)).toBeNull();
    // the newest run had something for the person: the streak is broken
    const broken = history(CHEAP_PATH_QUIET_RUNS + 2, { quiet: (index) => index !== CHEAP_PATH_QUIET_RUNS + 1 });
    expect(cheapPathFinding(routine(), broken.runs, broken.step, T0)).toBeNull();
  });

  it("drops arguments that moved from run to run, keeps the read", () => {
    const { runs, step } = history(CHEAP_PATH_QUIET_RUNS, { args: (index) => ({ since: index }) });
    expect(cheapPathFinding(routine(), runs, step, T0)).toEqual({ tool: READ, product: false, count: CHEAP_PATH_QUIET_RUNS });
  });

  it("never proposes a write, the app's own tools, a routine with a pre-check, a daily one or a trigger", () => {
    const write = history(CHEAP_PATH_QUIET_RUNS, { tool: "mcp__desk__ticket_update" });
    expect(cheapPathFinding(routine(), write.runs, write.step, T0)).toBeNull();
    // the app's own read is passed over: the product read after it is the one
    const own = history(CHEAP_PATH_QUIET_RUNS, { tool: "mcp__agents__list_routines" });
    expect(cheapPathFinding(routine(), own.runs, own.step, T0)?.tool).toBe("mcp__desk__ticket_get");
    const { runs, step } = history(CHEAP_PATH_QUIET_RUNS);
    expect(cheapPathFinding(routine({ precheck: { kind: "watch", source: { type: "tool", tool: READ } } }), runs, step, T0)).toBeNull();
    expect(cheapPathFinding(routine({ schedule: { type: "daily", time: "09:00", weekdays: [1] } as never }), runs, step, T0)).toBeNull();
    expect(cheapPathFinding(routine({ schedule: { type: "webhook" } }), runs, step, T0)).toBeNull();
    expect(cheapPathFinding(routine({ enabled: false }), runs, step, T0)).toBeNull();
  });
});

describe("cheapPathCardInput", () => {
  const finding = { tool: READ, product: true, count: 6 };
  it("offers the pre-check and keep; the product trigger only on a linked server for a product read", () => {
    const solo = cheapPathCardInput(routine(), finding, ENGLISH_WORDS, false);
    expect(solo).toMatchObject({ tool: "ask_choice", key: "routine-cheap-path:r1", wait: false, decision: true, title: "Board sweep could run without waking its bot" });
    expect(solo.options).toEqual(["Run only when it changes", "Keep it as it is"]);
    expect(solo.question).toContain("ran 6 times in a row with nothing for you, and each run began by reading ticket_list.");
    // the read as the run showed it closes the question, for the bot that applies the answer
    expect(solo.question.split("\n\n").at(-1)).toBe(`The read, as the run showed it: ${READ}`);
    expect(cheapPathCardInput(routine(), { ...finding, args: { board: 12 } }, ENGLISH_WORDS, false).question).toContain(`The read, as the run showed it: ${READ} {"board":12}`);
    const linked = cheapPathCardInput(routine(), finding, ENGLISH_WORDS, true);
    expect(linked.options).toEqual(["Run only when it changes", "Start on a product change", "Keep it as it is"]);
    expect(linked.details).toHaveLength(3);
    expect(cheapPathCardInput(routine(), { ...finding, product: false }, ENGLISH_WORDS, true).options).toHaveLength(2);
  });

  it("is a server card of its own kind, naming its routine", () => {
    expect(serverCardKind(cheapPathKey("r1"))).toBe("saving");
    expect(serverCardKind("routine-problem:r1")).toBe("fix");
    expect(serverCardKind("product:desk")).toBe("fix");
    expect(serverCardKind("voice-line")).toBe("fix");
    expect(serverCardKind("ask-0123456789abcdef")).toBeNull();
    expect(serverCardRoutineId(cheapPathKey("r1"))).toBe("r1");
  });
});

describe("RoutineCheapPathCards", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function world(dir = mkdtempSync(join(tmpdir(), "cheap-path-"))) {
    dirs.push(dir);
    const signals = new SignalLedger({ storage: signalLedgerDirStorage(join(dir, "signal-ledger")), now: () => T0, schedule: (fn) => fn() });
    const asked: Array<CheapPathCardInput | { key: string; retire: true }> = [];
    const open = new Set<string>();
    const place = { posts: true };
    const data = history(CHEAP_PATH_QUIET_RUNS);
    let reads = 0;
    const cards = new RoutineCheapPathCards<CheapPathRoutine>({
      runs: () => data.runs,
      firstStep: (run) => { reads += 1; return data.step(run); },
      words: () => ENGLISH_WORDS,
      productTrigger: () => false,
      ask: (_routine, input) => {
        if (!place.posts) return false;
        asked.push(input);
        if ("retire" in input) open.delete(input.key);
        else open.add(input.key);
        return true;
      },
      pending: (_routine, key) => open.has(key),
      now: () => T0,
      signals,
      person: () => "p1",
    });
    return { dir, signals, asked, open, place, cards, data, reads: () => reads };
  }

  it("proposes once, quietly in the ledger, and never again after the answer or a restart", () => {
    const one = world();
    one.cards.syncAll([routine()]);
    expect(one.asked).toHaveLength(1);
    expect(one.signals.get("p1", "b1", "routine-cheap-path:r1")).toMatchObject({ kind: CHEAP_PATH_KIND, level: "fyi", state: "told" });
    // the next passes: nothing new, and settled runs are read once
    one.cards.syncAll([routine()]);
    one.cards.syncAll([routine()]);
    expect(one.asked).toHaveLength(1);
    expect(one.reads()).toBe(CHEAP_PATH_QUIET_RUNS);
    // the person answered "Keep it as it is": the card left, nothing again
    one.open.clear();
    one.cards.syncAll([routine()]);
    expect(one.asked).toHaveLength(1);
    // a restart reads the ledger from disk: still nothing
    one.signals.flush();
    const two = world(one.dir);
    two.cards.syncAll([routine()]);
    expect(two.asked).toHaveLength(0);
  });

  it("marks the proposal told only once its card was posted, and tries again until it is", () => {
    const one = world();
    // no place for the card yet (no conversation, or the card failed)
    one.place.posts = false;
    one.cards.syncAll([routine()]);
    expect(one.asked).toHaveLength(0);
    expect(one.signals.get("p1", "b1", "routine-cheap-path:r1")).toBeUndefined();
    // the next pass can post it: the person sees it, once
    one.place.posts = true;
    one.cards.syncAll([routine()]);
    one.cards.syncAll([routine()]);
    expect(one.asked).toHaveLength(1);
    expect(one.signals.get("p1", "b1", "routine-cheap-path:r1")?.state).toBe("told");
  });

  it("retires the open card when the routine got its pre-check or was deleted", () => {
    const one = world();
    one.cards.syncAll([routine()]);
    one.cards.syncAll([routine({ precheck: { kind: "watch", source: { type: "tool", tool: READ } } })]);
    expect(one.asked.at(-1)).toEqual({ tool: "ask_choice", key: "routine-cheap-path:r1", retire: true });
    expect(one.signals.get("p1", "b1", "routine-cheap-path:r1")?.state).toBe("retired");

    const two = world();
    two.cards.syncAll([routine()]);
    two.cards.syncAll([]);
    expect(two.asked.at(-1)).toEqual({ tool: "ask_choice", key: "routine-cheap-path:r1", retire: true });
  });
});
