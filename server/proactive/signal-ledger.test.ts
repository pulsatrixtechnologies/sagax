// #4250 (S1): the signal ledger, one store per person on disk, and the
// memories moved into it. Each moved memory gets a restart test: no second
// wake, no second ring, reminder clocks kept.
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { RoutineNeedsPerson } from "../../shared/routines.ts";
import type { PushMessage } from "../push/payload.ts";
import { CARD_REMINDER_AFTER_MS, ReachMe, type ReachCard, type ReachNotice } from "../reach-me/service.ts";
import { createReachCodeStore, createReachMeStore } from "../reach-me/store.ts";
import { INPUT_REMIND_REPEAT_MS } from "../runtime/types.ts";
import { RoutineProblemCards, routineProblemKey, type PendingProblemCard, type RoutineProblemCardsDeps } from "../routines/routine-problem-card.ts";
import { RoutineManager, type RoutineManagerOptions } from "../routines/routines.ts";
import { createRoutineSuspended } from "../index-leaves/routineSuspended.ts";
import { ProactiveWaker, type ProactiveEvent } from "./proactive-wake.ts";
import { createTellPerson, settleKeyed, SignalLedger, signalKeys, signalLedgerDirStorage, signalLedgerFileName } from "./signal-ledger.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "sagax-signal-ledger-"));
  dirs.push(dir);
  return dir;
}

/** A ledger on `dir` that writes on flush (a restart is a new ledger on the same folder). */
function ledgerOn(dir: string, now: () => number = Date.now): SignalLedger {
  return new SignalLedger({ storage: signalLedgerDirStorage(join(dir, "signal-ledger")), now, schedule: () => {} });
}

describe("SignalLedger", () => {
  it("keeps each person's entries on disk, in a file named by a hash, across a restart", () => {
    const dir = tempDir();
    let now = 1_000;
    const first = ledgerOn(dir, () => now);
    first.note("pr_a", { key: "k1", kind: "event", bot: "b1", label: "Mail from example.com" });
    first.told("pr_a", { key: "owner-notice:signed_out", kind: "owner-notice", bot: "b1" }, ["notify"]);
    now = 2_000;
    first.reminded("pr_a", "b1", "owner-notice:signed_out", 1);
    first.told("pr_b", { key: "engine-sign-in:Claude", kind: "engine-sign-in" });
    first.flush();
    const names = readdirSync(join(dir, "signal-ledger")).sort();
    expect(names).toEqual([signalLedgerFileName("pr_a"), signalLedgerFileName("pr_b")].sort());
    expect(names.join(" ")).not.toContain("pr_");

    const second = ledgerOn(dir, () => now);
    expect(second.get("pr_a", "b1", "k1")).toMatchObject({ kind: "event", state: "open", count: 1, firstAt: 1_000, label: "Mail from example.com" });
    expect(second.get("pr_a", "b1", "owner-notice:signed_out")).toMatchObject({ state: "told", toldAt: 2_000, reminded: 1, channels: ["notify"] });
    expect(second.isTold("pr_b", "", "engine-sign-in:Claude")).toBe(true);
    // people are apart: one person's key is not another's
    expect(second.get("pr_b", "b1", "k1")).toBeUndefined();
  });

  it("a settled entry told again opens a new spell: its clock and reminders start over", () => {
    let now = 1_000;
    const ledger = new SignalLedger({ now: () => now });
    ledger.told("pr_a", { key: "k", kind: "x" });
    ledger.reminded("pr_a", "", "k", 1);
    ledger.settle("pr_a", "", "k", "retired");
    now = 5_000;
    expect(ledger.told("pr_a", { key: "k", kind: "x" })).toMatchObject({ state: "told", firstAt: 5_000, toldAt: 5_000, count: 2 });
    expect(ledger.get("pr_a", "", "k")?.reminded).toBeUndefined();
  });

  it("a flood of one kind never pushes out another kind", () => {
    const ledger = new SignalLedger({ maxPerKind: 3 });
    ledger.told("pr_a", { key: "owner-notice:credits", kind: "owner-notice", bot: "b1" });
    for (let index = 0; index < 10; index += 1) ledger.note("pr_a", { key: `mail-${index}`, kind: "event", bot: "b1" });
    expect(ledger.entries({ person: "pr_a", kind: "event" })).toHaveLength(3);
    expect(ledger.isTold("pr_a", "b1", "owner-notice:credits")).toBe(true);
  });

  it("an unreadable store is skipped, the others load", () => {
    const dir = tempDir();
    const first = ledgerOn(dir);
    first.told("pr_a", { key: "k", kind: "x" });
    first.flush();
    writeFileSync(join(dir, "signal-ledger", signalLedgerFileName("pr_b")), "{not json");
    expect(ledgerOn(dir).isTold("pr_a", "", "k")).toBe(true);
  });
});

describe("tellPerson", () => {
  it("rings once per key and step, a restart included, with one log line each", () => {
    const dir = tempDir();
    const rung: string[] = [];
    const lines: string[] = [];
    const tellOn = (ledger: SignalLedger) => createTellPerson<string>({ ledger, notify: (note) => rung.push(note), log: (line) => lines.push(line) });
    const first = ledgerOn(dir);
    const tell = tellOn(first);
    expect(tell("pr_a", { key: "run-problem:run-1", kind: "routine-run", bot: "b1", notification: "failed" })).toBe("told");
    expect(tell("pr_a", { key: "run-problem:run-1", kind: "routine-run", bot: "b1", notification: "failed" })).toBe("already_told");
    first.flush();

    const again = tellOn(ledgerOn(dir));
    expect(again("pr_a", { key: "run-problem:run-1", kind: "routine-run", bot: "b1", notification: "failed" })).toBe("already_told");
    expect(again("pr_a", { key: "run-problem:run-1", kind: "routine-run", bot: "b1", step: 1, notification: "reminder" })).toBe("told");
    expect(again("pr_a", { key: "run-problem:run-1", kind: "routine-run", bot: "b1", step: 1, notification: "reminder" })).toBe("already_told");
    expect(rung).toEqual(["failed", "reminder"]);
    expect(lines).toEqual([
      "[signal] kind=routine-run key=run-problem:run-1 bot=b1 level=card verdict=told",
      "[signal] kind=routine-run key=run-problem:run-1 bot=b1 level=card verdict=already_told",
      "[signal] kind=routine-run key=run-problem:run-1 bot=b1 level=card verdict=already_told",
      "[signal] kind=routine-run key=run-problem:run-1 bot=b1 level=card step=1 verdict=told",
      "[signal] kind=routine-run key=run-problem:run-1 bot=b1 level=card step=1 verdict=already_told",
    ]);
  });
});

describe("moved: the waker's event keys", () => {
  function waker(ledger: SignalLedger) {
    const woken: string[][] = [];
    const instance = new ProactiveWaker({
      bot: () => ({ proactiveMode: "proactive" }),
      owner: () => "pr_a",
      wake: (batch) => woken.push(batch.events.map((event) => event.key)),
      log: () => {},
      setTimer: () => ({}),
      clearTimer: () => {},
      signals: ledger,
    });
    return { instance, woken };
  }
  const EVENT: ProactiveEvent = { botId: "b1", source: "run", key: "run-1", label: "Routine failed: Daily report", detail: "failed", failed: true };

  it("an event offered before a restart is a duplicate after it (no second wake)", () => {
    const dir = tempDir();
    const before = ledgerOn(dir);
    const first = waker(before);
    expect(first.instance.offer({ ...EVENT })).not.toBe("duplicate");
    expect(first.instance.offer({ ...EVENT })).toBe("duplicate");
    before.flush();
    const second = waker(ledgerOn(dir));
    expect(second.instance.offer({ ...EVENT })).toBe("duplicate");
    expect(second.instance.offer({ ...EVENT, key: "run-2" })).not.toBe("duplicate");
  });
});

describe("moved: reach reminders and sent notices", () => {
  const CARD: ReachCard = { threadId: "t1", requestId: "r1", botId: "b1", botName: "Nimbus", kind: "approval", title: "Run a command?", line: "npm test", confidential: false, needsKey: false };
  const PUSH: PushMessage = { kind: "approval", personId: "pr_a", title: "Nimbus", body: "Run a command?", threadId: "t1", botId: "b1", requestId: "r1", prompt: "approval", at: 1 };

  function reachOn(dir: string, ledger: SignalLedger, clock: { now: number }, pushed: PushMessage[]) {
    return new ReachMe({
      settings: createReachMeStore(dir, () => clock.now),
      codes: createReachCodeStore(dir, () => clock.now),
      channels: {},
      card: () => CARD,
      answerer: () => "pr_a",
      respond: async () => ({ status: 200, body: {} }),
      push: (message) => pushed.push(message),
      language: () => "en",
      audit: () => {},
      now: () => clock.now,
      log: () => {},
      signals: ledger,
    });
  }

  it("a card's reminder clock survives a restart, and a step told before it never rings again", () => {
    const dir = tempDir();
    const clock = { now: 1_000 };
    const pushed: PushMessage[] = [];
    const firstLedger = ledgerOn(dir, () => clock.now);
    reachOn(dir, firstLedger, clock, pushed).cardRaised(PUSH);
    firstLedger.flush();

    // restart: the clock started at the raise, not at the restart
    clock.now = 1_000 + CARD_REMINDER_AFTER_MS[0];
    const secondLedger = ledgerOn(dir, () => clock.now);
    const second = reachOn(dir, secondLedger, clock, pushed);
    expect(second.openCardCount()).toBe(1);
    second.tick();
    expect(pushed.map((push) => push.title)).toEqual(["Still waiting (2 h) · Nimbus"]);
    expect(pushed[0]).toMatchObject({ kind: "approval", threadId: "t1", requestId: "r1", id: "pr_a\u0000t1\u0000r1:reminder1" });
    secondLedger.flush();

    // restart again: the 2 h step is told, nothing rings until 24 h
    const third = reachOn(dir, ledgerOn(dir, () => clock.now), clock, pushed);
    third.tick();
    expect(pushed).toHaveLength(1);
    clock.now = 1_000 + CARD_REMINDER_AFTER_MS[1];
    third.tick();
    // #4250 (S3): the morning line aside (server/reach-me/service.test.ts)
    expect(pushed.filter((push) => push.kind === "approval").map((push) => push.title)).toEqual(["Still waiting (2 h) · Nimbus", "Still waiting (24 h) · Nimbus"]);
  });

  it("a notice sent before a restart is not sent again after it", () => {
    const dir = tempDir();
    const clock = { now: Date.parse("2026-11-13T13:00:00Z") };
    const pushed: PushMessage[] = [];
    const notice: ReachNotice = { id: "brief:2026-11-13", person: "pr_a", botId: "b1", botName: "Nimbus", threadId: "t1", title: "Your brief", lines: ["Two things wait."] };
    const firstLedger = ledgerOn(dir, () => clock.now);
    reachOn(dir, firstLedger, clock, pushed).notice(notice);
    expect(pushed).toHaveLength(1);
    firstLedger.flush();
    reachOn(dir, ledgerOn(dir, () => clock.now), clock, pushed).notice(notice);
    expect(pushed).toHaveLength(1);
  });
});

describe("moved: the streak's told state (routine fix card)", () => {
  type R = { id: string; name: string; botId: string };
  const ROUTINE: R = { id: "r1", name: "Mailbox sweep", botId: "b1" };
  const NEED: RoutineNeedsPerson = { kind: "problem", since: 1_000, text: "It keeps failing." } as RoutineNeedsPerson;

  function cards(ledger: SignalLedger, state: { pending: PendingProblemCard | null; asked: string[]; reminded: number; now: number; latest?: { at: number } }) {
    const deps: RoutineProblemCardsDeps<R> = {
      need: () => NEED,
      facts: () => ({ summary: "Sign-in failed.", count: 3 }),
      words: () => ({ t: (key: string) => key } as unknown as ReturnType<RoutineProblemCardsDeps<R>["words"]>),
      ask: (_routine, input) => { state.asked.push("retire" in input ? "retire" : "raise"); },
      pending: () => state.pending,
      // the card in storage was put away and cleared: storage says nothing
      latest: () => state.latest ?? null,
      remind: () => { state.reminded += 1; },
      now: () => state.now,
      signals: ledger,
      person: () => "pr_a",
    };
    return new RoutineProblemCards<R>(deps);
  }

  it("a streak told before a restart is not raised again after it", () => {
    const dir = tempDir();
    const state = { pending: null as PendingProblemCard | null, asked: [] as string[], reminded: 0, now: 2_000 };
    const before = ledgerOn(dir, () => state.now);
    cards(before, state).sync(ROUTINE);
    expect(state.asked).toEqual(["raise"]);
    expect(before.get("pr_a", "b1", routineProblemKey("r1"))).toMatchObject({ state: "told", kind: "routine-problem" });
    before.flush();
    // the person put the card away; the server restarts
    cards(ledgerOn(dir, () => state.now), state).sync(ROUTINE);
    expect(state.asked).toEqual(["raise"]);
  });

  it("a card in storage newer than the ledger's told time counts (a rollback, then an upgrade)", () => {
    const dir = tempDir();
    // the previous version raised this streak's card at 3_000, and the person put it away
    const state = { pending: null as PendingProblemCard | null, asked: [] as string[], reminded: 0, now: 5_000, latest: { at: 3_000 } };
    const ledger = ledgerOn(dir, () => 500);
    // told under an older streak, before this one began
    ledger.told("pr_a", { key: routineProblemKey("r1"), kind: "routine-problem", bot: "b1" });
    cards(ledger, state).sync(ROUTINE);
    expect(state.asked).toEqual([]);
  });

  it("the day's reminder told before a restart never rings again", () => {
    const dir = tempDir();
    const state = { pending: { threadId: "conv", message: { id: "m1", at: 2_000 } } as PendingProblemCard | null, asked: [] as string[], reminded: 0, now: 2_000 + INPUT_REMIND_REPEAT_MS };
    const before = ledgerOn(dir, () => state.now);
    before.told("pr_a", { key: routineProblemKey("r1"), kind: "routine-problem", bot: "b1" });
    // the reminder step reached the ledger, the card's own mark did not (a restart in between)
    before.reminded("pr_a", "b1", routineProblemKey("r1"), 1);
    before.flush();
    cards(ledgerOn(dir, () => state.now), state).remindDue([ROUTINE]);
    expect(state.reminded).toBe(0);
  });
});

describe("moved: engine sign-in and owner notices (routine manager)", () => {
  const START = new Date(2026, 7, 17, 8, 0, 0).getTime();

  it("a file of the previous version moves into the ledger and is still written for it", () => {
    const dir = tempDir();
    const file = join(dir, "routines.json");
    writeFileSync(file, JSON.stringify({
      version: 1, routines: [], runs: [],
      ownerNotices: [{ botId: "b1", cause: "signed_out", at: START }],
      engineReconnectNotified: ["pr_a\0Claude"],
    }));
    const ledger = ledgerOn(dir, () => START);
    const options: RoutineManagerOptions = {
      file, now: () => START, botState: () => "ready", createTask: () => ({ threadId: "t" }), startTurn: async () => {},
      signals: ledger, personOf: () => "pr_a",
    };
    const manager = new RoutineManager(options);
    expect(ledger.isTold("pr_a", "b1", "owner-notice:signed_out")).toBe(true);
    expect(ledger.isTold("pr_a", "", "engine-sign-in:Claude")).toBe(true);
    ledger.flush();
    manager.create({ name: "Inbox sweep", prompt: "Sweep", botId: "b1", schedule: { type: "daily", time: "09:00", weekdays: [3] } });
    const written = JSON.parse(readFileSync(file, "utf8")) as { ownerNotices?: unknown; engineReconnectNotified?: unknown };
    expect(written.ownerNotices).toEqual([{ botId: "b1", cause: "signed_out", at: START }]);
    expect(written.engineReconnectNotified).toEqual(["pr_a\0Claude"]);
    // a restart reads the ledger: still told once
    const after = ledgerOn(dir, () => START);
    expect(after.isTold("pr_a", "b1", "owner-notice:signed_out")).toBe(true);
  });
});

describe("review of #4250: the next occurrence rings again", () => {
  function teller(dir: string) {
    const rung: string[] = [];
    const ledger = ledgerOn(dir);
    const tell = createTellPerson<string>({ ledger, notify: (note) => rung.push(note), log: () => {} });
    return { ledger, tell, rung };
  }

  it("runs skipped in a later away period ring again, even with the same count", () => {
    const { tell, rung } = teller(tempDir());
    const first = { count: 3, firstAt: 1_000, lastAt: 3_000 };
    const later = { count: 3, firstAt: 90_000, lastAt: 92_000 };
    const item = (skips: typeof first) => ({ key: signalKeys.awaySkips("rt-1", skips), kind: "routine-run", bot: "b1", notification: `skipped ${skips.firstAt}` });
    expect(tell("pr_a", item(first))).toBe("told");
    expect(tell("pr_a", item(first))).toBe("already_told");
    expect(tell("pr_a", item(later))).toBe("told");
    expect(rung).toEqual(["skipped 1000", "skipped 90000"]);
  });

  it("a later question with the same words rings again; the same message rings once", () => {
    const { tell, rung } = teller(tempDir());
    const item = (messageId: string) => ({ key: signalKeys.needsYou({ threadId: "work", messageId }), kind: "needs-you", bot: "b1", notification: messageId });
    expect(tell("pr_a", item("m1"))).toBe("told");
    expect(tell("pr_a", item("m1"))).toBe("already_told");
    expect(tell("pr_a", item("m2"))).toBe("told");
    expect(rung).toEqual(["m1", "m2"]);
  });

  it("a server engine's card rings in every administrators' home that shares a bot, and again after the spell is settled", () => {
    const { ledger, tell, rung } = teller(tempDir());
    const key = "engine-sign-in:inst-1";
    const item = (threadId: string) => ({ key: signalKeys.inHome(key, threadId), kind: "engine-fallback", bot: "org-bot", notification: threadId });
    expect(tell("server", item("home-a"))).toBe("told");
    expect(tell("server", item("home-b"))).toBe("told");
    expect(tell("server", item("home-a"))).toBe("already_told");
    expect(settleKeyed(ledger, { kind: "engine-fallback", key }, "retired")).toBe(2);
    expect(tell("server", item("home-a"))).toBe("told");
    expect(rung).toEqual(["home-a", "home-b", "home-a"]);
  });

  it("a run blocked then failed is told for each status", () => {
    const { tell, rung } = teller(tempDir());
    const item = (status: string) => ({ key: signalKeys.runProblem("run-1", status), kind: "routine-run", bot: "b1", notification: status });
    expect(tell("pr_a", item("blocked"))).toBe("told");
    expect(tell("pr_a", item("failed"))).toBe("told");
    expect(tell("pr_a", item("failed"))).toBe("already_told");
    expect(rung).toEqual(["blocked", "failed"]);
  });
});

describe("review 2 of #4250: every proactive writer tells through tellPerson", () => {
  function suspendWorld(ledger: SignalLedger) {
    const rung: Array<{ title: string; access: string; run?: string }> = [];
    const bot = { id: "b1", name: "Atlas", threadId: "main" };
    const host = {
      store: { bot: () => bot, group: () => undefined, appendMessage: () => ({ id: "m1" }) },
      effectiveRunAs: () => "pr_member",
      principals: { byId: () => ({ name: "Member" }) },
      routineAudit: () => {},
      routineSourceOwner: () => ({ threadId: "conv-member" }),
      effectiveBotOwner: () => "pr_owner",
      redactSecretsInText: (text: string) => text,
      deliverableNotification: (_kind: string, _bot: unknown, _threadId: string, title: string) => title,
      tellPerson: createTellPerson<{ notification: string; access?: { routineId: string }; routineRunId?: string }>({
        ledger, log: () => {},
        notify: ({ notification, access, routineRunId }) => { rung.push({ title: notification, access: access?.routineId ?? "", ...(routineRunId ? { run: routineRunId } : {}) }); },
      }),
      routineProblemPerson: () => "pr_member",
    };
    return { rung, suspend: createRoutineSuspended(() => host) as (routine: unknown, run: unknown, reason: string) => void };
  }

  it("a routine paused is told once per pause, a restart included; the next pause rings again", () => {
    const dir = tempDir();
    const routine = (at: number) => ({ id: "rt-1", name: "Mailbox sweep", botId: "b1", target: "bot", suspended: { reason: "person_out", at } });
    const before = ledgerOn(dir);
    const first = suspendWorld(before);
    first.suspend(routine(1_000), { id: "run-1" }, "person_out");
    expect(first.rung).toEqual([{ title: "Mailbox sweep: paused (its person was signed out by Perspicax)", access: "rt-1", run: "run-1" }]);
    expect(before.get("pr_member", "b1", signalKeys.routineSuspended("rt-1", { reason: "person_out", at: 1_000 }))).toMatchObject({ state: "told", kind: "routine-suspended" });
    before.flush();

    const after = suspendWorld(ledgerOn(dir));
    after.suspend(routine(1_000), null, "person_out");
    expect(after.rung).toEqual([]);
    after.suspend(routine(9_000), null, "person_out");
    expect(after.rung).toHaveLength(1);
  });

  it("a daily suggestion is told once per proposal, a restart included", () => {
    const dir = tempDir();
    const rung: string[] = [];
    const tellOn = (ledger: SignalLedger) => createTellPerson<string>({ ledger, notify: (note) => rung.push(note), log: () => {} });
    const item = (id: string) => ({ key: signalKeys.proposal(id), kind: "proposal", bot: "b1", notification: id });
    const before = ledgerOn(dir);
    expect(tellOn(before)("pr_a", item("prop-1"))).toBe("told");
    before.flush();
    const tell = tellOn(ledgerOn(dir));
    expect(tell("pr_a", item("prop-1"))).toBe("already_told");
    expect(tell("pr_a", item("prop-2"))).toBe("told");
    expect(rung).toEqual(["prop-1", "prop-2"]);
  });
});
