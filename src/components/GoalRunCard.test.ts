import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { GroupGoalRunCardData } from "../../shared/group-goal-run";
import type { Message } from "@/state/store";
import { GoalRunCard, GoalRunHeaderChip, goalRunPlace } from "./GoalRunCard";

function message(status: GroupGoalRunCardData["status"], detail?: string): Message {
  return {
    id: "goal-run-card",
    role: "bot",
    kind: "goal.run",
    at: 1,
    goalRun: {
      runId: "run-1",
      goal: "Write and polish the launch announcement",
      status,
      coordinatorBotId: "bot-1",
      coordinatorName: "Sprout",
      turnCount: status === "working" ? 2 : 5,
      maxTurns: 12,
      detail,
      startedAt: 1,
    },
  };
}

describe("goal history", () => {
  it("numbers a goal among the room's goals and lists the earlier ones", () => {
    const earlier = message("completed");
    earlier.id = "goal-old";
    earlier.goalRun = { ...earlier.goalRun!, goal: "Ship the notes" };
    const current = message("working");
    const place = goalRunPlace([earlier, current], current.id);
    expect(place).toMatchObject({ position: 2, total: 2 });
    const markup = renderToStaticMarkup(createElement(GoalRunCard, { message: current, history: place }));
    expect(markup).toContain("Goal 2 of 2");
    expect(markup).toContain("Goal history");
    expect(markup).toContain("Ship the notes");
  });

  it("offers the full goal when the line is cut", () => {
    const long = message("working");
    long.goalRun = { ...long.goalRun!, goal: "A".repeat(200) };
    const markup = renderToStaticMarkup(createElement(GoalRunCard, { message: long }));
    expect(markup).toContain("Show the full goal");
  });
});

describe("GoalRunCard", () => {
  it("shows live goal progress without expanding into a run log", () => {
    const markup = renderToStaticMarkup(createElement(GoalRunCard, {
      message: message("working", "Luna is reviewing the second draft."),
    }));

    expect(markup).toContain("Write and polish the launch announcement");
    expect(markup).toContain("Working");
    expect(markup).toContain("Luna is reviewing the second draft.");
    expect(markup).toContain("Latest:");
    expect(markup).toContain("Turn 3 of 12");
    expect(markup).toContain("Sprout coordinating");
    expect(markup).toContain('aria-label="Goal run: Working"');
    expect(markup).toContain('role="progressbar"');
    expect(markup).toContain('aria-valuenow="3"');
  });

  it.each([
    ["completed", "Completed"],
    ["needs-input", "Needs your input"],
    ["blocked", "Blocked"],
    ["limit-reached", "Turn limit reached"],
    ["paused", "Paused"],
    ["stopped", "Stopped"],
    ["failed", "Failed"],
  ] as const)("renders the %s status with turns against the budget", (status, label) => {
    const markup = renderToStaticMarkup(createElement(GoalRunCard, { message: message(status) }));
    expect(markup).toContain(label);
    expect(markup).toContain("5 of 12 turns");
  });

  it("names why a goal paused and what a blocked one is waiting on", () => {
    const paused = renderToStaticMarkup(createElement(GoalRunCard, {
      message: message("paused", "Pulsa Bot restarted, resume to continue"),
    }));
    expect(paused).toContain("Reason:");
    expect(paused).toContain("Pulsa Bot restarted, resume to continue");
    const asking = renderToStaticMarkup(createElement(GoalRunCard, {
      message: message("needs-input", "Which launch date should the post use?"),
    }));
    expect(asking).toContain("Question:");
  });

  it("keeps only the action that fits the state in view", () => {
    const noop = () => {};
    const working = renderToStaticMarkup(createElement(GoalRunCard, { message: message("working"), onStop: noop, onRunAgain: noop }));
    // a running goal: no Run again, Stop lives in the menu
    expect(working).not.toContain('data-goal-run-action="run-again"');
    expect(working).not.toContain('data-goal-run-action="stop"');
    expect(working).toContain("data-goal-run-more");

    const paused = renderToStaticMarkup(createElement(GoalRunCard, { message: message("paused"), onStop: noop, onRunAgain: noop }));
    expect(paused).toContain('data-goal-run-action="resume"');
    expect(paused).toContain("Resume");

    const done = renderToStaticMarkup(createElement(GoalRunCard, { message: message("limit-reached"), onRunAgain: noop }));
    expect(done).toContain('data-goal-run-action="run-again"');
    expect(done).toContain("Run again");

    const receipt = renderToStaticMarkup(createElement(GoalRunCard, { message: message("completed") }));
    expect(receipt).not.toContain('data-goal-run-action="run-again"');
  });

  it("keeps an incomplete payload readable", () => {
    const legacy: Message = {
      id: "goal-run-fallback",
      role: "bot",
      kind: "goal.run",
      at: 1,
      text: "The channel goal is complete.",
    };
    expect(renderToStaticMarkup(createElement(GoalRunCard, { message: legacy })))
      .toContain("The channel goal is complete.");
  });
});

describe("GoalRunHeaderChip", () => {
  it("shows the running turn against the budget", () => {
    const run = message("working").goalRun!;
    const markup = renderToStaticMarkup(createElement(GoalRunHeaderChip, { run, onShow: () => {} }));
    expect(markup).toContain("Goal");
    expect(markup).toContain("3/12");
    expect(markup).toContain('aria-label="Goal in progress, Turn 3 of 12. Show its card"');
  });
});
