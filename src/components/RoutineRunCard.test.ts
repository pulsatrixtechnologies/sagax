import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { RoutineRunCardData } from "../../shared/routine-run";
import type { Message } from "@/state/store";
import { hasRoutineExecutionTask, RoutineRunCard } from "./RoutineRunCard";

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

describe("RoutineRunCard", () => {
  it("dates the receipt by its scheduled occurrence, with a legacy message-time fallback", () => {
    const at = Date.UTC(2026, 8, 9, 9);
    const dated = renderToStaticMarkup(createElement(RoutineRunCard, { message: message("completed", { scheduledFor: at }) }));
    expect(dated).toContain(`dateTime="${new Date(at).toISOString()}"`);
    const legacy = renderToStaticMarkup(createElement(RoutineRunCard, { message: message("completed") }));
    expect(legacy).toContain('dateTime="1970-01-01T00:00:00.001Z"');
  });
  // 2026-10-22 (owner): one concise message, the bot's report only.
  // 2026-11-04 (JC): a card again: the routine's name as its title, a
  // Done pill, and a View run button.
  // 2026-11-05 (the operator, #2081): a finished report is the bot's message, not a
  // card: a provenance line (Routine · name · Done · time · View run) and the
  // bot's own bubble with the report as markdown. No border, no card chrome.
  it("reads a finished report as the bot's message under a provenance line, never as a card", () => {
    const markup = renderToStaticMarkup(createElement(RoutineRunCard, {
      message: message("completed", { summary: "The brief is ready with **three** follow-ups." }),
      onOpen: vi.fn(),
    }));

    expect(markup).toContain("<strong>three</strong>");
    expect(markup).toContain("data-routine-run-plain");
    expect(markup).toContain("data-routine-run-provenance");
    expect(markup).toMatch(/<h3[^>]*>Morning brief<\/h3>/);
    expect(markup).toMatch(/data-routine-run-status[^>]*>Done<\/span>/);
    expect(markup).toContain("View run");
    expect(markup).toContain('aria-label="View run for Morning brief"');
    expect(markup).toContain('aria-label="Morning brief routine run: Done"');
    expect(markup).toMatch(/data-routine-run-bubble[^>]*class="[^"]*bg-bubble-bot/);
    expect(markup).not.toContain("rounded-2xl border bg-card");
    expect(markup).not.toContain("pl-[42px]");
  });

  it("widens the bubble for a report with a table, as a bot reply with one", () => {
    const table = "| Board | Open |\n|---|---|\n| Service desk | 41 |\n| Projects | 18 |";
    const wide = renderToStaticMarkup(createElement(RoutineRunCard, { message: message("completed", { summary: table }) }));
    const narrow = renderToStaticMarkup(createElement(RoutineRunCard, { message: message("completed", { summary: "All good." }) }));
    expect(wide).toMatch(/data-routine-run-bubble[^>]*class="[^"]*w-full/);
    expect(narrow).toMatch(/data-routine-run-bubble[^>]*class="[^"]*w-fit/);
  });

  // 2026-11-05 (the operator: "I don't need to see the routines, only their result"):
  // no card for any state. Done with problems or with a hand-off: the
  // message, the status named in the grey line, the hand-off a grey line.
  it("never draws a card: problems and hand-offs are grey lines around the message", () => {
    const problems = renderToStaticMarkup(createElement(RoutineRunCard, {
      message: message("completed", { summary: "Counted 42 items.", problems: "One page did not load." }),
      onOpen: vi.fn(),
    }));
    expect(problems).not.toContain("data-routine-run-plain");
    expect(problems).not.toContain("rounded-2xl border bg-card");
    expect(problems).toMatch(/data-routine-run-status[^>]*class="[^"]*text-warning[^>]*>Completed with problems<\/span>/);
    expect(problems).toMatch(/data-routine-run-bubble[^>]*class="[^"]*bg-bubble-bot/);
    const handoff = renderToStaticMarkup(createElement(RoutineRunCard, {
      message: message("completed", { summary: "Sent.", handedTo: [{ botId: "nova", threadId: "nova-work", name: "Nova", status: "running" }] }),
    }));
    expect(handoff).toContain("data-routine-run-plain");
    expect(handoff).not.toContain("rounded-2xl border bg-card");
    expect(handoff).toMatch(/<li[^>]*data-run-handoff="nova"[^>]*class="[^"]*text-\[11px\]|data-run-handed-to[^>]*class="[^"]*text-\[11px\]/);
    expect(handoff).toContain("Sent work to Nova");
    expect(handoff).toMatch(/data-run-handoff-status[^>]*>Running</);
    // threads hidden (no onOpenThread): the teammate is named, never linked
    expect(handoff).not.toContain("data-run-teammate-thread");
    expect(handoff).not.toContain("thread");
  });

  // A plain Done says nothing in the line: the status node stays for
  // screen readers and the flash rule, hidden to the eye.
  it("hides the Done status and the routine's name from the line; both wait under Details", () => {
    const markup = renderToStaticMarkup(createElement(RoutineRunCard, { message: message("completed", { summary: "All good." }), onOpen: vi.fn() }));
    expect(markup).toMatch(/data-routine-run-status[^>]*class="[^"]*sr-only/);
    expect(markup).toMatch(/<details[^>]*data-routine-run-provenance/);
    expect(markup).toMatch(/<summary[^>]*>.*Routine.*Details.*<\/summary>/);
    expect(markup).not.toMatch(/<summary[^>]*>.*Morning brief.*<\/summary>/);
    expect(markup).not.toMatch(/<summary[^>]*>.*View run.*<\/summary>/);
    expect(markup).toMatch(/data-routine-run-details[^>]*>.*Morning brief.*View run/);
    expect(markup).not.toContain("data-routine-run-quiet");
  });

  it("a quiet run (nothing to report, no text) is the grey line alone", () => {
    const markup = renderToStaticMarkup(createElement(RoutineRunCard, { message: message("nothing_to_report"), onOpen: vi.fn() }));
    expect(markup).toContain("data-routine-run-quiet");
    expect(markup).not.toContain("data-routine-run-bubble");
    expect(markup).toMatch(/data-routine-run-status[^>]*>Nothing to report</);
  });

  it("shows a long report whole, as the bot wrote it", () => {
    const summary = `The brief is ready. ${"Detailed result. ".repeat(25)}\n\nFinal follow-up.`;
    const markup = renderToStaticMarkup(createElement(RoutineRunCard, {
      message: message("completed", { summary }),
      onOpen: vi.fn(),
    }));

    expect(markup).toContain("Final follow-up.");
    expect(markup).not.toContain("data-run-result-details");
  });

  it("names a run that ended with nothing to report after it waited on the person", () => {
    const markup = renderToStaticMarkup(createElement(RoutineRunCard, { message: message("nothing_to_report"), onOpen: vi.fn() }));
    expect(markup).toContain("Nothing to report");
    expect(markup).toMatch(/<h3[^>]*>Morning brief<\/h3>/);
  });

  it("keeps a terminal team-goal outcome distinct from scheduler completion", () => {
    const markup = renderToStaticMarkup(createElement(RoutineRunCard, {
      message: message("completed", { goalStatus: "blocked", summary: "The team needs a missing credential." }),
      onOpen: vi.fn(),
    }));

    expect(markup).toContain("Blocked");
    expect(markup).not.toContain(">Completed<");
    expect(markup).toContain("The team needs a missing credential.");
  });

  it("labels a queued run held behind a busy target as deferred", () => {
    const markup = renderToStaticMarkup(createElement(RoutineRunCard, {
      message: message("queued", { deferredAt: Date.UTC(2026, 8, 14, 12) }),
    }));

    expect(markup).toContain("Deferred: target busy");
    expect(markup).not.toContain("Queued");
    expect(markup).toContain('aria-label="Morning brief routine run: Deferred: target busy"');
  });

  it("keeps the plain queued label when no deferral was recorded", () => {
    const markup = renderToStaticMarkup(createElement(RoutineRunCard, { message: message("queued") }));

    expect(markup).toContain("Queued");
    expect(markup).not.toContain("Deferred: target busy");
  });

  it("does not describe delegated work as a question or approval", () => {
    const markup = renderToStaticMarkup(createElement(RoutineRunCard, {
      message: message("waiting", { summary: "Waiting for delegated work to finish." }),
      onOpen: vi.fn(),
    }));

    expect(markup).toContain("Waiting for delegated work to finish.");
    expect(markup).toContain("View run");
    expect(markup).not.toContain("Needs your input");
    expect(markup).not.toContain("Review");
  });

  it("keeps an explicit team-goal input request actionable", () => {
    const markup = renderToStaticMarkup(createElement(RoutineRunCard, {
      message: message("waiting", { goalStatus: "needs-input", summary: "Which region should I use?" }),
      onOpen: vi.fn(),
    }));
    expect(markup).toContain("Needs your input");
    expect(markup).toContain('aria-label="Review for Morning brief"');
  });

  it("shows a concise error without dumping a verbose run log into chat", () => {
    const verbose = `Provider failed ${"trace-line ".repeat(100)}`;
    const markup = renderToStaticMarkup(createElement(RoutineRunCard, {
      message: message("failed", { error: verbose }),
      onOpen: vi.fn(),
    }));

    expect(markup).toContain("Failed");
    expect(markup).toContain("Provider failed");
    expect(markup).toContain("…");
    expect(markup).not.toContain(verbose);
  });

  it("keeps a concise text fallback visible for an incomplete or newer payload", () => {
    const legacy: Message = {
      id: "legacy-run",
      role: "bot",
      kind: "routine.run",
      at: 1,
      text: "Morning brief completed.",
    };

    const markup = renderToStaticMarkup(createElement(RoutineRunCard, { message: legacy }));
    expect(markup).toContain("Morning brief completed.");
  });

  it("offers View run without an execution thread: the run's detail opens, to read (2026-10-29)", () => {
    const markup = renderToStaticMarkup(createElement(RoutineRunCard, {
      message: message("missed", { executionThreadId: undefined, error: "Computer was offline." }),
      onOpen: vi.fn(),
    }));

    expect(markup).toContain("Missed");
    expect(markup).toContain("View run");
    expect(renderToStaticMarkup(createElement(RoutineRunCard, { message: message("missed") }))).not.toContain("View run");
  });

  it("recognizes only an execution thread still present in the owning bot's tasks", () => {
    const tasks = [{ threadId: "source-thread" }, { threadId: "execution-thread" }];

    expect(hasRoutineExecutionTask(tasks, "execution-thread")).toBe(true);
    expect(hasRoutineExecutionTask(tasks, "deleted-thread")).toBe(false);
    expect(hasRoutineExecutionTask(undefined, "execution-thread")).toBe(false);
  });

  it("says the failure paused its routine and offers Resume only when given (2026-10-26)", () => {
    const paused = message("failed", { error: "engine unavailable", autoPausedAfter: 5 });
    const withResume = renderToStaticMarkup(createElement(RoutineRunCard, { message: paused, onResume: () => {} }));
    expect(withResume).toContain('data-routine-auto-paused="5"');
    expect(withResume).toContain("Paused after 5 failures in a row");
    expect(withResume).toContain("data-routine-resume");
    expect(withResume).toContain("engine unavailable");
    const noResume = renderToStaticMarkup(createElement(RoutineRunCard, { message: paused }));
    expect(noResume).not.toContain("data-routine-resume");
    const plain = renderToStaticMarkup(createElement(RoutineRunCard, { message: message("failed", { error: "x" }), onResume: () => {} }));
    expect(plain).not.toContain("data-routine-auto-paused");
    expect(plain).not.toContain("data-routine-resume");
    expect(renderToStaticMarkup(createElement(RoutineRunCard, { message: message("failed", { autoPausedAfter: 1 }) }))).toContain("Paused after a failure");
  });
  it("says a run completed with problems, the details only in the run detail (2026-11-03)", () => {
    const html = renderToStaticMarkup(createElement(RoutineRunCard, { message: message("completed", { summary: "Checked 10 invoices.", problems: "crm_login failed 2 times" }) }));
    expect(html).toContain("Checked 10 invoices.");
    expect(html).not.toContain("data-routine-problems");
    expect(html).not.toContain("crm_login failed");
    expect(html).toContain("Completed with problems");
  });

  it("says why a queued run has not started (2026-11-01)", () => {
    const html = renderToStaticMarkup(createElement(RoutineRunCard, { message: message("queued", { deferredAt: 1, attention: "Waits for the previous run of this routine to finish" }) }));
    expect(html).toContain("Waits for the previous run of this routine to finish");
  });

  // 2026-11-03 production: the bubble and the card were a lone "{".
  it("a blocked run's bubble says why in one line, the same as the run list, and links the teammate thread", () => {
    const html = renderToStaticMarkup(createElement(RoutineRunCard, {
      message: message("blocked", { error: "{", handedTo: [{ botId: "nova", threadId: "teammate-thread", name: "Nova", status: "running" }] }),
      onOpen: () => {}, onOpenThread: () => {},
    }));
    expect(html).toContain("Blocked: waiting for Nova");
    expect(html).not.toMatch(/>\{</);
    expect(html).toContain('data-run-teammate-thread="teammate-thread"');
    expect(html).toContain("text-warning");
  });

  it("a JSON report reads as plain sentences with Show details", () => {
    const summary = '{\n  "summary": "Bank watch updated",\n  "todo": ["Approve sheet 100203"]\n}';
    const html = renderToStaticMarkup(createElement(RoutineRunCard, { message: message("completed", { summary }) }));
    expect(html).toContain("Bank watch updated");
    expect(html).toContain("For you: Approve sheet 100203");
    expect(html).toContain("data-run-result-details");
  });
  // With threads shown (onOpenThread given), the hand-off line links the
  // teammate's thread; one row per run, never a second section.
  it("shows a hand-off as a grey line with its status and, threads shown, an Open thread link", () => {
    const markup = renderToStaticMarkup(createElement(RoutineRunCard, {
      message: message("nothing_to_report", { handedTo: [{ botId: "nova", threadId: "nova-work", name: "Nova", status: "completed" }] }),
      onOpen: () => {},
      onOpenThread: () => {},
    }));
    expect(markup).toContain("data-routine-run-card");
    expect(markup).toContain('data-run-handoff="nova"');
    expect(markup).toContain("Sent work to Nova");
    expect(markup).toContain('data-run-teammate-thread="nova-work"');
    expect(markup).toContain("Open Nova&#x27;s thread");
    expect(markup.match(/data-routine-run-card/g)).toHaveLength(1);
  });

  it("a running run is one live row: a spinner, how long it has run, and a live strip", () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 10, 4, 21, 0));
    try {
      const markup = renderToStaticMarkup(createElement(RoutineRunCard, {
        message: message("running", { startedAt: Date.UTC(2026, 10, 4, 20, 58) }),
      }));
      expect(markup).toMatch(/data-routine-run-status[^>]*>.*Running<\/span>/);
      expect(markup).toContain("animate-spin");
      expect(markup).toContain("data-routine-run-elapsed");
      expect(markup).toContain("2 min");
      expect(markup).toContain("data-routine-run-live");
      const done = renderToStaticMarkup(createElement(RoutineRunCard, { message: message("completed", { startedAt: Date.UTC(2026, 10, 4, 20, 58), summary: "All good." }) }));
      expect(done).not.toContain("data-routine-run-live");
      expect(done).not.toContain("data-routine-run-elapsed");
    } finally {
      vi.useRealTimers();
    }
  });
});
