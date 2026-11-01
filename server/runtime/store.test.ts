// The runtime store: rows, events, the inbox lane, pruning and nested
// transactions over node:sqlite, in memory and on disk.
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { openRuntimeStore, type RuntimeStore } from "./store.ts";
import { removeTempDir } from "../testing/cleanup.ts";
import { TERMINAL, type Assignment } from "./types.ts";

function assignment(id: string, patch: Partial<Assignment> = {}): Assignment {
  return {
    id, rootId: id, depth: 0,
    origin: { kind: "person", source: "chat", quote: "Ship it" },
    requester: { kind: "person", threadId: "chief-chat" },
    assignee: { botId: "chief", destination: { kind: "standing_thread", threadId: "chief-chat" } },
    mode: "work", reply: "resume", brief: "Ship it", status: "queued", level: "ask", levelSource: "own",
    executions: 0, restarts: 0, createdAt: 1_000, lastActivityAt: 1_000, result: "", rework: false, version: 1,
    ...patch,
  };
}

const child = (id: string, parent: Assignment, patch: Partial<Assignment> = {}) =>
  assignment(id, { rootId: parent.rootId, parentId: parent.id, depth: parent.depth + 1,
    requester: { kind: "bot_turn", botId: parent.assignee.botId, threadId: parent.assignee.destination.threadId },
    assignee: { botId: "builder", destination: { kind: "work_thread", threadId: `${id}-thread` } }, ...patch });

const stores: RuntimeStore[] = [];
const open = (path = ":memory:") => { const s = openRuntimeStore(path); stores.push(s); return s; };
afterEach(() => { for (const s of stores.splice(0)) s.close(); });

describe("runtime store", () => {
  it("round-trips a row with its event, and reads children in createdAt order", () => {
    const store = open();
    const root = assignment("root", { status: "running", startedAt: 1_000, budgets: { since: 1_000, requests: 0, executions: 1, wakes: 0 } });
    store.insert(root, { kind: "enqueued", at: 1_000, detail: "queued" });
    expect(store.get("root")).toEqual(root);
    const late = child("late", root, { createdAt: 3_000 });
    const early = child("early", root, { createdAt: 2_000 });
    store.insert(late, { kind: "enqueued", at: 3_000 });
    store.insert(early, { kind: "enqueued", at: 2_000 });
    expect(store.children("root").map(c => c.id)).toEqual(["early", "late"]);
    expect(store.root("late")?.id).toBe("root");
    expect(store.root("missing")).toBeUndefined();
    // update rewrites the whole row and (optionally) appends an event
    early.status = "running"; early.startedAt = 2_500; early.executions = 1;
    store.update(early, { kind: "started", at: 2_500, detail: "running: turn 1" });
    expect(store.get("early")).toEqual(early);
    delete early.startedAt;
    store.update(early);
    expect(store.get("early")?.startedAt).toBeUndefined();
    expect(store.events("early").map(e => [e.kind, e.detail])).toEqual([["enqueued", undefined], ["started", "running: turn 1"]]);
    expect(store.events("early").every(e => e.assignmentId === "early" && e.at > 0)).toBe(true);
    expect(() => store.update(assignment("ghost"))).toThrow(/does not exist/);
  });

  it("filters all() by tree, liveness and requester thread", () => {
    const store = open();
    const a = assignment("a", { status: "completed", outcome: "done", finishedAt: 5_000 });
    const b = assignment("b", { requester: { kind: "person", threadId: "other-chat" }, createdAt: 2_000 });
    store.insert(a, { kind: "enqueued" });
    store.insert(b, { kind: "enqueued" });
    store.insert(child("a1", a, { status: "running" }), { kind: "enqueued" });
    expect(store.all().map(x => x.id)).toEqual(["a", "a1", "b"]);
    expect(store.all({ rootId: "a" }).map(x => x.id)).toEqual(["a", "a1"]);
    expect(store.all({ nonTerminal: true }).map(x => x.id)).toEqual(["a1", "b"]);
    expect(store.all({ ownerThreadId: "other-chat" }).map(x => x.id)).toEqual(["b"]);
    expect(store.all({ rootId: "a", nonTerminal: true }).map(x => x.id)).toEqual(["a1"]);
  });

  it("childrenOfAssignee matches the activityChildren filter over all()", () => {
    const store = open();
    const chief = assignment("chief-root", {
      status: "running", startedAt: 1_000,
      assignee: { botId: "chief", destination: { kind: "standing_thread", threadId: "chief-chat" } },
    });
    const other = assignment("other-root", {
      status: "running", startedAt: 1_000, createdAt: 2_000,
      assignee: { botId: "other", destination: { kind: "standing_thread", threadId: "other-chat" } },
      requester: { kind: "person", threadId: "other-chat" },
    });
    store.insert(chief, { kind: "enqueued", at: 1_000 });
    store.insert(other, { kind: "enqueued", at: 2_000 });
    store.insert(child("direct-early", chief, {
      createdAt: 3_000,
      assignee: { botId: "builder", destination: { kind: "work_thread", threadId: "builder-early" } },
    }), { kind: "enqueued", at: 3_000 });
    store.insert(child("direct-late", chief, {
      createdAt: 4_000,
      assignee: { botId: "reviewer", destination: { kind: "work_thread", threadId: "reviewer-late" } },
    }), { kind: "enqueued", at: 4_000 });
    store.insert(child("room-child", chief, {
      createdAt: 5_000,
      assignee: { botId: "builder", destination: { kind: "room_thread", threadId: "room-1", groupId: "g1" } },
    }), { kind: "enqueued", at: 5_000 });
    store.insert(child("other-child", other, {
      createdAt: 6_000,
      assignee: { botId: "builder", destination: { kind: "work_thread", threadId: "builder-other" } },
    }), { kind: "enqueued", at: 6_000 });

    const viaIndex = store.childrenOfAssignee("chief", "chief-chat").map(x => x.id);
    expect(viaIndex).toEqual(["direct-early", "direct-late"]);

    // Same membership the old activityChildren scan produced: every child
    // whose parent assignee is (botId, threadId) and who has no groupId.
    const byId = new Map(store.all().map(row => [row.id, row]));
    const viaScan = store.all()
      .filter(node => {
        if (!node.parentId || node.assignee.destination.groupId !== undefined) return false;
        const parent = byId.get(node.parentId);
        return Boolean(parent && parent.assignee.botId === "chief" && parent.assignee.destination.threadId === "chief-chat");
      })
      .map(node => node.id);
    expect(viaIndex).toEqual(viaScan);

    // Parse cache: a second read of the same rows does not re-throw and stays equal.
    expect(store.childrenOfAssignee("chief", "chief-chat").map(x => x.id)).toEqual(viaIndex);
    expect(store.childrenOfAssignee("missing", "nope")).toEqual([]);
  });

  it("joins nested transactions and rolls an inner failure back to its savepoint", () => {
    const store = open();
    const root = assignment("root");
    store.transaction(() => {
      store.insert(root, { kind: "enqueued" });
      expect(() => store.transaction(() => {
        store.insert(child("c", root), { kind: "enqueued" });
        throw new Error("inner");
      })).toThrow("inner");
      // the inner savepoint is gone, the outer transaction goes on
      store.insert(child("d", root), { kind: "enqueued" });
    });
    expect(store.all().map(x => x.id)).toEqual(["root", "d"]);
    // an outer failure takes everything with it, including nested joins
    expect(() => store.transaction(() => {
      store.insert(child("e", root), { kind: "enqueued" });
      store.transaction(() => store.insert(child("f", root), { kind: "enqueued" }));
      throw new Error("outer");
    })).toThrow("outer");
    expect(store.all().map(x => x.id)).toEqual(["root", "d"]);
    expect(store.events("e")).toEqual([]);
    // a failed insert leaves neither the row nor its event behind
    expect(() => store.insert(root, { kind: "enqueued" })).toThrow();
    expect(store.events("root")).toHaveLength(1);
  });

  it("keeps the inbox per owner and marks delivery once", () => {
    const store = open();
    store.addInbox({ id: "i1", ownerBotId: "chief", ownerThreadId: "chief-chat", assignmentId: "a", kind: "settled", createdAt: 1 });
    store.addInbox({ id: "i2", ownerThreadId: "chief-chat", assignmentId: "b", kind: "needs_input", createdAt: 2 });
    store.addInbox({ id: "i3", ownerRunId: "run-9", assignmentId: "c", kind: "settled", createdAt: 3 });
    expect(store.inbox({ threadId: "chief-chat" }).map(i => i.id)).toEqual(["i1", "i2"]);
    expect(store.inbox({ botId: "chief", threadId: "chief-chat" }).map(i => i.id)).toEqual(["i1"]);
    expect(store.inbox({ runId: "run-9" })).toEqual([{ id: "i3", ownerRunId: "run-9", assignmentId: "c", kind: "settled", createdAt: 3 }]);
    expect(store.inbox({})).toEqual([]);
    store.markDelivered(["i1"], 10);
    store.markDelivered(["i1"], 20);
    expect(store.inbox({ threadId: "chief-chat" }).map(i => i.deliveredAt)).toEqual([10, undefined]);
    expect(store.inbox({ threadId: "chief-chat" }, true).map(i => i.id)).toEqual(["i2"]);
    store.markDelivered([], 30);
  });

  it("prunes only whole trees that settled before the cutoff", () => {
    const store = open();
    const old = assignment("old", { status: "completed", outcome: "done", finishedAt: 100 });
    const live = assignment("live", { status: "completed", outcome: "done", finishedAt: 100 });
    const recent = assignment("recent", { status: "failed", outcome: "expired", finishedAt: 900 });
    store.insert(old, { kind: "enqueued" });
    store.insert(child("old1", old, { status: "cancelled", outcome: "stopped", finishedAt: 90 }), { kind: "enqueued" });
    store.insert(live, { kind: "enqueued" });
    store.insert(child("live1", live, { status: "running" }), { kind: "enqueued" });
    store.insert(recent, { kind: "enqueued" });
    store.addInbox({ id: "i-old", ownerThreadId: "chief-chat", assignmentId: "old1", kind: "settled", createdAt: 95 });
    store.addInbox({ id: "i-live", ownerThreadId: "chief-chat", assignmentId: "live", kind: "settled", createdAt: 95 });
    expect(store.prune(500)).toBe(2);
    expect(store.all().map(x => x.id).sort()).toEqual(["live", "live1", "recent"]);
    expect(store.events("old")).toEqual([]);
    expect(store.inbox({ threadId: "chief-chat" }).map(i => i.id)).toEqual(["i-live"]);
    expect(store.prune(500)).toBe(0);
  });

  it("forgets a confidential thread: its settled trees go whole, a live tree keeps no words of it", () => {
    const store = open();
    // a settled tree the thread requested (root) with a teammate's work under it
    const asked = assignment("asked", { status: "completed", outcome: "done", finishedAt: 100, brief: "SECRET ask",
      origin: { kind: "person", source: "chat", ref: "secret-chat", quote: "SECRET quote" },
      requester: { kind: "person", threadId: "secret-chat" },
      assignee: { botId: "chief", destination: { kind: "standing_thread", threadId: "secret-chat" } } });
    store.insert(asked, { kind: "enqueued" });
    store.insert(child("asked1", asked, { status: "completed", outcome: "done", finishedAt: 90, brief: "SECRET brief", result: "SECRET result" }),
      { kind: "parked", detail: "needs_input: SECRET question" });
    store.addInbox({ id: "i-asked", ownerThreadId: "secret-chat", assignmentId: "asked1", kind: "settled", createdAt: 95 });
    // a live tree of someone else in which the thread did settled work
    const other = assignment("other", { status: "waiting", brief: "ordinary ask" });
    store.insert(other, { kind: "enqueued" });
    const done = child("done", other, { status: "completed", outcome: "done", finishedAt: 80, brief: "SECRET brief 2", result: "SECRET result 2",
      question: "SECRET q", answer: "SECRET a", outcomeDetail: "SECRET detail", evidence: { summary: "SECRET evidence" },
      assignee: { botId: "builder", destination: { kind: "work_thread", threadId: "secret-chat" } } });
    store.insert(done, { kind: "parked", detail: "needs_input: SECRET q" });
    store.insert(child("still", other, { status: "running", brief: "ordinary brief" }), { kind: "enqueued", detail: "queued" });
    // a settled tree another conversation asked, in which the thread did work:
    // the asker keeps its other teammate, the thread's row loses its words
    const theirs = assignment("theirs", { status: "completed", outcome: "done", finishedAt: 70, brief: "their ask" });
    store.insert(theirs, { kind: "enqueued" });
    store.insert(child("mine", theirs, { status: "completed", outcome: "done", finishedAt: 60, result: "SECRET result 3",
      assignee: { botId: "builder", destination: { kind: "work_thread", threadId: "secret-chat" } } }), { kind: "enqueued" });
    store.insert(child("peer", theirs, { status: "completed", outcome: "done", finishedAt: 60, result: "peer result" }), { kind: "enqueued" });
    // an unrelated settled tree stays as it is
    store.insert(assignment("unrelated", { status: "completed", outcome: "done", finishedAt: 50 }), { kind: "enqueued", detail: "queued" });

    expect(store.forgetThread("secret-chat")).toEqual({ removed: 2, scrubbed: 2 });
    expect(store.all().map(x => x.id).sort()).toEqual(["done", "mine", "other", "peer", "still", "theirs", "unrelated"]);
    expect(store.get("mine")).toMatchObject({ brief: "", result: "" });
    expect(store.get("peer")?.result).toBe("peer result");
    expect(store.events("asked1")).toEqual([]);
    expect(store.inbox({ threadId: "secret-chat" })).toEqual([]);
    const scrubbed = store.get("done")!;
    expect(scrubbed).toMatchObject({ status: "completed", brief: "", result: "" });
    for (const key of ["question", "answer", "outcomeDetail", "evidence"] as const) expect(scrubbed[key]).toBeUndefined();
    expect(store.events("done").map(e => e.detail)).toEqual([undefined]);
    expect(store.get("still")?.brief).toBe("ordinary brief");
    expect(store.events("still").map(e => e.detail)).toEqual(["queued"]);
    expect(JSON.stringify([...store.all(), ...store.all().flatMap(a => store.events(a.id))])).not.toContain("SECRET");
    expect(store.forgetThread("secret-chat")).toEqual({ removed: 0, scrubbed: 0 });
    // a row this build cannot read never stops the forget: an own one goes
    const broken = { ...child("broken", other, { assignee: { botId: "builder", destination: { kind: "work_thread", threadId: "late-chat" } } }), status: "sleeping" } as unknown as Assignment;
    store.insert(broken, { kind: "enqueued", detail: "SECRET" });
    expect(store.forgetThread("late-chat")).toEqual({ removed: 1, scrubbed: 0 });
    expect(store.events("broken")).toEqual([]);
  });

  it("refuses a row that no longer matches the record schema", () => {
    const store = open();
    store.insert(assignment("ok"), { kind: "enqueued" });
    // a row written with a status this build does not know
    const broken = { ...assignment("bad"), status: "sleeping" } as unknown as Assignment;
    store.insert(broken, { kind: "enqueued" });
    expect(() => store.get("bad")).toThrow(/record schema/);
    expect(store.get("ok")?.id).toBe("ok");
  });

  it("reads the live rows from their own index, never walking the ended ones, in a file an earlier build wrote too", async () => {
    const dir = mkdtempSync(join(tmpdir(), "runtime-store-"));
    try {
      const path = join(dir, "runtime.db");
      const store = openRuntimeStore(path);
      store.insert(assignment("ended", { status: "completed", outcome: "done", finishedAt: 2_000 }), { kind: "enqueued" });
      store.insert(assignment("live", { createdAt: 3_000 }), { kind: "enqueued" });
      store.close();
      // A file from before the index: the next open adds it.
      const earlier = new DatabaseSync(path);
      earlier.exec("DROP INDEX assignments_live");
      earlier.close();
      const again = openRuntimeStore(path);
      expect(again.all({ nonTerminal: true }).map(x => x.id)).toEqual(["live"]);
      again.close();
      // all({ nonTerminal: true }) as SQLite plans it: the index, in created order, no sort.
      const probe = new DatabaseSync(path, { readOnly: true });
      const terminal = TERMINAL.map(s => `'${s}'`).join(", ");
      const plan = probe.prepare(`EXPLAIN QUERY PLAN SELECT id, json FROM assignments WHERE status NOT IN (${terminal}) ORDER BY created_at, rowid`).all() as Array<{ detail: string }>;
      probe.close();
      expect(plan.map(step => step.detail)).toEqual(["SCAN assignments USING INDEX assignments_live"]);
    } finally {
      await removeTempDir(dir);
    }
  });

  it("creates the file owner-only in WAL mode and reopens the same data", async () => {
    const dir = mkdtempSync(join(tmpdir(), "runtime-store-"));
    try {
      const path = join(dir, "nested", "runtime.db");
      const store = openRuntimeStore(path);
      expect(store.path).toBe(path);
      store.insert(assignment("root"), { kind: "enqueued" });
      store.close();
      if (process.platform !== "win32") {
        expect(statSync(path).mode & 0o777).toBe(0o600);
        expect(statSync(join(dir, "nested")).mode & 0o777).toBe(0o700);
      }
      const probe = new DatabaseSync(path);
      expect((probe.prepare("PRAGMA journal_mode").get() as { journal_mode: string }).journal_mode).toBe("wal");
      probe.close();
      const again = openRuntimeStore(path);
      expect(again.get("root")?.brief).toBe("Ship it");
      again.close();
    } finally {
      await removeTempDir(dir);
    }
  });
});

describe("runtime store: request marks", () => {
  it("round-trips approved and batchKey, and refuses the wrong types", () => {
    const store = open();
    const root = assignment("root", { status: "running" });
    store.insert(root, { kind: "enqueued", at: 1_000 });
    const marked = child("marked", root, { approved: true, batchKey: "batch-1" });
    store.insert(marked, { kind: "enqueued", at: 2_000 });
    expect(store.get("marked")).toEqual(marked);
    expect(store.get("marked")).toMatchObject({ approved: true, batchKey: "batch-1" });
    const plain = child("plain", root);
    store.insert(plain, { kind: "enqueued", at: 3_000 });
    expect("approved" in store.get("plain")!).toBe(false);
    expect("batchKey" in store.get("plain")!).toBe(false);
    store.insert(child("bad", root, { approved: "yes" as unknown as boolean }), { kind: "enqueued", at: 4_000 });
    expect(() => store.get("bad")).toThrow(/does not match the record schema/);
  });

  it("round-trips carrying, and reads a row an earlier build wrote without it", () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-runtime-carrying-"));
    try {
      const path = join(dir, "runtime.db");
      const store = open(path);
      const root = assignment("root", { status: "running" });
      store.insert(root, { kind: "enqueued", at: 1_000 });
      const carrying = assignment("carrying", { ...root, id: "carrying", rootId: "carrying", carrying: ["a", "b"] });
      store.insert(carrying, { kind: "enqueued", at: 2_000 });
      expect(store.get("carrying")?.carrying).toEqual(["a", "b"]);
      // the record travels in the json column: no column, no migration;
      // a row an earlier build wrote simply has no carrying
      const db = new DatabaseSync(path, { readOnly: true });
      const columns = (db.prepare("PRAGMA table_info(assignments)").all() as Array<{ name: string }>).map(c => c.name);
      db.close();
      expect(columns).not.toContain("carrying");
      expect("carrying" in store.get("root")!).toBe(false);
      store.insert(child("bad", root, { carrying: "a" as unknown as string[] }), { kind: "enqueued", at: 3_000 });
      expect(() => store.get("bad")).toThrow(/does not match the record schema/);
    } finally {
      for (const s of stores.splice(0)) s.close();
      removeTempDir(dir);
    }
  });
});
