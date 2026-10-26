// The runtime coordinator over a fake CoordinatorHost: the HandoffView
// projection, roots named by the host's generation, the legacy refusal
// words in the legacy order, the run adapter (envelope, resume, NEEDS
// INPUT, abort), stops, restart continuation and the read models index.ts
// uses. The runtime's own rules are proven in server/runtime/; this file
// pins the adapter between them and the host.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import type { BeginTurnRequest, ComposedTurn, CoordinatorHost, HandoffOpener, HandoffOptions, HandoffView, HostTurnResult } from "./coordinator.ts";
import type { RoomAddress } from "./coordinator.ts";
import { needsInputQuestion, RuntimeCoordinator, view } from "./runtime-coordinator.ts";
import { ENVELOPE_MARK } from "./runtime/envelope.ts";
import type { Assignment, Level, Limits } from "./runtime/types.ts";
import { removeTempDir } from "./testing/cleanup.ts";

const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

type Outcome = HostTurnResult;
type Script = (node: HandoffView, text: string) => Outcome | "hold" | undefined;

interface Host extends CoordinatorHost {
  runs: Array<{ node: HandoffView; resumed: boolean; text: string; signal: AbortSignal; composed: ComposedTurn }>;
  parks: Array<{ node: HandoffView; question: string }>;
  reports: Array<{ child: HandoffView; parent?: HandoffView }>;
  changes: Array<{ groups: string[]; threads: string[] }>;
  validates: Array<{ node: HandoffView; parent?: HandoffView }>;
  held: Map<string, (outcome: Outcome) => void>;
  script: Script;
  busyAnswer: (node: HandoffView) => boolean;
  validateAnswer: string | undefined;
  levels: Record<string, { level: Level; driverKind?: string }>;
  chiefs: Set<string>;
  release(id: string, outcome: Outcome): Promise<void>;
}

function fakeHost(script: Script = () => undefined): Host {
  const host: Host = {
    runs: [], parks: [], reports: [], changes: [], validates: [], held: new Map(), script,
    busyAnswer: () => false, validateAnswer: undefined, levels: {}, chiefs: new Set(),
    validate(node, parent) { host.validates.push({ node, ...(parent ? { parent } : {}) }); return host.validateAnswer; },
    busy: node => host.busyAnswer(node),
    run(node, resumed, signal, composed) {
      const text = composed?.text ?? "";
      host.runs.push({ node, resumed, text, signal, composed });
      const outcome = host.script(node, text);
      if (outcome !== "hold") return Promise.resolve(outcome ?? { ok: true, text: `${node.botId} done` });
      // Like the real host: a stop resolves the turn with its own words.
      return new Promise<Outcome>(resolve => {
        const abort = () => { host.held.delete(node.id); resolve({ ok: false, text: "Coordinated work was stopped" }); };
        signal.addEventListener("abort", abort, { once: true });
        host.held.set(node.id, result => { signal.removeEventListener("abort", abort); resolve(result); });
      });
    },
    park(node, question) { host.parks.push({ node, question }); },
    report(child, parent) { host.reports.push({ child, ...(parent ? { parent } : {}) }); },
    changed(groups, threads) { host.changes.push({ groups: [...groups].sort(), threads: [...threads].sort() }); },
    names: (node, parent) => ({ requester: parent?.botId ?? "Milind", assignee: node.botId, person: "Milind" }),
    levelOf: target => host.levels[target.botId] ?? { level: "ask" },
    chiefOf: address => host.chiefs.has(address.threadId),
    async release(id, outcome) {
      const resolve = host.held.get(id);
      if (!resolve) throw new Error(`no held turn ${id}`);
      host.held.delete(id);
      resolve(outcome);
      await flush();
    },
  };
  return host;
}

interface World { host: Host; coordinator: RuntimeCoordinator; logs: string[] }
function world(script?: Script, runtimeLimits: Partial<Limits> = {}, dataDir = ":memory:"): World {
  const host = fakeHost(script);
  const logs: string[] = [];
  const coordinator = new RuntimeCoordinator({ dataDir, host, runtimeLimits, log: line => logs.push(line) });
  return { host, coordinator, logs };
}

const chief: RoomAddress = { botId: "chief", threadId: "chief-chat" };
const builder: RoomAddress = { botId: "builder", threadId: "builder-work" };
const tester: RoomAddress = { botId: "tester", threadId: "tester-work" };
const inRoom = (botId: string, groupId = "g1", threadId = "room-1"): RoomAddress => ({ groupId, threadId, botId });
const userOrigin = { kind: "user" as const, request: "Ship the CSV export" };
const hold: Script = (node) => node.botId === "builder" ? "hold" : undefined;

/** The host begins every turn's root before the turn can hand work on
 * (index.ts startTurn / runGroupMemberTurn): the same here, once per
 * generation, with the turn's own request as the brief. */
const begun = (w: World, source: RoomAddress, generation: string, sourceText = "Ship the CSV export", over: Partial<BeginTurnRequest> = {}) => {
  if (w.coordinator.has(generation)) return;
  w.coordinator.beginTurn({ id: generation, address: source, brief: sourceText, level: w.host.levelOf(source).level, origin: userOrigin, ...over });
};

/** Hands work from `source` (its own node `parentId`, or its own root `generation`, begun first). */
const send = (w: World, source: RoomAddress, generation: string, parentId: string | undefined, target: RoomAddress, text: string,
  opts: { approved?: boolean; rework?: boolean; batchKey?: string; sourceText?: string } = {}) => {
  if (!parentId) begun(w, source, generation, opts.sourceText);
  return w.coordinator.enqueue(source, generation, parentId, target, text, { approvalGranted: opts.approved ?? false, rework: opts.rework ?? false,
    requestBatchKey: opts.batchKey });
};

/** The requesting turn's own end (the host's one settle path). */
const ended = (w: World, generation: string, ok = true) =>
  w.coordinator.endTurn(generation, { ok, text: ok ? "" : "The originating turn ended before its teammates returned." });

const base: Assignment = {
  id: "as_1", rootId: "gen-1", parentId: "gen-1", depth: 1,
  origin: { kind: "person", source: "chat", ref: "chief-chat", quote: "Ship the CSV export" },
  requester: { kind: "bot_turn", botId: "chief", threadId: "chief-chat" },
  assignee: { botId: "builder", destination: { kind: "work_thread", threadId: "builder-work" } },
  mode: "work", reply: "resume", brief: "Build it", status: "queued", level: "ask", levelSource: "own",
  executions: 0, restarts: 0, createdAt: 1_000, lastActivityAt: 2_000, result: "", rework: false, version: 1,
};
const row = (patch: Partial<Assignment>): Assignment => ({ ...base, ...patch });
const roomRow = (patch: Partial<Assignment> = {}): Assignment => row({ assignee: { botId: "builder", destination: { kind: "room_thread", threadId: "room-1", groupId: "g1" } }, ...patch });

describe("view: an Assignment as the legacy node", () => {
  it("projects the plain fields: ids, address, key = bot, text = brief, times, counts", () => {
    expect(view(row({ startedAt: 1_500, executions: 2, restarts: 1, restart: "rerun", result: "half done", reportedAt: 3_000, approved: true, batchKey: "b1" }))).toEqual({
      id: "as_1", rootId: "gen-1", parentId: "gen-1", threadId: "builder-work", botId: "builder", key: "builder", text: "Build it",
      createdAt: 1_000, status: "queued", result: "half done", reported: true, executions: 2, startedAt: 1_500, lastProgressAt: 2_000,
      approvalGranted: true, kind: "work", origin: { kind: "user", request: "Ship the CSV export" }, restarts: 1, restart: "rerun", requestBatchKey: "b1",
      mode: "work", reply: "resume",
    });
    const plain = view(base);
    expect(plain).toMatchObject({ reported: false, approvalGranted: false, restarts: 0, lastProgressAt: 2_000 });
    for (const absent of ["startedAt", "restart", "requestBatchKey", "groupId"]) expect(absent in plain).toBe(false);
  });

  it("carries the record's mode, reply, outcome, outcome detail and question, each only when set", () => {
    const failed = view(row({ mode: "consult", reply: "poll", status: "failed", outcome: "denied", outcomeDetail: "Peer approval denied" }));
    expect(failed).toMatchObject({ mode: "consult", reply: "poll", status: "failed", outcome: "denied", outcomeDetail: "Peer approval denied" });
    expect("question" in failed).toBe(false);
    const parked = view(row({ mode: "notify", reply: "none", status: "needs_input", question: "Which account?" }));
    expect(parked).toMatchObject({ mode: "notify", reply: "none", status: "waiting", question: "Which account?" });
    for (const absent of ["outcome", "outcomeDetail"]) expect(absent in parked).toBe(false);
    for (const absent of ["outcome", "outcomeDetail", "question"]) expect(absent in view(base)).toBe(false);
  });

  it.each<[string, Partial<Assignment>, HandoffView["status"]]>([
    ["a root's first, host-run turn is the source turn", { id: "gen-1", parentId: undefined, depth: 0, status: "running", executions: 1 }, "source"],
    ["a root's later turn (a resume or rerun the runtime dispatched) runs", { id: "gen-1", parentId: undefined, depth: 0, status: "running", executions: 2 }, "running"],
    ["a running child runs", { status: "running", executions: 1 }, "running"],
    ["needs_input is waiting", { status: "needs_input", question: "Which account?" }, "waiting"],
    ["waiting", { status: "waiting" }, "waiting"],
    ["resume", { status: "resume" }, "resume"],
    ["completed", { status: "completed", outcome: "done" }, "completed"],
    ["failed", { status: "failed", outcome: "stalled" }, "failed"],
    ["cancelled", { status: "cancelled", outcome: "stopped" }, "cancelled"],
  ])("status: %s", (_name, patch, status) => {
    expect(view(row(patch)).status).toBe(status);
  });

  it("is an assignment only for same-room work under a room parent; a root is work", () => {
    const roomParent = roomRow({ id: "gen-1", parentId: undefined, depth: 0, assignee: { botId: "chief", destination: { kind: "room_thread", threadId: "room-1", groupId: "g1" } } });
    expect(view(roomRow(), roomParent).kind).toBe("assignment");
    expect(view(roomRow()).kind).toBe("work");
    expect(view(roomRow(), row({ id: "gen-1", parentId: undefined, depth: 0 })).kind).toBe("work");
    expect(view(roomRow({ assignee: { botId: "builder", destination: { kind: "room_thread", threadId: "room-2", groupId: "g2" } } }), roomParent).kind).toBe("work");
    expect(view(base, roomParent).kind).toBe("work");
    expect(view(roomParent).kind).toBe("work");
    expect(view(roomRow()).groupId).toBe("g1");
  });

  it.each<[string, Assignment["origin"], HandoffView["origin"]]>([
    ["a person's quoted request is the user's", { kind: "person", source: "chat", quote: "Ship it" }, { kind: "user", request: "Ship it" }],
    ["a person without a quote has no origin", { kind: "person", source: "chat" }, undefined],
    ["an empty quote has no origin", { kind: "person", source: "chat", quote: "" }, undefined],
    ["a routine is outside", { kind: "routine", source: "routine" }, { kind: "outside" }],
    ["a webhook is outside", { kind: "outside", source: "webhook" }, { kind: "outside" }],
    ["an outside chat line with a quote is still outside", { kind: "outside", source: "chat", quote: "Ship it" }, { kind: "outside" }],
  ])("origin: %s", (_name, origin, expected) => {
    const projected = view(row({ origin }));
    expect(projected.origin).toEqual(expected);
    if (expected === undefined) expect("origin" in projected).toBe(false);
  });
});

describe("needsInputQuestion", () => {
  it("reads a question from the last non-empty line, in any case, and nothing otherwise", () => {
    expect(needsInputQuestion("Did the first half.\nNEEDS INPUT: Which account should I use?\n\n")).toBe("Which account should I use?");
    expect(needsInputQuestion("needs input:   staging or prod?")).toBe("staging or prod?");
    expect(needsInputQuestion("NEEDS INPUT: first line\nsecond line")).toBeUndefined();
    expect(needsInputQuestion("All done. NEEDS INPUT: not at line start")).toBeUndefined();
    expect(needsInputQuestion("NEEDS INPUT:")).toBeUndefined();
    expect(needsInputQuestion("")).toBeUndefined();
    expect(needsInputQuestion("Done.")).toBeUndefined();
  });
});

describe("RuntimeCoordinator: the requesting turn and its tree", () => {
  it("creates the root under the generation, runs the child with the envelope, and resumes the root with the child's report", async () => {
    const w = world((node) => node.botId === "builder" ? { ok: true, text: "Built it on branch csv-export." } : undefined);
    w.host.levels.builder = { level: "edits", driverKind: "claudeAgent" };
    w.host.chiefs.add("chief-chat");
    const { node, duplicate } = send(w, chief, "gen-1", undefined, builder, "Build it", { approved: true });
    expect(duplicate).toBe(false);
    expect(node).toMatchObject({ status: "queued", rootId: "gen-1", parentId: "gen-1", botId: "builder", threadId: "builder-work", key: "builder",
      text: "Build it", kind: "work", approvalGranted: true, reported: false, executions: 0, origin: userOrigin });
    expect(w.coordinator.has("gen-1")).toBe(true);
    expect(w.coordinator.node("gen-1")).toMatchObject({ id: "gen-1", rootId: "gen-1", status: "source", botId: "chief", threadId: "chief-chat",
      text: "Ship the CSV export", kind: "work", origin: userOrigin, executions: 1 });
    expect(w.coordinator.children("gen-1").map(c => c.id)).toEqual([node.id]);
    expect(w.coordinator.all().map(n => n.id)).toEqual(["gen-1", node.id]);
    // the host validated the request at enqueue, as legacy views
    expect(w.host.validates.at(-1)).toMatchObject({ node: { id: node.id, status: "queued" }, parent: { id: "gen-1", status: "source" } });
    // the level the host said the thread runs with is on the record
    expect(w.coordinator.node(node.id)).toBeDefined();
    w.coordinator.tick();
    expect(w.host.runs).toHaveLength(1);
    const first = w.host.runs[0]!;
    expect(first.node).toMatchObject({ id: node.id, status: "running", executions: 1 });
    expect(first.resumed).toBe(false);
    expect(first.text.startsWith(`${ENVELOPE_MARK} ${node.id} from @chief for Milind]`)).toBe(true);
    expect(first.text).toContain('Milind asked: "Ship the CSV export".');
    expect(first.text).toContain("Your level for this is Edits:");
    expect(first.text.endsWith("Brief from @chief:\nBuild it")).toBe(true);
    await flush();
    expect(w.coordinator.node(node.id)).toMatchObject({ status: "completed", result: "Built it on branch csv-export.", reported: true });
    expect(w.host.reports).toHaveLength(1);
    expect(w.host.reports[0]).toMatchObject({ child: { id: node.id, status: "completed", kind: "work" }, parent: { id: "gen-1", status: "source" } });
    // the requesting turn ends: the root waits, then owes one resume turn
    ended(w, "gen-1");
    expect(w.coordinator.node("gen-1")?.status).toBe("waiting");
    w.coordinator.tick();
    expect(w.host.runs).toHaveLength(2);
    const resume = w.host.runs[1]!;
    // the host's dispatch guard reads a runtime-dispatched root turn as running, never as the source turn
    expect(resume.node).toMatchObject({ id: "gen-1", status: "running", executions: 2 });
    expect(resume.resumed).toBe(true);
    expect(resume.text.startsWith('Your downstream room requests have settled. Review the results against the request: "Ship the CSV export".')).toBe(true);
    expect(resume.text).toContain(`[Sagax report from @builder on assignment ${node.id}: done]`);
    expect(resume.text).toContain('What @builder said: "Built it on branch csv-export."');
    expect(resume.text).not.toContain(ENVELOPE_MARK);
    await flush();
    expect(w.coordinator.node("gen-1")).toMatchObject({ status: "completed", executions: 2 });
    expect(w.host.reports).toHaveLength(1);
  });

  it("relay: a resume carrying only relayed replies runs no turn; the host shows them and the root completes", async () => {
    const w = world((node) => node.botId === "builder" ? { ok: true, text: "Rome." } : undefined);
    const relayed: Array<{ node: HandoffView; replies: HandoffView[] }> = [];
    w.host.relay = (node, replies) => { relayed.push({ node, replies }); return true; };
    begun(w, chief, "gen-1", "Ask builder");
    const { node } = w.coordinator.enqueue(chief, "gen-1", undefined, builder, "Capital of Italy?", { relay: true });
    expect(node.relay).toBe(true);
    w.coordinator.tick();
    await flush();
    ended(w, "gen-1");
    w.coordinator.tick();
    await flush();
    expect(w.host.runs.map(r => r.resumed)).toEqual([false]);
    expect(relayed).toHaveLength(1);
    expect(relayed[0]!.node.id).toBe("gen-1");
    expect(relayed[0]!.replies.map(r => r.result)).toEqual(["Rome."]);
    expect(w.coordinator.node("gen-1")).toMatchObject({ status: "completed", result: "Rome." });
  });

  it("relay: a failed reply, a host that declines, a room or a mix with ordinary work still runs the resume turn", async () => {
    const cases: Array<{ script: Script; accept: boolean; extra?: boolean; room?: boolean }> = [
      { script: (n) => n.botId === "builder" ? { ok: false, text: "provider down" } : undefined, accept: true },
      { script: () => undefined, accept: false },
      { script: () => undefined, accept: true, extra: true },
      { script: () => undefined, accept: true, room: true },
    ];
    for (const c of cases) {
      const w = world(c.script);
      let asked = 0;
      w.host.relay = () => { asked += 1; return c.accept; };
      const target = c.room ? inRoom("builder", "g2", "room-2") : builder;
      begun(w, chief, "gen-1", "Ask");
      const { node } = w.coordinator.enqueue(chief, "gen-1", undefined, target, "Q", { relay: true });
      expect(Boolean(node.relay)).toBe(!c.room);
      if (c.extra) send(w, chief, "gen-1", undefined, tester, "Test it");
      w.coordinator.tick();
      await flush();
      ended(w, "gen-1");
      w.coordinator.tick();
      await flush();
      // the requester reviews: one resume turn, whatever the host was asked
      expect(w.host.runs.filter(r => r.resumed)).toHaveLength(1);
      // the host is only asked when every reply relays and completed
      expect(asked).toBe(c === cases[1] ? 1 : 0);
    }
  });

  it("active() is all() without the ended nodes, with the same views", async () => {
    const w = world();
    const ended_ = new Set(["completed", "failed", "cancelled"]);
    const same = () => expect(w.coordinator.active()).toEqual(w.coordinator.all().filter(n => !ended_.has(n.status)));
    const { node } = send(w, chief, "gen-1", undefined, builder, "Build it");
    same(); expect(w.coordinator.active().map(n => n.id)).toEqual(["gen-1", node.id]);
    ended(w, "gen-1"); w.coordinator.tick(); await flush();
    same(); expect(w.coordinator.active().map(n => n.id)).toEqual(["gen-1"]);
    w.coordinator.tick(); await flush();
    expect(w.coordinator.all()).toHaveLength(2);
    expect(w.coordinator.active()).toEqual([]);
  });

  it("active() never reads an ended row: one that no longer parses stops all(), not active()", async () => {
    const dir = mkdtempSync(join(tmpdir(), "runtime-coordinator-active-"));
    try {
      const w = world(hold, {}, dir);
      send(w, chief, "gen-1", undefined, tester, "Test it");
      ended(w, "gen-1"); w.coordinator.tick(); await flush();
      w.coordinator.tick(); await flush();
      expect(w.coordinator.all().map(n => n.status)).toEqual(["completed", "completed"]);
      const { node } = send(w, chief, "gen-2", undefined, builder, "Build it");
      ended(w, "gen-2"); w.coordinator.tick();
      // The settled tree's rows go bad on disk; nothing live reads them.
      const db = new DatabaseSync(join(dir, "runtime.db"));
      db.prepare("UPDATE assignments SET json = 'not json' WHERE root_id = ?").run("gen-1");
      db.close();
      expect(() => w.coordinator.all()).toThrow(/invalid JSON/);
      expect(w.coordinator.active().map(n => [n.id, n.status])).toEqual([["gen-2", "waiting"], [node.id, "running"]]);
      expect(w.coordinator.outstandingDirect("chief-chat").map(n => n.id)).toEqual([node.id]);
      w.coordinator.close();
    } finally {
      await removeTempDir(dir);
    }
  });

  it("a failed requesting turn keeps its accepted work and says so in its result; an unknown or settled id is logged and ignored", async () => {
    const w = world();
    const { node } = send(w, chief, "gen-1", undefined, builder, "Build it");
    ended(w, "gen-1", false);
    expect(w.coordinator.node("gen-1")).toMatchObject({ status: "waiting", result: "The originating turn ended before its teammates returned." });
    w.coordinator.tick(); await flush();
    expect(w.coordinator.node(node.id)?.status).toBe("completed");
    // a settled or unknown generation is logged and left alone
    ended(w, "gen-1");
    ended(w, "nope");
    expect(w.logs.filter(line => /not a running root/.test(line))).toHaveLength(2);
    expect(w.coordinator.node("gen-1")?.status).toBe("waiting");
    w.coordinator.tick();
    expect(w.host.runs.at(-1)!.node).toMatchObject({ id: "gen-1", status: "running" });
    await flush();
    expect(w.coordinator.node("gen-1")?.status).toBe("completed");
  });

  it("a hand-off from a generation the host began no root for is refused: no turn, nothing written", () => {
    const w = world();
    expect(() => w.coordinator.enqueue(chief, "gen-none", undefined, builder, "Build it")).toThrow("The requesting turn has no root (no turn)");
    expect(w.coordinator.has("gen-none")).toBe(false);
    expect(w.coordinator.all()).toEqual([]);
    expect(w.host.validates).toEqual([]);
  });

  it("a child's resume reviews against its assignment and names its requester", async () => {
    const w = world((node, text) => node.botId === "tester" ? { ok: true, text: `Tests green. Seen: ${text.includes("Brief from @builder") ? "brief" : "?"}` } : undefined);
    send(w, chief, "gen-1", undefined, builder, "Build it");
    w.coordinator.tick();
    const builderNode = w.host.runs[0]!.node;
    // the builder's turn hands out work, then ends
    const { node: testerNode } = send(w, builder, "gen-1", builderNode.id, tester, "Test it");
    expect(testerNode).toMatchObject({ parentId: builderNode.id, rootId: "gen-1", kind: "work" });
    await flush();
    expect(w.coordinator.node(builderNode.id)?.status).toBe("waiting");
    w.coordinator.tick(); await flush();
    expect(w.coordinator.node(testerNode.id)).toMatchObject({ status: "completed", result: "Tests green. Seen: brief" });
    expect(w.host.reports[0]).toMatchObject({ child: { id: testerNode.id }, parent: { id: builderNode.id, status: "waiting" } });
    w.coordinator.tick();
    const resume = w.host.runs.at(-1)!;
    expect(resume.node.id).toBe(builderNode.id);
    expect(resume.text.startsWith('Your downstream room requests have settled. Review the results against your assignment: "Build it".')).toBe(true);
    expect(resume.text).toContain(`[Sagax report from @tester on assignment ${testerNode.id}: done]`);
  });
});

describe("RuntimeCoordinator: refusals in the legacy words", () => {
  it("refuses work back to an ancestor, and a self-assignment writes nothing under the turn's root", async () => {
    const w = world(hold);
    expect(() => send(w, chief, "gen-1", undefined, chief, "Do it yourself")).toThrow("Cannot assign work back to an ancestor; results return automatically");
    expect(w.coordinator.children("gen-1")).toEqual([]);
    expect(() => send(w, inRoom("chief"), "gen-r", undefined, inRoom("chief"), "Do it yourself")).toThrow(/back to an ancestor/);
    expect(w.coordinator.children("gen-r")).toEqual([]);
    const { node } = send(w, chief, "gen-1", undefined, builder, "Build it");
    w.coordinator.tick();
    expect(() => send(w, builder, "gen-1", node.id, chief, "Approve it")).toThrow("Cannot assign work back to an ancestor; results return automatically");
    expect(() => send(w, builder, "gen-1", node.id, { ...chief, threadId: "chief-other" }, "Approve it")).toThrow(/back to an ancestor/);
    await w.host.release(node.id, { ok: true, text: "done" });
  });

  it("lets a teammate consult an ancestor: auto reads a question up the tree as a consultation, work stays refused", async () => {
    const w = world(hold);
    const { node } = send(w, chief, "gen-1", undefined, builder, "Build it");
    w.coordinator.tick();
    const ask = (mode: "work" | "consult" | "auto", threadId = "chief-consult") => w.coordinator.enqueue(builder, "gen-1", node.id,
      { ...chief, threadId }, "Which column order?", { mode });
    expect(() => ask("work")).toThrow("Cannot assign work back to an ancestor; results return automatically");
    const asked = ask("auto");
    expect(w.coordinator.children(node.id).find(c => c.id === asked.node.id)).toBeDefined();
    w.coordinator.tick(); await flush();
    expect(w.host.runs.find(r => r.node.id === asked.node.id)?.text).toBeTruthy();
    expect(w.coordinator.node(asked.node.id)?.status).toBe("completed");
    expect(ask("consult")).toMatchObject({ duplicate: true, node: { id: asked.node.id } });
    await w.host.release(node.id, { ok: true, text: "done" });
  });

  it("a request another tree of the same person already sent joins it; only a completed answer is shared", async () => {
    const w = world(hold);
    const as = (source: RoomAddress, generation: string, threadId: string, person?: string) => {
      begun(w, source, generation, "Ship the CSV export", person ? { person } : {});
      return w.coordinator.enqueue(source, generation, undefined, { ...builder, threadId }, "Poll: free tomorrow?", { mode: "work" });
    };
    const first = as(chief, "gen-1", "builder-work", "pr_a");
    // Another person, or nobody known: never joined.
    expect(as({ botId: "o1", threadId: "o1-chat" }, "gen-o1", "builder-from-o1", "pr_b").joined).toBeUndefined();
    expect(as({ botId: "o2", threadId: "o2-chat" }, "gen-o2", "builder-from-o2").joined).toBeUndefined();
    const second = as({ botId: "other", threadId: "other-chat" }, "gen-2", "builder-from-other", "pr_a");
    expect(second.joined).toBe(true);
    w.coordinator.tick(); await flush();
    expect(w.host.runs.map(r => r.node.id)).not.toContain(second.node.id);
    // The leader failed (its own tree's fate): the joined request runs on its own.
    await w.host.release(first.node.id, { ok: false, text: "engine down" });
    w.coordinator.tick(); await flush();
    expect(w.host.runs.map(r => r.node.id)).toContain(second.node.id);
  });

  it("refuses a second assignment to a teammate that completed one, unless it is rework", async () => {
    const w = world();
    const { node } = send(w, chief, "gen-1", undefined, builder, "Build it");
    w.coordinator.tick(); await flush();
    expect(w.coordinator.node(node.id)?.status).toBe("completed");
    expect(() => send(w, chief, "gen-1", undefined, builder, "Thanks, looks good")).toThrow("This agent already completed your assignment. Do not send acknowledgements or approvals as new work. Finish with your decision; results return automatically. Only use rework=true for concrete additional work.");
    const again = send(w, chief, "gen-1", undefined, builder, "Also add a header row", { rework: true });
    expect(again).toMatchObject({ duplicate: false, node: { status: "queued", text: "Also add a header row" } });
    expect(again.node.id).not.toBe(node.id);
  });

  it("refuses a room request that returns to an ancestor room", async () => {
    const w = world(hold);
    const { node } = send(w, inRoom("chief"), "gen-1", undefined, builder, "Build it");
    w.coordinator.tick();
    expect(() => send(w, builder, "gen-1", node.id, inRoom("tester"), "Review it")).toThrow("A room request cannot return to an ancestor room; results are returned automatically");
    // another room is fine
    expect(send(w, builder, "gen-1", node.id, inRoom("tester", "g2", "room-2"), "Review it").node).toMatchObject({ groupId: "g2", kind: "work" });
    await w.host.release(node.id, { ok: true, text: "done" });
  });

  it("maps the runtime's depth and budget refusals onto the legacy words", async () => {
    const deep = world(hold, { depth: 1 });
    const { node } = send(deep, chief, "gen-1", undefined, builder, "Build it");
    deep.coordinator.tick();
    expect(() => send(deep, builder, "gen-1", node.id, tester, "Test it")).toThrow("Room handoff depth limit reached");
    await deep.host.release(node.id, { ok: true, text: "done" });
    const tight = world(undefined, { requests: 1 });
    send(tight, chief, "gen-1", undefined, builder, "Build it");
    expect(() => send(tight, chief, "gen-1", undefined, tester, "Test it")).toThrow("Room handoff budget exhausted");
  });

  it("refuses when the originating task is not running or belongs to another speaker, and passes the host's refusal through", async () => {
    const w = world();
    expect(() => send(w, chief, "gen-1", "nope", builder, "Build it")).toThrow("The originating room task is no longer running");
    const { node } = send(w, chief, "gen-1", undefined, builder, "Build it");
    w.coordinator.tick();
    expect(() => send(w, tester, "gen-1", node.id, chief, "Build it")).toThrow("The handoff belongs to a different room speaker");
    expect(() => send(w, { ...chief, threadId: "chief-other" }, "gen-1", undefined, tester, "Test it")).toThrow("The handoff belongs to a different room speaker");
    await flush();
    expect(w.coordinator.node(node.id)?.status).toBe("completed");
    expect(() => send(w, builder, "gen-1", node.id, tester, "Test it")).toThrow("The originating room task is no longer running");
    ended(w, "gen-1");
    expect(() => send(w, chief, "gen-1", undefined, tester, "Test it")).toThrow("The originating room task is no longer running");
    w.host.validateAnswer = "The recipient is not an allowed peer of the sender";
    expect(() => send(w, chief, "gen-2", undefined, tester, "Test it")).toThrow("The recipient is not an allowed peer of the sender");
  });

  it("returns the existing request for a repeat, and runs a finished one again only with rework", async () => {
    const w = world();
    const first = send(w, chief, "gen-1", undefined, builder, "Build it");
    const repeat = send(w, chief, "gen-1", undefined, builder, "Build it");
    expect(repeat).toMatchObject({ duplicate: true, node: { id: first.node.id, status: "queued" } });
    expect(w.coordinator.children("gen-1")).toHaveLength(1);
    w.coordinator.tick(); await flush();
    expect(send(w, chief, "gen-1", undefined, builder, "Build it")).toMatchObject({ duplicate: true, node: { id: first.node.id, status: "completed" } });
    const rework = send(w, chief, "gen-1", undefined, builder, "Build it", { rework: true });
    expect(rework.duplicate).toBe(false);
    expect(rework.node.id).not.toBe(first.node.id);
  });
});

describe("RuntimeCoordinator: the run adapter", () => {
  it("parks a turn that ends on NEEDS INPUT, takes the person's answer, and carries it into the next turn", async () => {
    let turns = 0;
    const w = world((node) => node.botId === "builder" && turns++ === 0 ? { ok: true, text: "Did the first half.\nneeds input: Which account should I use?" } : undefined);
    const { node } = send(w, chief, "gen-1", undefined, builder, "Build it");
    w.coordinator.tick(); await flush();
    expect(w.host.parks).toHaveLength(1);
    expect(w.host.parks[0]).toMatchObject({ node: { id: node.id, status: "waiting" }, question: "Which account should I use?" });
    expect(w.coordinator.node(node.id)?.status).toBe("waiting");
    expect(w.coordinator.liveEdges()).toEqual([{ sourceBotId: "chief", targetBotId: "builder", state: "running", threadId: "builder-work" }]);
    expect(w.host.reports).toHaveLength(0);
    expect(w.coordinator.answer("tester-work", "no one is parked here")).toBe(false);
    expect(w.coordinator.answer("builder-work", "Use the staging account")).toBe(true);
    expect(w.coordinator.answer("builder-work", "again")).toBe(false);
    expect(w.coordinator.node(node.id)?.status).toBe("queued");
    w.coordinator.tick();
    expect(w.host.runs).toHaveLength(2);
    const next = w.host.runs[1]!.text;
    expect(next).toContain(ENVELOPE_MARK);
    expect(next).toContain('The person answered: "Use the staging account".');
    await flush();
    expect(w.coordinator.node(node.id)).toMatchObject({ status: "completed", result: "builder done" });
  });

  it("reads a provider failure as a failed turn, and a stop as stopped", async () => {
    const w = world((node) => node.botId === "builder" ? { ok: false, text: "Provider exited" } : "hold");
    const { node } = send(w, chief, "gen-1", undefined, builder, "Build it");
    w.coordinator.tick(); await flush();
    expect(w.coordinator.node(node.id)).toMatchObject({ status: "failed", result: "Provider exited" });
    expect(w.host.reports[0]).toMatchObject({ child: { id: node.id, status: "failed" } });
    const { node: held } = send(w, chief, "gen-1", undefined, tester, "Test it");
    w.coordinator.tick();
    expect(w.host.held.has(held.id)).toBe(true);
    w.coordinator.cancelDirect("tester-work", "The source conversation was deleted");
    expect(w.host.runs[1]!.signal.aborted).toBe(true);
    await flush();
    expect(w.host.held.has(held.id)).toBe(false);
    expect(w.coordinator.node(held.id)).toMatchObject({ status: "cancelled", result: "The source conversation was deleted" });
  });

  it("progress() keeps a slow turn out of the runtime's stall window", async () => {
    const w = world(hold, { turnStallMs: 40 });
    const { node } = send(w, chief, "gen-1", undefined, builder, "Build it");
    w.coordinator.tick();
    await sleep(60);
    w.coordinator.progress("builder-work");
    w.coordinator.tick();
    expect(w.coordinator.node(node.id)?.status).toBe("running");
    await sleep(60);
    w.coordinator.tick();
    expect(w.coordinator.node(node.id)).toMatchObject({ status: "failed", result: expect.stringContaining("no activity") });
    await flush();
    expect(w.host.held.has(node.id)).toBe(false);
  });
});

describe("RuntimeCoordinator: stops", () => {
  it("cancelRoom stops every open request in the room (or one of its threads), failed when the harness says so", async () => {
    const w = world(hold);
    const { node: b } = send(w, chief, "gen-1", undefined, inRoom("builder"), "Build it", { batchKey: "call-1" });
    const { node: t } = send(w, chief, "gen-1", undefined, inRoom("tester"), "Build it", { batchKey: "call-1" });
    const { node: other } = send(w, chief, "gen-1", undefined, inRoom("scout", "g1", "room-2"), "Scout it");
    w.coordinator.tick();
    expect(w.coordinator.node(b.id)?.status).toBe("running");
    expect(w.coordinator.node(t.id)?.status).toBe("queued");
    w.coordinator.cancelRoom("g1", "room-1", "Provider reloaded", "failed");
    expect(w.coordinator.node(b.id)).toMatchObject({ status: "failed", result: "Provider reloaded" });
    expect(w.coordinator.node(t.id)).toMatchObject({ status: "failed", result: "Provider reloaded" });
    expect(w.coordinator.node(other.id)?.status).not.toBe("failed");
    w.coordinator.cancelRoom("g1");
    expect(w.coordinator.node(other.id)).toMatchObject({ status: "cancelled", result: "Stopped by user" });
    expect(w.coordinator.node("gen-1")?.status).toBe("source");
    await flush();
    expect(w.host.reports.map(r => r.child.id).sort()).toEqual([b.id, other.id, t.id].sort());
  });

  it("stopAwaitingDirect drops what never started, leaves a working teammate, and stops the requester", async () => {
    const w = world(hold);
    const { node: b } = send(w, chief, "gen-1", undefined, builder, "Build it");
    const { node: t } = send(w, chief, "gen-1", undefined, tester, "Test it");
    w.host.busyAnswer = node => node.botId === "tester";
    w.coordinator.tick();
    expect(w.coordinator.node(b.id)?.status).toBe("running");
    expect(w.coordinator.node(t.id)?.status).toBe("queued");
    expect(w.coordinator.outstandingDirect("chief-chat").map(n => n.id).sort()).toEqual([b.id, t.id].sort());
    expect(w.coordinator.assignerOf("builder-work")?.id).toBe("gen-1");
    const left = w.coordinator.stopAwaitingDirect("chief-chat");
    expect(left.map(n => n.id)).toEqual([b.id]);
    expect(w.coordinator.node(t.id)).toMatchObject({ status: "cancelled", result: "Stopped before it started" });
    expect(w.coordinator.node("gen-1")).toMatchObject({ status: "cancelled", result: "Stopped by user" });
    expect(w.host.runs[0]!.signal.aborted).toBe(false);
    // the teammate left running is nobody's wait: its requester ended, so
    // nothing is outstanding for that conversation and nobody assigned it
    expect(w.coordinator.outstandingDirect("chief-chat")).toEqual([]);
    expect(w.coordinator.assignerOf("builder-work")).toBeUndefined();
    await w.host.release(b.id, { ok: true, text: "built anyway" });
    expect(w.coordinator.node(b.id)).toMatchObject({ status: "completed", result: "built anyway", reported: true });
    expect(w.host.reports.at(-1)).toMatchObject({ child: { id: b.id }, parent: { id: "gen-1", status: "cancelled" } });
  });
});

describe("RuntimeCoordinator: read models", () => {
  it("activeDirect, assignerOf, outstandingDirect and liveEdges follow the tree", async () => {
    const w = world(hold);
    expect(w.coordinator.activeDirect("builder-work")).toBe(false);
    const { node: b } = send(w, chief, "gen-1", undefined, builder, "Build it");
    const { node: r } = send(w, chief, "gen-1", undefined, inRoom("scout"), "Scout it");
    w.coordinator.tick();
    expect(w.coordinator.activeDirect("builder-work")).toBe(true);
    expect(w.coordinator.activeDirect("chief-chat")).toBe(true);
    expect(w.coordinator.activeDirect("room-1")).toBe(false);
    // one read for every thread (port de OpenMausBot #3126) agrees with the per-thread read
    expect([...w.coordinator.activeDirectThreads()].sort()).toEqual(["builder-work", "chief-chat"]);
    expect(w.coordinator.assignerOf("builder-work")).toMatchObject({ id: "gen-1", status: "source" });
    expect(w.coordinator.assignerOf("chief-chat")).toBeUndefined();
    expect(w.coordinator.outstandingDirect("chief-chat").map(n => n.id).sort()).toEqual([b.id, r.id].sort());
    expect(w.coordinator.outstandingDirect("builder-work")).toEqual([]);
    expect(w.coordinator.liveEdges()).toEqual([
      { sourceBotId: "chief", targetBotId: "builder", state: "running", threadId: "builder-work" },
      { sourceBotId: "chief", targetBotId: "scout", state: "running", threadId: "room-1", groupId: "g1" },
    ]);
    await flush();
    expect(w.coordinator.node(r.id)?.status).toBe("completed");
    expect(w.coordinator.liveEdges()).toEqual([{ sourceBotId: "chief", targetBotId: "builder", state: "running", threadId: "builder-work" }]);
    // a tester queued behind the builder's thread shows as queued
    const { node: t } = send(w, builder, "gen-1", b.id, tester, "Test it");
    w.host.busyAnswer = node => node.id === t.id;
    w.coordinator.tick();
    expect(w.coordinator.liveEdges()).toEqual([
      { sourceBotId: "chief", targetBotId: "builder", state: "running", threadId: "builder-work" },
      { sourceBotId: "builder", targetBotId: "tester", state: "queued", threadId: "tester-work" },
    ]);
    // the builder's turn ends after handing out work: it waits, which the legacy edge shows as running
    await w.host.release(b.id, { ok: true, text: "done" });
    expect(w.coordinator.node(b.id)?.status).toBe("waiting");
    expect(w.coordinator.liveEdges()).toEqual([
      { sourceBotId: "chief", targetBotId: "builder", state: "running", threadId: "builder-work" },
      { sourceBotId: "builder", targetBotId: "tester", state: "queued", threadId: "tester-work" },
    ]);
    expect(w.coordinator.activeDirect("builder-work")).toBe(true);
    expect(w.coordinator.assignerOf("tester-work")).toMatchObject({ id: b.id, status: "waiting" });
    for (const thread of ["builder-work", "chief-chat", "tester-work", "room-1"]) {
      expect(w.coordinator.activeDirectThreads().has(thread), thread).toBe(w.coordinator.activeDirect(thread));
    }
  });

  it("sharedRequest batches one call's room recipients and nothing else", () => {
    const w = world();
    const { node: b } = send(w, chief, "gen-1", undefined, inRoom("builder"), "Review it", { batchKey: "call-1" });
    const { node: t } = send(w, chief, "gen-1", undefined, inRoom("tester"), "Review it", { batchKey: "call-1" });
    const { node: later } = send(w, chief, "gen-1", undefined, inRoom("scout"), "Review it", { batchKey: "call-2" });
    const { node: direct } = send(w, chief, "gen-1", undefined, builder, "Build it", { batchKey: "call-3" });
    expect(b.requestBatchKey).toBe("call-1");
    expect(direct.requestBatchKey).toBeUndefined();
    expect(w.coordinator.sharedRequest(b)).toEqual({ id: b.id, botIds: ["builder", "tester"] });
    expect(w.coordinator.sharedRequest(t)).toEqual({ id: b.id, botIds: ["builder", "tester"] });
    expect(w.coordinator.sharedRequest(later)).toEqual({ id: later.id, botIds: ["scout"] });
    expect(w.coordinator.sharedRequest(direct)).toEqual({ id: direct.id, botIds: ["builder"] });
    expect(w.coordinator.sharedRequest(w.coordinator.node("gen-1")!)).toEqual({ id: "gen-1", botIds: ["chief"] });
  });

  it("changed() tells the host which rooms and which direct threads to refresh", async () => {
    const w = world();
    send(w, chief, "gen-1", undefined, builder, "Build it");
    expect(w.host.changes).toEqual([{ groups: [], threads: ["chief-chat"] }, { groups: [], threads: ["builder-work", "chief-chat"] }]);
    send(w, chief, "gen-1", undefined, inRoom("scout"), "Scout it");
    expect(w.host.changes.at(-1)).toEqual({ groups: ["g1"], threads: ["chief-chat"] });
    w.coordinator.tick(); await flush();
    expect(w.host.changes.at(-1)!.threads).toContain("chief-chat");
    expect(w.host.changes.every(c => c.groups.length + c.threads.length > 0)).toBe(true);
  });
});

describe("RuntimeCoordinator: restarts", () => {
  it("continuesAfterRestart names the turns the next start goes on with, and the next start reruns a cut turn with its note", async () => {
    const dir = mkdtempSync(join(tmpdir(), "runtime-coordinator-"));
    try {
      const before = world(hold, {}, dir);
      const { node } = send(before, chief, "gen-1", undefined, builder, "Build it");
      before.coordinator.tick();
      expect(before.coordinator.node(node.id)?.status).toBe("running");
      expect(before.coordinator.continuesAfterRestart("builder-work")).toBe(true);
      expect(before.coordinator.continuesAfterRestart("chief-chat")).toBe(true);
      expect(before.coordinator.continuesAfterRestart("tester-work")).toBe(false);
      before.coordinator.close();
      // the process died with the builder mid-turn; the next start reconciles
      const after = world(undefined, {}, dir);
      const rerun = after.coordinator.node(node.id)!;
      expect(rerun).toMatchObject({ status: "queued", restart: "rerun", restarts: 1, executions: 1 });
      expect(after.coordinator.node("gen-1")).toMatchObject({ status: "waiting", restart: "cut" });
      expect(after.coordinator.continuesAfterRestart("builder-work")).toBe(true);
      expect(after.coordinator.continuesAfterRestart("chief-chat")).toBe(false);
      after.coordinator.tick();
      expect(after.host.runs).toHaveLength(1);
      // A rerun is not a resume: the host sees a fresh turn with the restart note in front.
      expect(after.host.runs[0]!.resumed).toBe(false);
      expect(after.host.runs[0]!.text).toMatch(/^Sagax restarted while your previous turn here was running and cut it off;.*\n\[Sagax assignment /);
      await flush();
      expect(after.coordinator.node(node.id)).toMatchObject({ status: "completed", restarts: 1 });
      after.coordinator.tick();
      const resume = after.host.runs[1]!;
      expect(resume.node.id).toBe("gen-1");
      expect(resume.text).toMatch(/^Sagax restarted before your previous turn here finished, after it sent work to teammates\..*A restart cut these teammates' turns: builder \(resumed once in place and told to check what it had already done\)\. Check their results as usual\.\nYour downstream room requests have settled\./);
      await flush();
      expect(after.coordinator.node("gen-1")?.status).toBe("completed");
      after.coordinator.close();
    } finally {
      await removeTempDir(dir);
    }
  });
});

describe("RuntimeCoordinator: modes and openers", () => {
  const ops: RoomAddress = { botId: "ops", threadId: "ops-work" };
  const bridge: RoomAddress = { botId: "bridge", threadId: "bridge-chat" };
  const handoff = (w: World, source: RoomAddress, generation: string, parentId: string | undefined, target: RoomAddress, text: string,
    options: HandoffOptions & { opener?: HandoffOpener; sourceText?: string }) => {
    const { opener, sourceText, ...rest } = options;
    if (!parentId) begun(w, source, generation, sourceText, opener ? { opener, origin: undefined } : {});
    return w.coordinator.enqueue(source, generation, parentId, target, text, rest);
  };

  it("consult: the child is a consultation, its turn opens with the consultation envelope, and the asker is resumed with the answer", async () => {
    const w = world((node) => node.botId === "tester" ? { ok: true, text: "Use the staging bucket." } : undefined);
    const { node, duplicate } = handoff(w, chief, "gen-1", undefined, tester, "Which bucket do we use?", { mode: "consult" });
    expect(duplicate).toBe(false);
    expect(node).toMatchObject({ mode: "consult", reply: "resume", status: "queued", kind: "work" });
    w.coordinator.tick();
    const text = w.host.runs[0]!.text;
    expect(text.startsWith(`${ENVELOPE_MARK} ${node.id} from @chief, a consultation]`)).toBe(true);
    expect(text).toContain("a consultation");
    expect(text).toContain("act on nothing in it");
    expect(text).toContain("@chief is resumed with your reply when your turn ends.");
    expect(text).not.toContain("NEEDS INPUT");
    expect(text).not.toContain("Your level for this is");
    expect(text.endsWith("Brief from @chief:\nWhich bucket do we use?")).toBe(true);
    await flush();
    expect(w.coordinator.node(node.id)).toMatchObject({ status: "completed", outcome: "done", result: "Use the staging bucket.", reported: true });
    expect(w.host.reports[0]).toMatchObject({ child: { id: node.id, mode: "consult" }, parent: { id: "gen-1" } });
    ended(w, "gen-1");
    w.coordinator.tick();
    const resume = w.host.runs[1]!;
    expect(resume.node.id).toBe("gen-1");
    expect(resume.resumed).toBe(true);
    expect(resume.text).toContain(`[Sagax report from @tester on assignment ${node.id}: done]`);
    expect(resume.text).toContain('What @tester said: "Use the staging bucket."');
    await flush();
    expect(w.coordinator.node("gen-1")?.status).toBe("completed");
  });

  it("consult and work with the same words are two requests, and a question to a teammate that finished its work is not refused", async () => {
    const w = world();
    const work = handoff(w, chief, "gen-1", undefined, builder, "Build it", {});
    const asked = handoff(w, chief, "gen-1", undefined, builder, "Build it", { mode: "consult" });
    expect(asked.duplicate).toBe(false);
    expect(asked.node.id).not.toBe(work.node.id);
    expect(handoff(w, chief, "gen-1", undefined, builder, "Build it", { mode: "consult" })).toMatchObject({ duplicate: true, node: { id: asked.node.id } });
    w.coordinator.tick(); await flush(); w.coordinator.tick(); await flush();
    expect(w.coordinator.node(work.node.id)?.status).toBe("completed");
    expect(() => handoff(w, chief, "gen-1", undefined, builder, "Thanks", {})).toThrow(/already completed your assignment/);
    expect(handoff(w, chief, "gen-1", undefined, builder, "How long did it take?", { mode: "consult" }).node).toMatchObject({ mode: "consult", status: "queued" });
    expect(handoff(w, chief, "gen-1", undefined, builder, "Heads up: release at six", { mode: "notify" }).node).toMatchObject({ mode: "notify", status: "queued" });
  });

  it("notify: reply none, the requesting turn's end completes the root without waiting, no inbox item, no resume", async () => {
    const w = world();
    const { node } = handoff(w, chief, "gen-1", undefined, ops, "FYI: shipping tonight", { mode: "notify", reply: "resume" });
    expect(node).toMatchObject({ mode: "notify", reply: "none", status: "queued" });
    expect(w.coordinator.outstandingDirect("chief-chat")).toEqual([]);
    expect(w.coordinator.outstandingFor("chief-chat")).toEqual([]);
    ended(w, "gen-1");
    expect(w.coordinator.node("gen-1")).toMatchObject({ status: "completed", outcome: "done", executions: 1 });
    w.coordinator.tick();
    expect(w.host.runs[0]!.text).toContain("Ownership is yours: results, failures and questions stay in this thread; @chief is not waiting and will not be resumed.");
    await flush();
    expect(w.coordinator.node(node.id)).toMatchObject({ status: "completed", reported: true });
    w.coordinator.tick(); await flush();
    expect(w.host.runs.map(r => r.node.id)).toEqual([node.id]);
    expect(w.coordinator.status("gen-1")!.inbox).toEqual([]);
    expect(w.coordinator.status(node.id)!.inbox).toEqual([]);
    // the host still hears the settlement once (its chip is its own choice), and nothing wakes anybody
    expect(w.host.reports.map(r => r.child.id)).toEqual([node.id]);
  });

  it("external runtime opener: a poll root under the run id; it completes without a run and the run polls its children's results once", async () => {
    const w = world();
    const opener: HandoffOpener = { requester: { kind: "external_runtime", runId: "run-7" }, origin: { kind: "outside", source: "external_runtime", ref: "bridge-chat" } };
    const { node } = handoff(w, bridge, "gen-x", undefined, builder, "Build it", { opener, sourceText: "" });
    expect(node).toMatchObject({ reply: "poll", mode: "work", rootId: "gen-x", origin: { kind: "outside" } });
    const root = w.coordinator.status("gen-x")!.assignment;
    expect(root).toMatchObject({ reply: "poll", mode: "work", status: "running", origin: { kind: "outside", source: "external_runtime", ref: "bridge-chat" },
      requester: { kind: "external_runtime", runId: "run-7", botId: "bridge", threadId: "bridge-chat", chief: false } });
    expect(w.coordinator.status(node.id)!.assignment.requester).toEqual({ kind: "bot_turn", botId: "bridge", threadId: "bridge-chat", chief: false, runId: "run-7" });
    // a later hand-off of the same turn, with no opener, still lands in the run's inbox
    const { node: second } = handoff(w, bridge, "gen-x", undefined, tester, "Test it", { reply: "resume" });
    expect(second.reply).toBe("poll");
    w.coordinator.tick();
    const text = w.host.runs[0]!.text;
    expect(text).toContain("This work started with an external runtime, not with Milind's own request");
    expect(text).toContain("@bridge reads your reply from its inbox when it asks");
    ended(w, "gen-x");
    expect(w.coordinator.node("gen-x")?.status).toBe("waiting");
    await flush();
    w.coordinator.tick(); await flush(); w.coordinator.tick();
    expect(w.coordinator.node("gen-x")).toMatchObject({ status: "completed", outcome: "done", executions: 1 });
    expect(w.host.runs.map(r => r.node.id).sort()).toEqual([node.id, second.id].sort());
    // the root ended without a turn of its own: the host hears it alone
    expect(w.host.reports.at(-1)).toEqual({ child: expect.objectContaining({ id: "gen-x", status: "completed" }) });
    const polled = w.coordinator.poll({ runId: "run-7" });
    expect(polled.items.map(i => [i.assignmentId, i.kind])).toEqual([[node.id, "settled"], [second.id, "settled"]]);
    expect(polled.assignments.map(a => a.id)).toEqual([node.id, second.id]);
    expect(polled.assignments[0]).toMatchObject({ status: "completed", outcome: "done", mode: "work", reply: "poll", result: "builder done" });
    expect(w.coordinator.poll({ runId: "run-7" }).items).toEqual([]);
    const status = w.coordinator.status(node.id)!;
    expect(status.assignment).toMatchObject({ id: node.id, status: "completed", outcome: "done" });
    expect(status.children).toEqual([]);
    expect(status.inbox.map(i => [i.assignmentId, i.deliveredAt !== undefined])).toEqual([[node.id, true]]);
    expect(w.coordinator.status("gen-x")!.inbox.map(i => i.assignmentId)).toEqual([node.id, second.id]);
    expect(w.coordinator.status("gen-x")!.children.map(c => c.id)).toEqual([node.id, second.id]);
    expect(w.coordinator.status("nope")).toBeUndefined();
  });

  it("routine opener: the root keeps the run as its requester, the child's envelope has the routine lineage, done_when reaches row and envelope", async () => {
    const w = world();
    const opener: HandoffOpener = { requester: { kind: "routine_run", runId: "run-42" }, origin: { kind: "routine", source: "routine", ref: "routine-1" } };
    const { node } = handoff(w, chief, "gen-r", undefined, builder, "Build the nightly report", { opener, sourceText: "Nightly: build the report", doneWhen: "the PDF is in the shared folder" });
    expect(node).toMatchObject({ reply: "resume", mode: "work", origin: { kind: "outside" } });
    expect(w.coordinator.status("gen-r")!.assignment).toMatchObject({ reply: "resume", brief: "Nightly: build the report",
      requester: { kind: "routine_run", runId: "run-42", botId: "chief", threadId: "chief-chat" }, origin: { kind: "routine", source: "routine", ref: "routine-1" } });
    expect(w.coordinator.status(node.id)!.assignment).toMatchObject({ doneWhen: "the PDF is in the shared folder",
      requester: { kind: "bot_turn", botId: "chief", threadId: "chief-chat", runId: "run-42" }, origin: { kind: "routine" } });
    expect(w.coordinator.outstandingFor("chief-chat").map(n => n.id)).toEqual([node.id]);
    w.coordinator.tick();
    const text = w.host.runs[0]!.text;
    expect(text).toContain("A routine run started this work");
    expect(text).toContain("a step the routine does not cover");
    expect(text).toContain('Done when: "the PDF is in the shared folder".');
    expect(text).not.toContain("Milind asked");
    expect(text).not.toContain("outside content");
    await flush();
    expect(w.coordinator.outstandingFor("chief-chat")).toEqual([]);
    ended(w, "gen-r");
    w.coordinator.tick();
    // the run's resume is a turn of the root the runtime dispatches; the host runs it as a routine turn
    expect(w.host.runs[1]).toMatchObject({ node: { id: "gen-r", status: "running", executions: 2 }, resumed: true });
    await flush();
    expect(w.coordinator.node("gen-r")?.status).toBe("completed");
  });

  it("outstandingFor lists room and direct work the conversation waits on, never notices, and follows a child's own hand-offs", async () => {
    const w = world(hold);
    const { node: b } = send(w, chief, "gen-1", undefined, builder, "Build it");
    const { node: r } = send(w, chief, "gen-1", undefined, inRoom("scout"), "Scout it");
    const { node: n } = handoff(w, chief, "gen-1", undefined, ops, "FYI", { mode: "notify" });
    expect(w.coordinator.outstandingFor("chief-chat").map(x => x.id).sort()).toEqual([b.id, r.id].sort());
    expect(w.coordinator.outstandingDirect("chief-chat").map(x => x.id).sort()).toEqual([b.id, r.id].sort());
    expect(w.coordinator.outstandingFor("builder-work")).toEqual([]);
    expect(w.coordinator.outstandingFor("ops-work")).toEqual([]);
    w.coordinator.tick(); await flush();
    expect(w.coordinator.node(r.id)?.status).toBe("completed");
    expect(w.coordinator.node(n.id)?.status).toBe("completed");
    expect(w.coordinator.outstandingFor("chief-chat").map(x => x.id)).toEqual([b.id]);
    const { node: t } = send(w, builder, "gen-1", b.id, tester, "Test it");
    expect(w.coordinator.outstandingFor("builder-work").map(x => x.id)).toEqual([t.id]);
    expect(w.coordinator.outstandingFor("chief-chat").map(x => x.id)).toEqual([b.id]);
    await w.host.release(b.id, { ok: true, text: "built" });
    expect(w.coordinator.node(b.id)?.status).toBe("waiting");
    expect(w.coordinator.outstandingFor("chief-chat").map(x => x.id)).toEqual([b.id]);
  });

  it("thread: standing records the teammate's standing thread as the destination; new or absent is a work thread", () => {
    const w = world();
    const standing = handoff(w, chief, "gen-1", undefined, builder, "Build it", { thread: "standing" });
    const fresh = handoff(w, chief, "gen-1", undefined, tester, "Test it", { thread: "new" });
    const plain = handoff(w, chief, "gen-1", undefined, ops, "Deploy it", {});
    const room = handoff(w, chief, "gen-1", undefined, inRoom("scout"), "Scout it", { thread: "standing" });
    expect(w.coordinator.status(standing.node.id)!.assignment.assignee.destination).toEqual({ kind: "standing_thread", threadId: "builder-work" });
    expect(w.coordinator.status(fresh.node.id)!.assignment.assignee.destination).toEqual({ kind: "work_thread", threadId: "tester-work" });
    expect(w.coordinator.status(plain.node.id)!.assignment.assignee.destination).toEqual({ kind: "work_thread", threadId: "ops-work" });
    expect(w.coordinator.status(room.node.id)!.assignment.assignee.destination).toEqual({ kind: "room_thread", threadId: "room-1", groupId: "g1" });
    expect(w.coordinator.status(standing.node.id)!.assignment.doneWhen).toBeUndefined();
  });
});

describe("RuntimeCoordinator: every turn a root (beginTurn, endTurn, answerRoot, parkedDirect)", () => {
  const CONNECTED = "Sagax connection update: the user securely connected GitHub. Continue the task.";
  const bridge: RoomAddress = { botId: "bridge", threadId: "bridge-chat" };
  const begin = (w: World, id = "gen-1", over: Partial<BeginTurnRequest> = {}) =>
    w.coordinator.beginTurn({ id, address: chief, brief: "Ship the CSV export", level: "auto", origin: userOrigin, ...over });

  it("beginTurn creates the root under the turn's id with its origin and level, idempotent on the same id; openers set the requester and the lane", () => {
    const w = world();
    w.host.chiefs.add("chief-chat");
    const node = begin(w);
    expect(node).toMatchObject({ id: "gen-1", rootId: "gen-1", status: "source", botId: "chief", threadId: "chief-chat", text: "Ship the CSV export",
      kind: "work", origin: userOrigin, executions: 1, mode: "work", reply: "resume", restarts: 0 });
    for (const absent of ["parentId", "cards", "question", "groupId"]) expect(absent in node).toBe(false);
    expect(w.coordinator.status("gen-1")!.assignment).toMatchObject({ level: "auto", levelSource: "own", depth: 0, status: "running",
      requester: { kind: "person", threadId: "chief-chat", botId: "chief", chief: true },
      origin: { kind: "person", source: "chat", ref: "chief-chat", quote: "Ship the CSV export" }, budgets: { executions: 1 } });
    // the level is the one the host passed for this turn, never levelOf()
    expect(w.host.levels.chief).toBeUndefined();
    // the same id again is the same root: nothing is rewritten, nothing added
    expect(begin(w, "gen-1", { brief: "Something else", level: "full" })).toMatchObject({ id: "gen-1", text: "Ship the CSV export", executions: 1 });
    expect(w.coordinator.status("gen-1")!.assignment.level).toBe("auto");
    expect(w.coordinator.all().map(n => n.id)).toEqual(["gen-1"]);
    expect(w.coordinator.activeDirect("chief-chat")).toBe(true);
    // no legacy origin: an outside line
    expect(begin(w, "gen-2", { origin: undefined, address: { botId: "chief", threadId: "other-chat" } }).origin).toEqual({ kind: "outside" });
    // an external opener: a poll root under the run id
    const external: HandoffOpener = { requester: { kind: "external_runtime", runId: "run-7" }, origin: { kind: "outside", source: "external_runtime", ref: "bridge-chat" } };
    expect(begin(w, "gen-x", { address: bridge, opener: external, origin: undefined })).toMatchObject({ reply: "poll", origin: { kind: "outside" } });
    expect(w.coordinator.status("gen-x")!.assignment).toMatchObject({ reply: "poll",
      requester: { kind: "external_runtime", runId: "run-7", botId: "bridge", threadId: "bridge-chat", chief: false },
      origin: { kind: "outside", source: "external_runtime", ref: "bridge-chat" } });
    // a routine opener keeps the run as its requester and is resumed like a person's turn
    const routine: HandoffOpener = { requester: { kind: "routine_run", runId: "run-42" }, origin: { kind: "routine", source: "routine", ref: "routine-1" } };
    expect(begin(w, "gen-r", { address: { botId: "chief", threadId: "routine-chat" }, opener: routine })).toMatchObject({ reply: "resume", origin: { kind: "outside" } });
    expect(w.coordinator.status("gen-r")!.assignment).toMatchObject({ reply: "resume",
      requester: { kind: "routine_run", runId: "run-42", botId: "chief", threadId: "routine-chat", chief: false }, origin: { kind: "routine", source: "routine", ref: "routine-1" } });
    // a hand-off from that turn lands under the root beginTurn made, not a second one
    const { node: child } = send(w, chief, "gen-1", undefined, builder, "Build it");
    expect(child).toMatchObject({ rootId: "gen-1", parentId: "gen-1" });
    expect(w.coordinator.all().map(n => n.id)).toEqual(["gen-1", "gen-2", "gen-x", "gen-r", child.id]);
  });

  it("endTurn with cards parks the root: parkedDirect finds it with its cards, park() hears it once, nobody is woken; answerRoot runs the answered turn with the harness text alone", async () => {
    const w = world();
    begin(w);
    w.coordinator.endTurn("gen-1", { ok: true, text: "Please connect GitHub.", evidence: { toolCalls: 3 },
      cards: { question: "Connect GitHub to continue", ids: ["msg-1", "msg-2"] } });
    const parked = w.coordinator.parkedDirect("chief-chat");
    expect(parked).toMatchObject({ id: "gen-1", status: "waiting", question: "Connect GitHub to continue", cards: ["msg-1", "msg-2"], executions: 1 });
    expect(w.coordinator.node("gen-1")?.cards).toEqual(["msg-1", "msg-2"]);
    expect(w.coordinator.parkedDirect("builder-work")).toBeUndefined();
    expect(w.host.parks).toEqual([{ node: expect.objectContaining({ id: "gen-1", status: "waiting", cards: ["msg-1", "msg-2"] }), question: "Connect GitHub to continue" }]);
    expect(w.host.reports).toEqual([]);
    expect(w.coordinator.status("gen-1")!.inbox).toEqual([]);
    expect(w.coordinator.status("gen-1")!.assignment.evidence).toEqual({ toolCalls: 3 });
    w.coordinator.tick();
    expect(w.host.runs).toEqual([]);
    expect(w.host.parks).toHaveLength(1);
    // a typed line never answers a root parked on cards (it starts a new root); the cards' path does
    expect(w.coordinator.answer("chief-chat", "a typed line while the card waits")).toBe(false);
    expect(w.coordinator.parkedDirect("chief-chat")?.id).toBe("gen-1");
    expect(w.coordinator.answerRoot("gen-1", CONNECTED)).toBe(true);
    expect(w.coordinator.answerRoot("gen-1", CONNECTED)).toBe(false);
    expect(w.coordinator.parkedDirect("chief-chat")).toBeUndefined();
    expect(w.coordinator.node("gen-1")).toMatchObject({ status: "queued", cards: ["msg-1", "msg-2"] });
    w.coordinator.tick();
    expect(w.host.runs).toHaveLength(1);
    const run = w.host.runs[0]!;
    expect(run.node).toMatchObject({ id: "gen-1", status: "running", executions: 2, kind: "work", botId: "chief", threadId: "chief-chat" });
    expect("cards" in run.node).toBe(false);
    expect(run.resumed).toBe(false);
    expect(run.composed).toEqual({ text: CONNECTED, note: CONNECTED, restartNote: "", turn: "answered" });
    expect(run.text).not.toContain(ENVELOPE_MARK);
    expect(run.text).not.toContain("Brief from");
    await flush();
    expect(w.coordinator.node("gen-1")).toMatchObject({ status: "completed", outcome: "done", result: "chief done", executions: 2, reported: true });
    expect("cards" in w.coordinator.node("gen-1")!).toBe(false);
    expect(w.host.reports).toEqual([]);
    expect(w.coordinator.activeDirect("chief-chat")).toBe(false);
  });

  it("endTurn with cap continues the root in place: the continued turn carries the note and the handoff path, and a cap from host.run continues it again", async () => {
    const w = world((node, text) => node.id === "gen-1" && text.includes("/handoffs/1.md")
      ? { ok: true, text: "more", cap: { note: "The step cap was reached again.", handoffPath: "/handoffs/2.md" } } : undefined);
    begin(w);
    w.coordinator.endTurn("gen-1", { ok: true, text: "half", cap: { note: "The step cap was reached.", handoffPath: "/handoffs/1.md" } });
    expect(w.coordinator.node("gen-1")).toMatchObject({ status: "queued", result: "half", executions: 1 });
    expect(w.coordinator.status("gen-1")!.assignment.continuation).toEqual({ note: "The step cap was reached.", handoffPath: "/handoffs/1.md", count: 1 });
    expect(w.coordinator.parkedDirect("chief-chat")).toBeUndefined();
    expect(w.coordinator.activeDirect("chief-chat")).toBe(true);
    expect(w.host.parks).toEqual([]);
    w.coordinator.tick();
    const first = w.host.runs[0]!;
    expect(first.node).toMatchObject({ id: "gen-1", status: "running", executions: 2 });
    expect(first.resumed).toBe(false);
    expect(first.composed).toEqual({ text: "The step cap was reached. Every step so far is listed in /handoffs/1.md; read it before going on.",
      note: "The step cap was reached. Every step so far is listed in /handoffs/1.md; read it before going on.", restartNote: "", turn: "continued" });
    expect(first.text).not.toContain(ENVELOPE_MARK);
    await flush();
    expect(w.coordinator.node("gen-1")).toMatchObject({ status: "queued", result: "more", executions: 2 });
    expect(w.coordinator.status("gen-1")!.assignment.continuation).toEqual({ note: "The step cap was reached again.", handoffPath: "/handoffs/2.md", count: 2 });
    w.coordinator.tick();
    const second = w.host.runs[1]!;
    expect(second.composed.turn).toBe("continued");
    expect(second.text).toBe("The step cap was reached again. Every step so far is listed in /handoffs/2.md; read it before going on.");
    await flush();
    expect(w.coordinator.node("gen-1")).toMatchObject({ status: "completed", result: "chief done", executions: 3 });
    expect(w.host.reports).toEqual([]);
    // a cap with no handoff path (a seat the turn could not get) is the note alone
    begin(w, "gen-2", { address: { botId: "chief", threadId: "other-chat" } });
    w.coordinator.endTurn("gen-2", { ok: true, text: "", cap: { note: "The computer is free again. Continue where you left off." } });
    w.coordinator.tick();
    expect(w.host.runs[2]!.composed).toEqual({ text: "The computer is free again. Continue where you left off.", note: "The computer is free again. Continue where you left off.", restartNote: "", turn: "continued" });
  });

  it("a root cut by a restart reruns once as the rerun turn, the restart note first; cut again it ends interrupted, reported into its own conversation", async () => {
    const dir = mkdtempSync(join(tmpdir(), "runtime-coordinator-root-"));
    try {
      const before = world(undefined, {}, dir);
      begin(before);
      expect(before.coordinator.continuesAfterRestart("chief-chat")).toBe(true);
      before.coordinator.close();

      const after = world(undefined, {}, dir);
      expect(after.coordinator.node("gen-1")).toMatchObject({ status: "queued", restart: "rerun", restarts: 1, executions: 1 });
      expect(after.coordinator.continuesAfterRestart("chief-chat")).toBe(true);
      expect(after.coordinator.parkedDirect("chief-chat")).toBeUndefined();
      expect(after.host.parks).toEqual([]);
      after.coordinator.tick();
      expect(after.host.runs).toHaveLength(1);
      const run = after.host.runs[0]!;
      expect(run.node).toMatchObject({ id: "gen-1", status: "running", executions: 2, restarts: 1, restart: "rerun" });
      expect(run.resumed).toBe(false);
      expect(run.composed.turn).toBe("rerun");
      expect(run.composed.restartNote).toMatch(/^Sagax restarted while your previous turn here was running and cut it off; this turn continues it\./);
      expect(run.text.startsWith(run.composed.restartNote)).toBe(true);
      expect(run.text.endsWith('Continue the request you were working on: "Ship the CSV export".')).toBe(true);
      expect(run.text).not.toContain(ENVELOPE_MARK);
      expect(run.composed.note).toBe(run.text);
      await flush();
      expect(after.coordinator.node("gen-1")).toMatchObject({ status: "completed", restarts: 1, executions: 2, result: "chief done" });
      expect("restart" in after.coordinator.node("gen-1")!).toBe(false);
      expect(after.host.reports).toEqual([]);
      after.coordinator.close();

      // a second root, cut while its rerun was running
      const again = world(() => "hold", {}, dir);
      begin(again, "gen-2");
      again.coordinator.close();
      const rerun = world(() => "hold", {}, dir);
      rerun.coordinator.tick();
      expect(rerun.host.runs.map(r => [r.node.id, r.composed.turn])).toEqual([["gen-2", "rerun"]]);
      expect(rerun.host.held.has("gen-2")).toBe(true);
      rerun.coordinator.close();
      const last = world(undefined, {}, dir);
      expect(last.coordinator.node("gen-2")).toMatchObject({ status: "failed", outcome: "interrupted", restarts: 1, executions: 2 });
      expect(last.host.reports).toEqual([{ child: expect.objectContaining({ id: "gen-2", status: "failed", outcome: "interrupted" }) }]);
      expect(last.coordinator.continuesAfterRestart("chief-chat")).toBe(false);
      last.coordinator.tick();
      expect(last.host.runs).toEqual([]);
      last.coordinator.close();
    } finally {
      await removeTempDir(dir);
    }
  });

  it("a parked root survives a restart parked: park() again with its cards, no new item, no run, and the answer still resumes it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "runtime-coordinator-parked-"));
    try {
      const before = world(undefined, {}, dir);
      begin(before);
      before.coordinator.endTurn("gen-1", { ok: true, text: "", cards: { question: "Connect GitHub", ids: ["msg-1"] } });
      expect(before.coordinator.continuesAfterRestart("chief-chat")).toBe(false);
      before.coordinator.close();
      const after = world(undefined, {}, dir);
      expect(after.coordinator.parkedDirect("chief-chat")).toMatchObject({ id: "gen-1", status: "waiting", cards: ["msg-1"], restarts: 0 });
      expect(after.host.parks).toEqual([{ node: expect.objectContaining({ id: "gen-1", cards: ["msg-1"] }), question: "Connect GitHub" }]);
      expect(after.coordinator.status("gen-1")!.inbox).toEqual([]);
      after.coordinator.tick();
      expect(after.host.runs).toEqual([]);
      expect(after.coordinator.answerRoot("gen-1", CONNECTED)).toBe(true);
      after.coordinator.tick();
      expect(after.host.runs[0]!.composed).toEqual({ text: CONNECTED, note: CONNECTED, restartNote: "", turn: "answered" });
      await flush();
      expect(after.coordinator.node("gen-1")).toMatchObject({ status: "completed", executions: 2, restarts: 0 });
      after.coordinator.close();
    } finally {
      await removeTempDir(dir);
    }
  });

  it("a child's cap continues it in place: no failure to the requester, the continued turn opens with the note then its assignment, and the resume carries the final result once", async () => {
    let caps = 0;
    const w = world((node) => node.botId === "builder" && caps++ === 0 ? { ok: true, text: "half built", cap: { note: "Step cap: 64 rounds.", handoffPath: "/handoffs/builder-1.md" } } : undefined);
    const { node } = send(w, chief, "gen-1", undefined, builder, "Build it");
    w.coordinator.tick(); await flush();
    expect(w.coordinator.node(node.id)).toMatchObject({ status: "queued", result: "half built", executions: 1, reported: false });
    expect(w.host.reports).toEqual([]);
    expect(w.coordinator.outstandingDirect("chief-chat").map(n => n.id)).toEqual([node.id]);
    expect(w.coordinator.status("gen-1")!.inbox).toEqual([]);
    w.coordinator.tick();
    const second = w.host.runs[1]!;
    expect(second.node).toMatchObject({ id: node.id, status: "running", executions: 2 });
    expect(second.resumed).toBe(false);
    expect(second.composed.turn).toBe("continued");
    expect(second.composed.restartNote).toBe("");
    expect(second.text.startsWith(`Step cap: 64 rounds. Every step so far is listed in /handoffs/builder-1.md; read it before going on.\n${ENVELOPE_MARK} ${node.id} from @chief for Milind]`)).toBe(true);
    expect(second.text.endsWith("Brief from @chief:\nBuild it")).toBe(true);
    expect(second.composed.note.startsWith("Step cap: 64 rounds.")).toBe(true);
    expect(second.composed.note).not.toContain("Brief from");
    await flush();
    expect(w.coordinator.node(node.id)).toMatchObject({ status: "completed", result: "builder done", executions: 2, reported: true });
    expect(w.host.reports.map(r => r.child.id)).toEqual([node.id]);
    ended(w, "gen-1");
    w.coordinator.tick();
    const resume = w.host.runs[2]!;
    expect(resume).toMatchObject({ node: { id: "gen-1" }, resumed: true });
    expect(resume.composed.turn).toBe("resume");
    expect(resume.text).toContain(`[Sagax report from @builder on assignment ${node.id}: done]`);
    expect(resume.text).toContain('What @builder said: "builder done"');
    expect(resume.text).not.toContain("half built");
    await flush();
    expect(w.coordinator.node("gen-1")?.status).toBe("completed");
    expect(w.host.runs).toHaveLength(3);
  });

  it("activeDirect is true for a running or parked root; outstandingDirect lists only its live children; parkedDirect only a root on cards", async () => {
    const w = world(hold);
    expect(w.coordinator.activeDirect("chief-chat")).toBe(false);
    begin(w);
    expect(w.coordinator.activeDirect("chief-chat")).toBe(true);
    expect(w.coordinator.outstandingDirect("chief-chat")).toEqual([]);
    expect(w.coordinator.parkedDirect("chief-chat")).toBeUndefined();
    const { node: b } = send(w, chief, "gen-1", undefined, builder, "Build it");
    w.coordinator.tick();
    expect(w.coordinator.outstandingDirect("chief-chat").map(n => n.id)).toEqual([b.id]);
    expect(w.coordinator.activeDirect("builder-work")).toBe(true);
    // the root parks on cards while its teammate works: active, parked, its child still outstanding
    w.coordinator.endTurn("gen-1", { ok: true, text: "", cards: { question: "Approve the key", ids: ["msg-1"] } });
    expect(w.coordinator.activeDirect("chief-chat")).toBe(true);
    expect(w.coordinator.parkedDirect("chief-chat")).toMatchObject({ id: "gen-1", cards: ["msg-1"] });
    expect(w.coordinator.outstandingDirect("chief-chat").map(n => n.id)).toEqual([b.id]);
    expect(w.coordinator.assignerOf("builder-work")).toMatchObject({ id: "gen-1", status: "waiting" });
    // a child parked on its NEEDS INPUT line is outstanding and answerable by a typed line; it is no parkedDirect
    await w.host.release(b.id, { ok: true, text: "NEEDS INPUT: Which key?" });
    expect(w.coordinator.node(b.id)).toMatchObject({ status: "waiting", question: "Which key?" });
    expect(w.coordinator.parkedDirect("builder-work")).toBeUndefined();
    expect(w.coordinator.outstandingDirect("chief-chat").map(n => n.id)).toEqual([b.id]);
    expect(w.coordinator.answer("builder-work", "the staging key")).toBe(true);
    expect(w.coordinator.answerRoot("gen-1", "The user approved the key.")).toBe(true);
    expect(w.coordinator.parkedDirect("chief-chat")).toBeUndefined();
    expect(w.coordinator.activeDirect("chief-chat")).toBe(true);
    w.coordinator.tick(); await flush();
    expect(w.host.runs.map(r => [r.node.id, r.composed.turn]).sort()).toEqual([[b.id, "first"], [b.id, "answered"], ["gen-1", "answered"]].sort());
    // the root's answered turn ended while its teammate still works: it waits
    expect(w.coordinator.node("gen-1")).toMatchObject({ status: "waiting", executions: 2 });
    expect(w.coordinator.activeDirect("chief-chat")).toBe(true);
    await w.host.release(b.id, { ok: true, text: "done with the key" });
    w.coordinator.tick(); await flush();
    expect(w.coordinator.node("gen-1")).toMatchObject({ status: "completed", executions: 3 });
    expect(w.coordinator.activeDirect("chief-chat")).toBe(false);
    expect(w.coordinator.outstandingDirect("chief-chat")).toEqual([]);
  });

  it("a root's own NEEDS INPUT line does not park it: the question is in the chat, and the next typed line is a new root", async () => {
    const w = world((node) => node.id === "gen-1" ? { ok: true, text: "Done half.\nNEEDS INPUT: Which region?" } : undefined);
    begin(w);
    w.coordinator.endTurn("gen-1", { ok: true, text: "", cap: { note: "Cap." } });
    w.coordinator.tick(); await flush();
    expect(w.coordinator.node("gen-1")).toMatchObject({ status: "completed", result: "Done half.\nNEEDS INPUT: Which region?" });
    expect(w.host.parks).toEqual([]);
    expect(w.coordinator.parkedDirect("chief-chat")).toBeUndefined();
    expect(w.coordinator.answer("chief-chat", "eu")).toBe(false);
  });

  it("hardening: endTurn on an unknown, a settled or a child id logs and does nothing; answerRoot on a child or a running root is false; view carries cards", () => {
    const w = world();
    expect(() => w.coordinator.endTurn("ghost", { ok: true, text: "" })).not.toThrow();
    begin(w);
    const { node: child } = send(w, chief, "gen-1", undefined, builder, "Build it");
    expect(w.coordinator.answerRoot(child.id, "x")).toBe(false);
    expect(w.coordinator.answerRoot("gen-1", "x")).toBe(false);
    expect(w.coordinator.answerRoot("ghost", "x")).toBe(false);
    expect(() => w.coordinator.endTurn(child.id, { ok: true, text: "" })).not.toThrow();
    expect(w.coordinator.node(child.id)?.status).toBe("queued");
    w.coordinator.endTurn("gen-1", { ok: true, text: "done" });
    expect(w.coordinator.node("gen-1")?.status).toBe("waiting");
    expect(() => w.coordinator.endTurn("gen-1", { ok: false, text: "again" })).not.toThrow();
    expect(w.coordinator.node("gen-1")).toMatchObject({ status: "waiting", result: "done" });
    expect(w.logs.filter(line => /not a running root/.test(line))).toHaveLength(3);
    // a cards result that names no card is the turn's plain end: nothing could ever answer such a park
    begin(w, "gen-2", { address: { botId: "chief", threadId: "other-chat" } });
    w.coordinator.endTurn("gen-2", { ok: true, text: "done", cards: { question: "Nothing to act on", ids: [] } });
    expect(w.coordinator.node("gen-2")).toMatchObject({ status: "completed", result: "done" });
    expect(w.coordinator.parkedDirect("other-chat")).toBeUndefined();
    expect(w.host.parks).toEqual([]);
    expect(view(row({ id: "gen-1", parentId: undefined, depth: 0, status: "needs_input", question: "Connect", cards: ["m1", "m2"] })))
      .toMatchObject({ status: "waiting", question: "Connect", cards: ["m1", "m2"] });
    expect("cards" in view(base)).toBe(false);
  });

  it("tick() prunes terminal trees older than 30 days once a day, first at the first tick, logging the count, and never a parked root's tree", () => {
    const DAY = 24 * 60 * 60_000;
    const t0 = 1_700_000_000_000;
    let now = t0;
    const host = fakeHost();
    const logs: string[] = [];
    const coordinator = new RuntimeCoordinator({ dataDir: ":memory:", host, log: line => logs.push(line), now: () => now });
    coordinator.beginTurn({ id: "gen-old", address: chief, brief: "Old", level: "ask" });
    coordinator.endTurn("gen-old", { ok: true, text: "done" });
    now = t0 + DAY + 6 * 60 * 60_000;
    coordinator.beginTurn({ id: "gen-mid", address: { botId: "chief", threadId: "mid-chat" }, brief: "Mid", level: "ask" });
    coordinator.endTurn("gen-mid", { ok: true, text: "done" });
    coordinator.beginTurn({ id: "gen-parked", address: { botId: "chief", threadId: "parked-chat" }, brief: "Parked", level: "ask" });
    coordinator.endTurn("gen-parked", { ok: true, text: "", cards: { question: "Connect GitHub", ids: ["msg-1"] } });
    expect(coordinator.all().map(n => n.id)).toEqual(["gen-old", "gen-mid", "gen-parked"]);
    expect(logs).toEqual([]);
    // the first tick prunes what finished more than 30 days ago
    now = t0 + 31 * DAY;
    coordinator.tick();
    expect(coordinator.all().map(n => n.id)).toEqual(["gen-mid", "gen-parked"]);
    expect(logs).toEqual(["pruned 1 assignment rows of trees that finished more than 30 days ago"]);
    // twelve hours on, gen-mid is old enough, but the day is not over
    now = t0 + 31 * DAY + 12 * 60 * 60_000;
    coordinator.tick();
    expect(coordinator.has("gen-mid")).toBe(true);
    expect(logs).toHaveLength(1);
    // a day after the last prune it goes; the parked root stays however old
    now = t0 + 32 * DAY;
    coordinator.tick();
    expect(coordinator.all().map(n => n.id)).toEqual(["gen-parked"]);
    expect(logs).toHaveLength(2);
    expect(coordinator.parkedDirect("parked-chat")).toMatchObject({ id: "gen-parked", cards: ["msg-1"] });
    // nothing to prune: no line
    now = t0 + 40 * DAY;
    coordinator.tick();
    expect(logs).toHaveLength(2);
    expect(coordinator.has("gen-parked")).toBe(true);
    coordinator.close();
  });
});

describe("RuntimeCoordinator: outward restart policy, answerNode, continuation on the view", () => {
  const CONNECTED = "Sagax connection update: the user securely connected GitHub. Continue the task.";
  const beginRoot = (w: World, id: string, address: RoomAddress = chief) =>
    w.coordinator.beginTurn({ id, address, brief: "Ship the CSV export", level: "auto", origin: userOrigin });

  it("a cut turn that already acted outward is not rerun: host.outward decides, it ends interrupted with what it did, a root is reported into its own conversation, a child to its requester with the note; a port that says nothing reruns", async () => {
    const dir = mkdtempSync(join(tmpdir(), "runtime-coordinator-outward-"));
    try {
      // a root cut during its own turn
      const before = world(undefined, {}, dir);
      beginRoot(before, "gen-1");
      before.coordinator.close();
      const after = world(undefined, {}, dir);
      const asked: string[] = [];
      after.host.outward = node => { asked.push(node.id); return node.id === "gen-1" ? ["GMAIL_SEND_EMAIL", "git push"] : []; };
      expect(after.coordinator.node("gen-1")).toMatchObject({ status: "failed", outcome: "interrupted", restarts: 0, executions: 1,
        outcomeDetail: "Interrupted by a Sagax restart after it already sent an email (GMAIL_SEND_EMAIL), pushed (git push); not resumed, so nothing is done twice." });
      expect(asked).toEqual(["gen-1"]);
      expect("restart" in after.coordinator.node("gen-1")!).toBe(false);
      expect(after.host.reports).toEqual([{ child: expect.objectContaining({ id: "gen-1", status: "failed", outcome: "interrupted" }) }]);
      expect(after.coordinator.continuesAfterRestart("chief-chat")).toBe(false);
      expect(after.coordinator.activeDirect("chief-chat")).toBe(false);
      after.coordinator.tick();
      expect(after.host.runs).toEqual([]);
      after.coordinator.close();

      // a child cut mid-turn after it posted: the requester's resume carries the report and the restart note
      const again = world(hold, {}, dir);
      const { node } = send(again, chief, "gen-2", undefined, builder, "Announce it");
      again.coordinator.tick();
      expect(again.host.held.has(node.id)).toBe(true);
      ended(again, "gen-2");
      again.coordinator.close();
      const last = world(undefined, {}, dir);
      last.host.outward = n => n.id === node.id ? ["SLACK_SEND_MESSAGE"] : [];
      expect(last.coordinator.node(node.id)).toMatchObject({ status: "failed", outcome: "interrupted", restarts: 0, reported: true,
        outcomeDetail: "Interrupted by a Sagax restart after it already sent a message (SLACK_SEND_MESSAGE); not resumed, so nothing is done twice." });
      expect(last.host.reports.map(r => [r.child.id, r.parent?.id])).toEqual([[node.id, "gen-2"]]);
      expect(last.coordinator.node("gen-2")).toMatchObject({ status: "waiting", restart: "teammates" });
      last.coordinator.tick();
      const resume = last.host.runs[0]!;
      expect(resume.node.id).toBe("gen-2");
      expect(resume.composed.turn).toBe("resume");
      expect(resume.composed.restartNote).toBe("A restart cut these teammates' turns: builder (cut after an outward action, not resumed: see its result). Check their results as usual.\n");
      expect(resume.text).toContain(`[Sagax report from @builder on assignment ${node.id}: failed (interrupted): Interrupted by a Sagax restart after it already sent a message (SLACK_SEND_MESSAGE)`);
      await flush();
      expect(last.coordinator.node("gen-2")?.status).toBe("completed");
      expect(last.host.runs).toHaveLength(1);
      last.coordinator.close();

      // a port that knows nothing: today's rerun
      const quiet = world(undefined, {}, dir);
      beginRoot(quiet, "gen-3", { botId: "chief", threadId: "other-chat" });
      quiet.coordinator.close();
      const rerun = world(undefined, {}, dir);
      rerun.host.outward = () => [];
      expect(rerun.coordinator.node("gen-3")).toMatchObject({ status: "queued", restart: "rerun", restarts: 1 });
      expect(rerun.coordinator.continuesAfterRestart("other-chat")).toBe(true);
      rerun.coordinator.tick();
      expect(rerun.host.runs.map(r => [r.node.id, r.composed.turn])).toEqual([["gen-3", "rerun"]]);
      await flush();
      expect(rerun.coordinator.node("gen-3")?.status).toBe("completed");
      rerun.coordinator.close();
    } finally {
      await removeTempDir(dir);
    }
  });

  it("answerNode answers a child parked on cards: the requester is woken needs_input, a typed line does not answer it, the card does; answerRoot is the same call", async () => {
    let parks = 0;
    const w = world((node) => node.botId === "builder" && parks++ === 0
      ? { ok: true, text: "Please connect GitHub.", evidence: { toolCalls: 2 }, cards: { question: "connect GitHub", ids: ["msg-c1"] } } : undefined);
    const { node } = send(w, chief, "gen-1", undefined, builder, "Build it");
    w.coordinator.tick(); await flush();
    expect(w.coordinator.node(node.id)).toMatchObject({ status: "waiting", question: "connect GitHub", cards: ["msg-c1"], executions: 1 });
    expect(w.host.parks).toEqual([{ node: expect.objectContaining({ id: node.id, status: "waiting", cards: ["msg-c1"] }), question: "connect GitHub" }]);
    expect(w.coordinator.status("gen-1")!.inbox.map(i => [i.assignmentId, i.kind])).toEqual([[node.id, "needs_input"]]);
    expect(w.coordinator.parkedDirect("builder-work")).toBeUndefined();
    expect(w.coordinator.outstandingDirect("chief-chat").map(n => n.id)).toEqual([node.id]);
    expect(w.coordinator.awaitingAnswer("builder-work")).toBe(true);
    // a typed line in the child's thread never answers a card park; the cards' path does, once
    expect(w.coordinator.answer("builder-work", "typed while the card waits")).toBe(false);
    expect(w.coordinator.node(node.id)).toMatchObject({ status: "waiting", cards: ["msg-c1"] });
    expect(w.coordinator.answerNode("ghost", CONNECTED)).toBe(false);
    expect(w.coordinator.answerNode("gen-1", CONNECTED)).toBe(false);
    expect(w.coordinator.answerNode(node.id, CONNECTED)).toBe(true);
    expect(w.coordinator.answerNode(node.id, CONNECTED)).toBe(false);
    expect(w.coordinator.answerRoot(node.id, CONNECTED)).toBe(false);
    w.coordinator.tick();
    const run = w.host.runs[1]!;
    expect(run.node).toMatchObject({ id: node.id, status: "running", executions: 2 });
    expect("cards" in run.node).toBe(false);
    expect(run.composed.turn).toBe("answered");
    // a child's answered turn is its assignment again, with the person's act as the harness-quoted answer
    // (the question is consumed with the answer, as for a NEEDS INPUT park)
    expect(run.text.startsWith(`${ENVELOPE_MARK} ${node.id} from @chief for Milind]`)).toBe(true);
    expect(run.text.endsWith('The person answered: "Sagax connection update: the user securely connected GitHub. Continue the task.".')).toBe(true);
    expect(run.text).not.toContain("Your question was");
    await flush();
    expect(w.coordinator.node(node.id)).toMatchObject({ status: "completed", result: "builder done", executions: 2, reported: true });
    expect(w.host.reports.map(r => r.child.id)).toEqual([node.id]);
    ended(w, "gen-1");
    w.coordinator.tick(); await flush();
    expect(w.coordinator.node("gen-1")?.status).toBe("completed");
    expect(w.host.runs).toHaveLength(3);

    // answerRoot stays as the same call for a root parked on its cards
    beginRoot(w, "gen-2", { botId: "chief", threadId: "other-chat" });
    w.coordinator.endTurn("gen-2", { ok: true, text: "", cards: { question: "Connect GitHub", ids: ["msg-r1"] } });
    expect(w.coordinator.parkedDirect("other-chat")?.id).toBe("gen-2");
    expect(w.coordinator.answerRoot("gen-2", CONNECTED)).toBe(true);
    expect(w.coordinator.answerNode("gen-2", CONNECTED)).toBe(false);
    w.coordinator.tick(); await flush();
    expect(w.coordinator.node("gen-2")).toMatchObject({ status: "completed", executions: 2 });
  });

  it("the view carries a queued continuation (note, handoff path, count) and drops it once the turn is dispatched", async () => {
    expect(view(row({ continuation: { note: "Cap.", handoffPath: "/h/1.md", count: 2 } })).continuation).toEqual({ note: "Cap.", handoffPath: "/h/1.md", count: 2 });
    expect("continuation" in view(base)).toBe(false);
    const w = world();
    beginRoot(w, "gen-1");
    w.coordinator.endTurn("gen-1", { ok: true, text: "half", cap: { note: "The computer is taken.", } });
    expect(w.coordinator.node("gen-1")).toMatchObject({ status: "queued", continuation: { note: "The computer is taken.", count: 1 } });
    expect("handoffPath" in w.coordinator.node("gen-1")!.continuation!).toBe(false);
    w.coordinator.tick();
    expect("continuation" in w.coordinator.node("gen-1")!).toBe(false);
    expect(w.host.runs[0]!.composed.turn).toBe("continued");
  });
});
