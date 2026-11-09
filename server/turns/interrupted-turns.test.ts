import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { directResumeStep, drainTurns, INTERRUPTED_TURN_MAX_AGE_MS, runtimeResumeVerdict, saveInterruptedTurns, shutdownDrainMs, takeInterruptedTurns } from "./interrupted-turns.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const temp = () => { const dir = mkdtempSync(join(tmpdir(), "sagax-cut-")); dirs.push(dir); return dir; };

describe("interrupted turns", () => {
  it("resumes recent cut turns once; older ones are only noted", () => {
    const dir = temp();
    const now = 10 * INTERRUPTED_TURN_MAX_AGE_MS;
    saveInterruptedTurns(dir, [
      { botId: "b1", threadId: "t1", at: now - 1_000, speaker: { origin: "person", principalId: "pr_a" } },
      { botId: "b2", threadId: "t2", at: now - INTERRUPTED_TURN_MAX_AGE_MS - 1 },
      { botId: "b1", threadId: "t1", at: now },
    ]);
    expect(takeInterruptedTurns(dir, now)).toEqual({
      resume: [{ botId: "b1", threadId: "t1", at: now - 1_000, speaker: { origin: "person", principalId: "pr_a" } }],
      stale: [{ botId: "b2", threadId: "t2", at: now - INTERRUPTED_TURN_MAX_AGE_MS - 1 }],
    });
    expect(takeInterruptedTurns(dir, now)).toEqual({ resume: [], stale: [] });
    saveInterruptedTurns(dir, []);
    expect(existsSync(join(dir, "interrupted-turns.json"))).toBe(false);
  });

  it("drains until idle, until only approvals wait, or until the deadline", async () => {
    let busy = ["t1", "t2"];
    let clock = 0;
    const sleep = async (ms: number) => { clock += ms; if (clock >= 500) busy = ["t2"]; };
    expect(await drainTurns({ busy: () => busy, waitingOnPerson: t => t === "t2", timeoutMs: 5_000, now: () => clock, sleep })).toEqual(["t2"]);
    expect(clock).toBe(500);
    clock = 0;
    expect(await drainTurns({ busy: () => ["t1"], waitingOnPerson: () => false, timeoutMs: 1_000, now: () => clock, sleep: async ms => { clock += ms; } })).toEqual(["t1"]);
    expect(clock).toBe(1_000);
    expect(await drainTurns({ busy: () => [], waitingOnPerson: () => false, timeoutMs: 1_000 })).toEqual([]);
  });

  it("drains 5 s by default on a server, not under the desktop app", () => {
    expect(shutdownDrainMs({}, false)).toBe(5_000);
    expect(shutdownDrainMs({}, true)).toBe(0);
    expect(shutdownDrainMs({ SAGAX_SHUTDOWN_DRAIN_MS: "5000" }, true)).toBe(5_000);
    expect(shutdownDrainMs({ SAGAX_SHUTDOWN_DRAIN_MS: "999999" }, false)).toBe(120_000);
  });
  it("#2602: keeps a runtime-held turn and checks the resume promise was kept", () => {
    const dir = temp();
    const now = Date.now();
    saveInterruptedTurns(dir, [{ botId: "b1", threadId: "t1", at: now - 1_000, runtimeHeld: true }]);
    const [turn] = takeInterruptedTurns(dir, now).resume;
    expect(turn).toEqual({ botId: "b1", threadId: "t1", at: now - 1_000, runtimeHeld: true });
    const cutNote = { role: "bot", kind: "activity", at: now - 500 };
    expect(runtimeResumeVerdict(turn!, { held: true, busy: false, messages: [cutNote] })).toBe("wait");
    expect(runtimeResumeVerdict(turn!, { held: false, busy: true, messages: [cutNote] })).toBe("wait");
    // Nothing came back and nothing holds it any more: the promise was not kept.
    expect(runtimeResumeVerdict(turn!, { held: false, busy: false, messages: [cutNote] })).toBe("lost");
    expect(runtimeResumeVerdict(turn!, { held: false, busy: false, messages: [cutNote, { role: "bot", at: now }] })).toBe("resumed");
    // The person spoke first: a later answer belongs to the new request.
    expect(runtimeResumeVerdict(turn!, { held: false, busy: false, messages: [{ role: "user", at: now - 100 }, { role: "bot", at: now }] })).toBe("lost");
  });
});

describe("directResumeStep (#3217)", () => {
  it("relaunches a lost chat turn once, then reports it", () => {
    expect(directResumeStep("resumed", false)).toBe("done");
    expect(directResumeStep("wait", false)).toBe("wait");
    expect(directResumeStep("lost", false)).toBe("relaunch");
    expect(directResumeStep("lost", true)).toBe("report");
    expect(directResumeStep("wait", true)).toBe("wait");
  });
});
