import { describe, expect, it } from "vitest";
import { readQuietHours } from "../../../shared/signal-levels";
import { quietPresetOf, quietValueOf } from "./SignalSettings";

describe("quiet hours setting (#2695)", () => {
  it("stores a preset with the time zone the server reads", () => {
    const value = quietValueOf("22-07", "America/Toronto");
    expect(readQuietHours(value)).toEqual({ start: "22:00", end: "07:00", timeZone: "America/Toronto" });
    expect(quietPresetOf(value)).toBe("22-07");
    expect(quietValueOf("off")).toBeNull();
    expect(quietPresetOf("off")).toBe("off");
    expect(quietPresetOf(null)).toBe("off");
  });
});
