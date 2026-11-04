import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

import type { CoordinatorHost, HandoffView, RoomAddress } from "../coordinator.ts";
import { RuntimeCoordinator } from "../runtime-coordinator.ts";
import { ownsThread, threadOwner } from "../threads/thread-privacy.ts";
import { transpileTs } from "../testing/transpile.ts";
import { queuedBehindPersonText } from "./waiting-on-person.ts";

// Compose the actual host admission/receipt functions with the actual
// runtime coordinator. DEL-08 must keep the waiting receipt while it uses
// slotUse instead of busy, including the source person's private audience.
const source = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
const section = (from: string, to: string) => {
  const start = source.indexOf(`\n${from}`);
  const end = source.indexOf(`\n${to}`, start);
  if (start < 0 || end <= start) throw new Error(`Queued-card host section moved: ${from}`);
  return source.slice(start, end);
};
const hostCode = transpileTs([
  section("function coordinatorSlotUse(", "/** Routine and webhook dispatch"),
  section("function queuedBehindPerson(", "// The coordinator runs every hand-off"),
  "globalThis.slotUse = coordinatorSlotUse; globalThis.status = queuedStatus;",
].join("\n"));

function fixture(options: { organization?: boolean; room?: boolean; cardOwner?: string; readable?: boolean; confidential?: boolean; revoked?: boolean } = {}) {
  const from: RoomAddress = { botId: "chief", threadId: "source", ...(options.room ? { groupId: "shared-room" } : {}) };
  const target: RoomAddress = { botId: "mira", threadId: "queued-work" };
  const bots = new Map([
    ["chief", { id: "chief", name: "Clive", color: "blue", ownerUserId: "bot-owner" }],
    ["mira", { id: "mira", name: "Mira", color: "green", ownerUserId: "alice" }],
  ]);
  const sourceTask = { threadId: "source", ownerPrincipalId: " Alice " };
  const cardTask = { threadId: "private-card", title: "Private deployment", ownerPrincipalId: options.cardOwner ?? "alice", activity: "waiting-on-you" };
  const state = { occupied: true };
  const messages: Array<{ threadId: string; row: any }> = [];
  const runs: HandoffView[] = [];
  const context = vm.createContext({
    cfg: {}, privateThreadOwner: threadOwner, ownsThread, queuedBehindPersonText,
    privateThreads: () => options.organization === true,
    effectiveBotOwner: (bot: { ownerUserId: string }) => bot.ownerUserId,
    botThreadReadable: (_bot: unknown, threadId: string, viewer: string) => options.readable !== false &&
      threadId === cardTask.threadId && ownsThread(viewer, cardTask, "alice"),
    roomHandoffProblem: (node: RoomAddress) => options.revoked ? "No route to that bot"
      : options.confidential && node.threadId === cardTask.threadId ? "A confidential thread takes no part in teammate work" : undefined,
    store: {
      bot: (id: string) => bots.get(id),
      tasks: (id: string) => id === "mira" ? [cardTask] : [sourceTask],
      taskByThread: (_id: string, threadId: string) => threadId === "source" ? sourceTask : cardTask,
      appendMessage: (threadId: string, row: unknown) => messages.push({ threadId, row }),
    },
    reviewHolds: () => false,
    threadBusy: (_id: string, threadId: string) => state.occupied && threadId === cardTask.threadId,
    activeGroupTurnForBot: () => undefined,
    botAtThreadCapacity: () => state.occupied,
    botBusyThreadCount: () => state.occupied ? 1 : 0,
    botMaxConcurrentThreads: () => 1,
    openPersonCard: (threadId: string) => state.occupied && threadId === cardTask.threadId ? { kind: "approval" } : undefined,
  });
  vm.runInContext(hostCode, context, { filename: "index.ts (queued-card host fixture)" });
  const host: CoordinatorHost = {
    validate: () => undefined,
    busy: (node) => { if (!node.groupId) throw new Error("Direct admission must use slotUse"); return false; },
    slotUse: (node) => context.slotUse(node),
    run: async (node) => { runs.push(node); return { ok: true, text: `${node.botId} done` }; },
    park: () => {}, report: () => {}, changed: () => {},
    names: (node, parent) => ({ requester: parent?.botId ?? "alice", assignee: node.botId, person: "alice" }),
    levelOf: () => ({ level: "ask" }), chiefOf: () => false,
  };
  const coordinator = new RuntimeCoordinator({ dataDir: ":memory:", host });
  context.coordinator = coordinator;
  const child = coordinator.enqueue(from, "source-generation", undefined, target, "work", "Update the changelog", false, false, "Ship it",
    undefined, { kind: "user", request: "Ship it" }).node;
  coordinator.sourceSettled("source-generation", true);
  return { coordinator, child, messages, runs, state, status: () => context.status(coordinator.node(child.id)) };
}

describe("runtime admission queued behind a person's card", () => {
  it.each([
    ["solo direct", {}],
    ["solo room", { room: true }],
    ["the private source's actual owner", { organization: true }],
  ] as const)("keeps %s informed once, then dispatches only after the slot is free", async (_name, options) => {
    const f = fixture(options);
    try {
      f.coordinator.tick(); f.coordinator.tick();
      expect(f.coordinator.node(f.child.id)).toMatchObject({ status: "queued", executions: 0 });
      expect(f.runs).toEqual([]);
      expect(f.messages).toEqual([{ threadId: "source", row: {
        role: "bot", kind: "activity", from: { botId: "mira", name: "Mira", color: "green" },
        tool: { name: 'Queued for @Mira behind your approval in “Private deployment”', ok: true },
        threadRef: { botId: "mira", threadId: "private-card", title: "Private deployment" },
      } }]);
      expect(f.status()).toContain('in its thread "Private deployment"');
      f.state.occupied = false;
      for (let i = 0; i < 4; i++) { f.coordinator.tick(); await new Promise<void>(resolve => setImmediate(resolve)); }
      expect(f.coordinator.node(f.child.id)).toMatchObject({ status: "completed", executions: 1 });
      expect(f.runs.map(node => node.botId)).toEqual(["mira", "chief"]);
      expect(f.coordinator.all()).toHaveLength(2);
      expect(f.messages).toHaveLength(1);
    } finally { f.coordinator.close(); }
  });

  it.each([
    ["another person's card", { cardOwner: "bob" }],
    ["revoked read access", { readable: false }],
    ["a shared room's audience", { room: true }],
    ["a confidential card thread", { confidential: true }],
    ["a confidential solo direct thread", { organization: false, confidential: true }],
    ["a confidential solo thread from a room", { organization: false, room: true, confidential: true }],
  ] as const)("never exposes %s in a receipt or requester context", (_name, options) => {
    const f = fixture({ organization: true, ...options });
    try {
      f.coordinator.tick(); f.coordinator.tick();
      expect(f.coordinator.node(f.child.id)).toMatchObject({ status: "queued", executions: 0 });
      expect(f.runs).toEqual([]);
      expect(f.messages).toHaveLength(1);
      expect(f.messages[0]!.row.tool).toEqual({ name: "Queued for @Mira, who's waiting on a person", ok: true });
      expect(f.messages[0]!.row.threadRef).toBeUndefined();
      expect(JSON.stringify(f.messages)).not.toMatch(/Private deployment|private-card/);
      expect(f.status()).toBe("waiting for a free slot: that teammate is waiting on a person");
    } finally { f.coordinator.close(); }
  });

  it("names no teammate once the route is revoked", () => {
    const f = fixture({ organization: true, revoked: true });
    try {
      f.coordinator.tick();
      expect(f.messages).toEqual([]);
      expect(f.status()).toBe("waiting for that teammate to be free");
    } finally { f.coordinator.close(); }
  });
});
