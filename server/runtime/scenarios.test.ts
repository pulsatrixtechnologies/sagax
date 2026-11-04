// The scenario suite for the job runtime (docs/runtime-contract.md). One
// describe per contract section; every scenario is graded on runtime state
// (rows, events, inbox, runner calls), never on text beyond the envelope's
// opening marker, and ends with checkInvariants() === [].
//
// Everything is deterministic: no real timers, no sleeps. The fake clock
// moves time, tick() moves the runtime, and drain() repeats
// "flush microtasks, tick" until nothing changes any more.
import { afterEach, describe, expect, it } from "vitest";

import { ENVELOPE_MARK } from "./envelope.ts";
import { checkInvariants, replayStatus } from "./invariants.ts";
import { Runtime, type BeginRequest } from "./runtime.ts";
import { openRuntimeStore, type RuntimeStore } from "./store.ts";
import { FakeClock } from "./testing/fake-clock.ts";
import { complete, custom, fail, FakeRunner, handOut, hang, needsInput, type ChildSpec } from "./testing/fake-runner.ts";
import {
  terminal,
  type Assignment,
  type Assignee,
  type EnqueueResult,
  type Limits,
  type Origin,
  type Owner,
  type Requester,
  type Status,
} from "./types.ts";

// ── harness ────────────────────────────────────────────────────────────

const BOTS = {
  chief: { name: "Chief", chief: true },
  dev: { name: "Dev" },
  qa: { name: "QA" },
  ops: { name: "Ops" },
};

const CHIEF_THREAD = "thread-chief";
const PERSON_QUOTE = "Ship the release";
const chiefOwner: Owner = { botId: "chief", threadId: CHIEF_THREAD };

interface World {
  store: RuntimeStore;
  clock: FakeClock;
  runner: FakeRunner;
  rt: Runtime;
  limits: Partial<Limits>;
  logs: string[];
}

const worlds: World[] = [];

function world(limits: Partial<Limits> = {}): World {
  const store = openRuntimeStore(":memory:");
  const clock = new FakeClock();
  const runner = new FakeRunner(BOTS);
  const logs: string[] = [];
  const rt = new Runtime(store, runner, { clock, limits, log: (line) => logs.push(line) });
  runner.attach(rt);
  runner.lookup = (id) => store.get(id);
  rt.open();
  const w: World = { store, clock, runner, rt, limits, logs };
  worlds.push(w);
  return w;
}

/** The host process dies and comes back on the same database. */
function reopen(w: World): void {
  w.rt.close();
  w.runner.reboot();
  w.rt = new Runtime(w.store, w.runner, { clock: w.clock, limits: w.limits, log: (line) => w.logs.push(line) });
  w.runner.attach(w.rt);
  w.rt.open();
}

afterEach(() => {
  for (const w of worlds.splice(0)) {
    w.rt.close();
    w.store.close();
  }
});

const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

function signature(w: World): string {
  const rows = w.store.all().map((a) => `${a.id}:${a.status}:${a.executions}:${a.restart ?? ""}`).join("|");
  const calls = w.runner.calls.filter((c) => c.method === "run" || c.method === "park" || c.method === "report").length;
  return `${rows}#${calls}#${w.runner.running.size}`;
}

/** Tick until the runtime and the runner stop changing. */
async function drain(w: World, max = 60): Promise<void> {
  let last = "";
  for (let i = 0; i < max; i++) {
    await flush();
    w.rt.tick();
    await flush();
    const now = signature(w);
    if (now === last) return;
    last = now;
  }
  throw new Error(`drain: the runtime did not settle in ${max} rounds`);
}

function get(w: World, id: string): Assignment {
  const a = w.store.get(id);
  if (!a) throw new Error(`no assignment ${id}`);
  return a;
}

function invariants(w: World): void {
  expect(checkInvariants(w.store, w.runner.live())).toEqual([]);
}

function ok(r: EnqueueResult): Assignment {
  if (!r.ok) throw new Error(`enqueue refused: ${r.outcome}: ${r.reason}`);
  return r.assignment;
}

function refused(r: EnqueueResult | undefined): { reason: string; outcome: "refused" | "budget" | "duplicate" } {
  if (!r) throw new Error("no enqueue result recorded");
  if (r.ok) throw new Error(`expected a refusal, got ${r.assignment.id}`);
  return r;
}

const personOrigin = (): Origin => ({ kind: "person", source: "chat", ref: CHIEF_THREAD, quote: PERSON_QUOTE });
const chiefAssignee = (): Assignee => ({ botId: "chief", destination: { kind: "standing_thread", threadId: CHIEF_THREAD } });

function beginChief(w: World, over: Partial<BeginRequest> = {}): Assignment {
  return w.rt.begin({
    origin: personOrigin(),
    requester: { kind: "person", threadId: CHIEF_THREAD, chief: true },
    assignee: chiefAssignee(),
    brief: PERSON_QUOTE,
    level: "auto",
    ...over,
  });
}

let seq = 0;
/** Work for a teammate in a fresh work thread. */
function workFor(bot: string, brief: string, over: Partial<ChildSpec> = {}): ChildSpec {
  seq += 1;
  return { assignee: { botId: bot, destination: { kind: "work_thread", threadId: `work-${bot}-${seq}` } }, brief, ...over };
}

function enqueueFrom(w: World, parent: Assignment, spec: ChildSpec): EnqueueResult {
  return w.rt.enqueue(w.runner.childRequest(parent, spec));
}

const kinds = (w: World, id: string): string[] => w.store.events(id).map((e) => e.kind);

// ── §2 Lifecycle ───────────────────────────────────────────────────────

describe("§2 lifecycle", () => {
  it("S01 person → Chief root → one teammate completes → Chief resumes exactly once", async () => {
    const w = world();
    const root = beginChief(w);
    expect(root.status).toBe("running");
    expect(root.depth).toBe(0);
    expect(root.rootId).toBe(root.id);
    expect(root.executions).toBe(1);
    expect(root.reply).toBe("resume");

    const child = ok(enqueueFrom(w, root, workFor("dev", "Build the thing")));
    expect(child.status).toBe("queued");
    expect(child.parentId).toBe(root.id);
    expect(child.rootId).toBe(root.id);
    expect(child.depth).toBe(1);
    expect(child.origin).toEqual(root.origin);
    expect(child.mode).toBe("work");
    expect(child.reply).toBe("resume");
    expect(kinds(w, child.id)).toEqual(["enqueued"]);

    w.runner.script("dev", complete("built"));
    w.runner.script("chief", complete("all done"));
    w.rt.end(root.id, { ok: true, text: "handed out" });
    expect(get(w, root.id).status).toBe("waiting");
    expect(w.runner.runs()).toHaveLength(0);

    w.rt.tick();
    expect(get(w, child.id).status).toBe("running");
    expect(w.runner.running.has(child.id)).toBe(true);
    expect(w.rt.liveEdges()).toEqual([
      expect.objectContaining({ sourceBotId: "chief", targetBotId: "dev", state: "running", threadId: child.assignee.destination.threadId }),
    ]);
    expect(w.rt.outstanding(chiefOwner).map((a) => a.id)).toEqual([child.id]);
    invariants(w);

    await drain(w);

    const c = get(w, child.id);
    expect(c.status).toBe("completed");
    expect(c.outcome).toBe("done");
    expect(c.result).toBe("built");
    expect(c.executions).toBe(1);
    expect(c.finishedAt).toBeDefined();
    expect(c.reportedAt).toBeDefined();

    const childRuns = w.runner.runs(child.id);
    expect(childRuns).toHaveLength(1);
    const input = childRuns[0].input!;
    expect(input.envelope.startsWith(ENVELOPE_MARK)).toBe(true);
    expect(input.mode).toBe("work");
    expect(input.level).toBe(c.level);
    expect(input.answer).toBeUndefined();
    expect(input.settled ?? []).toHaveLength(0);
    expect(childRuns[0].settledAborted).toBe(false);

    const rootRuns = w.runner.runs(root.id);
    expect(rootRuns).toHaveLength(1);
    expect(rootRuns[0].input!.settled?.map((a) => a.id)).toEqual([child.id]);
    expect(rootRuns[0].input!.settled?.[0].outcome).toBe("done");
    expect(rootRuns[0].input!.mode).toBe("work");

    expect(w.runner.reports(child.id)).toHaveLength(1);
    expect(w.runner.reports(child.id)[0].parent?.id).toBe(root.id);
    expect(w.runner.reports(root.id)).toHaveLength(0);

    const inbox = w.store.inbox(chiefOwner, false);
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({ kind: "settled", assignmentId: child.id });
    expect(inbox[0].deliveredAt).toBeDefined();
    expect(w.store.inbox(chiefOwner, true)).toHaveLength(0);

    const r = get(w, root.id);
    expect(r.status).toBe("completed");
    expect(r.outcome).toBe("done");
    expect(r.executions).toBe(2);
    expect(w.rt.liveEdges()).toEqual([]);
    expect(w.rt.outstanding(chiefOwner)).toEqual([]);

    const ck = kinds(w, child.id);
    expect(ck[0]).toBe("enqueued");
    expect(ck).toContain("started");
    expect(ck).toContain("settled");
    expect(ck).toContain("reported");
    expect(w.rt.status(root.id)?.children.map((a) => a.id)).toEqual([child.id]);
    invariants(w);
  });

  it("S02 a duplicate brief returns the existing row; rework runs it again", async () => {
    const w = world();
    const root = beginChief(w);
    const spec = workFor("dev", "Write the docs");
    const first = w.rt.enqueue(w.runner.childRequest(root, spec));
    expect(first).toMatchObject({ ok: true, duplicate: false });
    const firstRow = ok(first);
    const again = w.rt.enqueue(w.runner.childRequest(root, spec));
    expect(again).toMatchObject({ ok: true, duplicate: true });
    expect(ok(again).id).toBe(firstRow.id);
    expect(w.store.all()).toHaveLength(2);

    w.runner.script("dev", complete("v1"), complete("v2"));
    let dup: EnqueueResult | undefined;
    let rework: EnqueueResult | undefined;
    w.runner.script(
      "chief",
      custom(({ handOut: give }) => {
        dup = give(spec);
        rework = give({ ...spec, rework: true });
        return { kind: "completed", text: "asked again" };
      }),
      complete("final"),
    );
    w.rt.end(root.id, { ok: true, text: "handed out" });
    await drain(w);

    expect(dup).toMatchObject({ ok: true, duplicate: true });
    expect(ok(dup!).id).toBe(firstRow.id);
    expect(rework).toMatchObject({ ok: true, duplicate: false });
    const second = ok(rework!);
    expect(second.id).not.toBe(firstRow.id);
    expect(second.rework).toBe(true);
    expect(second.brief).toBe(firstRow.brief);

    expect(w.runner.runs(firstRow.id)).toHaveLength(1);
    expect(w.runner.runs(second.id)).toHaveLength(1);
    expect(get(w, firstRow.id)).toMatchObject({ status: "completed", result: "v1" });
    expect(get(w, second.id)).toMatchObject({ status: "completed", result: "v2" });
    expect(w.runner.reports(firstRow.id)).toHaveLength(1);
    expect(w.runner.reports(second.id)).toHaveLength(1);

    const rootRuns = w.runner.runs(root.id);
    expect(rootRuns).toHaveLength(2);
    expect(rootRuns[0].input!.settled?.map((a) => a.id)).toEqual([firstRow.id]);
    // A resume returns every settled result of the node, so the rework's
    // resume carries the first round's result again beside its own.
    expect(rootRuns[1].input!.settled?.map((a) => a.id)).toEqual([firstRow.id, second.id]);
    expect(get(w, root.id).status).toBe("completed");
    expect(w.store.all()).toHaveLength(3);
    invariants(w);
  });

  it("S03 the depth limit refuses with a typed reason", async () => {
    const w = world({ depth: 1 });
    const root = beginChief(w);
    const child = ok(enqueueFrom(w, root, workFor("dev", "Build")));
    expect(child.depth).toBe(1);
    let grand: EnqueueResult | undefined;
    w.runner.script(
      "dev",
      custom(({ handOut: give }) => {
        grand = give(workFor("qa", "Test"));
        return { kind: "completed", text: "built alone" };
      }),
    );
    w.rt.end(root.id, { ok: true, text: "" });
    await drain(w);

    const refusal = refused(grand);
    expect(refusal.outcome).toBe("refused");
    expect(typeof refusal.reason).toBe("string");
    expect(refusal.reason.length).toBeGreaterThan(0);
    expect(w.store.all({ nonTerminal: true })).toEqual([]);
    expect(w.store.all().filter((a) => a.assignee.botId === "qa" && !terminal(a.status))).toEqual([]);
    expect(get(w, child.id).status).toBe("completed");
    expect(get(w, root.id).status).toBe("completed");
    expect(w.runner.runs().filter((c) => c.a!.assignee.botId === "qa")).toHaveLength(0);
    invariants(w);
  });

  it("S04 work back to an ancestor is refused", async () => {
    const w = world();
    const root = beginChief(w);
    const child = ok(enqueueFrom(w, root, workFor("dev", "Build")));
    let back: EnqueueResult | undefined;
    let backToRoot: EnqueueResult | undefined;
    let toSibling: EnqueueResult | undefined;
    w.runner.script(
      "dev",
      custom(({ a, handOut: give }) => {
        back = give({ assignee: chiefAssignee(), brief: "Please review" });
        backToRoot = give({ assignee: a.assignee, brief: "Do it myself" });
        toSibling = give(workFor("qa", "Test"));
        return { kind: "completed", text: "built" };
      }),
    );
    w.rt.end(root.id, { ok: true, text: "" });
    await drain(w);

    expect(refused(back).outcome).toBe("refused");
    expect(refused(backToRoot).outcome).toBe("refused");
    const sibling = ok(toSibling!);
    expect(sibling.parentId).toBe(child.id);
    expect(sibling.depth).toBe(2);
    expect(get(w, sibling.id).status).toBe("completed");
    expect(get(w, child.id).status).toBe("completed");
    expect(get(w, root.id).status).toBe("completed");
    expect(w.store.all().filter((a) => a.assignee.botId === "chief")).toHaveLength(1);
    invariants(w);
  });

  it("S05 consult mode runs with RunInput.mode consult", async () => {
    const w = world();
    const root = beginChief(w);
    const child = ok(enqueueFrom(w, root, workFor("dev", "What does the build do?", { mode: "consult" })));
    expect(child.mode).toBe("consult");
    expect(child.reply).toBe("resume");
    w.runner.script("dev", complete("it builds"));
    w.rt.end(root.id, { ok: true, text: "" });
    await drain(w);

    const runs = w.runner.runs(child.id);
    expect(runs).toHaveLength(1);
    expect(runs[0].input!.mode).toBe("consult");
    expect(runs[0].input!.envelope.startsWith(ENVELOPE_MARK)).toBe(true);
    expect(get(w, child.id)).toMatchObject({ status: "completed", outcome: "done", result: "it builds" });
    expect(w.runner.reports(child.id)).toHaveLength(1);
    expect(w.runner.runs(root.id)).toHaveLength(1);
    expect(w.runner.runs(root.id)[0].input!.settled?.map((a) => a.id)).toEqual([child.id]);
    expect(get(w, root.id).status).toBe("completed");
    invariants(w);
  });

  it("S06 notify mode: no inbox, no resume, terminal recorded", async () => {
    const w = world();
    const root = beginChief(w);
    const child = ok(enqueueFrom(w, root, workFor("dev", "FYI: release at 5", { mode: "notify", reply: "none" })));
    expect(child.mode).toBe("notify");
    expect(child.reply).toBe("none");
    w.runner.script("dev", complete("noted"));
    w.rt.end(root.id, { ok: true, text: "told dev" });
    await drain(w);

    const c = get(w, child.id);
    expect(c.status).toBe("completed");
    expect(c.outcome).toBe("done");
    expect(kinds(w, child.id)).toContain("settled");
    expect(w.runner.runs(child.id)).toHaveLength(1);
    expect(w.runner.runs(child.id)[0].input!.mode).toBe("notify");
    expect(w.store.inbox(chiefOwner, false)).toEqual([]);
    expect(w.runner.runs(root.id)).toHaveLength(0);
    expect(w.runner.reports(child.id).length).toBeLessThanOrEqual(1);
    const r = get(w, root.id);
    expect(terminal(r.status)).toBe(true);
    expect(r.status).toBe("completed");
    invariants(w);
  });

  it("S07 needs_input: park, answer(), the next run carries the answer", async () => {
    const w = world({ stallMs: 60_000, inputWaitMs: 600_000 });
    const root = beginChief(w);
    const child = ok(enqueueFrom(w, root, workFor("dev", "Pick a colour")));
    w.runner.script("dev", needsInput("Which colour?"), complete("blue it is"));
    w.rt.end(root.id, { ok: true, text: "" });
    await drain(w);

    const parked = get(w, child.id);
    expect(parked.status).toBe("needs_input");
    expect(parked.question).toBe("Which colour?");
    expect(parked.answer).toBeUndefined();
    expect(w.runner.parks(child.id)).toHaveLength(1);
    expect(w.runner.parks(child.id)[0].question).toBe("Which colour?");
    expect(w.runner.parked.has(child.id)).toBe(true);
    expect(w.runner.running.size).toBe(0);
    expect(kinds(w, child.id)).toContain("parked");
    expect(get(w, root.id).status).toBe("waiting");
    expect(w.rt.liveEdges()).toEqual([expect.objectContaining({ targetBotId: "dev", state: "needs_input" })]);
    invariants(w);

    // Time parked on the person is charged to no window.
    w.clock.advance(120_000);
    await drain(w);
    expect(get(w, child.id).status).toBe("needs_input");
    expect(get(w, root.id).status).toBe("waiting");

    expect(w.rt.answer("no-such-id", "x")).toBe(false);
    expect(w.rt.answer(root.id, "x")).toBe(false);
    expect(w.rt.answer(child.id, "blue")).toBe(true);
    expect(kinds(w, child.id)).toContain("answered");
    await drain(w);

    const runs = w.runner.runs(child.id);
    expect(runs).toHaveLength(2);
    expect(runs[0].input!.answer).toBeUndefined();
    expect(runs[1].input!.answer).toBe("blue");
    expect(runs[1].input!.envelope.startsWith(ENVELOPE_MARK)).toBe(true);
    const done = get(w, child.id);
    expect(done).toMatchObject({ status: "completed", outcome: "done", result: "blue it is" });
    expect(done.executions).toBe(2);
    expect(w.runner.parked.size).toBe(0);
    expect(w.runner.reports(child.id)).toHaveLength(1);
    expect(w.store.inbox(chiefOwner, false).filter((i) => i.kind === "settled")).toHaveLength(1);
    // The question resumed the root once, then the result once more.
    expect(w.runner.runs(root.id).map((run) => [run.input!.asked?.map((a) => a.id), run.input!.settled?.map((a) => a.id)]))
      .toEqual([[[child.id], undefined], [undefined, [child.id]]]);
    expect(get(w, root.id).status).toBe("completed");
    invariants(w);
  });

  it("S07b needs_input expiry → expired(expired), never completed, parent woken once (I5)", async () => {
    const w = world({ inputWaitMs: 1_000 });
    const root = beginChief(w);
    const child = ok(enqueueFrom(w, root, workFor("dev", "Pick a colour")));
    w.runner.script("dev", needsInput("Which colour?"), complete("never"));
    w.rt.end(root.id, { ok: true, text: "" });
    await drain(w);
    expect(get(w, child.id).status).toBe("needs_input");

    w.clock.advance(999);
    await drain(w);
    expect(get(w, child.id).status).toBe("needs_input");

    w.clock.advance(2);
    await drain(w);
    const c = get(w, child.id);
    expect(c.status).toBe("expired");
    expect(c.outcome).toBe("expired");
    expect(kinds(w, child.id)).not.toContain("answered");
    expect(w.runner.runs(child.id)).toHaveLength(1);
    expect(w.runner.reports(child.id)).toHaveLength(1);
    expect(w.runner.parked.size).toBe(0);
    expect(w.rt.answer(child.id, "too late")).toBe(false);

    const rootRuns = w.runner.runs(root.id);
    expect(rootRuns).toHaveLength(2);
    expect(rootRuns[0].input!.asked?.map((a) => a.id)).toEqual([child.id]);
    expect(rootRuns[1].input!.settled?.map((a) => [a.id, a.status, a.outcome])).toEqual([[child.id, "expired", "expired"]]);
    expect(w.store.inbox(chiefOwner, false).filter((i) => i.kind === "settled")).toHaveLength(1);
    expect(get(w, root.id).status).toBe("completed");
    invariants(w);
  });
});

describe("§4b a question waits for the person (bot quality 2026-10-19)", () => {
  it("S07c default limits: mid-delay reminder at 120 of 240 min, then answer resumes (R6)", async () => {
    const w = world();
    const root = beginChief(w);
    const long = `Which colour? ${"Context the person needs to decide. ".repeat(12)}End of question.`;
    const child = ok(enqueueFrom(w, root, workFor("dev", "Pick a colour")));
    w.runner.script("dev", needsInput(long), complete("painted blue"));
    w.rt.end(root.id, { ok: true, text: "" });
    await drain(w);
    expect(get(w, child.id).status).toBe("needs_input");
    expect(w.runner.callsOf("remind", child.id)).toHaveLength(0);

    // Before mid-delay (half of 240 m): no remind.
    w.clock.advance(119 * 60_000);
    await drain(w);
    expect(w.runner.callsOf("remind", child.id)).toHaveLength(0);

    w.clock.advance(2 * 60_000);
    await drain(w);
    expect(get(w, child.id).status).toBe("needs_input");
    const reminders = w.runner.callsOf("remind", child.id);
    expect(reminders).toHaveLength(1);
    expect(reminders[0]!.question).toBe(long);
    expect(long.length).toBeGreaterThan(180);

    w.clock.advance(14 * 60_000);
    await drain(w);
    expect(w.runner.callsOf("remind", child.id)).toHaveLength(1);
    expect(w.rt.answer(child.id, "blue")).toBe(true);
    await drain(w);
    const c = get(w, child.id);
    expect(c.status).toBe("completed");
    expect(c.outcome).toBe("done");
    expect(get(w, root.id).status).toBe("completed");
    invariants(w);
  });

  it("S07d reminds at mid-delay then daily, and expires only after the week", async () => {
    // A host that lets a delegation's question wait the whole week (the
    // default closes a delegation sooner, S07e). First remind at half of
    // that wait (4 d), then one a day (R6). Reminds fire once waited
    // strictly exceeds each threshold, so six days exactly yields mid +
    // day 5; one more hour yields day 6.
    const w = world({ delegationInputWaitMs: 8 * 24 * 60 * 60_000 });
    const root = beginChief(w);
    const child = ok(enqueueFrom(w, root, workFor("dev", "Pick a colour")));
    w.runner.script("dev", needsInput("Which colour?"), complete("never"));
    w.rt.end(root.id, { ok: true, text: "" });
    await drain(w);
    for (let hour = 0; hour < 6 * 24; hour += 1) {
      w.clock.advance(60 * 60_000);
      await drain(w);
    }
    expect(get(w, child.id).status).toBe("needs_input");
    expect(w.runner.callsOf("remind", child.id).length).toBe(2);
    w.clock.advance(60 * 60_000);
    await drain(w);
    expect(get(w, child.id).status).toBe("needs_input");
    expect(w.runner.callsOf("remind", child.id).length).toBe(3);
    w.clock.advance(24 * 60 * 60_000);
    await drain(w);
    expect(get(w, child.id)).toMatchObject({ status: "expired", outcome: "expired" });
    invariants(w);
  });

  it("S07h default_answer resumes the branch instead of expiring (R6)", async () => {
    const w = world();
    const root = beginChief(w);
    const child = ok(enqueueFrom(w, root, { ...workFor("dev", "Pick a colour"), defaultAnswer: "blue" }));
    w.runner.script("dev", needsInput("GO?"), complete("painted blue"));
    w.rt.end(root.id, { ok: true, text: "" });
    await drain(w);
    expect(get(w, child.id).status).toBe("needs_input");
    w.clock.advance(4 * 60 * 60_000 + 60_000);
    await drain(w);
    expect(kinds(w, child.id)).toContain("answered");
    const runs = w.runner.runs(child.id);
    expect(runs).toHaveLength(2);
    expect(runs[1]!.input!.answer).toMatch(/declared default answer/);
    expect(runs[1]!.input!.answer).toMatch(/blue/);
    const c = get(w, child.id);
    expect(c.status).toBe("completed");
    expect(c.outcome).toBe("done");
    expect(c.result).toBe("painted blue");
    expect(get(w, root.id).status).toBe("completed");
    invariants(w);
  });

  // 2026-10-29: a bot handed work to teammates that each waited hours on a
  // GO in their own conversation; every one stayed "waiting on you" under
  // each new turn of the requester. A stale delegation closes.
  it("S07e closes a delegation parked longer than delegationInputWaitMs, and tells the requester", async () => {
    const w = world();
    const root = beginChief(w);
    const child = ok(enqueueFrom(w, root, workFor("dev", "Pick a colour")));
    w.runner.script("dev", needsInput("GO?"), complete("never"));
    w.rt.end(root.id, { ok: true, text: "" });
    await drain(w);
    expect(get(w, child.id).status).toBe("needs_input");
    w.clock.advance(3 * 60 * 60_000);
    await drain(w);
    expect(get(w, child.id).status).toBe("needs_input");
    w.clock.advance(61 * 60_000);
    await drain(w);
    expect(get(w, child.id)).toMatchObject({ status: "expired", outcome: "expired" });
    expect(get(w, child.id).result).toMatch(/did not answer within 240m/);
    expect(w.runner.reports(child.id)).toHaveLength(1);
    invariants(w);
  });

  // 0.8.46: a question closed without the person tells its cards so
  // (runner.unparked), never that the person answered.
  it("S07e2 tells the host a parked question expired without the person's answer", async () => {
    const w = world();
    const closed: Array<{ id: string; reason: string; defaulted: boolean }> = [];
    (w.runner as unknown as { unparked: (a: { id: string }, reason: string, defaulted: boolean) => void }).unparked = (a, reason, defaulted) => closed.push({ id: a.id, reason, defaulted });
    const root = beginChief(w);
    const child = ok(enqueueFrom(w, root, workFor("dev", "Pick a colour")));
    w.runner.script("dev", needsInput("GO?"), complete("never"));
    w.rt.end(root.id, { ok: true, text: "" });
    await drain(w);
    expect(closed).toEqual([]);
    w.clock.advance(4 * 60 * 60_000 + 60_000);
    await drain(w);
    expect(get(w, child.id).status).toBe("expired");
    expect(closed).toEqual([{ id: child.id, reason: expect.stringMatching(/did not answer within 240m/), defaulted: false }]);
    invariants(w);
  });

  it("S07f a restart closes a stale delegation instead of parking it again", async () => {
    const w = world();
    const root = beginChief(w);
    const child = ok(enqueueFrom(w, root, workFor("dev", "Pick a colour")));
    w.runner.script("dev", needsInput("GO?"), complete("never"));
    w.rt.end(root.id, { ok: true, text: "" });
    await drain(w);
    const parks = w.runner.callsOf("park", child.id).length;
    // the server was down for five hours
    w.rt.close();
    w.clock.advance(5 * 60 * 60_000);
    reopen(w);
    expect(get(w, child.id)).toMatchObject({ status: "expired", outcome: "expired" });
    expect(w.runner.callsOf("park", child.id)).toHaveLength(parks);
    await drain(w);
    invariants(w);
  });

  it("S07g closes a park whose question can no longer be answered (runner.parkedGone)", async () => {
    const w = world();
    const gone = new Set<string>();
    (w.runner as unknown as { parkedGone: (a: { id: string }) => boolean }).parkedGone = (a) => gone.has(a.id);
    const root = beginChief(w);
    const child = ok(enqueueFrom(w, root, workFor("dev", "Pick a colour")));
    w.runner.script("dev", needsInput("GO?"), complete("never"));
    w.rt.end(root.id, { ok: true, text: "" });
    await drain(w);
    w.clock.advance(60_000);
    await drain(w);
    expect(get(w, child.id).status).toBe("needs_input");
    gone.add(child.id);
    w.clock.advance(60_000);
    await drain(w);
    expect(get(w, child.id)).toMatchObject({ status: "expired", outcome: "expired" });
    invariants(w);
  });
});

// ── §5 Restart ─────────────────────────────────────────────────────────

describe("§5 restart", () => {
  it("S08 a running leaf reruns once with RunInput.resumed; cut again → failed(interrupted), reported (I8)", async () => {
    const w = world();
    const root = beginChief(w);
    const child = ok(enqueueFrom(w, root, workFor("dev", "Build")));
    w.runner.script("dev", hang(), hang());
    w.rt.end(root.id, { ok: true, text: "" });
    await drain(w);
    expect(get(w, child.id).status).toBe("running");
    expect(w.runner.hungIds()).toEqual([child.id]);
    invariants(w);

    reopen(w);
    const afterOpen = get(w, child.id);
    expect(afterOpen.restart).toBe("rerun");
    expect(afterOpen.restarts).toBe(1);
    expect(terminal(afterOpen.status)).toBe(false);
    expect(kinds(w, child.id)).toContain("restart_reconciled");
    expect(get(w, root.id).status).toBe("waiting");
    expect(get(w, root.id).restart).toBe("teammates");
    await drain(w);

    const runs = w.runner.runs(child.id);
    expect(runs).toHaveLength(2);
    expect(runs[1].input!.resumed).toBe(true);
    expect(runs[1].input!.restartNote.length).toBeGreaterThan(0);
    expect(runs[1].input!.envelope.startsWith(ENVELOPE_MARK)).toBe(true);
    expect(runs[1].a!.restart).toBe("rerun");
    expect(runs[0].input!.resumed).toBe(false);
    expect(runs[0].input!.restartNote).toBe("");
    expect(get(w, child.id).status).toBe("running");
    expect(get(w, child.id).executions).toBe(2);
    invariants(w);

    reopen(w);
    await drain(w);
    const c = get(w, child.id);
    expect(c.status).toBe("failed");
    expect(c.outcome).toBe("interrupted");
    expect(c.restarts).toBe(1);
    expect(w.runner.runs(child.id)).toHaveLength(2);
    expect(w.runner.reports(child.id)).toHaveLength(1);
    expect(w.runner.reports(child.id)[0].parent?.id).toBe(root.id);

    const rootRuns = w.runner.runs(root.id);
    expect(rootRuns).toHaveLength(1);
    expect(rootRuns[0].input!.settled?.map((a) => [a.id, a.outcome])).toEqual([[child.id, "interrupted"]]);
    expect(rootRuns[0].a!.restart).toBe("teammates");
    expect(rootRuns[0].input!.restartNote.length).toBeGreaterThan(0);
    expect(get(w, root.id).status).toBe("completed");
    expect(get(w, root.id).restart).toBeUndefined();
    expect(w.store.inbox(chiefOwner, true)).toHaveLength(0);
    invariants(w);
  });

  it("S09 a running node that handed out work → waiting; its resume says cut", async () => {
    const w = world();
    const root = beginChief(w);
    const child = ok(enqueueFrom(w, root, workFor("dev", "Build")));
    w.runner.script("dev", handOut([workFor("qa", "Test")], hang()), complete("c done"));
    w.runner.script("qa", hang(), complete("g done"));
    w.rt.end(root.id, { ok: true, text: "" });
    await drain(w);
    const grand = w.store.children(child.id)[0];
    expect(grand).toBeDefined();
    expect(get(w, child.id).status).toBe("running");
    expect(get(w, grand.id).status).toBe("running");
    expect(w.runner.hungIds().sort()).toEqual([child.id, grand.id].sort());
    invariants(w);

    reopen(w);
    const c = get(w, child.id);
    expect(c.status).toBe("waiting");
    expect(c.restart).toBe("cut");
    expect(c.restarts).toBe(0);
    expect(kinds(w, child.id)).toContain("restart_reconciled");
    const g = get(w, grand.id);
    expect(g.restart).toBe("rerun");
    expect(g.restarts).toBe(1);
    expect(get(w, root.id).restart).toBe("teammates");
    invariants(w);

    await drain(w);
    expect(w.runner.runs(grand.id)).toHaveLength(2);
    expect(get(w, grand.id)).toMatchObject({ status: "completed", result: "g done" });
    const childRuns = w.runner.runs(child.id);
    expect(childRuns).toHaveLength(2);
    expect(childRuns[1].input!.settled?.map((a) => a.id)).toEqual([grand.id]);
    expect(childRuns[1].a!.restart).toBe("cut");
    expect(childRuns[1].input!.restartNote.length).toBeGreaterThan(0);
    expect(get(w, child.id)).toMatchObject({ status: "completed", restarts: 0, result: "c done" });
    expect(get(w, child.id).restart).toBeUndefined();
    expect(w.runner.reports(grand.id)).toHaveLength(1);
    expect(w.runner.reports(child.id)).toHaveLength(1);
    expect(w.runner.runs(root.id)).toHaveLength(1);
    expect(get(w, root.id).status).toBe("completed");
    invariants(w);
  });

  it("S10 needs_input is re-parked at open and still answerable", async () => {
    const w = world();
    const root = beginChief(w);
    const child = ok(enqueueFrom(w, root, workFor("dev", "Pick a colour")));
    w.runner.script("dev", needsInput("Which colour?"), complete("blue"));
    w.rt.end(root.id, { ok: true, text: "" });
    await drain(w);
    expect(get(w, child.id).status).toBe("needs_input");
    expect(w.runner.parks(child.id)).toHaveLength(1);

    reopen(w);
    expect(w.runner.parks(child.id)).toHaveLength(2);
    expect(w.runner.parks(child.id)[1].question).toBe("Which colour?");
    expect(w.runner.parked.has(child.id)).toBe(true);
    expect(get(w, child.id).status).toBe("needs_input");
    expect(get(w, child.id).restarts).toBe(0);
    await drain(w);
    expect(get(w, child.id).status).toBe("needs_input");
    expect(w.runner.runs(child.id)).toHaveLength(1);
    invariants(w);

    expect(w.rt.answer(child.id, "blue")).toBe(true);
    await drain(w);
    const runs = w.runner.runs(child.id);
    expect(runs).toHaveLength(2);
    expect(runs[1].input!.answer).toBe("blue");
    expect(get(w, child.id)).toMatchObject({ status: "completed", result: "blue" });
    expect(w.runner.reports(child.id)).toHaveLength(1);
    // The restart re-parked the question without passing it on a second time.
    expect(w.runner.runs(root.id).map((run) => [run.input!.asked?.map((a) => a.id), run.input!.settled?.map((a) => a.id)]))
      .toEqual([[[child.id], undefined], [undefined, [child.id]]]);
    expect(get(w, root.id).status).toBe("completed");
    invariants(w);
  });
});

// ── §6 Budgets and clocks ──────────────────────────────────────────────

describe("§6 budgets and clocks", () => {
  it("S11 24 requests accepted, the 25th refused as budget; a settlement renews the window", async () => {
    const w = world({ requests: 24, executions: 1_000, wakes: 1_000 });
    const root = beginChief(w);
    const children: Assignment[] = [];
    for (let i = 0; i < 24; i++) children.push(ok(enqueueFrom(w, root, workFor("dev", `Task ${i}`))));
    const over = refused(enqueueFrom(w, root, workFor("dev", "Task 24")));
    expect(over.outcome).toBe("budget");
    expect(over.reason.length).toBeGreaterThan(0);
    expect(w.store.all()).toHaveLength(25);
    expect(get(w, root.id).budgets?.requests).toBe(24);

    // The teammates work while the Chief's own turn is still running.
    await drain(w);
    expect(children.every((c) => get(w, c.id).status === "completed")).toBe(true);
    expect(get(w, root.id).status).toBe("running");
    expect(w.runner.runs(root.id)).toHaveLength(0);
    expect(w.store.inbox(chiefOwner, true)).toHaveLength(24);
    invariants(w);

    const renewed = ok(enqueueFrom(w, root, workFor("dev", "Task 24")));
    expect(renewed.status).toBe("queued");
    w.rt.end(root.id, { ok: true, text: "" });
    await drain(w);

    expect(get(w, renewed.id).status).toBe("completed");
    const rootRuns = w.runner.runs(root.id);
    expect(rootRuns).toHaveLength(1);
    expect(rootRuns[0].input!.settled?.map((a) => a.id).sort()).toEqual([...children.map((c) => c.id), renewed.id].sort());
    expect(w.store.inbox(chiefOwner, true)).toHaveLength(0);
    expect(w.store.inbox(chiefOwner, false)).toHaveLength(25);
    expect(get(w, root.id).status).toBe("completed");
    invariants(w);
  });

  it("S12 the owed resume turn runs even when executions are exhausted", async () => {
    const w = world({ executions: 0 });
    const root = beginChief(w);
    const child = ok(enqueueFrom(w, root, workFor("dev", "Build")));
    w.rt.end(root.id, { ok: true, text: "" });
    expect(get(w, root.id).status).toBe("waiting");
    w.rt.cancel(child.id, "not needed");
    await drain(w);

    expect(get(w, child.id)).toMatchObject({ status: "cancelled", outcome: "stopped" });
    expect(w.runner.runs(child.id)).toHaveLength(0);
    expect(w.runner.reports(child.id)).toHaveLength(1);
    const rootRuns = w.runner.runs(root.id);
    expect(rootRuns).toHaveLength(1);
    expect(rootRuns[0].input!.settled?.map((a) => a.id)).toEqual([child.id]);
    expect(get(w, root.id).status).toBe("completed");
    invariants(w);
  });

  it("S13 queue expiry: never started past queueMs → expired(expired)", async () => {
    const w = world({ queueMs: 1_000, stallMs: 1e9 });
    const root = beginChief(w);
    w.runner.setCanStart("dev", false);
    const child = ok(enqueueFrom(w, root, workFor("dev", "Build")));
    w.rt.end(root.id, { ok: true, text: "" });
    await drain(w);
    expect(get(w, child.id).status).toBe("queued");

    w.clock.advance(999);
    await drain(w);
    expect(get(w, child.id).status).toBe("queued");
    invariants(w);

    w.clock.advance(2);
    await drain(w);
    const c = get(w, child.id);
    expect(c.status).toBe("expired");
    expect(c.outcome).toBe("expired");
    expect(c.startedAt).toBeUndefined();
    expect(c.executions).toBe(0);
    expect(w.runner.runs(child.id)).toHaveLength(0);
    expect(w.runner.reports(child.id)).toHaveLength(1);
    expect(kinds(w, child.id)).not.toContain("started");
    const rootRuns = w.runner.runs(root.id);
    expect(rootRuns).toHaveLength(1);
    expect(rootRuns[0].input!.settled?.map((a) => [a.id, a.outcome])).toEqual([[child.id, "expired"]]);
    expect(get(w, root.id).status).toBe("completed");
    invariants(w);
  });

  it("S14 root stall: no durable progress for stallMs → tree failed(stalled), report(root) once (I4)", async () => {
    const w = world({ stallMs: 10_000, queueMs: 1e9 });
    const root = beginChief(w);
    w.runner.setCanStart("dev", false);
    const child = ok(enqueueFrom(w, root, workFor("dev", "Build")));
    w.rt.end(root.id, { ok: true, text: "" });
    await drain(w);
    expect(get(w, root.id).status).toBe("waiting");

    w.clock.advance(9_999);
    await drain(w);
    expect(get(w, root.id).status).toBe("waiting");
    expect(get(w, child.id).status).toBe("queued");
    invariants(w);

    w.clock.advance(2);
    await drain(w);
    const r = get(w, root.id);
    expect(r.status).toBe("failed");
    expect(r.outcome).toBe("stalled");
    expect(kinds(w, root.id)).toContain("stalled");
    expect(terminal(get(w, child.id).status)).toBe(true);
    expect(w.runner.runs(child.id)).toHaveLength(0);
    expect(w.runner.runs(root.id)).toHaveLength(0);
    expect(w.runner.reports(root.id)).toHaveLength(1);
    expect(w.store.all({ nonTerminal: true })).toEqual([]);
    expect(w.rt.liveEdges()).toEqual([]);
    invariants(w);
  });

  it("S14b a root with a needs_input node is never stalled", async () => {
    const w = world({ stallMs: 10_000, inputWaitMs: 1e9 });
    const root = beginChief(w);
    const child = ok(enqueueFrom(w, root, workFor("dev", "Pick")));
    w.runner.script("dev", needsInput("Which?"), complete("ok"));
    w.rt.end(root.id, { ok: true, text: "" });
    await drain(w);
    expect(get(w, child.id).status).toBe("needs_input");

    w.clock.advance(100_000);
    await drain(w);
    expect(get(w, root.id).status).toBe("waiting");
    expect(get(w, child.id).status).toBe("needs_input");
    expect(w.runner.reports(root.id)).toHaveLength(0);
    invariants(w);

    expect(w.rt.answer(child.id, "that one")).toBe(true);
    await drain(w);
    expect(get(w, child.id).status).toBe("completed");
    expect(get(w, root.id).status).toBe("completed");
    invariants(w);
  });

  it("S15 per-turn stall: sleep() is not a stall, monotonic advance is; progress() resets it", async () => {
    const w = world({ turnStallMs: 5_000, stallMs: 1e9, queueMs: 1e9 });
    const root = beginChief(w);
    const a = ok(enqueueFrom(w, root, workFor("dev", "Build")));
    const b = ok(enqueueFrom(w, root, workFor("qa", "Test")));
    w.runner.script("dev", hang());
    w.runner.script("qa", hang());
    w.rt.end(root.id, { ok: true, text: "" });
    await drain(w);
    expect(get(w, a.id).status).toBe("running");
    expect(get(w, b.id).status).toBe("running");

    // A laptop sleep moves the wall clock only.
    w.clock.sleep(60 * 60_000);
    await drain(w);
    expect(get(w, a.id).status).toBe("running");
    expect(get(w, b.id).status).toBe("running");
    invariants(w);

    w.clock.advance(3_000);
    w.rt.progress(b.id);
    w.clock.advance(1_999);
    await drain(w);
    expect(get(w, a.id).status).toBe("running");
    expect(get(w, b.id).status).toBe("running");

    w.clock.advance(2);
    await drain(w);
    const stalledA = get(w, a.id);
    expect(stalledA.status).toBe("failed");
    expect(stalledA.outcome).toBe("stalled");
    expect(w.runner.runs(a.id)[0].signal!.aborted).toBe(true);
    expect(w.runner.reports(a.id)).toHaveLength(1);
    expect(get(w, b.id).status).toBe("running");
    expect(get(w, root.id).status).toBe("waiting");
    invariants(w);

    w.clock.advance(2_998);
    await drain(w);
    expect(get(w, b.id).status).toBe("running");
    w.clock.advance(2);
    await drain(w);
    const stalledB = get(w, b.id);
    expect(stalledB.status).toBe("failed");
    expect(stalledB.outcome).toBe("stalled");
    expect(w.runner.runs(b.id)[0].signal!.aborted).toBe(true);
    expect(w.runner.reports(b.id)).toHaveLength(1);
    expect(w.runner.running.size).toBe(0);

    const rootRuns = w.runner.runs(root.id);
    expect(rootRuns).toHaveLength(1);
    expect(rootRuns[0].input!.settled?.map((x) => x.id).sort()).toEqual([a.id, b.id].sort());
    expect(get(w, root.id).status).toBe("completed");
    invariants(w);
  });
});

// ── §2 Cancel and stop ─────────────────────────────────────────────────

describe("§2 cancel and stop awaiting", () => {
  it("S16 cancel cascades, aborts running signals, outcome stopped, reported", async () => {
    const w = world();
    const root = beginChief(w);
    const child = ok(enqueueFrom(w, root, workFor("dev", "Build")));
    w.runner.script("dev", handOut([workFor("qa", "Test")], hang()));
    w.runner.script("qa", hang());
    w.rt.end(root.id, { ok: true, text: "" });
    await drain(w);
    const grand = w.store.children(child.id)[0];
    expect(get(w, child.id).status).toBe("running");
    expect(get(w, grand.id).status).toBe("running");
    invariants(w);

    w.rt.cancel(root.id, "person stopped it");
    for (const id of [root.id, child.id, grand.id]) {
      expect(get(w, id).status).toBe("cancelled");
      expect(get(w, id).outcome).toBe("stopped");
      expect(kinds(w, id)).toContain("cancelled");
    }
    expect(w.runner.runs(child.id)[0].signal!.aborted).toBe(true);
    expect(w.runner.runs(grand.id)[0].signal!.aborted).toBe(true);
    await drain(w);

    expect(w.runner.running.size).toBe(0);
    expect(w.runner.reports(child.id)).toHaveLength(1);
    expect(w.runner.reports(grand.id)).toHaveLength(1);
    expect(w.runner.reports(root.id).length).toBeLessThanOrEqual(1);
    for (const id of [root.id, child.id, grand.id]) expect(get(w, id)).toMatchObject({ status: "cancelled", outcome: "stopped" });
    expect(w.runner.runs(root.id)).toHaveLength(0);
    expect(w.runner.runs(child.id)).toHaveLength(1);
    expect(w.runner.runs(grand.id)).toHaveLength(1);
    expect(w.rt.liveEdges()).toEqual([]);
    expect(w.rt.outstanding(chiefOwner)).toEqual([]);
    invariants(w);
  });

  it("S17 stopRequester: queued children cancelled, the running child keeps going and reports, the requester never resumes", async () => {
    const w = world();
    const root = beginChief(w);
    const a = ok(enqueueFrom(w, root, workFor("dev", "Build")));
    const b = ok(enqueueFrom(w, root, workFor("qa", "Test")));
    w.runner.script("dev", hang());
    w.runner.setCanStart("qa", false);
    w.rt.end(root.id, { ok: true, text: "" });
    await drain(w);
    expect(get(w, a.id).status).toBe("running");
    expect(get(w, b.id).status).toBe("queued");

    const left = w.rt.stopRequester(chiefOwner, "person stopped the chat");
    expect(left.map((x) => x.id)).toEqual([a.id]);
    expect(get(w, b.id)).toMatchObject({ status: "cancelled", outcome: "stopped" });
    expect(get(w, root.id)).toMatchObject({ status: "cancelled", outcome: "stopped" });
    expect(get(w, a.id).status).toBe("running");
    expect(w.runner.runs(a.id)[0].signal!.aborted).toBe(false);
    expect(w.runner.running.has(a.id)).toBe(true);
    await drain(w);
    expect(get(w, a.id).status).toBe("running");
    invariants(w);

    w.runner.release(a.id, complete("late but done"));
    await drain(w);
    expect(get(w, a.id)).toMatchObject({ status: "completed", outcome: "done", result: "late but done" });
    expect(w.runner.reports(a.id)).toHaveLength(1);
    expect(w.runner.reports(a.id)[0].parent?.id).toBe(root.id);
    expect(w.runner.reports(b.id)).toHaveLength(1);
    expect(w.runner.runs(root.id)).toHaveLength(0);
    expect(get(w, root.id).status).toBe("cancelled");
    expect(w.store.all({ nonTerminal: true })).toEqual([]);
    expect(w.rt.outstanding(chiefOwner)).toEqual([]);
    invariants(w);
  });
});

// ── §1/§2 Roots of other kinds ─────────────────────────────────────────

describe("§1 roots of every kind", () => {
  it("S18 external runtime root with reply poll: poll() returns each item once (I3), root completes with no turn", async () => {
    const w = world();
    const ext: Requester = { kind: "external_runtime", runId: "run-1" };
    const root = w.rt.begin({
      origin: { kind: "outside", source: "external_runtime", ref: "run-1" },
      requester: ext,
      assignee: { botId: "chief", destination: { kind: "work_thread", threadId: "ext-thread" } },
      brief: "Do two things",
      level: "ask",
      reply: "poll",
    });
    expect(root.reply).toBe("poll");
    const a = ok(enqueueFrom(w, root, workFor("dev", "Thing one", { requester: ext, reply: "poll" })));
    const b = ok(enqueueFrom(w, root, workFor("qa", "Thing two", { requester: ext, reply: "poll" })));
    w.runner.script("dev", complete("one"));
    w.runner.script("qa", complete("two"));
    w.rt.end(root.id, { ok: true, text: "" });
    await drain(w);

    expect(get(w, a.id).status).toBe("completed");
    expect(get(w, b.id).status).toBe("completed");
    expect(w.runner.reports(a.id)).toHaveLength(1);
    expect(w.runner.reports(b.id)).toHaveLength(1);
    expect(w.runner.runs(root.id)).toHaveLength(0);
    expect(get(w, root.id).status).toBe("completed");
    invariants(w);

    const first = w.rt.poll({ runId: "run-1" });
    expect(first.items.map((i) => i.assignmentId).sort()).toEqual([a.id, b.id].sort());
    expect(first.items.every((i) => i.kind === "settled")).toBe(true);
    expect(first.assignments.map((x) => x.id).sort()).toEqual([a.id, b.id].sort());
    const second = w.rt.poll({ runId: "run-1" });
    expect(second.items).toEqual([]);
    expect(second.assignments).toEqual([]);
    expect(w.store.inbox({ runId: "run-1" }, false).every((i) => i.deliveredAt !== undefined)).toBe(true);
    expect(w.store.inbox({ runId: "run-1" }, false)).toHaveLength(2);
    expect(w.rt.status(root.id)?.children.map((x) => x.id).sort()).toEqual([a.id, b.id].sort());
    invariants(w);
  });

  it("S19 routine_run root: the same flow with origin routine", async () => {
    const w = world();
    const thread = "thread-routine";
    const owner: Owner = { botId: "chief", threadId: thread };
    const root = w.rt.begin({
      origin: { kind: "routine", source: "routine", ref: "routine-9" },
      requester: { kind: "routine_run", botId: "chief", threadId: thread, runId: "rr-1" },
      assignee: { botId: "chief", destination: { kind: "standing_thread", threadId: thread } },
      brief: "Nightly: check the build",
      level: "auto",
    });
    expect(root.origin.kind).toBe("routine");
    const child = ok(enqueueFrom(w, root, workFor("dev", "Check the build")));
    expect(child.origin).toEqual(root.origin);
    expect(child.requester).toMatchObject({ kind: "bot_turn", botId: "chief", threadId: thread });
    w.runner.script("dev", complete("green"));
    w.runner.script("chief", complete("logged"));
    w.rt.end(root.id, { ok: true, text: "" });
    await drain(w);

    expect(get(w, child.id)).toMatchObject({ status: "completed", result: "green" });
    expect(w.runner.runs(child.id)[0].input!.envelope.startsWith(ENVELOPE_MARK)).toBe(true);
    expect(w.runner.reports(child.id)).toHaveLength(1);
    const rootRuns = w.runner.runs(root.id);
    expect(rootRuns).toHaveLength(1);
    expect(rootRuns[0].input!.settled?.map((x) => x.id)).toEqual([child.id]);
    const inbox = w.store.inbox(owner, false).filter((i) => i.assignmentId === child.id);
    expect(inbox).toHaveLength(1);
    expect(inbox[0].kind).toBe("settled");
    expect(inbox[0].deliveredAt).toBeDefined();
    expect(get(w, root.id).status).toBe("completed");
    invariants(w);
  });
});

// ── §2 Admission ───────────────────────────────────────────────────────

describe("§2 admission", () => {
  it("S20 canStart string reason: stays queued, exactly one waiting event", async () => {
    const w = world();
    const root = beginChief(w);
    w.runner.setCanStart("dev", "no free computer");
    const child = ok(enqueueFrom(w, root, workFor("dev", "Build")));
    w.rt.end(root.id, { ok: true, text: "" });
    for (let i = 0; i < 3; i++) {
      w.rt.tick();
      await flush();
    }
    expect(get(w, child.id).status).toBe("queued");
    expect(w.runner.runs(child.id)).toHaveLength(0);
    expect(w.runner.callsOf("canStart", child.id).length).toBeGreaterThanOrEqual(3);
    const events = w.store.events(child.id);
    expect(events).toHaveLength(2);
    expect(events[0].kind).toBe("enqueued");
    expect(events[1].kind).not.toBe("started");
    expect(w.rt.liveEdges()).toEqual([expect.objectContaining({ targetBotId: "dev", state: "queued" })]);
    invariants(w);

    w.runner.setCanStart("dev", true);
    await drain(w);
    expect(get(w, child.id).status).toBe("completed");
    expect(w.runner.runs(child.id)).toHaveLength(1);
    expect(get(w, root.id).status).toBe("completed");
    invariants(w);
  });

  it("S21 a child addressed to the parent's own thread waits until the parent's turn ends", async () => {
    const w = world();
    const room = "room-1";
    const root = w.rt.begin({
      origin: { kind: "person", source: "chat", ref: room, quote: "Team, ship it" },
      requester: { kind: "person", threadId: room, chief: true },
      assignee: { botId: "chief", destination: { kind: "room_thread", threadId: room, groupId: "g1" } },
      brief: "Team, ship it",
      level: "auto",
    });
    const child = ok(
      enqueueFrom(w, root, { assignee: { botId: "dev", destination: { kind: "room_thread", threadId: room, groupId: "g1" } }, brief: "Dev, build it" }),
    );
    for (let i = 0; i < 3; i++) {
      w.rt.tick();
      await flush();
    }
    expect(get(w, child.id).status).toBe("queued");
    expect(w.runner.runs(child.id)).toHaveLength(0);
    invariants(w);

    w.runner.script("dev", complete("built in the room"));
    w.rt.end(root.id, { ok: true, text: "" });
    await drain(w);
    expect(w.runner.runs(child.id)).toHaveLength(1);
    expect(get(w, child.id)).toMatchObject({ status: "completed", result: "built in the room" });
    expect(w.runner.runs(root.id)).toHaveLength(1);
    expect(get(w, root.id).status).toBe("completed");
    invariants(w);
  });
});

// ── §7 Invariants and §8 ports ─────────────────────────────────────────

describe("§7 invariants", () => {
  it("S22 I7: replaying a row's events yields its status", async () => {
    const w = world();
    const root = beginChief(w);
    const child = ok(enqueueFrom(w, root, workFor("dev", "Build")));
    const refusedAtDispatch = ok(enqueueFrom(w, root, workFor("ops", "Deploy")));
    w.runner.validateReasons.set(refusedAtDispatch.id, "ops has no computer");
    const failing = ok(enqueueFrom(w, root, workFor("ops", "Flaky deploy")));
    w.runner.script(failing.id, fail("provider_error", "boom"));
    w.runner.script("dev", handOut([workFor("qa", "Test")], complete("built")), complete("verified"));
    w.runner.script("qa", needsInput("Which browser?"), complete("tested"));
    w.rt.end(root.id, { ok: true, text: "" });
    await drain(w);
    const grand = w.store.children(child.id)[0];
    expect(get(w, grand.id).status).toBe("needs_input");

    const snapshotStatuses = () => {
      const seen = new Map<string, Status[]>();
      for (const call of w.runner.callsOf("changed")) {
        for (const row of call.rows ?? []) {
          const list = seen.get(row.id) ?? [];
          if (list[list.length - 1] !== row.status) list.push(row.status);
          seen.set(row.id, list);
        }
      }
      return seen;
    };

    for (const row of w.store.all()) {
      const events = w.store.events(row.id);
      expect(events.length).toBeGreaterThan(0);
      expect(events[0].kind).toBe("enqueued");
      expect(replayStatus(events)).toBe(row.status);
    }

    expect(w.rt.answer(grand.id, "firefox")).toBe(true);
    await drain(w);
    expect(get(w, root.id).status).toBe("completed");
    expect(get(w, refusedAtDispatch.id)).toMatchObject({ status: "failed", outcome: "refused" });
    expect(get(w, failing.id)).toMatchObject({ status: "failed", outcome: "provider_error" });

    const seen = snapshotStatuses();
    for (const row of w.store.all()) {
      const events = w.store.events(row.id);
      expect(replayStatus(events)).toBe(row.status);
      const ats = events.map((e) => e.at);
      expect(ats).toEqual(ats.toSorted((x, y) => x - y));
      const transitions = seen.get(row.id) ?? [];
      expect(events.length).toBeGreaterThanOrEqual(transitions.length);
    }
    invariants(w);
  });
});

describe("§8 ports", () => {
  it("S23 write-before-act: the row reads running before run(); a throwing run leaves a failed row, never a throw out of tick()", async () => {
    const w = world();
    const root = beginChief(w);
    const broken = ok(enqueueFrom(w, root, workFor("dev", "Build")));
    const fine = ok(enqueueFrom(w, root, workFor("qa", "Test")));
    w.runner.throwOnce("run");
    w.runner.script("qa", complete("tested"));
    w.rt.end(root.id, { ok: true, text: "" });
    expect(() => w.rt.tick()).not.toThrow();
    await drain(w);

    const runs = w.runner.runs();
    expect(runs.length).toBeGreaterThanOrEqual(2);
    for (const call of runs) expect(call.storedStatus).toBe("running");
    const b = get(w, broken.id);
    expect(b.status).toBe("failed");
    expect(b.outcome).toBeDefined();
    expect(kinds(w, broken.id)).toContain("settled");
    expect(w.runner.reports(broken.id)).toHaveLength(1);
    expect(get(w, fine.id)).toMatchObject({ status: "completed", result: "tested" });
    expect(w.runner.runs(root.id)).toHaveLength(1);
    expect(w.runner.runs(root.id)[0].input!.settled?.map((x) => x.id).sort()).toEqual([broken.id, fine.id].sort());
    expect(get(w, root.id).status).toBe("completed");
    expect(w.logs.length).toBeGreaterThan(0);
    invariants(w);
  });

  it("S23b a run() that rejects leaves a failed row with an event", async () => {
    const w = world();
    const root = beginChief(w);
    const child = ok(enqueueFrom(w, root, workFor("dev", "Build")));
    w.runner.rejectRunOnce();
    w.rt.end(root.id, { ok: true, text: "" });
    await drain(w);
    const c = get(w, child.id);
    expect(c.status).toBe("failed");
    expect(kinds(w, child.id)).toContain("settled");
    expect(w.runner.runs(child.id)).toHaveLength(1);
    expect(w.runner.reports(child.id)).toHaveLength(1);
    expect(w.runner.runs(root.id)).toHaveLength(1);
    expect(get(w, root.id).status).toBe("completed");
    invariants(w);
  });

  it("S23c a host method that throws is read as not now and retried next tick", async () => {
    const w = world();
    const root = beginChief(w);
    const child = ok(enqueueFrom(w, root, workFor("dev", "Build")));
    w.runner.throwOnce("canStart");
    w.rt.end(root.id, { ok: true, text: "" });
    expect(() => w.rt.tick()).not.toThrow();
    await flush();
    expect(get(w, child.id).status).toBe("queued");
    expect(w.runner.runs(child.id)).toHaveLength(0);
    invariants(w);
    await drain(w);
    expect(get(w, child.id).status).toBe("completed");
    expect(w.runner.runs(child.id)).toHaveLength(1);
    expect(get(w, root.id).status).toBe("completed");
    invariants(w);
  });

  it("S23d a validate refusal at dispatch ends the row failed(refused), reported, never run", async () => {
    const w = world();
    const root = beginChief(w);
    const child = ok(enqueueFrom(w, root, workFor("dev", "Build")));
    w.runner.validateReasons.set("dev", "dev was deleted");
    w.rt.end(root.id, { ok: true, text: "" });
    await drain(w);
    expect(get(w, child.id)).toMatchObject({ status: "failed", outcome: "refused" });
    expect(kinds(w, child.id)).toContain("refused");
    expect(w.runner.runs(child.id)).toHaveLength(0);
    expect(w.runner.reports(child.id)).toHaveLength(1);
    expect(w.runner.runs(root.id)).toHaveLength(1);
    expect(get(w, root.id).status).toBe("completed");
    invariants(w);
  });
});

// ── §1 Storage ─────────────────────────────────────────────────────────

describe("§1 storage", () => {
  it("S24 prune removes old terminal trees only", async () => {
    const w = world({ queueMs: 1e12, stallMs: 1e12, turnStallMs: 1e12, inputWaitMs: 1e12 });
    const t0 = w.clock.now();

    const old = beginChief(w);
    const oldChild = ok(enqueueFrom(w, old, workFor("dev", "Old work")));
    w.rt.end(old.id, { ok: true, text: "" });
    await drain(w);
    expect(get(w, old.id).status).toBe("completed");

    const live = w.rt.begin({
      origin: { kind: "person", source: "chat", ref: "thread-live", quote: "Keep going" },
      requester: { kind: "person", threadId: "thread-live" },
      assignee: { botId: "qa", destination: { kind: "standing_thread", threadId: "thread-live" } },
      brief: "Keep going",
      level: "ask",
    });
    const liveChild = ok(enqueueFrom(w, live, workFor("dev", "Live work")));
    w.runner.script("dev", hang());
    await drain(w);
    expect(get(w, liveChild.id).status).toBe("running");

    w.clock.advance(24 * 60 * 60_000);
    const recent = w.rt.begin({
      origin: { kind: "person", source: "chat", ref: "thread-recent", quote: "Recent" },
      requester: { kind: "person", threadId: "thread-recent" },
      assignee: { botId: "ops", destination: { kind: "standing_thread", threadId: "thread-recent" } },
      brief: "Recent",
      level: "ask",
    });
    w.rt.end(recent.id, { ok: true, text: "done alone" });
    await drain(w);
    expect(get(w, recent.id).status).toBe("completed");
    expect(w.store.all()).toHaveLength(5);

    const removed = w.store.prune(t0 + 60 * 60_000);
    expect(removed).toBe(2);
    expect(w.store.get(old.id)).toBeUndefined();
    expect(w.store.get(oldChild.id)).toBeUndefined();
    expect(w.store.events(old.id)).toEqual([]);
    expect(w.store.events(oldChild.id)).toEqual([]);
    expect(w.store.inbox(chiefOwner, false)).toEqual([]);
    expect(w.store.get(live.id)?.status).toBe("running");
    expect(w.store.get(liveChild.id)?.status).toBe("running");
    expect(w.store.get(recent.id)?.status).toBe("completed");
    expect(w.store.all()).toHaveLength(3);
    invariants(w);

    expect(w.store.prune(w.clock.now() + 1)).toBe(1);
    expect(w.store.get(recent.id)).toBeUndefined();
    expect(w.store.all()).toHaveLength(2);
    expect(w.store.prune(w.clock.now() + 1)).toBe(0);
    invariants(w);
  });
});

// ── §3 Level ───────────────────────────────────────────────────────────

describe("§3 one level rule", () => {
  it("S25 a Chief at full with a person origin lifts the child to full where the engine supports it; outside lineage inherits nothing", async () => {
    const w = world();
    const root = beginChief(w, { level: "full" });
    const lifted = ok(enqueueFrom(w, root, workFor("dev", "Build", { levels: { own: "ask", chief: "full" }, driverKind: "claudeAgent" })));
    expect(lifted.level).toBe("full");
    expect(lifted.levelSource).toBe("chief");
    const capped = ok(enqueueFrom(w, root, workFor("qa", "Test", { levels: { own: "ask", chief: "full" }, driverKind: "unknownAgent" })));
    expect(capped.level).toBe("ask");
    expect(capped.levelSource).toBe("engine_cap");
    const edits = ok(enqueueFrom(w, root, workFor("ops", "Deploy", { levels: { own: "ask", chief: "auto" }, driverKind: "geminiAgent" })));
    expect(edits.level).toBe("edits");
    expect(edits.levelSource).toBe("engine_cap");
    const ownWins = ok(enqueueFrom(w, root, workFor("dev", "Lint", { levels: { own: "full", chief: "edits" }, driverKind: "claudeAgent" })));
    expect(ownWins.level).toBe("full");
    expect(ownWins.levelSource).toBe("own");
    const customNeverTravels = ok(enqueueFrom(w, root, workFor("dev", "Shell", { levels: { own: "ask", chief: "custom" }, driverKind: "codex" })));
    expect(customNeverTravels.level).toBe("ask");

    const outsideRoot = w.rt.begin({
      origin: { kind: "outside", source: "webhook", ref: "hook-1" },
      requester: { kind: "person", threadId: "thread-hook", chief: true },
      assignee: { botId: "chief", destination: { kind: "standing_thread", threadId: "thread-hook" } },
      brief: "Webhook: deploy",
      level: "full",
    });
    const outside = ok(enqueueFrom(w, outsideRoot, workFor("dev", "Deploy", { levels: { own: "ask", chief: "full" }, driverKind: "claudeAgent" })));
    expect(outside.level).toBe("ask");
    expect(outside.levelSource).toBe("own");

    w.rt.end(root.id, { ok: true, text: "" });
    w.rt.end(outsideRoot.id, { ok: true, text: "" });
    await drain(w);

    // I6: the level a turn ran with equals the level on its record.
    for (const call of w.runner.runs()) expect(call.input!.level).toBe(get(w, call.id!).level);
    expect(w.runner.runs(lifted.id)[0].input!.level).toBe("full");
    expect(w.runner.runs(outside.id)[0].input!.level).toBe("ask");
    expect(get(w, root.id).status).toBe("completed");
    expect(get(w, outsideRoot.id).status).toBe("completed");
    invariants(w);
  });
});
