import { describe, expect, it } from "vitest";

import { PROACTIVE_MODES } from "../shared/proactive-mode.ts";
import {
  classifyProactiveActionKind,
  decideProactiveStep,
  ProactiveBudget,
  ProactiveEngine,
  DEFAULT_PROACTIVE_BUDGET,
} from "./proactive.ts";

describe("server classification of a proactive step (server-enforced, never a client claim)", () => {
  it("calls an outbound, money or contact action a write", () => {
    for (const tool of ["GMAIL_SEND_EMAIL", "SLACK_POST_MESSAGE", "STRIPE_CREATE_REFUND", "TWILIO_SEND_SMS", "mcp__cw_psa__update_ticket"]) {
      expect(classifyProactiveActionKind({ tool })).toBe("write");
    }
  });

  it("calls a plainly read-only tool a read", () => {
    for (const tool of ["GMAIL_FETCH_EMAILS", "GOOGLECALENDAR_EVENTS_LIST", "mcp__cw_psa__find_tickets", "list_routines", "read_file"]) {
      expect(classifyProactiveActionKind({ tool })).toBe("read");
    }
  });

  it("fails an unknown or ambiguous step to a write, so the unknown always cards", () => {
    for (const tool of ["mcp__weird__frobnicate", "run_command", "write_file", undefined, ""]) {
      expect(classifyProactiveActionKind({ tool })).toBe("write");
    }
  });

  it("classifies a shell step by its command line, not by a caller flag", () => {
    expect(classifyProactiveActionKind({ tool: "run_command", command: "git status" })).toBe("read");
    expect(classifyProactiveActionKind({ tool: "run_command", command: "rm -rf /" })).toBe("write");
    // A caller cannot mislabel a send as read-only: the tool name decides.
    expect(classifyProactiveActionKind({ tool: "GMAIL_SEND_EMAIL", readOnlyHint: true } as never)).toBe("write");
  });
});

const covers = (v: boolean) => () => v;

describe("the server decision, derived from the stored bot", () => {
  it("OFF: a bot never observes and never acts", () => {
    const d = decideProactiveStep({ bot: { proactiveMode: "off" }, action: { tool: "GMAIL_FETCH_EMAILS" }, coveredByRules: covers(true) });
    expect(d).toMatchObject({ mayObserve: false, disposition: "blocked", execute: false, card: false, propose: false });
  });

  it("PROPOSE: proposes, and executes nothing — not a read, not a write", () => {
    const read = decideProactiveStep({ bot: { proactiveMode: "propose" }, action: { tool: "GMAIL_FETCH_EMAILS" }, coveredByRules: covers(true) });
    expect(read).toMatchObject({ mayObserve: true, disposition: "propose", execute: false, propose: true, card: false });
    const write = decideProactiveStep({ bot: { proactiveMode: "propose" }, action: { tool: "GMAIL_SEND_EMAIL" }, coveredByRules: covers(true) });
    expect(write).toMatchObject({ mayObserve: true, disposition: "propose", execute: false, propose: true, card: false });
  });

  it("READ-AUTO: runs a read itself, cards any write with a dry run", () => {
    const read = decideProactiveStep({ bot: { proactiveMode: "read-auto" }, action: { tool: "GMAIL_FETCH_EMAILS" }, coveredByRules: covers(true) });
    expect(read).toMatchObject({ disposition: "auto", execute: true, card: false });
    const write = decideProactiveStep({ bot: { proactiveMode: "read-auto" }, action: { tool: "GMAIL_SEND_EMAIL" }, coveredByRules: covers(true) });
    expect(write).toMatchObject({ disposition: "card", execute: false, card: true, dryRun: true });
  });

  it("FOLLOW-RULES: a write passes only when the bot's own rules cover it, else it cards", () => {
    const covered = decideProactiveStep({ bot: { proactiveMode: "follow-rules" }, action: { tool: "GMAIL_SEND_EMAIL" }, coveredByRules: covers(true) });
    expect(covered).toMatchObject({ disposition: "defer", execute: true, card: false });
    const notCovered = decideProactiveStep({ bot: { proactiveMode: "follow-rules" }, action: { tool: "GMAIL_SEND_EMAIL" }, coveredByRules: covers(false) });
    expect(notCovered).toMatchObject({ disposition: "defer", execute: false, card: true, dryRun: true });
    // A read still runs itself (#875: no card for a read).
    const read = decideProactiveStep({ bot: { proactiveMode: "follow-rules" }, action: { tool: "GMAIL_FETCH_EMAILS" }, coveredByRules: covers(false) });
    expect(read).toMatchObject({ disposition: "auto", execute: true, card: false });
  });

  it("#875: a read-only step never opens a card in any acting mode", () => {
    for (const mode of ["read-auto", "follow-rules"] as const) {
      const d = decideProactiveStep({ bot: { proactiveMode: mode }, action: { tool: "mcp__cw_psa__find_tickets" }, coveredByRules: covers(false) });
      expect(d.card).toBe(false);
      expect(d.execute).toBe(true);
    }
  });

  it("a proactive write WITHOUT a covering rule always cards, in every acting mode", () => {
    for (const mode of ["propose", "read-auto", "follow-rules"] as const) {
      const d = decideProactiveStep({ bot: { proactiveMode: mode }, action: { tool: "STRIPE_CREATE_CHARGE" }, coveredByRules: covers(false) });
      expect(d.execute).toBe(false);
      // Propose uses a proposal card; the other two an approval card. Either way a person decides.
      expect(d.card || d.propose).toBe(true);
    }
  });

  it("is server-enforced: an unknown stored mode fails closed to off, whatever the client sent", () => {
    const d = decideProactiveStep({ bot: { proactiveMode: "chief" }, action: { tool: "GMAIL_FETCH_EMAILS" }, coveredByRules: covers(true) });
    expect(d).toMatchObject({ disposition: "blocked", execute: false });
  });

  it("#938 intact: a covered write passes the WHOLE request through, never an emptied scope", () => {
    // Follow-rules with a standing Always-allow (coveredByRules true) runs the
    // step exactly as the bot would normally: we never narrow or split it.
    const action = { tool: "GMAIL_SEND_EMAIL", request: { to: "a@b.c", body: "hi", scope: "full-request" } };
    const d = decideProactiveStep({ bot: { proactiveMode: "follow-rules" }, action, coveredByRules: covers(true) });
    expect(d.execute).toBe(true);
    expect(d.forwardedRequest).toBe(action.request);
  });

  it("never executes a write unprompted: for every mode, a write with no covering rule is held", () => {
    for (const mode of PROACTIVE_MODES) {
      const d = decideProactiveStep({ bot: { proactiveMode: mode }, action: { tool: "GMAIL_SEND_EMAIL" }, coveredByRules: covers(false) });
      expect(d.execute).toBe(false);
    }
  });
});

describe("the proactive budget bounds the loop (no runaway)", () => {
  it("holds a bot to its minimum interval between cycles", () => {
    let now = 1_000_000;
    const budget = new ProactiveBudget({ minIntervalMs: 15 * 60_000, maxPerWindow: 10, windowMs: 60 * 60_000, now: () => now });
    expect(budget.mayCycle("b")).toBe(true);
    budget.noteCycle("b");
    expect(budget.mayCycle("b")).toBe(false);
    now += 14 * 60_000;
    expect(budget.mayCycle("b")).toBe(false);
    now += 2 * 60_000;
    expect(budget.mayCycle("b")).toBe(true);
  });

  it("caps initiations per rolling window, then reopens once the window passes", () => {
    let now = 5_000_000;
    const budget = new ProactiveBudget({ minIntervalMs: 0, maxPerWindow: 3, windowMs: 60 * 60_000, now: () => now });
    for (let i = 0; i < 3; i++) {
      expect(budget.mayInitiate("b")).toBe(true);
      budget.noteInitiate("b");
    }
    expect(budget.mayInitiate("b")).toBe(false); // runaway loop stopped here
    now += 61 * 60_000;
    expect(budget.mayInitiate("b")).toBe(true);
  });

  it("budgets each bot on its own", () => {
    let now = 9_000_000;
    const budget = new ProactiveBudget({ minIntervalMs: 10_000, maxPerWindow: 1, windowMs: 60_000, now: () => now });
    budget.noteInitiate("a");
    expect(budget.mayInitiate("a")).toBe(false);
    expect(budget.mayInitiate("b")).toBe(true);
    budget.noteCycle("a");
    expect(budget.mayCycle("a")).toBe(false);
    expect(budget.mayCycle("b")).toBe(true);
  });

  it("ships a sane default budget (bounded cadence and a per-hour cap)", () => {
    expect(DEFAULT_PROACTIVE_BUDGET.minIntervalMs).toBeGreaterThanOrEqual(5 * 60_000);
    expect(DEFAULT_PROACTIVE_BUDGET.maxPerWindow).toBeGreaterThan(0);
    expect(DEFAULT_PROACTIVE_BUDGET.maxPerWindow).toBeLessThanOrEqual(60);
    expect(DEFAULT_PROACTIVE_BUDGET.windowMs).toBeGreaterThan(0);
  });
});

describe("the engine ties the budget to the decision (the drop-in call a loop or trigger makes)", () => {
  function engine(now: () => number) {
    const bots = new Map<string, { proactiveMode?: unknown }>([
      ["off", { proactiveMode: "off" }],
      ["auto", { proactiveMode: "read-auto" }],
    ]);
    return new ProactiveEngine({
      bot: (id) => bots.get(id),
      coveredByRules: () => false,
      budget: new ProactiveBudget({ minIntervalMs: 1000, maxPerWindow: 2, windowMs: 60_000, now }),
    });
  }

  it("never observes or initiates for an off bot, and does not spend budget on it", () => {
    let now = 100;
    const e = engine(() => now);
    const d = e.consider("off", { tool: "GMAIL_FETCH_EMAILS" });
    expect(d.acted).toBe(false);
    expect(d.decision.disposition).toBe("blocked");
    // an off bot cost nothing: a later acting bot still has its whole budget
    now += 2000;
    expect(e.consider("auto", { tool: "GMAIL_SEND_EMAIL" }).acted).toBe(true);
  });

  it("stops initiating once the budget is spent (bounded, server-side)", () => {
    let now = 1_000;
    const e = engine(() => now);
    expect(e.consider("auto", { tool: "GMAIL_SEND_EMAIL" }).acted).toBe(true);
    now += 1_100;
    expect(e.consider("auto", { tool: "GMAIL_SEND_EMAIL" }).acted).toBe(true);
    now += 1_100;
    // third within the window: budget refuses it, nothing is decided
    const third = e.consider("auto", { tool: "GMAIL_SEND_EMAIL" });
    expect(third.acted).toBe(false);
    expect(third.reason).toBe("budget");
  });

  it("holds a bot to its minimum interval between cycles", () => {
    let now = 5_000;
    const e = engine(() => now);
    expect(e.consider("auto", { tool: "GMAIL_FETCH_EMAILS" }).acted).toBe(true);
    // too soon: refused on cadence, not on the decision
    const soon = e.consider("auto", { tool: "GMAIL_FETCH_EMAILS" });
    expect(soon.acted).toBe(false);
    expect(soon.reason).toBe("cadence");
  });
});
