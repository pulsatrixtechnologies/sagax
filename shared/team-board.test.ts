// The Team board's column rule (#3409 design note, section 3): first match
// wins, Merged, Blocked, Gate and review, Code, Design, To do.
import { describe, expect, it } from "vitest";

import { boardSummary, cardStale, cardStatus, placeCard, TEAM_BOARD_MERGED_MS, TEAM_BOARD_NO_MOVEMENT_MS, TEAM_BOARD_NO_REVIEW_MS, type PlaceCardInput, type TeamBoardCard } from "./team-board.ts";

const NOW = 1_800_000_000_000;
const base = (over: Partial<PlaceCardInput> = {}): PlaceCardInput => ({ issueOpen: true, touched: false, linkedWork: false, now: NOW, ...over });

describe("placeCard", () => {
  it("puts an open issue no team bot touched in To do", () => {
    expect(placeCard(base())).toEqual({ column: "todo" });
  });

  it("puts a touched issue without linked work in Design", () => {
    expect(placeCard(base({ touched: true }))).toEqual({ column: "design" });
  });

  it("puts linked work with no pull request, or a draft, in Code", () => {
    expect(placeCard(base({ touched: true, linkedWork: true }))).toEqual({ column: "code" });
    expect(placeCard(base({ linkedWork: true, pull: { state: "open", draft: true } }))).toEqual({ column: "code" });
  });

  it("puts an open, ready pull request in Gate and review", () => {
    expect(placeCard(base({ linkedWork: true, pull: { state: "open" } }))).toEqual({ column: "review" });
  });

  it("keeps a merge 7 days, then the card leaves the board", () => {
    expect(placeCard(base({ issueOpen: false, linkedWork: true, pull: { state: "merged", mergedAt: NOW - TEAM_BOARD_MERGED_MS + 1 } }))).toEqual({ column: "merged" });
    expect(placeCard(base({ issueOpen: false, linkedWork: true, pull: { state: "merged", mergedAt: NOW - TEAM_BOARD_MERGED_MS - 1 } }))).toBeNull();
  });

  it("drops an issue closed without a merged pull request", () => {
    expect(placeCard(base({ issueOpen: false, touched: true }))).toBeNull();
    expect(placeCard(base({ issueOpen: false, linkedWork: true, pull: { state: "closed" } }))).toBeNull();
  });

  it("keeps a card waiting for the person in its stage column, never Blocked (addendum P1)", () => {
    const input = base({ linkedWork: true, holder: { status: "waiting", waitingFor: "Waiting for your approval: push to main" } });
    expect(placeCard(input)).toEqual({ column: "code" });
    expect(cardStatus({ ...input, column: "code" })).toBe("waiting_you");
  });

  it("blocks on a failed turn with its stored cause", () => {
    expect(placeCard(base({ touched: true, holder: { status: "failed", failure: "The engine stopped: usage limit" } }))).toEqual({
      column: "blocked", stage: "design", blocked: { source: "turn", reason: "The engine stopped: usage limit" },
    });
  });

  it("blocks on GitHub: changes requested, a failing check, a conflict, in that order", () => {
    const pull = { state: "open" as const, changesRequestedBy: "octo", failingCheck: "test", conflictsWith: "main" };
    expect(placeCard(base({ linkedWork: true, pull }))?.blocked).toEqual({ source: "review", reason: "Changes requested by octo" });
    expect(placeCard(base({ linkedWork: true, pull: { ...pull, changesRequestedBy: undefined } }))?.blocked).toEqual({ source: "checks", reason: "Check failed: test" });
    expect(placeCard(base({ linkedWork: true, pull: { state: "open", conflictsWith: "main" } }))).toEqual({
      column: "blocked", stage: "review", blocked: { source: "conflict", reason: "Conflicts with main" },
    });
  });

  it("never blocks a card whose holder's turn is running, whatever GitHub says", () => {
    expect(placeCard(base({ linkedWork: true, pull: { state: "open", failingCheck: "test" }, holder: { status: "running" } }))).toEqual({ column: "review" });
  });

  it("puts a merged pull request in Merged even when its holder failed after", () => {
    expect(placeCard(base({ issueOpen: false, linkedWork: true, pull: { state: "merged", mergedAt: NOW }, holder: { status: "failed" } }))).toEqual({ column: "merged" });
  });
});

describe("cardStatus (addendum P1): one status per card, first match wins", () => {
  it("says blocked for a broken card, whatever else is true", () => {
    expect(cardStatus({ ...base({ linkedWork: true, holder: { status: "failed" } }), column: "blocked" })).toBe("blocked");
  });

  it("says running while the holder's turn runs, taken when it holds without running, free otherwise", () => {
    expect(cardStatus({ ...base({ touched: true, holder: { status: "running" } }), column: "design" })).toBe("running");
    expect(cardStatus({ ...base({ touched: true, holder: { status: "finished" } }), column: "design" })).toBe("taken");
    expect(cardStatus({ ...base({ touched: true, holder: { status: "queued" } }), column: "design" })).toBe("taken");
    expect(cardStatus({ ...base(), column: "todo" })).toBe("free");
  });

  it("says waiting_review for a ready pull request without a verdict, and taken once approved", () => {
    expect(cardStatus({ ...base({ linkedWork: true, pull: { state: "open" }, holder: { status: "finished" } }), column: "review" })).toBe("waiting_review");
    expect(cardStatus({ ...base({ linkedWork: true, pull: { state: "open", review: "required" }, holder: { status: "finished" } }), column: "review" })).toBe("waiting_review");
    expect(cardStatus({ ...base({ linkedWork: true, pull: { state: "open", review: "approved" }, holder: { status: "finished" } }), column: "review" })).toBe("taken");
  });

  it("says waiting_release for a merge (no release is read yet, lot P2)", () => {
    expect(cardStatus({ ...base({ issueOpen: false, linkedWork: true, pull: { state: "merged", mergedAt: NOW } }), column: "merged" })).toBe("waiting_release");
  });
});

describe("cardStale (addendum P1, decided thresholds: 4 hours, 2 hours)", () => {
  const DAY = 24 * 60 * 60_000;
  it("names the decided thresholds", () => {
    expect(TEAM_BOARD_NO_MOVEMENT_MS).toBe(4 * 60 * 60_000);
    expect(TEAM_BOARD_NO_REVIEW_MS).toBe(2 * 60 * 60_000);
  });

  it("flags no movement in Design, Code or Gate and review, never in To do", () => {
    expect(cardStale({ column: "code", status: "taken", movedAt: NOW - TEAM_BOARD_NO_MOVEMENT_MS - 1, now: NOW })).toEqual({ why: "no_movement", days: 0, hours: 4 });
    expect(cardStale({ column: "code", status: "taken", movedAt: NOW - TEAM_BOARD_NO_MOVEMENT_MS + 1, now: NOW })).toBeUndefined();
    expect(cardStale({ column: "todo", status: "free", movedAt: NOW - 30 * DAY, now: NOW })).toBeUndefined();
  });

  it("flags a ready pull request with no verdict", () => {
    expect(cardStale({ column: "review", status: "waiting_review", reviewSince: NOW - TEAM_BOARD_NO_REVIEW_MS - 1, movedAt: NOW, now: NOW })).toEqual({ why: "no_review", days: 0, hours: 2 });
  });
});

describe("boardSummary (addendum P1)", () => {
  const card = (over: Partial<TeamBoardCard>): TeamBoardCard => ({ key: "o/r#1", repo: "o/r", number: 1, title: "t", issueUrl: "u", column: "code", sectionId: "s", status: "taken", createdAt: NOW, ...over });
  it("counts in progress, waiting for you, blocked, merged this week, and the oldest in progress", () => {
    const DAY = 24 * 60 * 60_000;
    expect(boardSummary([
      card({ key: "o/r#1", status: "running", since: NOW - DAY }),
      card({ key: "o/r#2", status: "taken", column: "review", since: NOW - 9 * DAY }),
      card({ key: "o/r#3", status: "waiting_you" }),
      card({ key: "o/r#4", status: "blocked", column: "blocked" }),
      card({ key: "o/r#5", status: "waiting_release", column: "merged" }),
      card({ key: "o/r#6", status: "free", column: "todo" }),
    ], NOW)).toEqual({ inProgress: 2, waitingYou: 1, blocked: 1, mergedThisWeek: 1, oldestInProgress: { key: "o/r#2", days: 9 } });
  });
});
