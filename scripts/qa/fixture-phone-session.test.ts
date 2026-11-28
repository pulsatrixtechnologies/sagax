// #5534: the fixture phone session proves M-1 to M-4 without a real device.
import { describe, expect, it } from "vitest";

import { runFixturePhoneSession } from "./fixture-phone-session.ts";

describe("fixture phone session (M-1 to M-4)", () => {
  it("pairs a phone session and passes every mobile conversation sub-case", async () => {
    const report = await runFixturePhoneSession();
    expect(report.device).toBe("fixture-phone");
    expect(report.cases.map((entry) => entry.id)).toEqual(["M-1", "M-2", "M-3", "M-4"]);
    const failed = report.cases.filter((entry) => !entry.ok).map((entry) => `${entry.id}: ${entry.detail}`);
    expect(failed, JSON.stringify(report.cases, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
  }, 300_000);
});
