import { describe, expect, it } from "vitest";

import { foldedSurfaceThreads, foldSurfaceUsage, surfaceLedger, SURFACE_USAGE_LABEL, wholeMonths } from "./surface-usage.ts";
import type { UsageRow } from "./usage-ledger.ts";

const row = (extra: Partial<UsageRow>): UsageRow => ({
  at: "2026-11-17T14:03:11.000Z", botId: "sb", botName: "Desk", threadId: "t1", instanceId: "claude", driverKind: "claudeAgent", model: "m",
  input: 10, output: 5, costUsd: 0.5, costSource: "reported", trigger: { kind: "user", principalId: "pr_bob" }, ownerPrincipalId: "pr_bob", surface: true, ...extra,
});

describe("lot S1: a surface bot's usage as others read it", () => {
  const rows = [
    row({}),
    row({ at: "2026-11-03T18:00:00.000Z", threadId: "t2", input: 1, output: 1, costUsd: 0.25 }),
    row({ model: "other", threadId: "t3" }),
    row({ at: "2026-11-20T09:00:00.000Z", botId: "orion", botName: "Orion", surface: undefined }),
  ];
  it("folds another person's into one row per month and model, with no conversation, bot, day or time", () => {
    const seen = foldSurfaceUsage(rows, null);
    expect(seen).toHaveLength(3);
    expect(seen[0]).toMatchObject({ at: "2026-11-01T00:00:00.000Z", botId: "", botName: SURFACE_USAGE_LABEL, threadId: "", model: "m", input: 11, output: 6, costUsd: 0.75, ownerPrincipalId: "pr_bob" });
    expect(seen[1]).toMatchObject({ model: "other", threadId: "" });
    expect(seen[2]).toMatchObject({ botId: "orion", threadId: "t1" });
    expect(JSON.stringify(seen)).not.toContain("t2");
    expect(JSON.stringify(seen)).not.toContain("2026-11-17");
    expect(JSON.stringify(foldSurfaceUsage(rows, "pr_ann"))).not.toContain("\"sb\"");
  });
  it("leaves the person every row of their own", () => {
    expect(foldSurfaceUsage(rows, "PR_BOB")).toEqual(rows);
    expect([...foldedSurfaceThreads(rows, "pr_bob")]).toEqual([]);
  });
  it("names the conversations whose tool calls another reader's stats leave out", () => {
    expect([...foldedSurfaceThreads(rows, null)].sort()).toEqual(["t1", "t2", "t3"]);
  });
});

describe("lot S1: no range gives less than a month of another person's chat", () => {
  const ledger: UsageRow[] = [
    row({ at: "2026-10-30T10:00:00.000Z", threadId: "o1", input: 100, output: 0, costUsd: 1 }),
    row({ at: "2026-11-02T10:00:00.000Z", threadId: "n1", input: 10, output: 0, costUsd: 0.1 }),
    row({ at: "2026-11-17T10:00:00.000Z", threadId: "n2", input: 20, output: 0, costUsd: 0.2 }),
    row({ at: "2026-11-17T11:00:00.000Z", botId: "orion", botName: "Orion", surface: undefined, input: 7, output: 0, costUsd: 0.07 }),
  ];
  const read = (range: { from: Date; to: Date }) => ledger.filter((one) => Date.parse(one.at) >= range.from.getTime() && Date.parse(one.at) <= range.to.getTime());
  const day = (from: string, to: string) => ({ from: new Date(`${from}T00:00:00.000Z`), to: new Date(`${to}T23:59:59.999Z`) });

  it("a one-day range gives the whole month, never that day's spend", () => {
    const range = day("2026-11-17", "2026-11-17");
    const seen = surfaceLedger(read(range), range, null, read);
    const chat = seen.filter((one) => one.botName === SURFACE_USAGE_LABEL);
    expect(chat).toHaveLength(1);
    expect(chat[0]).toMatchObject({ at: "2026-11-01T00:00:00.000Z", input: 30 });
    expect(chat[0]!.costUsd).toBeCloseTo(0.3, 6);
    // the other bots' rows are the range's, as read
    expect(seen.filter((one) => one.botId === "orion")).toHaveLength(1);
  });
  it("a range across two months gives both whole months", () => {
    const range = day("2026-10-31", "2026-11-02");
    const chat = surfaceLedger(read(range), range, null, read).filter((one) => one.botName === SURFACE_USAGE_LABEL);
    expect(chat.map((one) => [one.at, one.input])).toEqual([["2026-10-01T00:00:00.000Z", 100], ["2026-11-01T00:00:00.000Z", 30]]);
  });
  it("leaves the person their own rows of the range, in full", () => {
    const range = day("2026-11-17", "2026-11-17");
    expect(surfaceLedger(read(range), range, "pr_bob", read)).toEqual(read(range));
  });
  it("names the whole months a range touches", () => {
    expect(wholeMonths(day("2026-11-17", "2026-12-03"))).toEqual({ from: new Date("2026-11-01T00:00:00.000Z"), to: new Date("2026-12-31T23:59:59.999Z") });
  });
});
