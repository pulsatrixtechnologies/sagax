// What is left of the delegation ledger (server/delegation-receipts.ts):
// the receipt drawer, the one-time hand-over of an older release's queue,
// and the pure wake and status helpers.
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  buildDelegationFailurePrompt,
  buildDelegationRevivalPrompt,
  DELEGATION_WAKE_MAX_PER_WINDOW,
  DELEGATION_WAKE_WINDOW_MS,
  DelegationWakeBudget,
  findDelegationReceipt,
  formatDelegationElapsed,
  loadDelegationReceipts,
  recordDelegationReceipt,
  summarizeDelegatedActivity,
  takeLegacyDelegations,
} from "./delegation-receipts.ts";
import { DATA_DIR } from "./config.ts";
import { removeTempDir } from "./testing/cleanup.ts";

describe("receipts", () => {
  it("persists receipts across a restart and prunes the drawer by count", () => {
    mkdirSync(DATA_DIR, { recursive: true });
    recordDelegationReceipt({ id: "task-one", sourceThreadId: "source", toBotId: "target", toBotName: "Helper", status: "done", result: "the reply text" });
    // a fresh process loads what the last one recorded
    loadDelegationReceipts();
    expect(findDelegationReceipt("task-one")).toMatchObject({ status: "done", result: "the reply text" });
    for (let index = 0; index < 105; index++) {
      recordDelegationReceipt({ id: `bulk-${index}`, sourceThreadId: "source", toBotId: "target", toBotName: "Helper", status: "done" });
    }
    expect(findDelegationReceipt("bulk-104")).toBeTruthy();
    expect(findDelegationReceipt("bulk-3")).toBeNull(); // oldest pruned
  });
});

describe("an older release's queue", () => {
  it("is taken once: every well-formed handoff comes back, and the file is retired", () => {
    const dir = mkdtempSync(join(tmpdir(), "legacy-delegations-"));
    try {
      const file = join(dir, "delegations.json");
      writeFileSync(file, JSON.stringify({
        "source-thread": [
          { id: "d1", sourceBotId: "chief", toBotId: "lead", message: "Build it", depth: 0, queuedAt: 1 },
          { id: "d2", sourceBotId: "chief", toBotId: "lead", message: "FYI", depth: 0, targetThreadId: "opened", oneWay: true, approvalAlreadyGranted: true },
          { id: "d3", sourceBotId: "gateway", toBotId: "lead", message: "Poll me", depth: 0, completionOwner: "external" },
          { toBotId: "lead" },
        ],
      }));
      expect(takeLegacyDelegations(file)).toEqual([
        { id: "d1", sourceThreadId: "source-thread", sourceBotId: "chief", toBotId: "lead", message: "Build it", oneWay: false, external: false, approved: false },
        { id: "d2", sourceThreadId: "source-thread", sourceBotId: "chief", toBotId: "lead", message: "FYI", targetThreadId: "opened", oneWay: true, external: false, approved: true },
        { id: "d3", sourceThreadId: "source-thread", sourceBotId: "gateway", toBotId: "lead", message: "Poll me", oneWay: false, external: true, approved: false },
      ]);
      expect(existsSync(file)).toBe(false);
      expect(existsSync(`${file}.migrated`)).toBe(true);
      expect(takeLegacyDelegations(file)).toEqual([]);
    } finally {
      removeTempDir(dir);
    }
  });
});

describe("peer wake helpers", () => {
  it("buildDelegationRevivalPrompt names the peer and instructs the source to answer", () => {
    const prompt = buildDelegationRevivalPrompt("Helper");
    expect(prompt).toContain("@Helper");
    expect(prompt).toContain("answer the user with the outcome");
    expect(prompt).toContain("Do not re-delegate the same task");
  });

  it("buildDelegationFailurePrompt carries the reason and forbids an unchanged retry", () => {
    const prompt = buildDelegationFailurePrompt("Helper", "delegated turn stalled");
    expect(prompt).toContain("@Helper");
    expect(prompt).toContain("delegated turn stalled");
    expect(prompt).toContain("tell the user what failed");
    expect(prompt).toContain("Do not re-delegate the exact same task unchanged");
  });

  it("DelegationWakeBudget caps bursts per thread and expires with the window", () => {
    let now = 1_000_000;
    const budget = new DelegationWakeBudget(() => now);

    expect(DELEGATION_WAKE_MAX_PER_WINDOW).toBe(6);
    for (let i = 0; i < 6; i++) {
      expect(budget.tryAcquire("t1")).toBe(true);
    }
    // cap reached — no further wakes within the same window
    expect(budget.tryAcquire("t1")).toBe(false);

    // a different thread has its own budget
    expect(budget.tryAcquire("t2")).toBe(true);

    // the window rolls over and the cap resets
    now += DELEGATION_WAKE_WINDOW_MS + 1;
    expect(budget.tryAcquire("t1")).toBe(true);
  });

  it("DelegationWakeBudget.reset clears the debt for a thread", () => {
    let now = 1_000_000;
    const budget = new DelegationWakeBudget(() => now);
    for (let i = 0; i < DELEGATION_WAKE_MAX_PER_WINDOW; i++) budget.tryAcquire("t1");
    expect(budget.tryAcquire("t1")).toBe(false);
    budget.reset("t1");
    expect(budget.tryAcquire("t1")).toBe(true);
  });
});

describe("delegated turn status helpers", () => {
  it("formats elapsed time compactly", () => {
    expect(formatDelegationElapsed(5_000)).toBe("5s");
    expect(formatDelegationElapsed(65_000)).toBe("65s");
    expect(formatDelegationElapsed(95_000)).toBe("1m 35s");
    expect(formatDelegationElapsed(180_000)).toBe("3m");
  });

  it("summarizeDelegatedActivity keeps only post-dispatch activity, newest last, bounded", () => {
    const messages = [
      { at: 900, kind: "text", text: "before dispatch (the user's ask)" },
      { at: 1_100, kind: "activity", tool: { name: "Delegated to @Helper: followup" } },
      { at: 1_200, kind: "text", text: "peer inbound message" },
      { at: 1_300, kind: "activity", tool: { name: "tool: Bash" } },
      { at: 1_400, kind: "text", text: "  multi  space   reply " },
      { at: 1_500, kind: "activity" },
      { at: 1_600, kind: "unknown-kind" },
    ];
    const lines = summarizeDelegatedActivity(messages, 1_000, 5);
    expect(lines).toEqual([
      "tool: Delegated to @Helper: followup",
      "text: peer inbound message",
      "tool: tool: Bash",
      "text: multi space reply",
    ]);
  });

  it("summarizeDelegatedActivity bounds the list to the newest lines", () => {
    const messages = Array.from({ length: 9 }, (_, index) => ({
      at: 1_000 + index,
      kind: "activity",
      tool: { name: `step-${index}` },
    }));
    const lines = summarizeDelegatedActivity(messages, 1_000, 3);
    expect(lines).toEqual(["tool: step-6", "tool: step-7", "tool: step-8"]);
  });
});
