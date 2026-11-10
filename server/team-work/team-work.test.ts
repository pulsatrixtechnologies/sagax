// #3461: the team work read model with the reader's rights, on an
// in-memory runtime store: each person sees only their own work.
import { afterEach, describe, expect, it } from "vitest";

import { openRuntimeStore, type RuntimeStore } from "../runtime/store.ts";
import type { Assignment } from "../runtime/types.ts";
import { handedOver } from "../runtime-coordinator.ts";
import type { TurnPeek } from "../turns/turn-watchdog.ts";
import { createTeamWorkReader, stepTitle, type TeamWorkDeps, type TeamWorkMessage, type TeamWorkThread } from "./team-work.ts";

const NOW = 10_000_000;

function root(id: string, threadId: string, person: string): Assignment {
  return {
    id, rootId: id, depth: 0,
    origin: { kind: "person", source: "chat", quote: "Ship the login fix" },
    requester: { kind: "person", threadId },
    assignee: { botId: "orc", destination: { kind: "standing_thread", threadId } },
    mode: "work", reply: "resume", brief: "Ship the login fix", status: "waiting", level: "ask", levelSource: "own",
    executions: 1, restarts: 0, createdAt: NOW - 600_000, lastActivityAt: NOW - 600_000, result: "", rework: false, person, version: 1,
  };
}

function handOver(id: string, parent: Assignment, botId: string, threadId: string, patch: Partial<Assignment> = {}): Assignment {
  return {
    ...parent, id, parentId: parent.id, depth: 1,
    requester: { kind: "bot_turn", botId: "orc", threadId: parent.assignee.destination.threadId },
    assignee: { botId, destination: { kind: "work_thread", threadId } },
    brief: `## Fix the login\nDetails for ${id}`, status: "running", startedAt: NOW - 500_000, createdAt: NOW - 550_000,
    ...patch,
  };
}

let store: RuntimeStore | undefined;
afterEach(() => { store?.close(); store = undefined; });

function rig() {
  store = openRuntimeStore(":memory:");
  const runtime = store;
  const threads = new Map<string, TeamWorkThread & { owner: string }>();
  const messages = new Map<string, TeamWorkMessage[]>();
  const peeks = new Map<string, TurnPeek>();
  const reachable = new Set(["dev", "rev"]);
  const thread = (botId: string, threadId: string, owner: string, extra: Partial<TeamWorkThread> = {}) =>
    threads.set(`${botId}:${threadId}`, { title: "@Orc · work", owner, ...extra });
  const deps: TeamWorkDeps = {
    handedOutBy: (botId, since) => runtime.handedOutBy(botId, since).map(handedOver),
    thread: (botId, threadId) => threads.get(`${botId}:${threadId}`),
    threadReadable: (botId, threadId, viewerId) => {
      const record = threads.get(`${botId}:${threadId}`);
      return Boolean(record) && (!viewerId || record!.owner === viewerId);
    },
    messages: (threadId) => messages.get(threadId) ?? [],
    activity: (_botId, threadId) => ({ id: `thread:${threadId}`, kind: "hop", botId: "dev", title: "", status: "running", startedAt: 0, updatedAt: 0, coding: true, currentStep: "Running tests" }),
    failureCause: () => undefined,
    peek: (threadId) => peeks.get(threadId),
    openTurns: () => [],
    name: (_orc, botId) => (reachable.has(botId) ? { name: botId === "dev" ? "Dev" : "Reviewer" } : undefined),
    now: () => NOW,
  };
  return { runtime, threads, thread, messages, peeks, reachable, reader: createTeamWorkReader(deps) };
}

describe("team work reader (#3461)", () => {
  it("lists a step with its live state, tokens of its settled turns and the tool call in flight", () => {
    const r = rig();
    const ana = root("ana-root", "orc-ana", "ana");
    r.runtime.insert(ana, { kind: "enqueued" });
    r.runtime.insert(handOver("h1", ana, "dev", "dev-work"), { kind: "enqueued" });
    r.thread("orc", "orc-ana", "ana");
    r.thread("dev", "dev-work", "ana");
    r.peeks.set("dev-work", { threadId: "dev-work", botId: "dev", startedAt: NOW - 500_000, lastEventAt: NOW - 40_000, waitingOnHuman: false, waitingOnComputer: false });
    r.messages.set("dev-work", [
      { kind: "digest", at: NOW - 900_000, digest: { reply: "An earlier request.", usage: { input: 999, output: 999 } } },
      { kind: "digest", at: NOW - 300_000, digest: { reply: "Wrote the fix.", usage: { input: 1_000, output: 200 } } },
    ]);
    const work = r.reader.read("orc", "ana", 0);
    expect(work.live).toHaveLength(1);
    expect(work.live[0]).toMatchObject({ key: "step:h1", name: "Fix the login", done: 0, total: 1, tokens: 1_200,
      current: { botId: "dev", stepId: "h1" }, live: { state: "working", lastActionAt: NOW - 40_000 } });
    expect(work.live[0]!.steps[0]).toMatchObject({ threadId: "dev-work", doing: "Running tests", durationMs: 500_000 });
    expect(work.team).toEqual([expect.objectContaining({ botId: "dev", name: "Dev", stepId: "h1", threadId: "dev-work" })]);
  });

  it("does not list another person's work on a shared orchestrator", () => {
    const r = rig();
    const ana = root("ana-root", "orc-ana", "ana");
    const ben = root("ben-root", "orc-ben", "ben");
    r.runtime.insert(ana, { kind: "enqueued" });
    r.runtime.insert(ben, { kind: "enqueued" });
    r.runtime.insert(handOver("ana-step", ana, "dev", "dev-ana"), { kind: "enqueued" });
    r.runtime.insert(handOver("ben-step", ben, "dev", "dev-ben"), { kind: "enqueued" });
    r.thread("orc", "orc-ana", "ana");
    r.thread("orc", "orc-ben", "ben");
    r.thread("dev", "dev-ana", "ana");
    r.thread("dev", "dev-ben", "ben");
    expect(r.reader.read("orc", "ana", 0).live.map((item) => item.key)).toEqual(["step:ana-step"]);
    expect(r.reader.read("orc", "ben", 0).live.map((item) => item.key)).toEqual(["step:ben-step"]);
    // a step thread the reader may not read is not listed, even from their own conversation
    r.thread("dev", "dev-ana", "ben");
    expect(r.reader.read("orc", "ana", 0).live).toEqual([]);
  });

  it("does not name a bot the orchestrator can no longer reach", () => {
    const r = rig();
    const ana = root("ana-root", "orc-ana", "ana");
    r.runtime.insert(ana, { kind: "enqueued" });
    r.runtime.insert(handOver("h1", ana, "dev", "dev-work"), { kind: "enqueued" });
    r.thread("orc", "orc-ana", "ana");
    r.thread("dev", "dev-work", "ana");
    r.reachable.delete("dev");
    const work = r.reader.read("orc", "ana", 0);
    expect(work.live).toHaveLength(1);
    expect(work.team[0]!.botId).toBe("dev");
    expect(work.team[0]!.name).toBeUndefined();
  });

  it("still lists an archived step thread, and it can be opened", () => {
    const r = rig();
    const ana = root("ana-root", "orc-ana", "ana");
    r.runtime.insert(ana, { kind: "enqueued" });
    r.runtime.insert(handOver("h1", ana, "dev", "dev-work", { status: "completed", outcome: "done", finishedAt: NOW - 100_000 }), { kind: "enqueued" });
    r.thread("orc", "orc-ana", "ana");
    r.thread("dev", "dev-work", "ana", { archivedAt: NOW - 50_000 });
    r.messages.set("dev-work", [{ kind: "digest", at: NOW - 100_000, digest: { reply: "Merged the fix.", usage: { input: 10, output: 5 } } }]);
    const work = r.reader.read("orc", "ana", 0);
    expect(work.doneToday).toHaveLength(1);
    expect(work.doneToday[0]!.steps[0]).toMatchObject({ threadId: "dev-work", did: "Merged the fix.", done: true, durationMs: 400_000 });
  });

  it("yields nothing for a confidential thread", () => {
    const r = rig();
    const ana = root("ana-root", "orc-ana", "ana");
    r.runtime.insert(ana, { kind: "enqueued" });
    r.runtime.insert(handOver("h1", ana, "dev", "dev-work"), { kind: "enqueued" });
    r.thread("orc", "orc-ana", "ana");
    r.thread("dev", "dev-work", "ana", { confidential: true });
    expect(r.reader.read("orc", "ana", 0)).toMatchObject({ live: [], doneToday: [], team: [] });
    // nor for a hand-over out of a confidential conversation of the orchestrator
    r.thread("dev", "dev-work", "ana");
    r.thread("orc", "orc-ana", "ana", { confidential: true });
    expect(r.reader.read("orc", "ana", 0)).toMatchObject({ live: [], doneToday: [], team: [] });
  });

  it("names a step by the thread its send opened, else by its request's first line", () => {
    const r = rig();
    const ana = root("ana-root", "orc-ana", "ana");
    r.runtime.insert(ana, { kind: "enqueued" });
    r.runtime.insert(handOver("h1", ana, "dev", "dev-new", { mode: "notify", reply: "none" }), { kind: "enqueued" });
    r.thread("orc", "orc-ana", "ana");
    r.thread("dev", "dev-new", "ana", { title: "Login fix", openedBy: { botId: "orc", delegationId: "h1" } });
    expect(r.reader.read("orc", "ana", 0).live[0]!.name).toBe("Login fix");
    expect(stepTitle("  ## **Fix** the `login`\nmore")).toBe("Fix the login");
  });
});
