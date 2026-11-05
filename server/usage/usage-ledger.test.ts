import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { removeTempDir } from "../testing/cleanup.ts";
import {
  aggregateOrgUsage,
  appendUsage,
  orgUsageSpeaker,
  parseOrgUsageRange,
  flushUsageLedger,
  parseUsageRange,
  readUsage,
  summarizeUsage,
  triggerKey,
  triggerLabel,
  usageCsv,
  usageFileFor,
  usageRowsFor,
  type UsageRow,
} from "./usage-ledger.ts";
import { usageViewerOf } from "../routes/usage.ts";

function row(overrides: Partial<UsageRow> = {}): Omit<UsageRow, "at"> & { at?: string } {
  return {
    botId: "b1",
    botName: "Scout",
    threadId: "t1",
    instanceId: "claude",
    driverKind: "claudeAgent",
    model: "claude-sonnet-5",
    input: 1200,
    output: 300,
    cachedInput: 900,
    costUsd: 0.012,
    trigger: { kind: "user", email: "ada@example.test", label: "Ada's laptop" },
    ...overrides,
  };
}

describe("usage ledger per-model split", () => {
  const mixed = row({
    model: "big-model",
    input: 1000,
    output: 100,
    cachedInput: 600,
    costUsd: 0.5,
    models: [
      { model: "big-model", inputTokens: 100, outputTokens: 80, cachedInputTokens: 600, cacheWriteTokens: 100, costUsd: 0.4 },
      { model: "small-model", inputTokens: 200, outputTokens: 20, costUsd: 0.1 },
    ],
  }) as UsageRow;

  it("groups a mixed turn by each model with its own tokens and cost, and by anything else as one row", () => {
    const byModel = summarizeUsage([mixed, row({ at: "2026-09-03T10:00:00.000Z" }) as UsageRow], "model");
    const big = byModel.groups.find((g) => g.label === "big-model")!;
    expect(big).toMatchObject({ turns: 1, input: 800, output: 80, cachedInput: 600, costUsd: 0.4 });
    expect(byModel.groups.find((g) => g.label === "small-model")).toMatchObject({ turns: 1, input: 200, output: 20, costUsd: 0.1 });
    expect(byModel.total).toMatchObject({ turns: 2, input: 2200, costUsd: 0.512 });
    expect(summarizeUsage([mixed], "bot").groups).toHaveLength(1);
  });

  it("keeps old rows and rows with an unreadable split grouped by their model", () => {
    const broken = row({ model: "solo-model", models: [{ model: "x" }] as never }) as UsageRow;
    const groups = summarizeUsage([row() as UsageRow, broken], "model").groups.map((g) => g.label).sort();
    expect(groups).toEqual(["claude-sonnet-5", "solo-model"]);
  });

  it("writes the split to the file, reads it back, and adds a models column to the CSV", async () => {
    const dir = mkdtempSync(join(tmpdir(), "omb-usage-"));
    try {
      appendUsage(dir, { ...mixed, at: "2026-09-03T10:00:00.000Z" });
      await flushUsageLedger(dir);
      const [back] = readUsage(dir, { from: new Date("2026-09-01T00:00:00Z"), to: new Date("2026-09-30T00:00:00Z") });
      expect(back?.models).toHaveLength(2);
      const csv = usageCsv([back!]).split("\n");
      expect(csv[0]).toMatch(/,thread,models$/);
      expect(csv[1]).toContain('""model"":""small-model""');
    } finally {
      await removeTempDir(dir);
    }
  });
});

describe("usage ledger files", () => {
  let dataDir: string;
  beforeEach(() => { dataDir = mkdtempSync(join(tmpdir(), "omb-usage-")); });
  afterEach(async () => { await removeTempDir(dataDir); });

  it("appends one private row per turn into the month's file and reads it back in order", async () => {
    appendUsage(dataDir, row({ at: "2026-09-03T10:00:00.000Z" }));
    appendUsage(dataDir, row({ at: "2026-09-03T11:00:00.000Z", botId: "b2", botName: "Clerk", costUsd: null }));
    appendUsage(dataDir, row({ at: "2026-10-01T00:00:00.000Z", botId: "b3", botName: "Later" }));
    await flushUsageLedger(dataDir);
    const september = usageFileFor(dataDir, new Date("2026-09-15T00:00:00Z"));
    expect(september.endsWith(join("usage", "2026-09.jsonl"))).toBe(true);
    expect(readFileSync(september, "utf8").trim().split("\n")).toHaveLength(2);
    if (process.platform !== "win32") {
      expect(statSync(september).mode & 0o777).toBe(0o600);
      expect(statSync(join(dataDir, "usage")).mode & 0o777).toBe(0o700);
    }
    const rows = readUsage(dataDir, { from: new Date("2026-09-01T00:00:00Z"), to: new Date("2026-10-31T23:59:59Z") });
    expect(rows.map((r) => r.botId)).toEqual(["b1", "b2", "b3"]);
    expect(rows[1]!.costUsd).toBeNull();
    // a cost is labelled with where it came from; an unpriced row has no label
    expect(rows[0]!.costSource).toBe("reported");
    expect(rows[1]).not.toHaveProperty("costSource");
  });

  it("carries the prompt byte split when present and drops malformed values", async () => {
    appendUsage(dataDir, row({ at: "2026-09-03T10:00:00.000Z", promptBytes: { stable: 21_396, volatile: 8_102 } }));
    appendUsage(dataDir, row({ at: "2026-09-03T11:00:00.000Z", promptBytes: { stable: -4, volatile: "big" } as unknown as { stable: number; volatile: number } }));
    await flushUsageLedger(dataDir);
    const rows = readUsage(dataDir, { from: new Date("2026-09-01T00:00:00Z"), to: new Date("2026-09-30T23:59:59Z") });
    expect(rows[0]!.promptBytes).toEqual({ stable: 21_396, volatile: 8_102 });
    expect(rows[1]).not.toHaveProperty("promptBytes");
  });

  it("stores an estimate as such, and drops a label that has no cost behind it", async () => {
    appendUsage(dataDir, row({ at: "2026-09-03T10:00:00.000Z", costUsd: 0.25, costSource: "estimated" }));
    appendUsage(dataDir, row({ at: "2026-09-03T11:00:00.000Z", costUsd: null, costSource: "estimated" }));
    await flushUsageLedger(dataDir);
    const rows = readUsage(dataDir, { from: new Date("2026-09-01T00:00:00Z"), to: new Date("2026-09-30T23:59:59Z") });
    expect(rows[0]).toMatchObject({ costUsd: 0.25, costSource: "estimated" });
    expect(rows[1]!.costUsd).toBeNull();
    expect(rows[1]).not.toHaveProperty("costSource");
  });

  it("filters by time, skips torn lines and foreign rows, and never stores a negative or fractional token", async () => {
    appendUsage(dataDir, row({ at: "2026-09-03T10:00:00.000Z", input: -5, output: 12.7, cachedInput: Number.NaN, costUsd: -1 }));
    await flushUsageLedger(dataDir);
    const file = usageFileFor(dataDir, new Date("2026-09-03T00:00:00Z"));
    writeFileSync(file, readFileSync(file, "utf8") + '{"at":"2026-09-04T00:00:00.000Z","botId":"x"' + "\n" + JSON.stringify({ unrelated: true }) + "\n", { flag: "w" });
    const rows = readUsage(dataDir, { from: new Date("2026-09-01T00:00:00Z"), to: new Date("2026-09-30T23:59:59Z") });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ input: 0, output: 12, cachedInput: 0, costUsd: null });
    expect(readUsage(dataDir, { from: new Date("2026-09-04T00:00:00Z"), to: new Date("2026-09-30T23:59:59Z") })).toHaveLength(0);
  });

  it("keeps a full disk or a missing directory from failing the turn", async () => {
    appendUsage(join(dataDir, "missing-file-as-dir"), row());
    writeFileSync(join(dataDir, "blocked"), "not a directory");
    appendUsage(join(dataDir, "blocked"), row());
    await expect(flushUsageLedger(join(dataDir, "blocked"))).resolves.toBeUndefined();
    expect(existsSync(join(dataDir, "blocked", "usage"))).toBe(false);
  });
});

describe("usage ranges", () => {
  const now = new Date("2026-09-15T12:00:00Z");

  it("defaults to the month to date and accepts inclusive day bounds", () => {
    expect(parseUsageRange(undefined, undefined, now)).toEqual({ from: new Date("2026-09-01T00:00:00Z"), to: now });
    const range = parseUsageRange("2026-08-01", "2026-08-31", now)!;
    expect(range.from.toISOString()).toBe("2026-08-01T00:00:00.000Z");
    expect(range.to.toISOString()).toBe("2026-08-31T23:59:59.999Z");
  });

  it("rejects malformed, impossible, reversed, or year-long ranges", () => {
    expect(parseUsageRange("2026-8-1", undefined, now)).toBeNull();
    expect(parseUsageRange("2026-02-31", undefined, now)).toBeNull();
    expect(parseUsageRange("2026-09-10", "2026-09-01", now)).toBeNull();
    expect(parseUsageRange("2025-01-01", "2026-09-01", now)).toBeNull();
    expect(parseUsageRange("2025-09-10", "2026-09-10", now)).not.toBeNull();
  });
});

describe("usage summaries", () => {
  const rows: UsageRow[] = [
    { ...row({ at: "2026-09-01T10:00:00.000Z" }), at: "2026-09-01T10:00:00.000Z" } as UsageRow,
    { ...row({ at: "2026-09-01T11:00:00.000Z", botId: "b2", botName: "Clerk", model: "gpt-5", driverKind: "codex", costUsd: null, trigger: { kind: "owner" } }), at: "2026-09-01T11:00:00.000Z" } as UsageRow,
    { ...row({ at: "2026-09-02T09:00:00.000Z", input: 100, output: 50, cachedInput: 0, costUsd: 0.5, trigger: { kind: "routine", routineId: "r1", label: "Morning digest" } }), at: "2026-09-02T09:00:00.000Z" } as UsageRow,
    { ...row({ at: "2026-09-02T10:00:00.000Z", botId: "b2", botName: "Clerk", costUsd: 0.001, trigger: { kind: "bot", botId: "b1" } }), at: "2026-09-02T10:00:00.000Z" } as UsageRow,
  ];

  it("groups by bot, money first, and counts unpriced rows instead of hiding them", () => {
    const summary = summarizeUsage(rows, "bot");
    expect(summary.groups.map((g) => [g.label, g.turns, g.costUsd, g.unpriced])).toEqual([
      ["Scout", 2, 0.512, 0],
      ["Clerk", 2, 0.001, 1],
    ]);
    expect(summary.total).toMatchObject({ turns: 4, input: 1200 + 1200 + 100 + 1200, output: 300 + 300 + 50 + 300, cachedInput: 900 * 3, unpriced: 1 });
    expect(summary.total.costUsd).toBeCloseTo(0.513, 6);
  });

  it("groups by person with stable keys, by model, by engine, and by day in date order", () => {
    expect(summarizeUsage(rows, "user").groups.map((g) => [g.key, g.label])).toEqual([
      ["routine:r1", "Routine: Morning digest"],
      ["user:ada@example.test", "ada@example.test"],
      ["bot", "Bot to bot"],
      ["owner", "This computer"],
    ]);
    expect(summarizeUsage(rows, "model").groups.map((g) => g.key)).toEqual(["model:claudeAgent/claude-sonnet-5", "model:codex/gpt-5"]);
    expect(summarizeUsage(rows, "engine").groups.map((g) => g.label)).toEqual(["claudeAgent", "codex"]);
    expect(summarizeUsage(rows, "day").groups.map((g) => [g.label, g.turns])).toEqual([["2026-09-01", 2], ["2026-09-02", 2]]);
    expect(summarizeUsage([], "day")).toEqual({ groups: [], total: expect.objectContaining({ turns: 0, costUsd: null }) });
  });

  it("groups by routine, with every non-routine turn in one manual bucket", () => {
    const summary = summarizeUsage(rows, "routine");
    expect(summary.groups.map((g) => [g.key, g.label, g.turns, g.costUsd])).toEqual([
      ["routine:r1", "Morning digest", 1, 0.5],
      ["manual", "Not from a routine", 3, expect.closeTo(0.013, 6)],
    ]);
    expect(summary.total.turns).toBe(4);
  });

  it("prices groups from the operator's list and adds a billable column to the CSV only then", () => {
    const prices = { default: { inputPerMillion: 1000, outputPerMillion: 2000 }, "codex/gpt-5": { inputPerMillion: 0, outputPerMillion: 0 } };
    const priced = summarizeUsage(rows, "bot", prices);
    // Scout: one claude turn of 1200 in (900 cached at the input rate) / 300 out, one of 100 / 50
    expect(priced.groups[0]!.billableUsd).toBeCloseTo((1200 * 1000 + 300 * 2000) / 1e6 + (100 * 1000 + 50 * 2000) / 1e6, 9);
    // Clerk: one gpt-5 turn priced at zero, one claude turn at the default
    expect(priced.groups[1]!.billableUsd).toBeCloseTo((1200 * 1000 + 300 * 2000) / 1e6, 9);
    expect(priced.total.billableUsd).toBeCloseTo(priced.groups[0]!.billableUsd! + priced.groups[1]!.billableUsd!, 9);
    expect(summarizeUsage(rows, "bot").total.billableUsd).toBeNull();
    expect(usageCsv([rows[0]!], prices).split("\n")[0]).toContain(",cost_usd,cost_source,billable_usd,thread");
    expect(usageCsv([rows[0]!], prices).split("\n")[1]).toContain(",0.012,reported,1.8,t1");
    expect(usageCsv([rows[0]!]).split("\n")[0]).not.toContain("billable_usd");
  });

  it("names a person by email before device label and never throws on an empty trigger", () => {
    expect(triggerLabel({ kind: "user", label: "Phone" })).toBe("Phone");
    expect(triggerKey({ kind: "user", email: "Ada@Example.test" })).toBe("user:ada@example.test");
    expect(triggerKey({ kind: "user" })).toBe("user:unknown");
    expect(triggerLabel({ kind: "routine" })).toBe("Routine: unknown");
  });

  it("exports spreadsheet-safe CSV with one line per turn", () => {
    const csv = usageCsv([
      rows[0]!,
      { ...rows[1]!, botName: '=HYPERLINK("x")', trigger: { kind: "user", email: "a,b@example.test" } },
    ]);
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("time,bot,model,engine,triggered_by,input_tokens,output_tokens,cached_input_tokens,cost_usd,cost_source,thread");
    expect(lines[1]).toBe("2026-09-01T10:00:00.000Z,Scout,claude-sonnet-5,claudeAgent,ada@example.test,1200,300,900,0.012,reported,t1");
    expect(lines[2]).toContain("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(lines[2]).toContain('"a,b@example.test"');
    expect(lines[2]).toMatch(/,,,t1$/);
    expect(usageCsv([{ ...rows[0]!, costSource: "estimated" }]).split("\n")[1]).toContain(",0.012,estimated,t1");
  });

  it("keeps estimates apart from reported cost, and reads rows written before estimates existed as reported", () => {
    const estimated = { ...rows[1]!, costUsd: 0.2, costSource: "estimated" as const };
    const legacy = { ...rows[0]! }; // costUsd 0.012, no costSource
    const summary = summarizeUsage([legacy, estimated, rows[2]!], "bot");
    expect(summary.total.costUsd).toBeCloseTo(0.712, 9);
    expect(summary.total.estimatedUsd).toBeCloseTo(0.2, 9);
    expect(summary.total.unpriced).toBe(0);
    const clerk = summary.groups.find((g) => g.label === "Clerk")!;
    expect(clerk).toMatchObject({ costUsd: 0.2, estimatedUsd: 0.2 });
    expect(summary.groups.find((g) => g.label === "Scout")!.estimatedUsd).toBeNull();
    // an unpriced row is still counted as unpriced, never as a $0 estimate
    expect(summarizeUsage([rows[1]!], "bot").total).toMatchObject({ costUsd: null, estimatedUsd: null, unpriced: 1 });
  });
});

describe("organization admin usage (slice 7)", () => {
  const base = (over: Partial<UsageRow>): UsageRow => ({ ...(row() as UsageRow), cachedInput: 0, at: "2026-09-10T12:00:00.000Z", ...over });
  const P1 = "pr_00000000-0000-4000-8000-000000000001";
  const P2 = "pr_00000000-0000-4000-8000-000000000002";

  it("names the speaker by principal, routine runAs, bot or nobody", () => {
    expect(orgUsageSpeaker({ trigger: { kind: "user", principalId: P1, label: "x" } })).toEqual({ kind: "person", principalId: P1 });
    expect(orgUsageSpeaker({ trigger: { kind: "user", email: "a@example.test" } })).toEqual({ kind: "unattributed" });
    expect(orgUsageSpeaker({ trigger: { kind: "routine", routineId: "r1", runAsPrincipalId: P2 } })).toEqual({ kind: "routine", routineId: "r1", runAsPrincipalId: P2 });
    expect(orgUsageSpeaker({ trigger: { kind: "routine", routineId: "r1" } })).toEqual({ kind: "routine", routineId: "r1", runAsPrincipalId: null });
    expect(orgUsageSpeaker({ trigger: { kind: "bot", botId: "b2" } })).toEqual({ kind: "bot", botId: "b2" });
    expect(orgUsageSpeaker({ trigger: { kind: "owner" } })).toEqual({ kind: "unattributed" });
  });

  it("2026-10-01: counts the speaker's own key apart, keeps the console's keys, and drops an unknown value to unknown", () => {
    const rows = [
      base({ trigger: { kind: "user", principalId: P1 }, access: "speaker-key", payerPrincipalId: P1, ownerPrincipalId: P2 }),
      base({ trigger: { kind: "user", principalId: P1 }, access: "subscription", payerPrincipalId: P1, ownerPrincipalId: P2 }),
      base({ trigger: { kind: "user", principalId: P1 }, access: "org-key", ownerPrincipalId: P2 }),
      base({ trigger: { kind: "user", principalId: P1 }, access: "bogus" as never, ownerPrincipalId: P2 }),
    ];
    const [row] = aggregateOrgUsage(rows, () => true).rows;
    // every key the Perspicax console reads is still there (sagax-usage.tsx)
    expect(row!.access).toEqual({ subscription: 1, "owner-key": 0, "speaker-key": 1, "org-key": 1, server: 0, unknown: 1 });
  });

  it("groups by day, bot and speaker with the access split, and filters by reach", () => {
    const rows = [
      base({ trigger: { kind: "user", principalId: P1 }, input: 10, output: 5, cachedInput: 2, costUsd: 0.1, costSource: "reported", access: "owner-key", ownerPrincipalId: P2 }),
      base({ trigger: { kind: "user", principalId: P1 }, input: 1, output: 1, costUsd: 0.05, costSource: "estimated", access: "server", ownerPrincipalId: P2 }),
      base({ trigger: { kind: "user", principalId: P1 }, at: "2026-09-11T00:00:00.000Z", ownerPrincipalId: P2 }),
      base({ trigger: { kind: "routine", routineId: "r1", runAsPrincipalId: P2 }, ownerPrincipalId: P2, access: "subscription" }),
      base({ trigger: { kind: "owner" } }),
    ];
    const all = aggregateOrgUsage(rows, () => true);
    expect(all.truncated).toBe(false);
    expect(all.rows).toHaveLength(4);
    expect(all.rows[0]).toMatchObject({ day: "2026-09-10", botId: "b1", speaker: { kind: "person", principalId: P1 }, turns: 2, input: 11, output: 6, cachedInput: 2, ownerPrincipalId: P2, access: { "owner-key": 1, server: 1, unknown: 0 } });
    expect(all.rows[0]!.costUsd).toBeCloseTo(0.15);
    expect(all.rows[0]!.estimatedUsd).toBeCloseTo(0.05);
    expect(all.rows.find((r) => r.speaker.kind === "unattributed")).toMatchObject({ ownerPrincipalId: null, access: { unknown: 1 } });
    // a manager reaching P1 only: P1's rows; the routine of P2 and the unattributed row go
    const reach = new Set([P1]);
    const narrowed = aggregateOrgUsage(rows, ({ speaker, ownerPrincipalId }) => speaker.kind === "unattributed" ? false
      : speaker.kind === "person" ? reach.has(speaker.principalId) : reach.has(ownerPrincipalId ?? ""));
    expect(narrowed.rows.map((r) => r.speaker.kind)).toEqual(["person", "person"]);
    // the row cap truncates
    expect(aggregateOrgUsage(rows, () => true, 2)).toMatchObject({ truncated: true });
  });

  it("reads YYYY-MM-DD ranges: 30 days by default, at most 92, never reversed", () => {
    const now = new Date("2026-09-30T15:00:00.000Z");
    expect(parseOrgUsageRange(null, null, now)).toMatchObject({ fromDay: "2026-09-01", toDay: "2026-09-30" });
    expect(parseOrgUsageRange("2026-07-01", "2026-09-30", now)).toMatchObject({ fromDay: "2026-07-01" });
    expect(parseOrgUsageRange("2026-06-30", "2026-09-30", now)).toBeNull();
    expect(parseOrgUsageRange("2026-09-30", "2026-09-01", now)).toBeNull();
    expect(parseOrgUsageRange("2026-9-1", null, now)).toBeNull();
    expect(parseOrgUsageRange("2026-02-31", null, now)).toBeNull();
  });

  it("keys a person by principal when the row names one", () => {
    expect(triggerKey({ kind: "user", principalId: P1, email: "a@example.test" })).toBe(`principal:${P1}`);
    expect(triggerKey({ kind: "user", email: "A@example.test" })).toBe("user:a@example.test");
  });
});

// Settings > Usage shows the person's own usage only (2026-10-14).
describe("usage of the person asking (?mine=1)", () => {
  const at = "2026-10-14T12:00:00.000Z";
  const rows = [
    { ...row({ trigger: { kind: "owner" } }), at },
    { ...row({ trigger: { kind: "user", principalId: "p-ada" } }), at },
    { ...row({ trigger: { kind: "user", email: "Bob@Example.com" } }), at },
    { ...row({ trigger: { kind: "routine", routineId: "r1", runAsPrincipalId: "p-ada" } }), at },
    { ...row({ trigger: { kind: "routine", routineId: "r2" } }), at },
    { ...row({ trigger: { kind: "bot", botId: "b2" } }), at },
  ] as UsageRow[];
  const kinds = (list: UsageRow[]) => list.map((entry) => JSON.stringify(entry.trigger));

  it("gives a person their own turns and the routines run as them, nobody else's", () => {
    expect(kinds(usageRowsFor(rows, { kind: "person", principalId: "p-ada" }))).toEqual([JSON.stringify(rows[1]!.trigger), JSON.stringify(rows[3]!.trigger)]);
    expect(kinds(usageRowsFor(rows, { kind: "person", email: "bob@example.com" }))).toEqual([JSON.stringify(rows[2]!.trigger)]);
    expect(usageRowsFor(rows, { kind: "person", principalId: "p-nobody" })).toEqual([]);
  });

  it("gives the operator every turn no signed-in person asked for", () => {
    expect(kinds(usageRowsFor(rows, { kind: "operator" }))).toEqual([rows[0], rows[4], rows[5]].map((entry) => JSON.stringify(entry!.trigger)));
  });

  it("reads who asks from the request", () => {
    expect(usageViewerOf({ kind: "loopback", scopes: ["admin", "client"] })).toEqual({ kind: "operator" });
    expect(usageViewerOf({ kind: "session", via: "cookie", scopes: ["admin"], session: { principalId: "p-ada" } as never })).toEqual({ kind: "person", principalId: "p-ada", email: undefined });
    expect(usageViewerOf({ kind: "session", via: "bearer", scopes: ["admin"], session: {} as never })).toEqual({ kind: "operator" });
  });
});
