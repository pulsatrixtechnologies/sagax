import { describe, expect, it } from "vitest";

import { setLocale } from "./i18n";
import { routineAutoPauseChoices, routineAutoPausedText, routineAutoPauseOption, routineRunError, routineRunsOn, routineWeekRunsText, scheduleRepeatsEventDate } from "./routine-display";

describe("a routine's details (#1516)", () => {
  it("says one run in the singular", () => {
    setLocale("fr");
    try {
      expect(routineWeekRunsText({ ok: 1, total: 1 })).toBe("1 exécution sur 1 réussie cette semaine");
      expect(routineWeekRunsText({ ok: 2, total: 3 })).toBe("2 exécutions sur 3 réussies cette semaine");
    } finally {
      setLocale("en");
    }
    expect(routineWeekRunsText({ ok: 0, total: 1 })).toBe("0 of 1 run OK this week");
  });

  it("does not repeat a one-time event's date under its date", () => {
    expect(scheduleRepeatsEventDate({ type: "once", at: 5 }, 5)).toBe(true);
    expect(scheduleRepeatsEventDate({ type: "once", at: 5 }, 9)).toBe(false);
    expect(scheduleRepeatsEventDate({ type: "daily" }, 5)).toBe(false);
  });
});

describe("where a routine runs", () => {
  it("on My Cloud, every routine runs on schedule even when the person's computer is off", () => {
    expect(routineRunsOn({ roomGoal: false, cloudHome: true })).toEqual({
      label: "My Cloud", hint: "Runs on schedule, even when your computer is off.",
    });
    expect(routineRunsOn({ roomGoal: false, runOn: "cloud", cloudHome: true })).toEqual({
      label: "Cloud computer", hint: "Runs the whole job on the bot's cloud computer, even when your computer is off.",
    });
    expect(routineRunsOn({ roomGoal: false, computer: "cloud", cloudHome: true })).toEqual({
      label: "The bot's cloud computer", hint: "Runs on schedule, even when your computer is off.",
    });
    expect(routineRunsOn({ roomGoal: true, cloudHome: true })).toEqual({
      label: "My Cloud, with the whole group", hint: "Runs on schedule, even when your computer is off.",
    });
    // A Cloud home has no Local VM or this computer: a copied bot's setting reads as My Cloud.
    expect(routineRunsOn({ roomGoal: false, computer: "vm", cloudHome: true }).label).toBe("My Cloud");
  });

  it("on a desktop, a routine starts while Sagax is open there", () => {
    expect(routineRunsOn({ roomGoal: false, cloudHome: false })).toEqual({
      label: "This computer", hint: "Starts while Sagax is open here.",
    });
    expect(routineRunsOn({ roomGoal: false, runOn: "cloud", cloudHome: false })).toEqual({
      label: "Cloud computer", hint: "Runs the whole job on the bot's cloud computer while Sagax is open.",
    });
    expect(routineRunsOn({ roomGoal: false, computer: "vm", cloudHome: false }).label).toBe("The bot's virtual machine");
    expect(routineRunsOn({ roomGoal: true, cloudHome: false }).label).toBe("This computer, with the whole group");
  });

  it("never names Boat or a cloud runner", () => {
    for (const cloudHome of [true, false]) {
      for (const input of [{ runOn: "cloud" }, { computer: "cloud" }, {}]) {
        const { label, hint } = routineRunsOn({ roomGoal: false, cloudHome, ...input });
        expect(`${label} ${hint}`).not.toMatch(/boat|runner|VM\b/i);
      }
    }
  });
});

describe("a failed run's error", () => {
  it("keeps the engine's own words, and turns a bare stop code into a sentence", () => {
    const words = "Grok refused this turn: the usage balance of the Grok account it runs on is used up.";
    expect(routineRunError(words)).toBe(words);
    expect(routineRunError(undefined)).toBeUndefined();
    // runs recorded before 2026-10-08 kept only the code (production, "Failed: rpc_error")
    expect(routineRunError("rpc_error")).toMatch(/^The bot's engine stopped this run with an internal error/);
    expect(routineRunError("auth_required")).toMatch(/sign-in, key or credit/);
    expect(routineRunError("shutdown_timeout")).toBe("The bot's engine stopped this run (shutdown_timeout). Open the run's steps for the details.");
  });
});

describe("auto-pause words and choices (2026-10-26)", () => {
  it("offers Never first, then the counts, keeping a routine's own other count", () => {
    expect(routineAutoPauseChoices(5)).toEqual([0, 1, 2, 3, 5, 10, 20]);
    expect(routineAutoPauseChoices(7)).toEqual([0, 1, 2, 3, 5, 7, 10, 20]);
    expect(routineAutoPauseOption(0)).toBe("Never");
    expect(routineAutoPauseOption(1)).toBe("After 1 failed run");
    expect(routineAutoPauseOption(5)).toBe("After 5 failed runs in a row");
    expect(routineAutoPausedText(5)).toBe("Paused after 5 failures in a row");
    expect(routineAutoPausedText(1)).toBe("Paused after a failure");
  });
});

// JC 2026-11-01: "it saturates easily, queues really badly". A queued run
// shows its place: queued runs start oldest first, per bot.
describe("routineQueuePosition (2026-11-01)", () => {
  it("is the run's rank among the queued runs of its bot, oldest first", async () => {
    const { routineQueuePosition } = await import("./routine-display");
    const at = (id: string, botId: string, createdAt: number, status = "queued") => ({ id, botId, createdAt, status }) as never;
    const runs = [at("c", "atlas", 3), at("a", "atlas", 1), at("x", "other", 0), at("done", "atlas", 0, "completed"), at("b", "atlas", 2)];
    expect(routineQueuePosition(runs[1]!, runs)).toEqual({ position: 1, count: 3 });
    expect(routineQueuePosition(runs[0]!, runs)).toEqual({ position: 3, count: 3 });
    expect(routineQueuePosition(runs[2]!, runs)).toEqual({ position: 1, count: 1 });
    expect(routineQueuePosition(runs[3]!, runs)).toBeNull();
  });
});
