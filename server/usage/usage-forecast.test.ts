import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { FORECAST_ALPHA, HOUR_MS, createUsageForecast } from "./usage-forecast.ts";

// 2026-11-19 at 14:00 UTC
const START = Date.UTC(2026, 10, 19, 14, 0);
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("the usage forecast per bot and hour of the day (#5014)", () => {
  it("averages each hour of the day over the days before, an idle hour counting as zero", () => {
    const clock = { now: START };
    const forecast = createUsageForecast({ now: () => clock.now });
    // day 1: 10 units at 14:00, nothing else
    forecast.record("Server", "ada", 10, START + 5 * 60_000);
    clock.now = START + 24 * HOUR_MS;
    // the next 14:00 expects alpha * 10; 15:00 expects nothing
    expect(forecast.demand("server", 2)).toEqual([FORECAST_ALPHA * 10, 0]);
    // day 2: 20 units at 14:00
    forecast.record("server", "ada", 20, clock.now + 60_000);
    clock.now = START + 48 * HOUR_MS;
    const expected = FORECAST_ALPHA * 20 + (1 - FORECAST_ALPHA) * FORECAST_ALPHA * 10;
    expect(forecast.demand("server", 1)[0]).toBeCloseTo(expected, 9);
  });

  it("adds the payer's bots and never another payer's", () => {
    const clock = { now: START };
    const forecast = createUsageForecast({ now: () => clock.now });
    forecast.record("person:p1", "ada", 10);
    forecast.record("person:p1", "nimbus", 5);
    forecast.record("person:p2", "acme", 100);
    clock.now = START + 24 * HOUR_MS;
    expect(forecast.demand("person:p1", 1)[0]).toBeCloseTo(FORECAST_ALPHA * 15, 9);
    expect(forecast.history("person:p1")).toBe(24 * HOUR_MS);
    expect(forecast.history("person:p3")).toBe(0);
  });

  it("keeps its history on disk", () => {
    const dir = mkdtempSync(join(tmpdir(), "usage-forecast-"));
    dirs.push(dir);
    const clock = { now: START };
    const first = createUsageForecast({ dataDir: dir, now: () => clock.now });
    first.record("server", "ada", 10);
    first.scales.set("server\u0000claude", 1.5);
    first.flush();
    clock.now = START + 24 * HOUR_MS;
    const again = createUsageForecast({ dataDir: dir, now: () => clock.now });
    expect(again.demand("server", 1)[0]).toBeCloseTo(FORECAST_ALPHA * 10, 9);
    expect(again.scales.get("server\u0000claude")).toBe(1.5);
  });
});
