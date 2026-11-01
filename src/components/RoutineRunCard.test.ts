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
  // 2026-10-22 (owner): one concise message, the bot's report only, with a
  // small "Routine: <name> · View run" line under it.
  it("reads as the bot's report with the routine named under it and a link to the run", () => {
    const markup = renderToStaticMarkup(createElement(RoutineRunCard, {
      message: message("completed", { summary: "The brief is ready with **three** follow-ups." }),
      onOpen: vi.fn(),
    }));

    expect(markup).toContain("<strong>three</strong>");
    expect(markup).toContain("Routine: Morning brief");
    expect(markup).toContain("View run");
    expect(markup).toContain('aria-label="View run for Morning brief"');
    expect(markup).toContain('aria-label="Morning brief routine run: Completed"');
    // a report is the message: no status chip, no card chrome
    expect(markup).not.toContain(">Completed<");
    expect(markup).not.toContain("border-hairline");
  });

  it("shows a long report whole, as the bot wrote it", () => {
    const summary = `The brief is ready. ${"Detailed result. ".repeat(25)}\n\nFinal follow-up.`;
    const markup = renderToStaticMarkup(createElement(RoutineRunCard, {
      message: message("completed", { summary }),
      onOpen: vi.fn(),
    }));

    expect(markup).toContain("Final follow-up.");
    expect(markup).not.toContain("<details");
  });

  it("names a run that ended with nothing to report after it waited on the person", () => {
    const markup = renderToStaticMarkup(createElement(RoutineRunCard, { message: message("nothing_to_report"), onOpen: vi.fn() }));
    expect(markup).toContain("Nothing to report");
    expect(markup).toContain("Routine: Morning brief");
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
  it("says a run completed with problems, with the problems under the report (2026-11-01)", () => {
    const html = renderToStaticMarkup(createElement(RoutineRunCard, { message: message("completed", { summary: "Checked 10 invoices.", problems: "crm_login failed 2 times" }) }));
    expect(html).toContain("Checked 10 invoices.");
    expect(html).toContain("data-routine-problems");
    expect(html).toContain("crm_login failed 2 times");
    expect(html).toContain("Completed with problems");
  });

  it("says why a queued run has not started (2026-11-01)", () => {
    const html = renderToStaticMarkup(createElement(RoutineRunCard, { message: message("queued", { deferredAt: 1, attention: "Waits for the previous run of this routine to finish" }) }));
    expect(html).toContain("Waits for the previous run of this routine to finish");
  });
});
