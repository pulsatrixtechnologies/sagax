// The passing notices (shared/transient-notices.ts) and the fixture the iOS
// core reads the same rules from.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isRoutineAutoPausedNotice, isTransientChatNotice, routineAccessSettled, TRANSIENT_NOTICE_RULES } from "./transient-notices.ts";

type FixtureMessage = Parameters<typeof isTransientChatNotice>[0] & { id: string; at: number; from?: { botId?: string } };
const fixture = JSON.parse(readFileSync(join(import.meta.dirname, "../ios/Tests/CompanionCoreTests/Fixtures/transient-notices.json"), "utf8")) as {
  routineRunStatuses: string[]; routineGoalStatuses: string[]; visibleMs: number; freshMs: number; autoPaused: string[];
  transient: FixtureMessage[]; rows: FixtureMessage[];
};

describe("transient notices", () => {
  it("is the list the iOS core reads (Fixtures/transient-notices.json)", () => {
    expect(fixture.routineRunStatuses).toEqual([...TRANSIENT_NOTICE_RULES.routineRunStatuses]);
    expect(fixture.routineGoalStatuses).toEqual([...TRANSIENT_NOTICE_RULES.routineGoalStatuses]);
    expect(fixture.visibleMs).toBe(TRANSIENT_NOTICE_RULES.visibleMs);
    expect(fixture.freshMs).toBe(TRANSIENT_NOTICE_RULES.freshMs);
  });

  it("passes a failed or missed routine run and a routine's access card, keeps the rest as rows", () => {
    for (const message of fixture.transient) expect(isTransientChatNotice(message), message.id).toBe(true);
    for (const message of fixture.rows) expect(isTransientChatNotice(message), message.id).toBe(false);
  });

  it("tells the failure that paused its routine from the others (Resume), a blocked team goal included", () => {
    const paused = [...fixture.transient, ...fixture.rows].filter((message) => isRoutineAutoPausedNotice(message)).map((message) => message.id);
    expect(paused).toEqual(fixture.autoPaused);
    for (const id of fixture.autoPaused) expect(isTransientChatNotice(fixture.transient.find((message) => message.id === id)!), id).toBe(true);
  });

  it("does not let a failure that paused a routine settle an access notice", () => {
    const access = fixture.transient.find((message) => message.id === "access")! as FixtureMessage & { access: { botId: string } };
    const goalPaused = fixture.transient.find((message) => message.id === "goal-auto-paused")!;
    expect(routineAccessSettled(access, [{ ...goalPaused, at: 2000, from: { botId: "b1" } }])).toBe(false);
  });

  // #4058: the one summary of a routine's streak of problems is a row the
  // chat keeps until the routine works again (the same row then says so),
  // never a passing banner, even when its run failed or paused the routine.
  it("keeps a streak's summary as a row, a failed or pausing run included", () => {
    for (const id of ["streak-failed", "streak-auto-paused"]) {
      const summary = fixture.rows.find((message) => message.id === id)!;
      expect(summary, id).toBeDefined();
      expect(isTransientChatNotice(summary), id).toBe(false);
      expect(isRoutineAutoPausedNotice(summary), id).toBe(false);
    }
  });

  it("does not let a streak's failed summary settle an access notice", () => {
    const access = fixture.transient.find((message) => message.id === "access")! as FixtureMessage & { access: { botId: string } };
    for (const id of ["streak-failed", "streak-auto-paused"]) {
      const summary = fixture.rows.find((message) => message.id === id)!;
      expect(routineAccessSettled(access, [{ ...summary, at: 2000, from: { botId: "b1" } }]), id).toBe(false);
    }
  });

  it("settles a routine access notice once the same bot's routine has run since", () => {
    const access = fixture.transient.find((message) => message.id === "access")! as FixtureMessage & { access: { botId: string } };
    const done = { ...fixture.rows[0]!, at: 2000, from: { botId: "b1" } };
    expect(routineAccessSettled(access, [done])).toBe(true);
    expect(routineAccessSettled(access, [{ ...done, from: { botId: "b2" } }])).toBe(false);
    expect(routineAccessSettled(access, [{ ...fixture.transient[0]!, at: 2000, from: { botId: "b1" } }])).toBe(false);
  });
});
