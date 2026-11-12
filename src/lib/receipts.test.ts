import { describe, expect, it } from "vitest";

import { lastNonReceipt, lastSpokenLine } from "./receipts";

describe("lastNonReceipt", () => {
  it("reads past digests, compactions and a stored stop notice", () => {
    const reply = { kind: "text", text: "done" };
    const stopped = { kind: "activity", tool: { name: "error: turn stopped", ok: false } };
    expect(lastNonReceipt([reply, stopped, { kind: "digest" }, { kind: "compaction" }])).toBe(reply);
  });

  it("reads past every hidden Workspace line and technical notice, never past one that asks the person", () => {
    const reply = { kind: "text", text: "done" };
    const here = { kind: "activity", tool: { name: "notice: Workspace: On your computer", ok: true } };
    const cloud = { kind: "activity", tool: { name: "notice: Workspace: In the cloud", ok: true } };
    const skipped = { kind: "activity", tool: { name: 'notice: MCP server "slack" was skipped for this turn: 401', ok: true } };
    const asks = { kind: "activity", tool: { name: "notice: Waiting for 1Password: approve the request in 1Password on your computer.", ok: true } };
    expect(lastNonReceipt([reply, here])).toBe(reply);
    expect(lastNonReceipt([reply, cloud])).toBe(reply);
    expect(lastNonReceipt([reply, skipped])).toBe(reply);
    expect(lastNonReceipt([reply, asks])).toBe(asks);
  });

  it("keeps a real failure as the last row", () => {
    const failure = { kind: "activity", tool: { name: "error: engine missing", ok: false } };
    expect(lastNonReceipt([{ kind: "text" }, failure])).toBe(failure);
  });
});

describe("lastSpokenLine (#3990)", () => {
  it("never previews a routine run's row the chat no longer draws", () => {
    const reply = { kind: "text", text: "Here is the plan." };
    const problems = { kind: "routine.run", routineRun: { status: "completed", summary: "Nothing urgent.", problems: "a step failed" } };
    const worksAgain = { kind: "routine.run", routineRun: { status: "completed", summary: "Sorted.", recovered: { afterRuns: 2, since: 1 } } };
    expect(lastSpokenLine([reply, problems, worksAgain])).toBe(reply);
    const result = { kind: "routine.run", routineRun: { status: "completed", summary: "Three meetings today." } };
    expect(lastSpokenLine([reply, result])).toBe(result);
  });
});
