import { describe, expect, it } from "vitest";

import { appliesNow, directApply, grantAfterQuote, reviewedSkillNeedsCard } from "./direct-apply.ts";

describe("appliesNow", () => {
  it("reports full-access or level, and null when the owner must confirm", () => {
    expect(appliesNow({ fullAccess: true, ownerMustConfirm: false })).toBe("full-access");
    expect(appliesNow({ fullAccess: false, ownerMustConfirm: false })).toBe("level");
    expect(appliesNow({ fullAccess: true, ownerMustConfirm: true })).toBeNull();
  });
});

describe("directApply", () => {
  it("applies everything at Full access, unchanged", () => {
    expect(directApply({ fullAccess: true, botId: "a", targetBotId: "b", blocked: false })).toBe("full-access");
    expect(directApply({ fullAccess: true, botId: "a", targetBotId: "a", blocked: false })).toBe("full-access");
  });

  it("applies a bot's change to itself at any other level", () => {
    expect(directApply({ fullAccess: false, botId: "a", targetBotId: "a", blocked: false })).toBe("self");
  });

  it("keeps the card for another bot, and for everything in a guest-driven turn", () => {
    expect(directApply({ fullAccess: false, botId: "a", targetBotId: "b", blocked: false })).toBeNull();
    expect(directApply({ fullAccess: false, botId: "a", targetBotId: "a", blocked: true })).toBeNull();
  });

  describe("another bot of the same person", () => {
    const owners: Record<string, string> = { a: "alice@example.com", a2: " Alice@Example.com ", b: "bob@example.com" };
    const ownerOf = (botId: string) => owners[botId];

    it("applies as self when both bots belong to the same person", () => {
      expect(directApply({ fullAccess: false, botId: "a", targetBotId: "a2", blocked: false, ownerOf })).toBe("self");
    });

    it("keeps the card for a bot of another person, an unknown bot, or an ownerless pair", () => {
      expect(directApply({ fullAccess: false, botId: "a", targetBotId: "b", blocked: false, ownerOf })).toBeNull();
      expect(directApply({ fullAccess: false, botId: "a", targetBotId: "ghost", blocked: false, ownerOf })).toBeNull();
      expect(directApply({ fullAccess: false, botId: "x", targetBotId: "y", blocked: false, ownerOf: () => "" })).toBeNull();
      expect(directApply({ fullAccess: false, botId: "x", targetBotId: "y", blocked: false, ownerOf: () => undefined })).toBeNull();
    });

    it("still keeps the card in a guest-driven turn", () => {
      expect(directApply({ fullAccess: false, botId: "a", targetBotId: "a2", blocked: true, ownerOf })).toBeNull();
    });
  });
});

describe("bypass keeps every own-work card away (2026-11-08)", () => {
  it("a refused quote drops self and primary grants, never Full access", () => {
    expect(grantAfterQuote("full-access", true)).toBe("full-access");
    expect(grantAfterQuote("self", true)).toBeNull();
    expect(grantAfterQuote("level", true)).toBeNull();
    expect(grantAfterQuote("self", false)).toBe("self");
    expect(grantAfterQuote(null, false)).toBeNull();
  });
  it("a skill the automatic review learns applies at Full, stays a card otherwise", () => {
    expect(reviewedSkillNeedsCard("create", "full-access")).toBe(false);
    expect(reviewedSkillNeedsCard("create", "self")).toBe(true);
    expect(reviewedSkillNeedsCard("update", "self")).toBe(false);
  });
});
