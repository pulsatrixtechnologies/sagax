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
  it("dates the bubble by when it posted, so the chat reads in order; the trigger time is in the tooltip (2026-11-06)", () => {
    const triggered = Date.UTC(2026, 10, 7, 0, 28);
    const posted = Date.UTC(2026, 10, 7, 0, 35);
    const html = renderToStaticMarkup(createElement(RoutineRunCard, { message: { ...message("completed", { scheduledFor: triggered }), at: posted } }));
    expect(html).toContain(`dateTime="${new Date(posted).toISOString()}"`);
    expect(html).not.toContain(`dateTime="${new Date(triggered).toISOString()}"`);
    expect(html).toMatch(/<time[^>]*title="[^"]+"/);
    const same = renderToStaticMarkup(createElement(RoutineRunCard, { message: { ...message("completed", { scheduledFor: posted - 5_000 }), at: posted } }));
    expect(same).not.toMatch(/<time[^>]*title=/);
  });
  // 2026-10-22 (owner): one concise message, the bot's report only.
  // 2026-11-04 (the owner): a card again: the routine's name as its title, a
  // Done pill, and a View run button.
  // 2026-11-05 (the operator, #2081): a finished report is the bot's message, not a
  // card: a provenance line (Routine · name · Done pill · time · View run) above
  // the bot's own bubble with the report as markdown. No border, no card chrome.
  // 2026-11-06 (the owner, #2272 follow-up): a routine's run in the chat is only
  // its RESULT, a plain bot message like the reference app's. No card, no badge, no
  // "Proactive: ..." title, no "Routine · date", no "View run"; the run's
  // detail one discreet "Details" away.
  it("reads a finished report as the bot's message under a quiet line, never as a card", () => {
    const markup = renderToStaticMarkup(createElement(RoutineRunCard, {
      message: message("completed", { summary: "The brief is ready with **three** follow-ups." }),
      onOpen: vi.fn(),
    }));

    expect(markup).toContain("<strong>three</strong>");
    expect(markup).toContain("data-routine-run-plain");
    expect(markup).toContain("data-routine-run-provenance");
    expect(markup).not.toMatch(/<h3/);
    expect(markup).not.toContain("data-routine-run-status");
    expect(markup).not.toMatch(/>View run</);
    expect(markup).not.toMatch(/>Routine</);
    expect(markup).toMatch(/data-routine-run-open[^>]*>Details/);
    expect(markup).toContain('aria-label="View run for Morning brief"');
    expect(markup).toContain('aria-label="Morning brief routine run: Done"');
    expect(markup).toMatch(/data-routine-run-bubble[^>]*class="[^"]*bg-bubble-bot/);
    expect(markup).not.toContain("rounded-2xl border bg-card");
    expect(markup).not.toContain("rounded-full border");
    expect(markup).not.toContain("pl-[42px]");
  });

  it("widens the bubble for a report with a table, as a bot reply with one", () => {
    const table = "| Board | Open |\n|---|---|\n| Service desk | 41 |\n| Projects | 18 |";
    const wide = renderToStaticMarkup(createElement(RoutineRunCard, { message: message("completed", { summary: table }) }));
    const narrow = renderToStaticMarkup(createElement(RoutineRunCard, { message: message("completed", { summary: "All good." }) }));
    expect(wide).toMatch(/data-routine-run-bubble[^>]*class="[^"]*w-full/);
    expect(narrow).toMatch(/data-routine-run-bubble[^>]*class="[^"]*w-fit/);
  });

  // #2081: status cards stay for real states (done with problems, nothing to
  // report, running...). A clean finished report with a hand-off keeps the
  // plain message; the hand-off is a grey line under it.
  it("a report with problems or a hand-off is still a plain message, never a red card", () => {
    const problems = renderToStaticMarkup(createElement(RoutineRunCard, {
      message: message("completed", { summary: "Counted 42 items.", problems: "One page did not load." }),
      onOpen: vi.fn(),
    }));
    expect(problems).toContain("data-routine-run-plain");
    expect(problems).not.toContain("rounded-2xl border bg-card");
    expect(problems).not.toMatch(/text-danger|bg-danger|border-danger/);
    expect(problems).toMatch(/data-routine-run-status[^>]*>Completed with problems<\/span>/);
    expect(problems).toContain("Counted 42 items.");
    const handoff = renderToStaticMarkup(createElement(RoutineRunCard, {
      message: message("completed", { summary: "Sent.", handedTo: [{ botId: "nova", threadId: "nova-work", name: "Nova", status: "running" }] }),
    }));
    expect(handoff).toContain("data-routine-run-plain");
    expect(handoff).not.toContain("rounded-2xl border bg-card");
    expect(handoff).toContain("data-run-handed-to");
    expect(handoff).toContain("Sent work to Nova");
    expect(handoff).toContain("Planning next moves");
    expect(handoff).toContain("data-delegation-waiting");
    // threads hidden (no onOpenThread): the teammate is named, never linked
    expect(handoff).not.toContain("data-run-teammate-thread");
    expect(handoff).not.toContain("thread");
  });

  it("a pass with nothing for the person is one muted line, no bubble", () => {
    const markup = renderToStaticMarkup(createElement(RoutineRunCard, { message: message("nothing_to_report"), onOpen: vi.fn() }));
    expect(markup).toContain("data-routine-run-quiet");
    expect(markup).toContain("data-routine-run-plain");
    expect(markup).toContain("opacity-70");
    expect(markup).not.toContain("rounded-2xl border bg-card");
    expect(markup).not.toContain("data-routine-run-bubble");
    expect(markup).toMatch(/data-routine-run-status[^>]*>Nothing to report</);
    expect(markup).not.toMatch(/<h3/);
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
    expect(markup).toContain('aria-label="Morning brief routine run: Nothing to report"');
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
    expect(markup).toContain("Details");
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

  it("offers Details without an execution thread: the run's detail opens, to read (2026-10-29)", () => {
    const markup = renderToStaticMarkup(createElement(RoutineRunCard, {
      message: message("missed", { executionThreadId: undefined, error: "Computer was offline." }),
      onOpen: vi.fn(),
    }));

    expect(markup).toContain("Missed");
    expect(markup).toMatch(/data-routine-run-open[^>]*>Details/);
    expect(renderToStaticMarkup(createElement(RoutineRunCard, { message: message("missed") }))).not.toContain("data-routine-run-open");
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

  // 2026-11-06 (#2186): a routine result with ```widget-imperfect draws as a
  // widget, never as a raw CodeBlock ("Widget-imperfect · N lines").
  it("draws a widget-imperfect fence in a completed-with-problems report as a widget", () => {
    const summary = [
      "Dispatch finished.",
      "",
      "```widget-imperfect",
      "<style>#dgx .fold summary::-webkit-details-marker{display:none}</style>",
      "<div id=dgx><p>Board</p></div>",
      "```",
    ].join("\n");
    const html = renderToStaticMarkup(createElement(RoutineRunCard, {
      message: message("completed", { summary, problems: "One tool failed twice." }),
      onOpen: vi.fn(),
    }));
    expect(html).toContain("Completed with problems");
    expect(html).toContain("data-widget-frame");
    expect(html).toContain("data-widget-imperfect");
    // CodeBlock chrome for a language chip (the bug): never on a widget frame.
    expect(html).not.toContain(">Widget-imperfect<");
    expect(html).not.toContain(">Wrap<");
    expect(html).toContain("<iframe");
  });

  it("treats an unclosed widget fence at the end of a routine report as pending, never raw code", () => {
    const summary = "Building the board:\n\n```widget-imperfect\n<style>#dgx .fold summary::-webk";
    const html = renderToStaticMarkup(createElement(RoutineRunCard, {
      message: message("completed", { summary, problems: "Cut short." }),
    }));
    expect(html).toContain("data-widget-frame");
    expect(html).toMatch(/still being written|en cours de rédaction/i);
    expect(html).not.toContain(">Widget-imperfect<");
    expect(html).not.toContain(">Wrap<");
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
    expect(html).not.toMatch(/text-warning|text-danger/);
  });

  it("a JSON report reads as plain sentences with Show details", () => {
    const summary = '{\n  "summary": "Bank watch updated",\n  "todo": ["Approve sheet 100203"]\n}';
    const html = renderToStaticMarkup(createElement(RoutineRunCard, { message: message("completed", { summary }) }));
    expect(html).toContain("Bank watch updated");
    expect(html).toContain("For you: Approve sheet 100203");
    expect(html).toContain("data-run-result-details");
  });
  // With threads shown the hand-off row links the teammate's thread. One
  // message per run, never a card.
  it("shows a hand-off under a quiet pass with its status and, threads shown, a row that opens the teammate's work", () => {
    const markup = renderToStaticMarkup(createElement(RoutineRunCard, {
      message: message("nothing_to_report", { handedTo: [{ botId: "nova", threadId: "nova-work", name: "Nova", status: "completed" }] }),
      onOpen: () => {},
      onOpenThread: () => {},
    }));
    expect(markup).toContain("data-routine-run-card");
    expect(markup).not.toContain("rounded-2xl border bg-card");
    expect(markup).toContain('data-run-handoff="nova"');
    expect(markup).toContain("Sent work to Nova");
    expect(markup).toContain('data-run-teammate-thread="nova-work"');
    expect(markup).toContain("See Nova&#x27;s work, Completed");
    expect(markup).not.toContain("Open Nova");
    expect(markup).not.toContain("data-delegation-waiting");
    expect(markup.match(/data-routine-run-card/g)).toHaveLength(1);
  });

  it("a running run is one quiet live line: Running, how long it has run, Stop", () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 10, 4, 21, 0));
    try {
      const markup = renderToStaticMarkup(createElement(RoutineRunCard, {
        message: message("running", { startedAt: Date.UTC(2026, 10, 4, 20, 58) }),
      }));
      expect(markup).toContain("data-routine-run-plain");
      expect(markup).not.toContain("rounded-2xl border bg-card");
      expect(markup).toMatch(/data-routine-run-status[^>]*>Running<\/span>/);
      expect(markup).toContain("thinking-shimmer");
      expect(markup).toContain("data-routine-run-elapsed");
      expect(markup).toContain("2 min");
      const done = renderToStaticMarkup(createElement(RoutineRunCard, { message: message("completed", { startedAt: Date.UTC(2026, 10, 4, 20, 58), summary: "All good." }) }));
      expect(done).toContain("data-routine-run-plain");
      expect(done).not.toContain("rounded-2xl border bg-card");
      expect(done).not.toContain("data-routine-run-live");
      expect(done).not.toContain("data-routine-run-elapsed");
    } finally {
      vi.useRealTimers();
    }
  });
});
