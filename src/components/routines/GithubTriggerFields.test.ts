import { describe, expect, it } from "vitest";

import { githubDraftFrom, githubScheduleFromDraft } from "./GithubTriggerFields";
import { triggerChoiceOf, triggerPatch } from "./TriggerPopover";
import { recurrenceFor } from "../RoutineCalendarPage.tsx-parts/helpers";

describe("GitHub routine trigger", () => {
  it("round-trips the draft into an event schedule", () => {
    const schedule = githubScheduleFromDraft({ events: ["pr.opened"], repo: "a/b, c/d" });
    expect(schedule).toMatchObject({ type: "event", source: "github", events: ["pr.opened"], filters: { repo: ["a/b", "c/d"] } });
    expect(githubDraftFrom(schedule as never).events).toEqual(["pr.opened"]);
  });
  it("is recognised as the github choice", () => {
    const schedule = githubScheduleFromDraft({ events: ["issue.opened"], repo: "" });
    expect(triggerChoiceOf(schedule as never)).toBe("github");
    expect(recurrenceFor(schedule as never, 0, true)).toBe("github");
    expect(typeof triggerPatch).toBe("function");
  });
});
