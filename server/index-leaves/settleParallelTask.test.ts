import { describe, expect, it, vi } from "vitest";
import { createSettleParallelTask } from "./settleParallelTask.ts";
import { createSettleParallelFallback } from "./settleParallelFallback.ts";

/** A parallel task "task-1" opened from the conversation "main". */
function fakeHost(awaiting: boolean) {
  const appended: any[] = [];
  const bot = { id: "bot-1", name: "Gaston" };
  const task = { threadId: "task-1", title: "Slogans", parallelOf: { threadId: "main", messageId: "m-1", cardMessageId: "c-1" } as any, closedBy: undefined };
  const host: Record<string, any> = {
    DATA_DIR: "/tmp", appendAdminAction: () => {}, IDENTITY: { kind: "sagax" },
    pendingParallelTask: (threadId: string) => threadId === "task-1" && task.parallelOf.reportedAt === undefined ? { bot, task } : null,
    parallelStops: new Set<string>(),
    coordinator: { awaitsTeammates: (threadId: string) => awaiting && threadId === "task-1" },
    store: {
      setTaskParallelOf: (_b: string, _t: string, link: any) => { task.parallelOf = link; },
      taskByThread: () => ({ threadId: "main" }),
      messagesFor: () => [{ id: "m-1", kind: "text" }],
      appendMessage: (threadId: string, message: any) => appended.push({ threadId, ...message }),
      setTaskClosedBy: () => {},
    },
    redactSecretsInText: (text: string) => text,
    patchParallelCard: () => {},
    markTaskContextExternallyUpdated: () => {},
    drainQueuedSends: () => {},
  };
  return { host, appended, task, setAwaiting: (value: boolean) => { awaiting = value; } };
}

describe("settleParallelTask (#2808)", () => {
  it("keeps a task running while its teammates still work, then answers with the final reply", () => {
    const world = fakeHost(true);
    const settle = createSettleParallelTask(() => world.host);
    settle("task-1", { ok: true, reply: "I asked Nova, I'll report back." });
    expect(world.appended).toHaveLength(0);
    expect(world.task.parallelOf.reportedAt).toBeUndefined();
    world.setAwaiting(false);
    settle("task-1", { ok: true, reply: "Nova proposes three slogans." });
    expect(world.appended).toHaveLength(1);
    expect(world.appended[0]).toMatchObject({ threadId: "main", parallelTask: { role: "result", state: "done" } });
    expect(world.appended[0].text).toContain("Nova proposes three slogans.");
  });

  it("a relayed teammate reply settles at once", () => {
    const world = fakeHost(true);
    createSettleParallelTask(() => world.host)("task-1", { ok: true, final: true, reply: "Le pain qui réveille." });
    expect(world.appended[0].text).toContain("Le pain qui réveille.");
  });

  it("a failed or stopped task settles even while teammates work", () => {
    const failed = fakeHost(true);
    createSettleParallelTask(() => failed.host)("task-1", { ok: false, reply: "", why: "boom" });
    expect(failed.appended[0].parallelTask.state).not.toBe("done");
    const stopped = fakeHost(true);
    stopped.host.parallelStops.add("task-1");
    createSettleParallelTask(() => stopped.host)("task-1", { ok: true, reply: "" });
    expect(stopped.appended).toHaveLength(1);
  });

  it("the start fallback leaves a task alone while its teammates work", () => {
    vi.useFakeTimers();
    try {
      const world = fakeHost(true);
      world.host.threadBusy = () => false;
      world.host.hasQueuedSteeredMessages = () => false;
      world.host.store.messagesFor = () => [];
      world.host.settleParallelTask = createSettleParallelTask(() => world.host);
      const fallback = createSettleParallelFallback(() => world.host);
      fallback("task-1");
      vi.runAllTimers();
      expect(world.appended).toHaveLength(0);
      world.setAwaiting(false);
      fallback("task-1");
      vi.runAllTimers();
      expect(world.appended[0].parallelTask.state).toBe("failed");
    } finally {
      vi.useRealTimers();
    }
  });
});
