import { describe, expect, it } from "vitest";

import { isTeamMemorySharing, storedTeamMemorySharing, teamMemoryCardReachesMember, teamMemorySharingOf, type TeamMemoryCardDelivery } from "./team-memory-sharing.ts";

const teamCard = { teamMemoryRequest: { section: "Dispatch" } };
const base = (over: Partial<TeamMemoryCardDelivery> = {}): TeamMemoryCardDelivery => ({
  card: teamCard,
  sharing: "shared",
  sharedServer: true,
  cloudHome: false,
  confidential: false,
  memberOfSection: (section) => section === "Dispatch",
  seesCardContext: () => false,
  ...over,
});

describe("teamMemorySharingOf", () => {
  it("reads absent and shared as shared, private as private", () => {
    expect(teamMemorySharingOf(undefined)).toBe("shared");
    expect(teamMemorySharingOf(null)).toBe("shared");
    expect(teamMemorySharingOf({})).toBe("shared");
    expect(teamMemorySharingOf({ teamMemorySharing: undefined })).toBe("shared");
    expect(teamMemorySharingOf({ teamMemorySharing: "shared" })).toBe("shared");
    expect(teamMemorySharingOf({ teamMemorySharing: "private" })).toBe("private");
    expect(isTeamMemorySharing("private")).toBe(true);
    expect(isTeamMemorySharing("nobody")).toBe(false);
  });

  it("fails closed: a present but unknown value reads as private", () => {
    for (const value of ["everyone", "Private", "Shared", "", null, 0, 1, true, ["private"], { mode: "shared" }]) {
      expect(teamMemorySharingOf({ teamMemorySharing: value }), JSON.stringify(value)).toBe("private");
    }
  });
});

describe("storedTeamMemorySharing", () => {
  it("stores only private; the default and shared store nothing; unknown stores private", () => {
    expect(storedTeamMemorySharing(undefined)).toBeUndefined();
    expect(storedTeamMemorySharing({})).toBeUndefined();
    expect(storedTeamMemorySharing({ teamMemorySharing: "shared" })).toBeUndefined();
    expect(storedTeamMemorySharing({ teamMemorySharing: "private" })).toBe("private");
    expect(storedTeamMemorySharing({ teamMemorySharing: "everyone" })).toBe("private");
  });
});

describe("teamMemoryCardReachesMember", () => {
  it("shared: a member of the section gets the card without seeing its bot or conversation", () => {
    expect(teamMemoryCardReachesMember(base())).toBe(true);
  });

  it("private: only a member who also sees the card's bot and conversation", () => {
    expect(teamMemoryCardReachesMember(base({ sharing: "private" }))).toBe(false);
    expect(teamMemoryCardReachesMember(base({ sharing: "private", seesCardContext: () => true }))).toBe(true);
  });

  it("never reaches someone outside the section, whatever the setting", () => {
    for (const sharing of ["shared", "private"] as const) {
      expect(teamMemoryCardReachesMember(base({ sharing, memberOfSection: () => false, seesCardContext: () => true }))).toBe(false);
    }
  });

  it("never carries a personal memory card to another person, whatever the setting", () => {
    const personal = { confidentialMemoryRequest: { id: "r1" } };
    const mixed = { ...teamCard, confidentialMemoryRequest: { id: "r2" } };
    for (const sharing of ["shared", "private"] as const) {
      for (const card of [personal, mixed, { title: "Save to your personal memory?" }]) {
        expect(teamMemoryCardReachesMember(base({ sharing, card, seesCardContext: () => true }))).toBe(false);
      }
    }
  });

  it("never in a confidential conversation, on a Cloud home, or on a one-person server", () => {
    for (const over of [{ confidential: true }, { cloudHome: true }, { sharedServer: false }]) {
      expect(teamMemoryCardReachesMember(base({ ...over, seesCardContext: () => true }))).toBe(false);
    }
  });
});
