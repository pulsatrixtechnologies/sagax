// #3535: a start (Runtime.open) reads the live rows, the settled rows whose
// report is still owed, and the settled rows a late inbox entry may reopen,
// through indexes. It never reads the settled rows that already reported:
// on a store with a long history that read stopped the event loop seconds.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { removeTempDir } from "../testing/cleanup.ts";

import { Runtime } from "./runtime.ts";
import { openRuntimeStore, type RuntimeStore } from "./store.ts";
import type { Assignment, TurnRunner } from "./types.ts";

const SETTLED = 3_000;

const row = (id: string, patch: Partial<Assignment> = {}): Assignment => ({
  id, rootId: id, depth: 0,
  origin: { kind: "person", source: "chat" },
  requester: { kind: "person", threadId: `${id}-chat` },
  assignee: { botId: "worker", destination: { kind: "work_thread", threadId: `${id}-work` } },
  mode: "work", reply: "resume", brief: `Brief ${id}`, status: "completed", outcome: "done",
  level: "auto", levelSource: "own", executions: 1, restarts: 0,
  createdAt: 1_000, lastActivityAt: 2_000, finishedAt: 2_000, reportedAt: 2_100,
  result: "done", rework: false, version: 1, ...patch,
});

/** A store with a long settled history and a few rows a start must read. */
function seed(store: RuntimeStore) {
  store.transaction(() => {
    for (let i = 0; i < SETTLED; i += 1) store.insert(row(`old-${i}`, { createdAt: 1_000 + i }), { kind: "enqueued", at: 1_000 });
  });
  const live = [
    row("live-queued", { status: "queued", createdAt: 50_000, finishedAt: undefined, reportedAt: undefined, outcome: undefined, result: "" }),
    row("live-waiting", { status: "waiting", createdAt: 50_001, finishedAt: undefined, reportedAt: undefined, outcome: undefined, result: "" }),
  ];
  for (const a of live) { delete a.finishedAt; delete a.reportedAt; delete a.outcome; store.insert(a, { kind: "enqueued", at: 50_000 }); }
  const owed = row("owed", { createdAt: 50_002 });
  delete owed.reportedAt;
  store.insert(owed, { kind: "enqueued", at: 50_000 });
  // A settled parent that reported, then its child's entry came in after.
  store.insert(row("parent", { createdAt: 50_003, reportedAt: 3_000 }), { kind: "enqueued", at: 50_000 });
  store.insert(row("child", { rootId: "parent", parentId: "parent", depth: 1, createdAt: 50_004 }), { kind: "enqueued", at: 50_000 });
  store.addInbox({ id: "late", assignmentId: "child", kind: "settled", ownerThreadId: "parent-work", createdAt: 4_000 });
  // A delivered entry never reopens anything and is not a reason to read.
  store.addInbox({ id: "seen", assignmentId: "old-7", kind: "settled", ownerThreadId: "old-6-work", createdAt: 4_000, deliveredAt: 4_100 });
  return { live: live.map(a => a.id) };
}

/** Every assignment id any read of the store hands back. */
function recording(store: RuntimeStore): { store: RuntimeStore; read: Set<string> } {
  const read = new Set<string>();
  const note = (value: unknown) => {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item && typeof item === "object" && "rootId" in item && "id" in item) read.add(String((item as Assignment).id));
    }
    return value;
  };
  const proxy = new Proxy(store, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver) as unknown;
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => note((value as (...a: unknown[]) => unknown).apply(target, args));
    },
  });
  return { store: proxy, read };
}

function runner(reports: string[]): TurnRunner {
  return {
    validate: () => undefined,
    canStart: () => true,
    run: () => new Promise(() => {}),
    park: () => {},
    report: a => { reports.push(a.id); },
    changed: () => {},
    names: a => ({ requester: "requester", assignee: a.assignee.botId, person: "person" }),
  };
}

describe("Runtime.open on a long settled history (#3535)", () => {
  it("reads the live, owed and reopenable rows only, never a settled row that reported", () => {
    const base = openRuntimeStore(":memory:");
    const { live } = seed(base);
    const { store, read } = recording(base);
    const reports: string[] = [];
    const runtime = new Runtime(store, runner(reports), { clock: { now: () => 60_000, monotonic: () => 60_000 } });
    runtime.open();
    const old = [...read].filter(id => id.startsWith("old-"));
    expect(old).toEqual([]);
    expect([...read].sort()).toEqual([...live, "child", "owed", "parent"].sort());
    // Nothing a person sees changes: the late entry reopens its parent, and
    // the owed report is still sent.
    expect(base.get("parent")).toMatchObject({ status: "resume" });
    expect(base.get("parent")?.reportedAt).toBeUndefined();
    runtime.tick();
    expect(reports).toContain("owed");
    expect(reports.filter(id => id.startsWith("old-"))).toEqual([]);
    base.close();
  });

  it("finds the owed and reopenable rows through indexes, and follows writes", () => {
    const dir = mkdtempSync(join(tmpdir(), "runtime-open-settled-"));
    try {
      const path = join(dir, "runtime.db");
      const store = openRuntimeStore(path);
      seed(store);
      expect(store.unreported().map(a => a.id)).toEqual(["owed"]);
      expect(store.settledWithUndelivered().map(a => a.id)).toEqual(["parent"]);
      // reported now: it leaves the owed list; a newly settled row enters it
      const owed = store.get("owed")!;
      owed.reportedAt = 60_000;
      store.update(owed);
      const done = store.get("live-queued")!;
      done.status = "completed"; done.finishedAt = 60_000;
      store.update(done);
      store.markDelivered(["late"], 60_000);
      expect(store.unreported().map(a => a.id)).toEqual(["live-queued"]);
      expect(store.settledWithUndelivered()).toEqual([]);
      store.close();
      // across a restart the same, and the index is not rebuilt
      const again = openRuntimeStore(path);
      expect(again.unreported().map(a => a.id)).toEqual(["live-queued"]);
      again.close();
      const db = new DatabaseSync(path);
      const plan = (sql: string) => (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as Array<{ detail: string }>).map(r => r.detail).join(" | ");
      const sql = String((db.prepare("SELECT sql FROM sqlite_master WHERE name = 'assignments_unreported'").get() as { sql: string }).sql);
      const where = sql.slice(sql.indexOf(" WHERE ") + 7);
      expect(plan(`SELECT id, json FROM assignments INDEXED BY assignments_unreported WHERE ${where} ORDER BY created_at, rowid`)).toContain("assignments_unreported");
      expect(plan("SELECT assignment_id FROM inbox WHERE delivered_at IS NULL")).toContain("inbox_undelivered");
      db.close();
    } finally {
      removeTempDir(dir);
    }
  });

  it("a row whose json no longer parses still opens the store and is refused when read", () => {
    const dir = mkdtempSync(join(tmpdir(), "runtime-open-settled-bad-"));
    try {
      const path = join(dir, "runtime.db");
      const store = openRuntimeStore(path);
      store.insert(row("bad"), { kind: "enqueued", at: 1_000 });
      store.close();
      const db = new DatabaseSync(path);
      db.exec("DROP INDEX assignments_unreported");
      db.prepare("UPDATE assignments SET json = 'not json' WHERE id = 'bad'").run();
      db.close();
      const again = openRuntimeStore(path);
      expect(() => again.unreported()).toThrow(/invalid JSON/);
      again.close();
    } finally {
      removeTempDir(dir);
    }
  });
});
