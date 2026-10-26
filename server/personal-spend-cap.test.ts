import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertWithinBudget, resetSpendAlertsForTests, resetSpendCacheForTests } from "./spend.ts";
import { setPersonalCapOrganization, clearPersonalCap, personalCapAlert, personalCapState, readPersonalCap, writePersonalCap, MIN_PERSONAL_CAP_USD } from "./personal-spend-cap.ts";
import { removeTempDir } from "./testing/cleanup.ts";
import { appendUsage, flushUsageLedger } from "./usage-ledger.ts";

describe("personal monthly spend cap", () => {
  let dataDir: string;
  const now = new Date("2026-10-15T12:00:00Z");
  beforeEach(() => { dataDir = mkdtempSync(join(tmpdir(), "sagax-personal-cap-")); resetSpendCacheForTests(); resetSpendAlertsForTests(); });
  afterEach(async () => { await removeTempDir(dataDir); });

  const book = async (costUsd: number) => {
    appendUsage(dataDir, {
      at: "2026-10-10T00:00:00.000Z", botId: "b", botName: "B", threadId: "t", instanceId: "claude", driverKind: "claudeAgent",
      model: "m", input: 1, output: 1, costUsd, trigger: { kind: "owner" },
    });
    await flushUsageLedger(dataDir);
  };

  it("has no cap until one is set, then keeps it across reads and can remove it", () => {
    expect(readPersonalCap(dataDir)).toBeNull();
    expect(personalCapState(dataDir, now)).toBeNull();
    writePersonalCap(dataDir, 25);
    expect(readPersonalCap(dataDir)).toBe(25);
    clearPersonalCap(dataDir);
    expect(readPersonalCap(dataDir)).toBeNull();
  });

  it("ignores a leftover file on an organization server", async () => {
    writePersonalCap(dataDir, 1);
    await book(5);
    setPersonalCapOrganization(true);
    try {
      expect(readPersonalCap(dataDir)).toBeNull();
      expect(personalCapState(dataDir, now)).toBeNull();
      expect(() => assertWithinBudget({}, dataDir, now, () => false)).not.toThrow();
      expect(personalCapAlert(dataDir, now)).toBeNull();
    } finally {
      setPersonalCapOrganization(false);
    }
  });

  it("refuses a cap under the minimum or not a number", () => {
    expect(MIN_PERSONAL_CAP_USD).toBe(1);
    expect(() => writePersonalCap(dataDir, 0.5)).toThrow(/at least/);
    expect(() => writePersonalCap(dataDir, Number.NaN)).toThrow();
  });

  it("blocks a new turn once the month reaches the cap, with the spend_cap code, and lets the owner raise it", async () => {
    writePersonalCap(dataDir, 5);
    await book(4);
    expect(() => assertWithinBudget({}, dataDir, now, () => false)).not.toThrow();
    expect(personalCapState(dataDir, now)).toMatchObject({ monthlyUsd: 5, spentUsd: 4, percent: 80, exceeded: false });
    await book(1.5);
    resetSpendCacheForTests();
    let error: unknown;
    try { assertWithinBudget({}, dataDir, now, () => false); } catch (caught) { error = caught; }
    expect(error).toMatchObject({ status: 409, code: "spend_cap" });
    expect(String((error as Error).message)).toContain("personal");
    writePersonalCap(dataDir, 50);
    expect(() => assertWithinBudget({}, dataDir, now, () => false)).not.toThrow();
  });

  it("raises one notice at the warning line and one at the cap per month", async () => {
    writePersonalCap(dataDir, 10);
    await book(8.5);
    expect(personalCapAlert(dataDir, now)).toBe("warn");
    expect(personalCapAlert(dataDir, now)).toBeNull();
    await book(2);
    resetSpendCacheForTests();
    expect(personalCapAlert(dataDir, now)).toBe("cap");
    expect(personalCapAlert(dataDir, now)).toBeNull();
  });
});
