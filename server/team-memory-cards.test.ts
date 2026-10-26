import { describe, expect, it } from "vitest";

import { TEAM_MEMORY_SETTLED_CODE, teamMemoryCardSettled, teamMemoryLateAnswer } from "./team-memory-cards.ts";

describe("teamMemoryCardSettled", () => {
  it("an open card takes an answer; answered, dismissed or expired does not", () => {
    expect(teamMemoryCardSettled(undefined)).toBe(false);
    expect(teamMemoryCardSettled({})).toBe(false);
    expect(teamMemoryCardSettled({ answered: "allow" })).toBe(true);
    expect(teamMemoryCardSettled({ answered: "deny" })).toBe(true);
    expect(teamMemoryCardSettled({ dismissed: true })).toBe(true);
    expect(teamMemoryCardSettled({ expired: true })).toBe(true);
  });
});

describe("teamMemoryLateAnswer", () => {
  it("an accepted card answers 409 accepted, with who accepted it", () => {
    const late = teamMemoryLateAnswer({ answered: "allow", answeredBy: { kind: "session", name: "Dana" } });
    expect(late.status).toBe(409);
    expect(late.body).toMatchObject({ code: TEAM_MEMORY_SETTLED_CODE, outcome: "allowed-once", alreadySettled: true, settledBy: "Dana" });
    expect(late.body.error).toBe("This team memory entry was already accepted by Dana.");
  });

  it("a declined or deleted card answers 409 rejected, never allowed", () => {
    const late = teamMemoryLateAnswer({ answered: "deny", answeredBy: { kind: "session", name: "Dana" } });
    expect(late.body).toMatchObject({ outcome: "rejected", settledBy: "Dana" });
    expect(late.body.error).toContain("already declined or deleted by Dana");
  });

  it("names nobody when the card names no person", () => {
    for (const answeredBy of [undefined, { kind: "loopback" as const }, { kind: "worker" as const }, { kind: "session" as const, name: "  " }]) {
      const late = teamMemoryLateAnswer({ answered: "allow", ...(answeredBy ? { answeredBy } : {}) });
      expect(late.body.settledBy).toBeUndefined();
      expect(late.body.error).toContain("by someone else");
    }
  });

  it("a card closed as unavailable says so", () => {
    expect(teamMemoryLateAnswer({ answered: "unavailable", dismissed: true }).body).toMatchObject({ outcome: "unavailable", code: TEAM_MEMORY_SETTLED_CODE });
    expect(teamMemoryLateAnswer({ dismissed: true }).body.outcome).toBe("unavailable");
  });
});
