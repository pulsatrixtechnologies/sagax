import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { UsageMeter } from "./usage-meter.ts";

describe("UsageMeter", () => {
  it("records nothing until the person turns it on, and stores no name", () => {
    const meter = new UsageMeter(mkdtempSync(join(tmpdir(), "usage-meter-")), () => 10);
    const scope = { organization: false } as const;
    expect(meter.read(scope)).toEqual({ enabled: false, count: 0 });
    expect(meter.record(scope, "app_opened", { surface: "desktop" })).toBe(false);
    expect(meter.read(scope).count).toBe(0);
    expect(meter.setEnabled(scope, true)).toEqual({ enabled: true, count: 0 });
    expect(meter.record(scope, "app_opened", { surface: "desktop", name: "Ada" })).toBe(false);
    expect(meter.record(scope, "bot_created", {})).toBe(true);
    expect(meter.read(scope)).toEqual({ enabled: true, count: 1 });
    expect(meter.setEnabled(scope, false).count).toBe(0);
    expect(meter.record(scope, "bot_created", {})).toBe(false);
  });
});
