// activityChildren cost: a synthetic large runtime store must keep the
// indexed childrenOfAssignee read under a few milliseconds. The old path
// (store.all() + zod parse of every assignment per request) blocked the
// event loop ~1.8 s once a minute on a production org host.
import { describe, expect, it } from "vitest";

import { openRuntimeStore, type RuntimeStore } from "./store.ts";
import type { Assignment } from "./types.ts";

function assignment(id: string, patch: Partial<Assignment> = {}): Assignment {
  return {
    id, rootId: id, depth: 0,
    origin: { kind: "person", source: "chat", quote: "Ship it" },
    requester: { kind: "person", threadId: "chief-chat" },
    assignee: { botId: "chief", destination: { kind: "standing_thread", threadId: "chief-chat" } },
    mode: "work", reply: "resume", brief: `Brief for ${id}`, status: "queued", level: "ask", levelSource: "own",
    executions: 0, restarts: 0, createdAt: 1_000, lastActivityAt: 1_000, result: "", rework: false, version: 1,
    ...patch,
  };
}

const childOf = (id: string, parent: Assignment, patch: Partial<Assignment> = {}) =>
  assignment(id, {
    rootId: parent.rootId, parentId: parent.id, depth: parent.depth + 1,
    requester: { kind: "bot_turn", botId: parent.assignee.botId, threadId: parent.assignee.destination.threadId },
    assignee: { botId: "builder", destination: { kind: "work_thread", threadId: `${id}-thread` } },
    ...patch,
  });

/** Membership the old activityChildren scan produced over store.all(). */
function scanChildrenOfAssignee(store: RuntimeStore, botId: string, threadId: string): string[] {
  const rows = store.all();
  const byId = new Map(rows.map(row => [row.id, row]));
  return rows
    .filter(node => {
      if (!node.parentId || node.assignee.destination.groupId !== undefined) return false;
      const parent = byId.get(node.parentId);
      return Boolean(parent && parent.assignee.botId === botId && parent.assignee.destination.threadId === threadId);
    })
    .map(node => node.id);
}

describe("runtime store activity children perf", () => {
  it("childrenOfAssignee stays under a few ms on thousands of assignments and matches the scan", () => {
    const store = openRuntimeStore(":memory:");
    try {
      const ROOTS = 400;
      const CHILDREN_PER = 8;
      const TARGET = "target-root";
      // One target parent with a handful of direct children the panel reads.
      const target = assignment(TARGET, {
        status: "running", startedAt: 1_000,
        assignee: { botId: "chief", destination: { kind: "standing_thread", threadId: "chief-chat" } },
      });
      store.insert(target, { kind: "enqueued", at: 1_000 });
      const expected: string[] = [];
      for (let i = 0; i < 5; i += 1) {
        const id = `target-child-${i}`;
        expected.push(id);
        store.insert(childOf(id, target, {
          createdAt: 2_000 + i,
          status: i % 2 ? "completed" : "running",
          ...(i % 2 ? { outcome: "done" as const, finishedAt: 3_000 + i } : {}),
        }), { kind: "enqueued", at: 2_000 + i });
      }
      // Noise: many other trees, including room children under the target
      // (filtered out) and direct children under other parents.
      store.insert(childOf("room-noise", target, {
        createdAt: 9_000,
        assignee: { botId: "builder", destination: { kind: "room_thread", threadId: "room-noise", groupId: "g-noise" } },
      }), { kind: "enqueued", at: 9_000 });
      for (let r = 0; r < ROOTS; r += 1) {
        const root = assignment(`noise-root-${r}`, {
          createdAt: 10_000 + r,
          status: r % 5 === 0 ? "completed" : "running",
          ...(r % 5 === 0 ? { outcome: "done" as const, finishedAt: 20_000 + r } : {}),
          assignee: { botId: `bot-${r % 40}`, destination: { kind: "standing_thread", threadId: `chat-${r}` } },
          requester: { kind: "person", threadId: `chat-${r}` },
        });
        store.insert(root, { kind: "enqueued", at: 10_000 + r });
        for (let c = 0; c < CHILDREN_PER; c += 1) {
          store.insert(childOf(`noise-${r}-${c}`, root, {
            createdAt: 30_000 + r * CHILDREN_PER + c,
            status: "completed", outcome: "done", finishedAt: 40_000 + r * CHILDREN_PER + c,
            assignee: { botId: "builder", destination: { kind: "work_thread", threadId: `noise-${r}-${c}-t` } },
          }), { kind: "enqueued", at: 30_000 + r * CHILDREN_PER + c });
        }
      }
      expect(store.all().length).toBeGreaterThan(3_000);

      // Correctness against the old full scan (pays the scan cost once).
      expect(scanChildrenOfAssignee(store, "chief", "chief-chat")).toEqual(expected);
      expect(store.childrenOfAssignee("chief", "chief-chat").map(row => row.id)).toEqual(expected);

      // Warm the parse cache the way a live server does after the first poll.
      store.childrenOfAssignee("chief", "chief-chat");

      const samples: number[] = [];
      for (let i = 0; i < 25; i += 1) {
        const started = performance.now();
        const ids = store.childrenOfAssignee("chief", "chief-chat").map(row => row.id);
        samples.push(performance.now() - started);
        expect(ids).toEqual(expected);
      }
      samples.sort((a, b) => a - b);
      const p50 = samples[Math.floor(samples.length / 2)]!;
      const p95 = samples[Math.floor(samples.length * 0.95)]!;
      // A few ms on a warm indexed read; CI hosts vary, so the ceiling is
      // generous versus the old ~1.8 s full-scan path.
      expect(p50).toBeLessThan(5);
      expect(p95).toBeLessThan(20);
    } finally {
      store.close();
    }
  });
  it("handedOutBy (#3461): the hand-overs of every turn of a bot since a date, plus the live ones, under the same bound", () => {
    const store = openRuntimeStore(":memory:");
    try {
      const SINCE = 5_000;
      const expected: string[] = [];
      // two conversations of the orchestrator, each its own root
      const rootA = assignment("orc-a", { status: "running", startedAt: 1_000 });
      const rootB = assignment("orc-b", { status: "completed", outcome: "done", finishedAt: 9_000, createdAt: 4_000,
        assignee: { botId: "chief", destination: { kind: "standing_thread", threadId: "chief-chat-2" } },
        requester: { kind: "person", threadId: "chief-chat-2" } });
      store.insert(rootA, { kind: "enqueued", at: 1_000 });
      store.insert(rootB, { kind: "enqueued", at: 4_000 });
      // before the date and ended: left out
      store.insert(childOf("old-done", rootA, { createdAt: 2_000, status: "completed", outcome: "done", finishedAt: 3_000 }), { kind: "enqueued", at: 2_000 });
      // before the date and still live: listed
      store.insert(childOf("old-live", rootA, { createdAt: 2_500, status: "running" }), { kind: "enqueued", at: 2_500 });
      expected.push("old-live");
      for (let i = 0; i < 4; i += 1) {
        const id = `new-${i}`;
        store.insert(childOf(id, i % 2 ? rootB : rootA, { createdAt: SINCE + i, status: i % 2 ? "completed" : "queued",
          ...(i % 2 ? { outcome: "done" as const, finishedAt: SINCE + 100 + i } : {}) }), { kind: "enqueued", at: SINCE + i });
        expected.push(id);
      }
      // room work: left out
      store.insert(childOf("room", rootA, { createdAt: SINCE + 50,
        assignee: { botId: "builder", destination: { kind: "room_thread", threadId: "room", groupId: "g" } } }), { kind: "enqueued", at: SINCE + 50 });
      // noise: other bots' trees
      for (let r = 0; r < 400; r += 1) {
        const root = assignment(`noise-root-${r}`, { createdAt: 10_000 + r, status: "completed", outcome: "done", finishedAt: 20_000 + r,
          assignee: { botId: `bot-${r % 40}`, destination: { kind: "standing_thread", threadId: `chat-${r}` } },
          requester: { kind: "person", threadId: `chat-${r}` } });
        store.insert(root, { kind: "enqueued", at: 10_000 + r });
        for (let c = 0; c < 8; c += 1) {
          store.insert(childOf(`noise-${r}-${c}`, root, { createdAt: 30_000 + r * 8 + c, status: "completed", outcome: "done", finishedAt: 40_000 + r * 8 + c }),
            { kind: "enqueued", at: 30_000 + r * 8 + c });
        }
      }
      expect(store.all().length).toBeGreaterThan(3_000);
      expect(store.handedOutBy("chief", SINCE).map(row => row.id)).toEqual(expected);
      expect(store.handedOutBy("nobody", 0)).toEqual([]);
      const samples: number[] = [];
      for (let i = 0; i < 25; i += 1) {
        const started = performance.now();
        store.handedOutBy("chief", SINCE);
        samples.push(performance.now() - started);
      }
      samples.sort((a, b) => a - b);
      expect(samples[Math.floor(samples.length / 2)]!).toBeLessThan(5);
      expect(samples[Math.floor(samples.length * 0.95)]!).toBeLessThan(20);
    } finally {
      store.close();
    }
  });
});
