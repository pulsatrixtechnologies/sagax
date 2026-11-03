import { describe, expect, it } from "vitest";

import {
  FULL_ACCESS_HOLDS,
  FULL_ACCESS_SURFACES,
  fullAccessActs,
  fullAccessChoiceAnswer,
  fullAccessChoiceLine,
  fullAccessDecision,
  peerContactCardRequired,
} from "./full-access-gate.ts";

describe("Full access, one decision (2026-11-02)", () => {
  it("acts at Full with nothing in its way, and at no other level", () => {
    expect(fullAccessDecision("full")).toEqual({ acts: true, level: "full" });
    for (const level of ["ask", "edits", "auto", "custom"] as const) {
      expect(fullAccessDecision(level)).toEqual({ acts: false, level });
      expect(fullAccessActs(level)).toBe(false);
    }
    expect(fullAccessActs(undefined)).toBe(false);
  });

  it("keeps only the holds the owner decided: organization rules, personal rules, isolation, sensitive paths, real questions", () => {
    expect(fullAccessDecision("full", { orgRule: "ask" })).toMatchObject({ acts: false, hold: "org-rule" });
    expect(fullAccessDecision("full", { orgRule: "deny" })).toMatchObject({ acts: false, hold: "org-rule" });
    expect(fullAccessDecision("full", { personRule: "ask" })).toMatchObject({ acts: false, hold: "person-rule" });
    expect(fullAccessDecision("full", { personRule: "deny" })).toMatchObject({ acts: false, hold: "person-rule" });
    expect(fullAccessDecision("full", { isolation: true })).toMatchObject({ acts: false, hold: "isolation" });
    expect(fullAccessDecision("full", { sensitivePath: true })).toMatchObject({ acts: false, hold: "sensitive-path" });
    expect(fullAccessDecision("full", { question: true })).toMatchObject({ acts: false, hold: "question" });
    // nothing else holds: a null rule, a false flag
    expect(fullAccessDecision("full", { orgRule: null, personRule: null, isolation: false, sensitivePath: false, question: false })).toEqual({ acts: true, level: "full" });
    // the list of holds is the list, in the order they are read
    expect([...FULL_ACCESS_HOLDS]).toEqual(["org-rule", "person-rule", "isolation", "sensitive-path", "question"]);
  });

  it("answers a may-I choice with the recommended option at Full only", () => {
    const mayI = { title: "Approval request", question: "May I continue and hand the review to the verifier?", options: ["Yes, continue", "Not now"] };
    expect(fullAccessChoiceAnswer("full", mayI)).toEqual({ choice: "Yes, continue" });
    expect(fullAccessChoiceAnswer("auto", mayI)).toBeNull();
    expect(fullAccessChoiceAnswer("ask", mayI)).toBeNull();
    expect(fullAccessChoiceAnswer(undefined, mayI)).toBeNull();
    // an Ask first rule still holds the choice
    expect(fullAccessChoiceAnswer("full", mayI, { orgRule: "ask" })).toBeNull();
    // a real decision keeps its card at Full
    expect(fullAccessChoiceAnswer("full", { question: "Which client is this for?", options: ["Northwind", "Contoso"] })).toBeNull();
  });

  it("writes one line for the chip and the journal, with no dash read as a dash", () => {
    const line = fullAccessChoiceLine("Scout", "May I   continue?", "Yes, continue");
    expect(line).toBe('Full access answered for you: Scout asked "May I continue?", taken: Yes, continue.');
    expect(fullAccessChoiceLine(undefined, "Go?", "Go")).toMatch(/^Full access answered for you: The bot asked/);
    expect(line).not.toMatch(/[\u2013\u2014]/);
  });

  it("Ask before contacting bots is a card below Full only (#1819)", () => {
    expect(peerContactCardRequired(true, "full")).toBe(false);
    expect(peerContactCardRequired(true, "auto")).toBe(true);
    expect(peerContactCardRequired(true, "ask")).toBe(true);
    expect(peerContactCardRequired(false, "auto")).toBe(false);
    expect(peerContactCardRequired(false, "full")).toBe(false);
  });

  it("lists every surface the guard test checks, each with a plain description", () => {
    for (const [id, description] of Object.entries(FULL_ACCESS_SURFACES)) {
      expect(id).toMatch(/^[a-z-]+$/);
      expect(description.length).toBeGreaterThan(10);
      expect(description).not.toMatch(/[\u2013\u2014]/);
    }
    expect(Object.keys(FULL_ACCESS_SURFACES)).toContain("tool-approval");
    expect(Object.keys(FULL_ACCESS_SURFACES)).toContain("ask-choice");
    expect(Object.keys(FULL_ACCESS_SURFACES)).toContain("safety-review");
    expect(Object.keys(FULL_ACCESS_SURFACES)).toContain("engine-bridge");
  });
});
