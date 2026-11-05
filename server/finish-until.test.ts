import { describe, expect, it } from "vitest";

import { parseBotProfilePatch } from "./bots/bot-profile.ts";
import { FinishUntilRuns, finishUntilOutcome, finishUntilPrompt, remindAfterCompaction, withoutFinishUntilMarker } from "./finish-until.ts";
import { FINISH_UNTIL_DEFAULT_ROUNDS, finishUntilLineText, finishUntilRounds } from "../shared/finish-until-line.ts";

describe("do not finish until", () => {
  it("stays off until the person sets one sentence on their bot", () => {
    expect(finishUntilPrompt("")).toBe("");
    expect(finishUntilPrompt(undefined)).toBe("");
    expect(parseBotProfilePatch({ finishUntil: "the tests pass" })).toEqual({ ok: true, patch: { finishUntil: "the tests pass" } });
    expect(parseBotProfilePatch({ finishUntil: "" })).toEqual({ ok: true, patch: { finishUntil: undefined } });
    expect(parseBotProfilePatch({ finishUntil: "one\ntwo" }).ok).toBe(false);
  });

  it("says the condition in the prompt and again after a compaction", () => {
    const prompt = finishUntilPrompt("the tests pass");
    expect(prompt.startsWith("Do not finish until: the tests pass")).toBe(true);
    expect(prompt).toContain("not a task list");
    const summary = remindAfterCompaction("Older turns were folded.", "the tests pass");
    expect(summary).toContain("Older turns were folded.");
    expect(summary).toContain("Do not finish until: the tests pass");
    expect(remindAfterCompaction(summary, "the tests pass")).toBe(summary);
    expect(remindAfterCompaction("Older turns were folded.", "")).toBe("Older turns were folded.");
  });

  it("asks the bot for a marker and reads it out of the reply (#1329)", () => {
    expect(finishUntilPrompt("the tests pass")).toContain("<sagax-finish>");
    const reply = 'All green.\n<sagax-finish>{"status":"met","detail":"12 pass"}</sagax-finish>';
    expect(finishUntilOutcome(reply)).toEqual({ status: "met", detail: "12 pass" });
    expect(withoutFinishUntilMarker(reply)).toBe("All green.");
    expect(finishUntilOutcome("<sagax-finish>{broken}</sagax-finish>")).toBeNull();
    expect(finishUntilOutcome('<sagax-finish>{"status":"maybe"}</sagax-finish>')).toBeNull();
    expect(finishUntilOutcome("no marker")).toBeNull();
  });

  it("keeps the bound in range and accepts it on the profile (#1329)", () => {
    expect(finishUntilRounds(undefined)).toBe(FINISH_UNTIL_DEFAULT_ROUNDS);
    expect(finishUntilRounds(0)).toBe(1);
    expect(finishUntilRounds(500)).toBe(50);
    expect(parseBotProfilePatch({ finishUntilMaxRounds: 3 })).toEqual({ ok: true, patch: { finishUntilMaxRounds: 3 } });
    expect(parseBotProfilePatch({ finishUntilMaxRounds: null })).toEqual({ ok: true, patch: { finishUntilMaxRounds: undefined } });
    expect(parseBotProfilePatch({ finishUntilMaxRounds: 0 }).ok).toBe(false);
    expect(parseBotProfilePatch({ finishUntilMaxRounds: 2.5 }).ok).toBe(false);
  });

  it("relaunches while unmet, then stops at met, blocked, a stop, a failure or the bound (#1329)", () => {
    const runs = new FinishUntilRuns();
    const settle = (over: Partial<{ ok: boolean; stopped: boolean; maxRounds: number }> = {}) =>
      runs.settle("t", { condition: "the tests pass", maxRounds: over.maxRounds ?? 3, ok: over.ok ?? true, stopped: over.stopped ?? false });

    // off: nothing happens
    expect(runs.settle("t", { condition: "", ok: true, stopped: false })).toEqual({ kind: "none" });

    // met on the first reply: no row
    runs.noteReply("t", '<sagax-finish>{"status":"met"}</sagax-finish>');
    expect(settle()).toEqual({ kind: "none" });

    // unmet: relaunch 1/3, 2/3, then met with a row
    const first = settle();
    expect(first.kind).toBe("relaunch");
    expect(first.kind === "relaunch" && first.prompt).toContain("relaunch 1 of 3");
    expect(finishUntilLineText(first.kind === "relaunch" ? first.line : { status: "met", condition: "" })).toBe("Relaunch 1/3: not finished until the tests pass");
    expect(settle()).toMatchObject({ kind: "relaunch", line: { round: 2, max: 3 } });
    runs.noteReply("t", '<sagax-finish>{"status":"met","detail":"done"}</sagax-finish>');
    expect(settle()).toMatchObject({ kind: "met", line: { status: "met", round: 2, detail: "done" } });
    expect(runs.rounds("t")).toBe(0);

    // the bound
    expect(settle({ maxRounds: 1 })).toMatchObject({ kind: "relaunch", line: { round: 1, max: 1 } });
    expect(settle({ maxRounds: 1 })).toMatchObject({ kind: "limit", line: { status: "limit", round: 1, max: 1 } });
    expect(runs.rounds("t")).toBe(0);

    // blocked waits for the person
    runs.noteReply("t", '<sagax-finish>{"status":"blocked","detail":"need the key"}</sagax-finish>');
    expect(settle()).toMatchObject({ kind: "blocked", line: { detail: "need the key" } });

    // Stop by the person ends a run in progress, with one row
    settle();
    expect(settle({ stopped: true })).toMatchObject({ kind: "stopped", line: { round: 1 } });
    expect(settle({ stopped: true })).toEqual({ kind: "none" });

    // a failed turn ends quietly (its error row is already there)
    settle();
    expect(settle({ ok: false })).toEqual({ kind: "none" });
    expect(runs.rounds("t")).toBe(0);

    // the person wrote: a fresh count
    settle();
    runs.reset("t");
    expect(settle()).toMatchObject({ kind: "relaunch", line: { round: 1 } });
  });
});
