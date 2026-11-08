import { describe, expect, it } from "vitest";
import { heldSignalsSection, localDayKey, PersonSignalGate, readQuietHours, readSignalBudget, signalLevelOfPush, withinQuietHours, type PersonSignalState, type SignalGateStorage } from "./signal-levels.ts";

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
    const gate = new PersonSignalGate(() => ({ budget: 5, quiet: readQuietHours(quiet), timeZone: "UTC" }), () => now);
    const card = { personId: "p1", kind: "message", title: "Rapport", body: "Tout va bien" };
    for (let index = 0; index < 5; index += 1) expect(gate.decide(card)).toBe("push");
    expect(gate.decide(card)).toBe("hold");
    expect(gate.decide({ personId: "p1", kind: "approval" })).toBe("push");
    expect(gate.decide({ personId: "p2", kind: "message" })).toBe("push");
    expect(gate.decide({ personId: "p1", kind: "achievement" })).toBe("hold");
    expect(gate.decide({ personId: "p1", kind: "message", title: "Note" }, { fyi: true })).toBe("hold");
    // the next local day starts at midnight, not 24 hours after the first push
    now = Date.UTC(2026, 10, 9, 0, 1);
    expect(gate.sentToday("p1")).toBe(0);
    expect(gate.decide(card)).toBe("push");
    quiet = NIGHT;
    now = Date.UTC(2026, 10, 10, 23, 0);
    expect(gate.decide(card)).toBe("hold");
    expect(gate.decide({ personId: "p1", kind: "message", fromId: "p3" })).toBe("push");
    const held = gate.takeHeld("p1");
    expect(held).toHaveLength(4);
    expect(held[0]).toMatchObject({ title: "Rapport", body: "Tout va bien" });
    expect(gate.takeHeld("p1")).toEqual([]);
  });

  it("keeps the day's count and the held content across a restart", () => {
    let saved: Record<string, PersonSignalState> | null = null;
    const storage: SignalGateStorage = { load: () => saved, save: (state) => { saved = JSON.parse(JSON.stringify(state)); } };
    const now = Date.UTC(2026, 10, 8, 12, 0);
    const prefs = () => ({ budget: 5, quiet: null, timeZone: "UTC" });
    const first = new PersonSignalGate(prefs, () => now, storage);
    for (let index = 0; index < 5; index += 1) first.decide({ personId: "p1", kind: "routine" });
    first.decide({ personId: "p1", kind: "routine", title: "Sauvegarde" });
    const second = new PersonSignalGate(prefs, () => now, storage);
    expect(second.sentToday("p1")).toBe(5);
    expect(second.decide({ personId: "p1", kind: "routine" })).toBe("hold");
    expect(second.takeHeld("p1").map((item) => item.title)).toEqual(["Sauvegarde", ""]);
  });

  it("counts the person's local day", () => {
    expect(localDayKey(Date.UTC(2026, 10, 9, 3, 0), "America/Toronto")).toBe("2026-11-08");
    expect(localDayKey(Date.UTC(2026, 10, 9, 3, 0), "UTC")).toBe("2026-11-09");
  });

  it("brings what waited to the brief as content, no dashes", () => {
    expect(heldSignalsSection([], "fr")).toBeNull();
    const fr = heldSignalsSection([{ at: 1, title: "Rapport", body: "Tout va bien" }, { at: 2, title: "Note", body: "" }], "fr");
    expect(fr).toContain("2 notifications");
    expect(fr).toContain("- Rapport : Tout va bien");
    const en = heldSignalsSection([{ at: 1, title: "Report", body: "All good" }], "en");
    expect(en).toContain("- Report: All good");
    expect(`${fr}${en}`).not.toMatch(/[–—]/);
  });
});
