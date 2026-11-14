import { describe, expect, it } from "vitest";
import { heldSignalsSection, localDayKey, PersonSignalGate, QUIET_HOURS_KEY, readQuietHours, readSignalBudget, readSignalPrefs, SIGNAL_BUDGET_KEY, signalLevelOfPush, withinQuietHours, type PersonSignalState, type SignalGateStorage } from "./signal-levels.ts";

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

  it("#3551: a notice taken back no longer waits for the brief", () => {
    const now = Date.UTC(2026, 10, 8, 12, 0);
    const gate = new PersonSignalGate(() => ({ budget: 0, timeZone: "UTC" }), () => now);
    expect(gate.decide({ personId: "p1", kind: "turn-failed", title: "Bot", body: "Sign-in expired", botId: "b1", threadId: "t1" })).toBe("hold");
    expect(gate.decide({ personId: "p1", kind: "message", title: "Bot", body: "Report", botId: "b2", threadId: "t2" })).toBe("hold");
    expect(gate.withdraw("p1", (held) => held.threadId === "t1")).toBe(1);
    expect(gate.withdraw("p1", (held) => held.threadId === "t1")).toBe(0);
    expect(gate.takeHeld("p1").map((item) => item.threadId)).toEqual(["t2"]);
  });

  it("#4233: what waited is read without a brief and cleared only up to what was read", () => {
    let now = Date.UTC(2026, 10, 8, 12, 0);
    const gate = new PersonSignalGate(() => ({ budget: 0, timeZone: "UTC" }), () => now);
    gate.decide({ personId: "p1", kind: "routine", title: "Backup", body: "Two jobs failed", botId: "b1", threadId: "t1" });
    gate.decide({ personId: "p2", kind: "routine", title: "Other person" });
    const seen = gate.peekHeld("p1");
    expect(seen).toEqual([expect.objectContaining({ title: "Backup", body: "Two jobs failed", botId: "b1", threadId: "t1" })]);
    // a read is not a take: the list stays until the person has seen it
    expect(gate.peekHeld("p1")).toHaveLength(1);
    // one more arrives after the read: clearing what was read keeps it
    now += 5_000;
    gate.decide({ personId: "p1", kind: "routine", title: "Later" });
    expect(gate.clearHeldUpTo("p1", seen[0]!.at)).toBe(1);
    expect(gate.peekHeld("p1").map((item) => item.title)).toEqual(["Later"]);
    // the brief still takes what is left
    expect(gate.takeHeld("p1").map((item) => item.title)).toEqual(["Later"]);
    expect(gate.peekHeld("p2").map((item) => item.title)).toEqual(["Other person"]);
  });

  it("#4233: the budget day follows the person's time zone, not the quiet hours' or the server's", () => {
    // 03:00 UTC on Nov 9 is still Nov 8 in Toronto
    let now = Date.UTC(2026, 10, 9, 2, 0);
    const prefs = readSignalPrefs({ [SIGNAL_BUDGET_KEY]: "5", [QUIET_HOURS_KEY]: NIGHT }, "America/Toronto");
    expect(prefs).toEqual({ budget: 5, quiet: { start: "22:00", end: "07:00", timeZone: "UTC" }, timeZone: "America/Toronto" });
    expect(readSignalPrefs({}, undefined)).toEqual({ budget: 20, quiet: null });
    const gate = new PersonSignalGate(() => ({ ...readSignalPrefs({}, "America/Toronto"), budget: 1 }), () => now);
    expect(gate.decide({ personId: "p1", kind: "routine" })).toBe("push");
    now = Date.UTC(2026, 10, 9, 4, 0);
    expect(gate.decide({ personId: "p1", kind: "routine" })).toBe("hold");
    now = Date.UTC(2026, 10, 9, 5, 1);
    expect(gate.decide({ personId: "p1", kind: "routine" })).toBe("push");
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
