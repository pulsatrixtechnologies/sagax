import { describe, expect, it } from "vitest";
import { heldSignalsLine, PersonSignalGate, readQuietHours, readSignalBudget, signalLevelOfPush, SIGNAL_WINDOW_MS, withinQuietHours } from "./signal-levels.ts";

const NIGHT = JSON.stringify({ start: "22:00", end: "07:00", timeZone: "UTC" });

describe("signal levels (#2695)", () => {
  it("rates a push fyi, card or urgent", () => {
    expect(signalLevelOfPush({ kind: "approval" })).toBe("urgent");
    expect(signalLevelOfPush({ kind: "message", fromId: "p2" })).toBe("urgent");
    expect(signalLevelOfPush({ kind: "achievement" })).toBe("fyi");
    expect(signalLevelOfPush({ kind: "message" })).toBe("card");
    expect(signalLevelOfPush({ kind: "routine" })).toBe("card");
  });

  it("reads the person's preferences, defaults otherwise", () => {
    expect(readSignalBudget("10")).toBe(10);
    expect(readSignalBudget("7")).toBe(20);
    expect(readSignalBudget(undefined)).toBe(20);
    expect(readQuietHours(NIGHT)).toEqual({ start: "22:00", end: "07:00", timeZone: "UTC" });
    expect(readQuietHours("off")).toBeNull();
    expect(readQuietHours(JSON.stringify({ start: "22:00", end: "07:00", timeZone: "Nowhere/City" }))).toBeNull();
  });

  it("knows quiet hours across midnight", () => {
    const quiet = readQuietHours(NIGHT);
    expect(withinQuietHours(quiet, Date.UTC(2026, 10, 8, 23, 30))).toBe(true);
    expect(withinQuietHours(quiet, Date.UTC(2026, 10, 8, 6, 59))).toBe(true);
    expect(withinQuietHours(quiet, Date.UTC(2026, 10, 8, 7, 0))).toBe(false);
    expect(withinQuietHours(null, Date.UTC(2026, 10, 8, 23, 30))).toBe(false);
  });

  it("holds cards past the budget and in quiet hours, never urgent ones", () => {
    let now = Date.UTC(2026, 10, 8, 12, 0);
    let quiet: string | undefined;
    const gate = new PersonSignalGate(() => ({ budget: 5, quiet: readQuietHours(quiet) }), () => now);
    const card = { personId: "p1", kind: "message" };
    for (let index = 0; index < 5; index += 1) expect(gate.decide(card)).toBe("push");
    expect(gate.decide(card)).toBe("hold");
    expect(gate.decide({ personId: "p1", kind: "approval" })).toBe("push");
    expect(gate.decide({ personId: "p2", kind: "message" })).toBe("push");
    expect(gate.decide({ personId: "p1", kind: "achievement" })).toBe("hold");
    now += SIGNAL_WINDOW_MS + 1;
    expect(gate.decide(card)).toBe("push");
    quiet = NIGHT;
    now = Date.UTC(2026, 10, 10, 23, 0);
    expect(gate.decide(card)).toBe("hold");
    expect(gate.decide({ personId: "p1", kind: "message", fromId: "p3" })).toBe("push");
    expect(gate.takeHeld("p1")).toBe(3);
    expect(gate.takeHeld("p1")).toBe(0);
  });

  it("says what waited in one brief line, no dashes", () => {
    expect(heldSignalsLine(0, "fr")).toBeNull();
    expect(heldSignalsLine(3, "fr")).toContain("3 notifications");
    expect(heldSignalsLine(1, "en")).toContain("1 notification waited");
    expect(`${heldSignalsLine(2, "fr")}${heldSignalsLine(2, "en")}`).not.toMatch(/[–—]/);
  });
});
