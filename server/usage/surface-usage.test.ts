import { describe, expect, it } from "vitest";

import { foldSurfaceUsage, SURFACE_USAGE_LABEL } from "./surface-usage.ts";
import type { UsageRow } from "./usage-ledger.ts";

const row = (extra: Partial<UsageRow>): UsageRow => ({
  at: "2026-11-17T14:03:11.000Z", botId: "sb", botName: "Desk", threadId: "t1", instanceId: "claude", driverKind: "claudeAgent", model: "m",
  input: 10, output: 5, costUsd: 0.5, costSource: "reported", trigger: { kind: "user", principalId: "pr_bob" }, ownerPrincipalId: "pr_bob", surface: true, ...extra,
});

describe("lot S1: a surface bot's usage as others read it", () => {
  const rows = [
    row({}),
    row({ at: "2026-11-17T18:00:00.000Z", threadId: "t2", input: 1, output: 1, costUsd: 0.25 }),
    row({ model: "other", threadId: "t3" }),
    row({ botId: "orion", botName: "Orion", surface: undefined }),
  ];
  it("folds another person's into one row per day and model, with no conversation, bot or time", () => {
    const seen = foldSurfaceUsage(rows, null);
    expect(seen).toHaveLength(3);
    expect(seen[0]).toMatchObject({ at: "2026-11-17T00:00:00.000Z", botId: "", botName: SURFACE_USAGE_LABEL, threadId: "", model: "m", input: 11, output: 6, costUsd: 0.75, ownerPrincipalId: "pr_bob" });
    expect(seen[1]).toMatchObject({ model: "other", threadId: "" });
    expect(seen[2]).toMatchObject({ botId: "orion", threadId: "t1" });
    expect(JSON.stringify(seen)).not.toContain("t2");
    expect(JSON.stringify(foldSurfaceUsage(rows, "pr_ann"))).not.toContain("\"sb\"");
  });
  it("leaves the person every row of their own", () => {
    expect(foldSurfaceUsage(rows, "PR_BOB")).toEqual(rows);
  });
});
