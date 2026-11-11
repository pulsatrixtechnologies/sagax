import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { RoutineRunCardData } from "../../shared/routine-run";
import type { Message } from "@/state/store";
import { hasRoutineExecutionTask, RoutineRunCard } from "./RoutineRunCard";
import { setLocale } from "@/lib/i18n";
import { formatTime } from "@/state/store";
import { dayLabel } from "@/lib/transcript-derivations";

function message(
  status: RoutineRunCardData["status"],
  patch: Partial<RoutineRunCardData> = {},
): Message {
  return {
    id: "routine-run-card",
    role: "bot",
    kind: "routine.run",
    at: 1,
    text: "Morning brief routine update",
    routineRun: {
      runId: "run-1",
      routineId: "routine-1",
      routineName: "Morning brief",
      status,
      executionThreadId: "execution-thread",
      ...patch,
    },
  };
}

const draw = (props: Parameters<typeof RoutineRunCard>[0]) => renderToStaticMarkup(createElement(RoutineRunCard, props));
/** The text a person reads in the card or row, tags removed. */
const words = (markup: string) => markup.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'");

// A real-shaped long report: headings, two tables, a list, and the closing
// line the run contract asks for.
const LONG_REPORT = `Here is this evening's dispatch pass.

## Board state

| Board | Open | Unassigned | Over SLA |
|---|---|---|---|
| Service desk | 41 | 3 | 2 |
| Projects | 18 | 0 | 0 |

${"Three tickets waited on a client answer for more than five days; I sent the follow-up note on each one. ".repeat(20)}

## Left alone

- #4790: the client asked to wait until Monday.
- #4801: the parts order is in transit.

3 tickets reassigned, 2 over SLA; nothing else needs a decision tonight.`;

describe("RoutineRunCard (#3581): a result is the chat's compact card, its report behind Details", () => {
  it("a finished run with a 3,000 character report is an AskCard with at most two lines and no report bubble", () => {
    expect(LONG_REPORT.length).toBeGreaterThan(2_000);
    const markup = draw({ message: message("completed", { summary: LONG_REPORT }), onOpen: vi.fn() });
    expect(markup).toContain('data-ask-card="result"');
    expect(markup).toContain('data-routine-run-form="card"');
    expect(markup).not.toContain("data-routine-run-bubble");
    expect(markup).not.toContain("<table");
    expect(markup).not.toContain("Board state");
    // the brief: the closing line, two lines at most
    expect(markup).toMatch(/data-routine-run-brief[^>]*class="line-clamp-2"[^>]*>3 tickets reassigned, 2 over SLA; nothing else needs a decision tonight.</);
    expect(markup).toMatch(/data-routine-run-name[^>]*>Morning brief</);
    // a finished result without problems has no state word
    expect(markup).not.toContain("data-routine-run-status");
    expect(markup).toMatch(/data-routine-run-open[^>]*>Details/);
    expect(markup).toContain('aria-label="View run for Morning brief"');
    expect(markup).toContain('aria-label="Morning brief routine run: Done"');
  });

  it("a card stored without a brief shows the brief the server would have written", () => {
    const stored = draw({ message: message("completed", { summary: LONG_REPORT }) });
    const written = draw({ message: message("completed", { summary: LONG_REPORT, brief: "3 tickets reassigned, 2 over SLA; nothing else needs a decision tonight." }) });
    expect(stored).toBe(written);
  });

  it("Details opens the run", () => {
    const onOpen = vi.fn();
    const markup = draw({ message: message("completed", { summary: "All green." }), onOpen });
    expect(markup).toMatch(/<button[^>]*data-routine-run-open/);
    expect(draw({ message: message("completed", { summary: "All green." }) })).not.toContain("data-routine-run-open");
  });

  it("no terminal font and no pill in the card or the row", () => {
    for (const status of ["completed", "running", "queued", "failed", "nothing_to_report", "blocked"] as const) {
      const markup = draw({ message: message(status, { summary: "All green.", startedAt: 1 }), onOpen: vi.fn(), onStop: vi.fn() });
      expect(markup, status).not.toContain("font-mono");
      expect(markup, status).not.toContain("rounded-full border");
    }
  });

  it("a folded result is the one quiet row: tick, name, brief, time, Details", () => {
    const markup = draw({ message: message("completed", { summary: LONG_REPORT }), folded: true, onOpen: vi.fn() });
    expect(markup).toContain('data-ask-card="settled"');
    expect(markup).toContain('data-routine-run-form="row"');
    expect(markup).not.toContain('data-ask-card="result"');
    expect(words(markup)).toContain("Morning brief · 3 tickets reassigned, 2 over SLA; nothing else needs a decision tonight. · ");
    expect(markup).toMatch(/data-routine-run-open[^>]*>Details/);
  });

  it("a result with problems stays a card with its state line and the count of a lasting problem", () => {
    const markup = draw({
      message: message("completed", { summary: "The mailbox refused the sign-in, so 4 messages were not sorted. Sign in again from Connect apps.", problems: "sign-in refused",
        repeat: { firstRunId: "run-0", count: 4, since: Date.UTC(2026, 10, 9, 19), lastAt: Date.UTC(2026, 10, 11, 13) } }),
      onOpen: vi.fn(),
    });
    expect(markup).toContain('data-routine-run-form="card"');
    expect(markup).toMatch(/data-routine-run-status="[^"]*" class="text-warning">Completed with problems/);
    expect(markup).toContain("4 runs in a row");
    expect(markup).toContain("Sign in again from Connect apps.");
    // the problem lines themselves stay in the run window (2026-11-03)
    expect(markup).not.toContain("sign-in refused");
    expect(markup).toContain("text-warning");
  });

  it("works again: said once, in the card's state line", () => {
    const markup = draw({ message: message("nothing_to_report", { recovered: { afterRuns: 7, since: Date.UTC(2026, 10, 9) } }), onOpen: vi.fn() });
    expect(markup).toContain('data-routine-run-form="card"');
    expect(markup).toContain("data-routine-run-recovered");
  });

  it("a blocked run is a card that says why in one line", () => {
    const html = draw({
      message: message("blocked", { error: "{", handedTo: [{ botId: "bot-b", threadId: "teammate-thread", name: "Bot B", status: "running" }] }),
      onOpen: () => {}, onOpenThread: () => {},
    });
    expect(html).toContain('data-routine-run-form="card"');
    expect(html).toContain("Blocked: waiting for Bot B");
    expect(html).not.toMatch(/>\{</);
    expect(html).toContain('data-run-teammate-thread="teammate-thread"');
  });

  it("a team goal waiting on the person keeps its words and its Review label", () => {
    const markup = draw({ message: message("waiting", { goalStatus: "needs-input", summary: "Which region should I use?" }), onOpen: vi.fn() });
    expect(markup).toContain("Needs your input");
    expect(markup).toContain('aria-label="Review for Morning brief"');
    const blocked = draw({ message: message("completed", { goalStatus: "blocked", summary: "The team needs a missing credential." }), onOpen: vi.fn() });
    expect(blocked).toContain("Blocked");
    expect(blocked).not.toContain(">Completed<");
    expect(blocked).toContain("The team needs a missing credential.");
  });

  it("items for the person stay on the card", () => {
    const markup = draw({
      message: { ...message("completed", { summary: "Two invoices wait for you." }), attention: { kind: "human", items: [{ text: "Approve sheet 100203" }], botId: "b", botName: "Bot B", threadId: "t", sourceMessageId: "m" } } as Message,
    });
    expect(markup).toContain('data-routine-run-form="card"');
    expect(markup).toContain("data-routine-run-attention");
    expect(markup).toContain("Approve sheet 100203");
  });

  it("a pass with nothing for the person is one quiet row", () => {
    const markup = draw({ message: message("nothing_to_report"), onOpen: vi.fn() });
    expect(markup).toContain('data-routine-run-form="row"');
    expect(words(markup)).toContain("Morning brief · Nothing to report");
    expect(markup).toContain('aria-label="Morning brief routine run: Nothing to report"');
  });

  it("a running run is one live row: spinner, Running, how long, Details and Stop", () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 10, 4, 21, 0));
    try {
      const markup = draw({ message: message("running", { startedAt: Date.UTC(2026, 10, 4, 20, 58) }), onOpen: vi.fn(), onStop: vi.fn() });
      expect(markup).toContain('data-routine-run-form="row"');
      expect(markup).toContain("data-coding-spinner");
      expect(markup).toMatch(/data-routine-run-status[^>]*>Running</);
      expect(markup).toContain("thinking-shimmer");
      expect(markup).toContain("2 min");
      expect(markup).toContain("data-run-stop");
      const done = draw({ message: message("completed", { startedAt: Date.UTC(2026, 10, 4, 20, 58), summary: "All good." }), onStop: vi.fn() });
      expect(done).not.toContain("data-run-stop");
      expect(done).not.toContain("data-routine-run-elapsed");
    } finally {
      vi.useRealTimers();
    }
  });

  it("dates the result by when it posted; the trigger time is in the tooltip (2026-11-06)", () => {
    const triggered = Date.UTC(2026, 10, 7, 0, 28);
    const posted = Date.UTC(2026, 10, 7, 0, 35);
    const html = draw({ message: { ...message("completed", { scheduledFor: triggered, summary: "All green." }), at: posted } });
    expect(html).toContain(`dateTime="${new Date(posted).toISOString()}"`);
    expect(html).toMatch(/<time[^>]*title="[^"]+"/);
    const same = draw({ message: { ...message("completed", { scheduledFor: posted - 5_000, summary: "All green." }), at: posted } });
    expect(same).not.toMatch(/<time[^>]*title=/);
  });

  // #3581: as the chat's own stamps, a result of today shows its time only;
  // another day's result shows the day before the time.
  it("shows the time alone today and the day before it otherwise", () => {
    const today = new Date();
    today.setHours(1, 30, 0, 0);
    const timeOf = (at: number) => draw({ message: { ...message("completed", { summary: "All 12 backups completed tonight." }), at }, onOpen: vi.fn() }).match(/<time[^>]*>([^<]*)<\/time>/)![1];
    expect(timeOf(today.getTime())).toBe(formatTime(today.getTime()));
    const before = today.getTime() - 3 * 86_400_000;
    expect(timeOf(before)).toBe(`${dayLabel(before)} ${formatTime(before)}`);
    expect(timeOf(before)).not.toBe(formatTime(before));
  });

  it("labels a queued run held behind a busy target as deferred, and says why", () => {
    const markup = draw({ message: message("queued", { deferredAt: Date.UTC(2026, 8, 14, 12), attention: "Waits for the previous run of this routine to finish" }) });
    expect(markup).toContain("Deferred: target busy");
    expect(markup).toContain("Waits for the previous run of this routine to finish");
    expect(draw({ message: message("queued") })).toContain("Queued");
  });

  it("a failure in the banner: one row with its reason, and Resume when it paused the routine (2026-10-26)", () => {
    const verbose = `Provider failed ${"trace-line ".repeat(100)}`;
    const failed = draw({ message: message("failed", { error: verbose }), onOpen: vi.fn() });
    expect(failed).toContain('data-routine-run-form="row"');
    expect(failed).toContain("Provider failed");
    expect(failed).not.toContain(verbose);
    const paused = message("failed", { error: "engine unavailable", autoPausedAfter: 5 });
    const withResume = draw({ message: paused, onResume: () => {} });
    expect(withResume).toContain('data-routine-auto-paused="5"');
    expect(withResume).toContain("Paused after 5 failures in a row");
    expect(withResume).toContain("data-routine-resume");
    expect(draw({ message: paused })).not.toContain("data-routine-resume");
    expect(draw({ message: message("failed", { error: "x" }), onResume: () => {} })).not.toContain("data-routine-resume");
  });

  it("never draws two separators in a row, whatever parts are present", () => {
    for (const props of [
      { message: message("running", { startedAt: Date.now() - 4 * 60_000 }), onOpen: vi.fn(), onStop: vi.fn() },
      { message: message("running"), onStop: vi.fn() },
      { message: message("queued") },
      { message: message("completed", { summary: "All done." }), folded: true },
      { message: { ...message("nothing_to_report"), routineRun: { ...message("nothing_to_report").routineRun!, routineName: "" } } },
    ]) {
      const text = words(draw(props));
      expect(text).not.toMatch(/·\s*·/);
      expect(text.trim()).not.toMatch(/^·|·$/);
    }
  });

  it("a JSON report reads as its summary field, the structure behind Details", () => {
    const summary = '{\n  "summary": "Bank watch updated",\n  "todo": ["Approve sheet 100203"]\n}';
    const html = draw({ message: message("completed", { summary }) });
    expect(html).toMatch(/data-routine-run-brief[^>]*>Bank watch updated</);
    expect(html).not.toContain("{");
  });

  it("the teammates it asked are the quiet Asked line, named without a thread link when threads are hidden", () => {
    const handoff = draw({ message: message("completed", { summary: "Sent.", handedTo: [{ botId: "bot-b", threadId: "bot-b-work", name: "Bot B", status: "running" }] }) });
    expect(handoff).toContain('data-testid="delegation-line"');
    expect(handoff).toContain("Bot B");
    expect(handoff).toContain("Asking");
    expect(handoff).not.toContain("data-run-teammate-thread");
    const quiet = draw({ message: message("nothing_to_report", { handedTo: [{ botId: "bot-b", threadId: "bot-b-work", name: "Bot B", status: "completed" }] }), onOpen: () => {}, onOpenThread: () => {} });
    expect(quiet).toContain('data-run-teammate-thread="bot-b-work"');
    expect(quiet.match(/data-routine-run-card/g)).toHaveLength(1);
  });

  it("the Asked line sits flush with the card's other lines, never centered, also once its names wrap", () => {
    const handedTo = ["Bot B", "Bot C", "Bot D", "Bot E", "Bot F"].map((name, index) => ({ botId: `bot-${index}`, threadId: `work-${index}`, name, status: "completed" as const }));
    const html = draw({ message: message("completed", { summary: "Reviewed.", handedTo }) });
    const row = /<div class="([^"]*)" data-testid="delegation-line"/.exec(html)?.[1] ?? "";
    expect(row).toContain("justify-start");
    expect(row).not.toContain("justify-center");
    const line = new RegExp('data-testid="delegation-line"[^>]*><div class="([^"]*)"').exec(html)?.[1] ?? "";
    expect(line).toContain("px-0");
    expect(line).not.toContain("justify-center");
  });

  it("keeps a concise text fallback visible for an incomplete or newer payload", () => {
    const legacy: Message = { id: "legacy-run", role: "bot", kind: "routine.run", at: 1, text: "Morning brief completed." };
    expect(draw({ message: legacy })).toContain("Morning brief completed.");
  });

  it("recognizes only an execution thread still present in the owning bot's tasks", () => {
    const tasks = [{ threadId: "source-thread" }, { threadId: "execution-thread" }];
    expect(hasRoutineExecutionTask(tasks, "execution-thread")).toBe(true);
    expect(hasRoutineExecutionTask(tasks, "deleted-thread")).toBe(false);
    expect(hasRoutineExecutionTask(undefined, "execution-thread")).toBe(false);
  });
});

// #3581 (review): the row's "state: why" line is a locale key, so French
// reads "En attente : ..." with its space before the colon.
describe("RoutineRunCard row state line", () => {
  it("is written by the locale, never glued in code", () => {
    try {
      setLocale("fr");
      const waiting = words(draw({ message: message("waiting", { attention: "Attend ta réponse" }), folded: true, onOpen: vi.fn() }));
      expect(waiting).toMatch(/\S : Attend ta réponse/);
      const failed = words(draw({ message: message("failed", { error: "Le jeton a expiré." }), folded: true, onOpen: vi.fn() }));
      expect(failed).toMatch(/\S : Le jeton a expiré/);
      setLocale("en");
      expect(words(draw({ message: message("failed", { error: "The token expired." }), folded: true, onOpen: vi.fn() }))).toMatch(/\S: The token expired/);
    } finally {
      setLocale("en");
    }
  });
});
