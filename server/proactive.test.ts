import { describe, expect, it } from "vitest";

import { PROACTIVE_MODES } from "../shared/proactive-mode.ts";
import {
  classifyProactiveActionKind,
  decideProactiveStep,
  proactiveDryRunSummary,
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

  it("fails an unknown or ambiguous step to a write", () => {
    for (const tool of ["mcp__weird__frobnicate", "run_command", "write_file", undefined, ""]) {
      expect(classifyProactiveActionKind({ tool })).toBe("write");
    }
  });

  it("classifies a shell step by its command line, not by a caller flag", () => {
    expect(classifyProactiveActionKind({ tool: "run_command", command: "git status" })).toBe("read");
    expect(classifyProactiveActionKind({ tool: "run_command", command: "rm -rf /" })).toBe("write");
    expect(classifyProactiveActionKind({ tool: "GMAIL_SEND_EMAIL", readOnlyHint: true } as never)).toBe("write");
  });
});

const covers = (v: boolean) => () => v;

describe("the server decision, derived from the stored bot", () => {
  it("OFF: a bot never observes and never acts", () => {
    const d = decideProactiveStep({ bot: { proactiveMode: "off" }, action: { tool: "GMAIL_FETCH_EMAILS" }, coveredByRules: covers(true) });
    expect(d).toMatchObject({ mayObserve: false, disposition: "blocked", execute: false, dryRun: false });
  });

  it("PROACTIVE: runs a read itself", () => {
    const read = decideProactiveStep({ bot: { proactiveMode: "proactive" }, action: { tool: "GMAIL_FETCH_EMAILS" }, coveredByRules: covers(false) });
    expect(read).toMatchObject({ disposition: "auto", execute: true, dryRun: false, kind: "read" });
  });

  it("PROACTIVE: a write records a dry run then executes through the ordinary approval path (no extra card)", () => {
    const write = decideProactiveStep({ bot: { proactiveMode: "proactive" }, action: { tool: "GMAIL_SEND_EMAIL" }, coveredByRules: covers(false) });
    expect(write).toMatchObject({ disposition: "defer", execute: true, dryRun: true, kind: "write" });
    // covered or not: the proactive layer still defers; ordinary approval decides
    const covered = decideProactiveStep({ bot: { proactiveMode: "proactive" }, action: { tool: "GMAIL_SEND_EMAIL" }, coveredByRules: covers(true) });
    expect(covered).toMatchObject({ disposition: "defer", execute: true, dryRun: true });
  });

  it("legacy propose, read-auto and follow-rules decide as proactive", () => {
    for (const mode of ["propose", "read-auto", "follow-rules"] as const) {
      const write = decideProactiveStep({ bot: { proactiveMode: mode }, action: { tool: "GMAIL_SEND_EMAIL" }, coveredByRules: covers(false) });
      expect(write).toMatchObject({ disposition: "defer", execute: true, dryRun: true });
    }
  });

  it("is server-enforced: an unknown stored mode fails closed to off", () => {
    const d = decideProactiveStep({ bot: { proactiveMode: "chief" }, action: { tool: "GMAIL_FETCH_EMAILS" }, coveredByRules: covers(true) });
    expect(d).toMatchObject({ disposition: "blocked", execute: false });
  });

  it("#938 intact: a deferred write passes the WHOLE request through", () => {
    const action = { tool: "GMAIL_SEND_EMAIL", request: { to: "a@b.c", body: "hi", scope: "full-request" } };
    const d = decideProactiveStep({ bot: { proactiveMode: "proactive" }, action, coveredByRules: covers(true) });
    expect(d.execute).toBe(true);
    expect(d.forwardedRequest).toBe(action.request);
  });

  it("never returns auto for a write in any mode", () => {
    for (const mode of PROACTIVE_MODES) {
      const d = decideProactiveStep({ bot: { proactiveMode: mode }, action: { tool: "GMAIL_SEND_EMAIL" }, coveredByRules: covers(false) });
      expect(d.disposition).not.toBe("auto");
    }
  });

  it("summarizes a dry run without leaking a long command whole", () => {
    expect(proactiveDryRunSummary({ tool: "GMAIL_SEND_EMAIL" })).toBe("GMAIL_SEND_EMAIL");
    expect(proactiveDryRunSummary({ tool: "Bash", command: "echo hi" })).toBe("Bash: echo hi");
    const long = "x".repeat(200);
    expect(proactiveDryRunSummary({ tool: "Bash", command: long }).length).toBeLessThan(140);
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
    expect(budget.mayInitiate("b")).toBe(false);
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

describe("the engine ties the budget to the decision", () => {
  function engine(now: () => number) {
    const bots = new Map<string, { proactiveMode?: unknown }>([
      ["off", { proactiveMode: "off" }],
      ["on", { proactiveMode: "proactive" }],
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
    now += 2000;
    expect(e.consider("on", { tool: "GMAIL_SEND_EMAIL" }).acted).toBe(true);
  });

  it("stops initiating once the budget is spent (bounded, server-side)", () => {
    let now = 1_000;
    const e = engine(() => now);
    expect(e.consider("on", { tool: "GMAIL_SEND_EMAIL" }).acted).toBe(true);
    now += 1_100;
    expect(e.consider("on", { tool: "GMAIL_SEND_EMAIL" }).acted).toBe(true);
    now += 1_100;
    const third = e.consider("on", { tool: "GMAIL_SEND_EMAIL" });
    expect(third.acted).toBe(false);
    expect(third.reason).toBe("budget");
  });

  it("holds a bot to its minimum interval between cycles", () => {
    let now = 5_000;
    const e = engine(() => now);
    expect(e.consider("on", { tool: "GMAIL_FETCH_EMAILS" }).acted).toBe(true);
    expect(e.consider("on", { tool: "GMAIL_FETCH_EMAILS" }).acted).toBe(false);
    now += 1_100;
    expect(e.consider("on", { tool: "GMAIL_FETCH_EMAILS" }).acted).toBe(true);
  });

  it("decideStep gates without spending budget (a wake's per-tool check)", () => {
    let now = 1_000;
    const e = engine(() => now);
    const first = e.decideStep("on", { tool: "GMAIL_SEND_EMAIL" });
    expect(first).toMatchObject({ dryRun: true, execute: true });
    const second = e.decideStep("on", { tool: "GMAIL_SEND_EMAIL" });
    expect(second).toMatchObject({ dryRun: true, execute: true });
    // budget still free for a real consider
    expect(e.consider("on", { tool: "GMAIL_FETCH_EMAILS" }).acted).toBe(true);
  });
});
