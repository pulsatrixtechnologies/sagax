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

import type { CoordinatorHost, HandoffView } from "./coordinator.ts";
import type { RoomAddress } from "./coordinator.ts";
import { needsInputQuestion, RuntimeCoordinator, view } from "./runtime-coordinator.ts";
import { ENVELOPE_MARK } from "./runtime/envelope.ts";
import type { Assignment, Level, Limits } from "./runtime/types.ts";
import { removeTempDir } from "./testing/cleanup.ts";

const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

type Outcome = { ok: boolean; text: string; stalled?: boolean };
type Script = (node: HandoffView, text: string) => Outcome | "hold" | undefined;

interface Host extends CoordinatorHost {
  runs: Array<{ node: HandoffView; resumed: boolean; text: string; signal: AbortSignal; asked?: string[] }>;
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
      host.runs.push({ node, resumed, text, signal, ...(composed?.asked ? { asked: composed.asked } : {}) });
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

/** Hands work from `source` (its own node `parentId`, or a fresh root `generation`). */
const send = (w: World, source: RoomAddress, generation: string, parentId: string | undefined, target: RoomAddress, text: string,
  opts: { approved?: boolean; rework?: boolean; batchKey?: string; sourceText?: string } = {}) =>
  w.coordinator.enqueue(source, generation, parentId, target, target.botId, text, opts.approved ?? false, opts.rework ?? false,
    opts.sourceText ?? "Ship the CSV export", opts.batchKey, userOrigin);

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
    });
    const plain = view(base);
    expect(plain).toMatchObject({ reported: false, approvalGranted: false, restarts: 0, lastProgressAt: 2_000 });
    for (const absent of ["startedAt", "restart", "requestBatchKey", "groupId"]) expect(absent in plain).toBe(false);
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
    // activity panel path: indexed children of the parent's assignee, same
    // membership as scanning all() for that parent (no room groupId).
    expect(w.coordinator.directChildrenOf("chief", "chief-chat").map(c => c.id)).toEqual([node.id]);
    expect(w.coordinator.directChildrenOf("builder", "builder-work")).toEqual([]);
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
    w.coordinator.sourceSettled("gen-1", true);
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
    const { node } = w.coordinator.enqueue(chief, "gen-1", undefined, builder, "builder", "Capital of Italy?", false, false, "Ask builder", undefined, userOrigin, "auto", undefined, true);
    expect(node.relay).toBe(true);
    w.coordinator.tick();
    await flush();
    w.coordinator.sourceSettled("gen-1", true);
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
      const { node } = w.coordinator.enqueue(chief, "gen-1", undefined, target, "builder", "Q", false, false, "Ask", undefined, userOrigin, "auto", undefined, true);
      expect(Boolean(node.relay)).toBe(!c.room);
      if (c.extra) send(w, chief, "gen-1", undefined, tester, "Test it");
      w.coordinator.tick();
      await flush();
      w.coordinator.sourceSettled("gen-1", true);
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
    w.coordinator.sourceSettled("gen-1", true); w.coordinator.tick(); await flush();
    same(); expect(w.coordinator.active().map(n => n.id)).toEqual(["gen-1"]);
    w.coordinator.tick(); await flush();
    expect(w.coordinator.all()).toHaveLength(2);
    expect(w.coordinator.active()).toEqual([]);
  });

  // port de OpenMausBot #3325: the watchdog's stop reaches the runtime as a
  // stall (the requesting turn's own end is runtime.test.ts's).
  it("fails a turn the host's watchdog stopped as stalled, not as a provider error", async () => {
    const dir = mkdtempSync(join(tmpdir(), "runtime-coordinator-stalled-"));
    try {
      const w = world((node) => node.botId === "builder" ? { ok: false, text: "No activity for 20 minutes — the turn was stopped", stalled: true }
        : node.botId === "tester" ? { ok: false, text: "The engine exited" } : undefined, {}, dir);
      const { node: built } = send(w, chief, "gen-1", undefined, builder, "Build it");
      const { node: tested } = send(w, chief, "gen-1", undefined, tester, "Test it");
      w.coordinator.sourceSettled("gen-1", true); w.coordinator.tick(); await flush();
      const db = new DatabaseSync(join(dir, "runtime.db"));
      const outcome = (id: string) => (JSON.parse((db.prepare("SELECT json FROM assignments WHERE id = ?").get(id) as { json: string }).json) as Assignment).outcome;
      expect([outcome(built.id), outcome(tested.id)]).toEqual(["stalled", "provider_error"]);
      db.close();
      w.coordinator.close();
    } finally {
      await removeTempDir(dir);
    }
  });

  it("active() never reads an ended row: one that no longer parses stops all(), not active()", async () => {
    const dir = mkdtempSync(join(tmpdir(), "runtime-coordinator-active-"));
    try {
      const w = world(hold, {}, dir);
      send(w, chief, "gen-1", undefined, tester, "Test it");
      w.coordinator.sourceSettled("gen-1", true); w.coordinator.tick(); await flush();
      w.coordinator.tick(); await flush();
      expect(w.coordinator.all().map(n => n.status)).toEqual(["completed", "completed"]);
      const { node } = send(w, chief, "gen-2", undefined, builder, "Build it");
      w.coordinator.sourceSettled("gen-2", true); w.coordinator.tick();
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

  it("a failed requesting turn keeps its accepted work and says so in its result", async () => {
    const w = world();
    const { node } = send(w, chief, "gen-1", undefined, builder, "Build it");
    w.coordinator.sourceSettled("gen-1", false);
    expect(w.coordinator.node("gen-1")).toMatchObject({ status: "waiting", result: "The originating turn ended before its teammates returned." });
    w.coordinator.tick(); await flush();
    expect(w.coordinator.node(node.id)?.status).toBe("completed");
    // an unknown or settled generation is ignored, as legacy does
    w.coordinator.sourceSettled("gen-1", true);
    w.coordinator.sourceSettled("nope", true);
    expect(w.logs).toEqual([]);
    // the root's resume turn is the runtime's: sourceSettled with its id does not end it
    w.coordinator.tick();
    expect(w.host.runs.at(-1)!.node).toMatchObject({ id: "gen-1", status: "running" });
    w.coordinator.sourceSettled("gen-1", false);
    expect(w.coordinator.node("gen-1")?.status).toBe("running");
    await flush();
    expect(w.coordinator.node("gen-1")?.status).toBe("completed");
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
  it("refuses work back to an ancestor, and never writes a root for a self-assignment", async () => {
    const w = world(hold);
    expect(() => send(w, chief, "gen-1", undefined, chief, "Do it yourself")).toThrow("Cannot assign work back to an ancestor; results return automatically");
    expect(w.coordinator.has("gen-1")).toBe(false);
    expect(() => send(w, inRoom("chief"), "gen-1", undefined, inRoom("chief"), "Do it yourself")).toThrow(/back to an ancestor/);
    expect(w.coordinator.has("gen-1")).toBe(false);
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
      { ...chief, threadId }, "chief", "Which column order?", false, false, "", undefined, userOrigin, mode);
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
    const as = (source: RoomAddress, generation: string, threadId: string, person?: string) => w.coordinator.enqueue(source, generation, undefined,
      { ...builder, threadId }, "builder", "Poll: free tomorrow?", false, false, "", undefined, userOrigin, "work", person);
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
    w.coordinator.sourceSettled("gen-1", true);
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

  it("resumes the requester with a teammate's NEEDS INPUT question while its other teammate still works", async () => {
    let asked = false;
    const w = world((node) => {
      if (node.botId === "tester") return "hold";
      if (node.botId !== "builder" || asked) return undefined;
      asked = true;
      return { ok: true, text: "Did the first half.\nNEEDS INPUT: Which region should I deploy to?" };
    });
    const { node: built } = send(w, chief, "gen-1", undefined, builder, "Build it");
    const { node: tested } = send(w, chief, "gen-1", undefined, tester, "Test it");
    w.coordinator.sourceSettled("gen-1", true);
    w.coordinator.tick(); await flush();
    w.coordinator.tick(); await flush();
    const resumes = w.host.runs.filter(run => run.node.id === "gen-1");
    expect(resumes.map(run => [run.resumed, run.asked])).toEqual([[true, ["builder"]]]);
    expect(resumes[0]!.text).toMatch(/^A teammate you are waiting on stopped on a question for Milind; the rest of your requests are still open/);
    expect(resumes[0]!.text).toContain(`\n\n[Sagax question from @builder on assignment ${built.id}: waiting on Milind]\nIt asks Milind: "Which region should I deploy to?".`);
    expect(w.coordinator.node("gen-1")?.status).toBe("waiting");
    expect(w.coordinator.node(tested.id)?.status).toBe("running");
    // no relay shortcut and no second pass of the same question
    w.coordinator.tick(); await flush();
    expect(w.host.runs.filter(run => run.node.id === "gen-1")).toHaveLength(1);
  });

  it("a requester that asked the person reads the answer and the results that settled meanwhile in one resume", async () => {
    let first = true;
    const w = world((node) => {
      if (node.botId !== "builder" || !first) return undefined;
      first = false;
      send(w, builder, "unused", node.id, tester, "Test it");
      return { ok: true, text: "Tests are running.\nNEEDS INPUT: Which region should I deploy to?" };
    });
    const { node: built } = send(w, chief, "gen-1", undefined, builder, "Build it");
    w.coordinator.sourceSettled("gen-1", true);
    w.coordinator.tick(); await flush();
    w.coordinator.tick(); await flush();
    const testedId = w.coordinator.children(built.id)[0]!.id;
    expect(w.coordinator.node(testedId)?.status).toBe("completed");
    expect(w.coordinator.node(built.id)?.status).toBe("waiting");
    expect(w.coordinator.answer("builder-work", "eu-west")).toBe(true);
    w.coordinator.tick(); await flush();
    const builderRuns = w.host.runs.filter(run => run.node.id === built.id);
    expect(builderRuns.map(run => run.resumed)).toEqual([false, true]);
    expect(builderRuns[1]!.text).toContain('The person answered: "eu-west".');
    expect(builderRuns[1]!.text).toContain(`[Sagax report from @tester on assignment ${testedId}: done]`);
    expect(builderRuns.filter(run => run.text.includes("[Sagax report from @tester"))).toHaveLength(1);
    expect(w.coordinator.node(built.id)?.status).toBe("completed");
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
    const left = w.coordinator.stopAwaitingDirect("chief-chat");
    expect(left.map(n => n.id)).toEqual([b.id]);
    expect(w.coordinator.node(t.id)).toMatchObject({ status: "cancelled", result: "Stopped before it started" });
    expect(w.coordinator.node("gen-1")).toMatchObject({ status: "cancelled", result: "Stopped by user" });
    expect(w.host.runs[0]!.signal.aborted).toBe(false);
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

// Lot 3 (docs/plans/grok-convergence-runtime-evidence.md): the seam methods
// the host uses for a provider limit's backup, routine runs and external runtimes.
describe("one request, one root at the seam", () => {
  const sendFor = (w: World, generation: string, request: string) =>
    w.coordinator.enqueue(chief, generation, undefined, builder, "builder", "Build it", false, false, "Ship the CSV export",
      undefined, userOrigin, "work", "solo-owner", false, undefined, request);

  it("continues a failed root under the backup turn's generation, finds it by request, and ends it through that generation", async () => {
    const w = world(hold);
    sendFor(w, "gen-1", "message-1");
    w.coordinator.tick();
    expect(w.coordinator.requestRoot("chief-chat", "message-1")).toBe("gen-1");
    expect(w.coordinator.requestRoot("other-chat", "message-1")).toBeUndefined();
    w.coordinator.sourceSettled("gen-1", false);
    expect(w.coordinator.node("gen-1")?.status).toBe("waiting");
    expect(w.coordinator.awaitsTeammates("chief-chat")).toBe(true);
    expect(w.coordinator.continueRoot("gen-1", null)).toBe("continued");
    expect(w.coordinator.node("gen-1")?.status).toBe("waiting");
    expect(w.coordinator.continueRoot("gen-1", "gen-2")).toBe("continued");
    expect(w.coordinator.node("gen-1")?.status).toBe("source");
    // The backup turn asks again under its own generation: the same request.
    const again = w.coordinator.enqueue(chief, "gen-2", undefined, builder, "builder", "Build it");
    expect(again.duplicate).toBe(true);
    expect(w.coordinator.has("gen-2")).toBe(false);
    w.coordinator.sourceSettled("gen-2", true);
    expect(w.coordinator.node("gen-1")?.status).toBe("waiting");
    const child = w.coordinator.children("gen-1")[0]!;
    await w.host.release(child.id, { ok: true, text: "built" });
    w.coordinator.tick();
    await flush();
    expect(w.host.runs.filter(run => run.node.id === "gen-1")).toHaveLength(1);
    expect(w.coordinator.node("gen-1")?.status).toBe("completed");
    expect(w.coordinator.awaitsTeammates("chief-chat")).toBe(false);
    expect(w.coordinator.continueRoot("gen-1", "gen-3")).toBe("answered");
  });

  it("an external runtime's delegation is a poll root that completes once its child settled, with no resume turn", async () => {
    const w = world(hold);
    const { node } = w.coordinator.enqueueExternal({ botId: "gateway", threadId: "gateway-pinned" }, builder, "Build it");
    const root = w.coordinator.node(node.rootId)!;
    expect(root).toMatchObject({ status: "waiting", origin: { kind: "outside" } });
    w.coordinator.tick();
    await w.host.release(node.id, { ok: true, text: "built" });
    w.coordinator.tick();
    await flush();
    expect(w.coordinator.node(node.rootId)?.status).toBe("completed");
    expect(w.coordinator.node(node.id)).toMatchObject({ status: "completed", result: "built" });
    expect(w.host.runs.filter(run => run.node.id === node.rootId)).toHaveLength(0);
  });

  // Lot 3 gap: an external runtime's delegate_bot whose connection dropped
  // after the server accepted it is retried by the caller. Without a key
  // each call opened its own poll root, so the retry dispatched the work twice.
  it("an external runtime's retried delegate_bot with the same idempotency key is the same request: one dispatch", async () => {
    const w = world(hold);
    const gateway = { botId: "gateway", threadId: "gateway-pinned" };
    const first = w.coordinator.enqueueExternal(gateway, builder, "Build it", false, "work", "call-0001");
    const retry = w.coordinator.enqueueExternal(gateway, builder, "Build it", false, "work", "call-0001");
    expect(retry).toMatchObject({ duplicate: true, node: { id: first.node.id } });
    w.coordinator.tick();
    await flush();
    expect(w.host.runs.filter(run => run.node.botId === "builder")).toHaveLength(1);
    expect(w.coordinator.all().filter(n => !n.parentId)).toHaveLength(1);
    // After it settled the key still answers the same request, never a new one.
    await w.host.release(first.node.id, { ok: true, text: "built" });
    w.coordinator.tick();
    await flush();
    expect(w.coordinator.enqueueExternal(gateway, builder, "Build it", false, "work", "call-0001")).toMatchObject({ duplicate: true, node: { status: "completed" } });
    // The same key for another request is refused, not silently answered.
    expect(() => w.coordinator.enqueueExternal(gateway, builder, "Build something else", false, "work", "call-0001")).toThrow(/idempotency key/);
    // Without a key, a second call is a second request (unchanged).
    expect(w.coordinator.enqueueExternal(gateway, builder, "Build it").duplicate).toBe(false);
  });

  it("an external runtime queues at most six requests on one conversation, like the legacy ledger", () => {
    const w = world(hold);
    const gateway = { botId: "gateway", threadId: "gateway-pinned" };
    w.host.busyAnswer = () => true;
    for (let i = 0; i < 6; i++) w.coordinator.enqueueExternal(gateway, builder, `Job ${i}`);
    expect(() => w.coordinator.enqueueExternal(gateway, builder, "Job 7")).toThrow(/too many delegations queued/);
    // Another conversation of the same bot has its own cap.
    expect(w.coordinator.enqueueExternal({ botId: "gateway", threadId: "other" }, builder, "Job 7").duplicate).toBe(false);
  });
});

// Lot 3: send_to_bot, an aside and review-gated work on the runtime.
describe("one-way notices, priority and review on the runtime", () => {
  it("a one-way notice holds nothing: the sender's turn completes, nothing resumes it, and a second notice to the same teammate is accepted", async () => {
    const w = world();
    const first = w.coordinator.enqueue(chief, "gen-1", undefined, builder, "builder", "FYI: release at 5", false, false, "", undefined, userOrigin, "notify");
    expect(first.node).toMatchObject({ oneWay: true, status: "queued" });
    w.coordinator.tick();
    await flush();
    expect(w.coordinator.node(first.node.id)?.status).toBe("completed");
    // Not an assignment it completed: another notice is not "already completed".
    const second = w.coordinator.enqueue(chief, "gen-1", undefined, { botId: "builder", threadId: "builder-other" }, "builder", "FYI: moved to 6", false, false, "", undefined, userOrigin, "notify");
    expect(second.duplicate).toBe(false);
    w.coordinator.sourceSettled("gen-1", true);
    w.coordinator.tick();
    await flush();
    expect(w.coordinator.node("gen-1")?.status).toBe("completed");
    expect(w.host.runs.filter(run => run.node.id === "gen-1")).toHaveLength(0);
    expect(w.coordinator.awaitsTeammates("chief-chat")).toBe(false);
  });

  it("a notice queued by a turn that then fails on the provider is still delivered once", async () => {
    const w = world();
    w.host.busyAnswer = () => true;
    const { node } = w.coordinator.enqueue(chief, "gen-1", undefined, builder, "builder", "FYI", false, false, "", undefined, userOrigin, "notify");
    w.coordinator.sourceSettled("gen-1", false);
    expect(w.coordinator.node("gen-1")?.status).toBe("failed");
    w.host.busyAnswer = () => false;
    w.coordinator.tick();
    await flush();
    w.coordinator.tick();
    expect(w.coordinator.node(node.id)?.status).toBe("completed");
    expect(w.host.runs.filter(run => run.node.id === node.id)).toHaveLength(1);
  });

  it("priority now is admitted ahead of work queued before it", async () => {
    const w = world();
    let free = false;
    w.host.busyAnswer = () => !free;
    const normal = w.coordinator.enqueue(chief, "gen-1", undefined, builder, "builder", "Normal", false, false, "", undefined, userOrigin, "notify");
    const urgent = w.coordinator.enqueue(chief, "gen-1", undefined, { botId: "builder", threadId: "builder-2" }, "builder", "Urgent", false, false, "", undefined, userOrigin, "notify",
      undefined, false, undefined, undefined, { priority: "now" });
    expect(urgent.node.priority).toBe("now");
    // One slot: whichever is admitted first takes it.
    w.host.busyAnswer = node => !free || w.host.runs.length > 0 || node.id === "never";
    free = true;
    w.coordinator.tick();
    await flush();
    expect(w.host.runs[0]?.node.id).toBe(urgent.node.id);
    expect(normal.node.id).not.toBe(urgent.node.id);
  });

  it("approve lets work the host held for review start; work not queued any more is not approved", async () => {
    const w = world();
    let held = true;
    w.host.busyAnswer = node => held && !node.approvalGranted;
    const { node } = w.coordinator.enqueue(chief, "gen-1", undefined, builder, "builder", "Build it", false, false, "", undefined, userOrigin);
    w.coordinator.tick();
    expect(w.host.runs).toHaveLength(0);
    expect(w.coordinator.approve(node.id)).toBe(true);
    await flush();
    expect(w.coordinator.node(node.id)?.approvalGranted).toBe(true);
    expect(w.host.runs.map(run => run.node.id)).toEqual([node.id]);
    held = false;
    expect(w.coordinator.approve(node.id)).toBe(false);
  });
});

// Lot 3: a step cap's Continue: thread (turn-continuation.ts) on the runtime.
describe("a bot's own continuation on the runtime", () => {
  const stopped: RoomAddress = { botId: "builder", threadId: "builder-work" };
  const cont: RoomAddress = { botId: "builder", threadId: "builder-continue" };

  it("runs once in the new thread at its level, under the stopped work's origin, and resumes nothing", async () => {
    const w = world();
    w.host.levels.builder = { level: "edits", driverKind: "claudeAgent" };
    const node = w.coordinator.enqueueContinuation(stopped, cont, "[Auto-continuation] read the handoff", userOrigin);
    expect(node).toMatchObject({ oneWay: true, botId: "builder", threadId: "builder-continue", approvalGranted: true });
    // Its poll root ended with the call: nothing waits on the continuation.
    expect(w.coordinator.node(node.rootId)?.status).toBe("completed");
    expect(w.coordinator.awaitsTeammates("builder-work")).toBe(false);
    w.coordinator.tick();
    await flush();
    w.coordinator.tick();
    expect(w.coordinator.node(node.id)?.status).toBe("completed");
    expect(w.host.runs.map(run => [run.node.id, run.resumed])).toEqual([[node.id, false]]);
    expect(w.host.runs[0]!.text).toContain("[Auto-continuation] read the handoff");
    expect(w.host.runs[0]!.text).toContain("Ship the CSV export");
    // Nothing reports back to the stopped thread.
    expect(w.host.reports.filter(report => report.child.id === node.id && report.parent?.threadId === "builder-work" && report.child.status !== "completed")).toEqual([]);
  });

  it("refuses anything but another direct thread of the same bot", () => {
    const w = world();
    expect(() => w.coordinator.enqueueContinuation(stopped, tester, "x")).toThrow(/same bot/);
    expect(() => w.coordinator.enqueueContinuation(stopped, stopped, "x")).toThrow(/same bot/);
    expect(() => w.coordinator.enqueueContinuation(inRoom("builder"), cont, "x")).toThrow(/same bot/);
    // A self-notice is only allowed as a continuation: ordinary work to oneself stays refused.
    expect(() => w.coordinator.enqueueExternal(stopped, cont, "x", false, "notify")).toThrow(/ancestor/);
  });

  it("a restart while the continuation runs reruns it once in place, never twice", async () => {
    const dir = mkdtempSync(join(tmpdir(), "runtime-coordinator-"));
    try {
      const before = world(() => "hold", {}, dir);
      const node = before.coordinator.enqueueContinuation(stopped, cont, "[Auto-continuation] read the handoff");
      before.coordinator.tick();
      expect(before.coordinator.node(node.id)?.status).toBe("running");
      before.coordinator.close();
      const after = world(undefined, {}, dir);
      expect(after.coordinator.node(node.id)).toMatchObject({ status: "queued", restart: "rerun", restarts: 1 });
      after.coordinator.tick();
      await flush();
      after.coordinator.tick();
      expect(after.coordinator.node(node.id)).toMatchObject({ status: "completed", restarts: 1 });
      expect(after.host.runs).toHaveLength(1);
      after.coordinator.close();
    } finally {
      await removeTempDir(dir);
    }
  });
});

// Lot 3: a room goal's worker assignment on the runtime (poll root of the run).
describe("a room goal's worker assignment on the runtime", () => {
  it("runs the worker once in the room and resumes nothing of the lead", async () => {
    const w = world();
    const lead = inRoom("chief");
    const worker = inRoom("builder");
    const node = w.coordinator.enqueueGoalAssignment(lead, worker, "Draft the release notes", "goal-run-1");
    expect(node).toMatchObject({ botId: "builder", threadId: lead.threadId, groupId: lead.groupId, approvalGranted: true });
    // The poll root waits on the worker (work, not a one-way notice); nothing
    // resumes the lead's engine.
    expect(w.coordinator.node(node.rootId)?.status).toBe("waiting");
    w.coordinator.tick();
    await flush();
    w.coordinator.tick();
    expect(w.coordinator.node(node.id)?.status).toBe("completed");
    expect(w.coordinator.node(node.rootId)?.status).toBe("completed");
    expect(w.host.runs.map(run => [run.node.botId, run.resumed])).toEqual([["builder", false]]);
    expect(w.host.runs[0]!.text).toContain("Draft the release notes");
  });

  it("refuses a worker outside the goal's room thread", () => {
    const w = world();
    expect(() => w.coordinator.enqueueGoalAssignment(inRoom("chief"), tester, "x", "goal-1")).toThrow(/room thread/);
    expect(() => w.coordinator.enqueueGoalAssignment(inRoom("chief"), inRoom("chief"), "x", "goal-1")).toThrow(/teammate/);
  });

  it("a Stop of the room cancels a queued goal worker before it starts", () => {
    const w = world(() => "hold");
    w.host.busyAnswer = () => true;
    const node = w.coordinator.enqueueGoalAssignment(inRoom("chief"), inRoom("builder"), "Draft the release notes", "goal-run-2");
    expect(w.coordinator.node(node.id)?.status).toBe("queued");
    w.coordinator.cancelRoom(inRoom("chief").groupId!, inRoom("chief").threadId, "Stopped by you.");
    expect(w.coordinator.node(node.id)?.status).toBe("cancelled");
    expect(w.host.runs).toHaveLength(0);
  });
});

// 2026-11-01: a routine run ends as the work its thread handed out did.
describe("handedOutOutcome", () => {
  it("reads the latest root's ending and the teammates whose work did not complete", async () => {
    const w = world(hold);
    expect(w.coordinator.handedOutOutcome("chief-chat", 0)).toBeNull();
    send(w, chief, "gen-1", undefined, builder, "Build it");
    w.coordinator.tick();
    w.coordinator.sourceSettled("gen-1", true);
    expect(w.coordinator.handedOutOutcome("chief-chat", 0)).toMatchObject({ pending: true, failed: [] });
    const child = w.coordinator.children("gen-1")[0]!;
    await w.host.release(child.id, { ok: false, text: "the build server refused" });
    w.coordinator.tick();
    await flush();
    const outcome = w.coordinator.handedOutOutcome("chief-chat", 0)!;
    expect(outcome.pending).toBe(false);
    expect(outcome.root.status).toBe("completed");
    expect(outcome.failed).toEqual([expect.objectContaining({ botId: "builder" })]);
    // Only work handed out since the run started counts.
    expect(w.coordinator.handedOutOutcome("chief-chat", Date.now() + 60_000)).toBeNull();
  });
});

// JC 2026-11-01: "the bots talk to each other, they do not answer me, I
// have to relaunch them". A turn cut short that is not the person's Stop (a
// safe-point cut to read their new words, a turn parked on a busy computer,
// an engine change) ends not ok while its teammate still works: the
// conversation waits and the teammate's reply resumes it. Only Stop
// (stopAwaitingDirect, server/teammate-replies.ts) drops it.
describe("a teammate's reply comes back after a cut that is not a Stop", () => {
  it("the cut turn waits and the reply resumes the conversation", async () => {
    const w = world(hold);
    const { node: b } = send(w, chief, "gen-1", undefined, builder, "Build it");
    w.coordinator.tick();
    // The safe-point cut: the source turn ends interrupted, not ok.
    w.coordinator.sourceSettled("gen-1", false);
    expect(w.coordinator.node("gen-1")?.status).toBe("waiting");
    expect(w.coordinator.awaitsTeammates("chief-chat")).toBe(true);
    await w.host.release(b.id, { ok: true, text: "Built it." });
    w.coordinator.tick();
    const resume = w.host.runs.find(run => run.node.id === "gen-1" && run.resumed);
    expect(resume?.text).toContain('What @builder said: "Built it."');
    await flush();
  });

  it("the person's Stop is the one cut that drops it: nothing resumes into a stopped chat", async () => {
    const w = world(hold);
    const { node: b } = send(w, chief, "gen-1", undefined, builder, "Build it");
    w.coordinator.tick();
    w.coordinator.stopAwaitingDirect("chief-chat");
    w.coordinator.sourceSettled("gen-1", false);
    await w.host.release(b.id, { ok: true, text: "Built it." });
    w.coordinator.tick();
    expect(w.host.runs.some(run => run.node.id === "gen-1" && run.resumed)).toBe(false);
  });
});
