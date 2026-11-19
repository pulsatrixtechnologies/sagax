import { describe, expect, it } from "vitest";

import { createSweepTemporaryAgents } from "./sweepTemporaryAgents.ts";

const HOUR = 3_600_000;

function host(bots: Array<Record<string, unknown>>) {
  const deleted: string[] = [];
  return {
    deleted,
    host: {
      archiveMark: (_by: unknown, _reason: unknown, now: number) => ({ at: now, by: { kind: "system" }, reason: "expired", purgeAt: now + 30 * 24 * HOUR }),
      store: { bots, tasks: () => [], setBotTemporary: () => {} },
      threadBusy: () => false,
      botLastActivity: () => 0,
      deleteBotWithLifecycle: async (id: string) => { deleted.push(id); return { status: 200 }; },
      temporaryAudit: () => {},
    },
  };
}

describe("sweepTemporaryAgents: no rule on a bot's name", () => {
  it("keeps an MCP temporary agent named like a test until its own retention ends", async () => {
    const now = 10 * HOUR;
    const archived = { at: 1, by: { kind: "system" }, reason: "expired", purgeAt: now * 100 };
    const temporary = { via: "mcp", createdAt: 0, ownerPrincipalId: "pr_1", createdBy: { kind: "person", principalId: "pr_1" }, idleHours: 24, lastActiveAt: 0 };
    const fake = host([
      { id: "a", name: "perf-test-061", busy: false, temporary: { ...temporary, archived } },
      { id: "b", name: "perf-test-062", busy: false, temporary },
    ]);
    await createSweepTemporaryAgents(() => fake.host)(now);
    expect(fake.deleted).toEqual([]);
    // its retention over, it goes like any other archived agent
    await createSweepTemporaryAgents(() => fake.host)(now * 100);
    expect(fake.deleted).toEqual(["a"]);
  });
});
