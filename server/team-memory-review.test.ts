import { describe, expect, it } from "vitest";

import { TEAM_MEMORY_REVIEW_REFUSAL, TEAM_MEMORY_SOLO_REFUSAL, teamMemoryReviewRefusal } from "./team-memory-review.ts";

describe("team memory review", () => {
  it("lets a member of the section confirm its shared memory", () => {
    expect(teamMemoryReviewRefusal({ admin: false, shared: true, memberOfSection: true })).toBeNull();
  });

  it("lets an organization admin confirm any section", () => {
    expect(teamMemoryReviewRefusal({ admin: true, shared: true, memberOfSection: false })).toBeNull();
  });

  it("in a solo workspace, keeps the review to the owner's session, as before", () => {
    expect(teamMemoryReviewRefusal({ admin: true, shared: false, memberOfSection: false })).toBeNull();
    // a client-only paired device (sagax --client) may chat, not confirm
    expect(teamMemoryReviewRefusal({ admin: false, shared: false, memberOfSection: false })).toBe(TEAM_MEMORY_SOLO_REFUSAL);
    expect(teamMemoryReviewRefusal({ admin: false, shared: false, memberOfSection: true })).toBe(TEAM_MEMORY_SOLO_REFUSAL);
  });

  it("refuses someone who cannot use a bot in that section", () => {
    expect(teamMemoryReviewRefusal({ admin: false, shared: true, memberOfSection: false })).toBe(TEAM_MEMORY_REVIEW_REFUSAL);
  });
});
