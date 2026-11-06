import { describe, expect, it } from "vitest";

import { builtInBrowserEnabled, dataWindowEnabled, decisionModelEnabled, llmThreadTitlesEnabled, parseSkillReviewSteps, routinesInConversationEnabled, sharedComputersEnabled, showToolCallsEnabled, skillAuthoringEnabled, skillReviewEnabled, skillReviewSteps, skillsLibraryEnabled } from "./feature-flags";

describe("experimental feature flags", () => {
  it("offers linked skills unless explicitly switched off", () => {
    expect(skillsLibraryEnabled(null)).toBe(true);
    expect(skillsLibraryEnabled({ features: {} })).toBe(true);
    expect(skillsLibraryEnabled({ features: { skillsLibrary: false } })).toBe(false);
  });
  it("keeps skill authoring on by default, before and after the config arrives", () => {
    expect(skillAuthoringEnabled(null)).toBe(true);
    expect(skillAuthoringEnabled({})).toBe(true);
    expect(skillAuthoringEnabled({ features: {} })).toBe(true);
    expect(skillAuthoringEnabled({ features: { skillAuthoring: true } })).toBe(true);
  });

  it("switches skill authoring off only on an explicit opt-out", () => {
    expect(skillAuthoringEnabled({ features: { skillAuthoring: false } })).toBe(false);
  });

  it("learns skills automatically only after an opt-in, and never without skill authoring", () => {
    expect(skillReviewEnabled(null)).toBe(false);
    expect(skillReviewEnabled({ features: {} })).toBe(false);
    expect(skillReviewEnabled({ features: { skillReview: true } })).toBe(true);
    expect(skillReviewEnabled({ features: { skillReview: true, skillAuthoring: false } })).toBe(false);
  });

  it("reviews after ten tool steps by default, within 3 to 100", () => {
    expect(skillReviewSteps(null)).toBe(10);
    expect(skillReviewSteps({ features: { skillReviewSteps: 25 } })).toBe(25);
    expect(skillReviewSteps({ features: { skillReviewSteps: 1 } })).toBe(3);
    expect(skillReviewSteps({ features: { skillReviewSteps: 500 } })).toBe(100);
    expect(parseSkillReviewSteps(" 12 ")).toBe(12);
    for (const bad of ["", "2", "101", "4.5", "-5", "ten"]) expect(parseSkillReviewSteps(bad)).toBeNull();
  });

  it("keeps the experimental browser off until explicitly enabled", () => {
    expect(builtInBrowserEnabled(null)).toBe(false);
    expect(builtInBrowserEnabled({})).toBe(false);
    expect(builtInBrowserEnabled({ features: { browser: false } })).toBe(false);
    expect(builtInBrowserEnabled({ features: { browser: true } })).toBe(true);
  });

  it("hides tool-call chips by default", () => {
    expect(showToolCallsEnabled(null)).toBe(false);
    expect(showToolCallsEnabled({})).toBe(false);
    expect(showToolCallsEnabled({ features: { showToolCalls: false } })).toBe(false);
  });

  it("shows tool-call chips only after explicit opt-in", () => {
    expect(showToolCallsEnabled({ features: { showToolCalls: true } })).toBe(true);
    expect(routinesInConversationEnabled(null)).toBe(false);
    expect(routinesInConversationEnabled({})).toBe(false);
    expect(routinesInConversationEnabled({ features: { routinesInConversation: true } })).toBe(true);
  });

  it("keeps computer sharing off unless the server says it is on", () => {
    expect(sharedComputersEnabled(null)).toBe(false);
    expect(sharedComputersEnabled({})).toBe(false);
    expect(sharedComputersEnabled({ features: {} })).toBe(false);
    expect(sharedComputersEnabled({ features: { sharedComputers: false } })).toBe(false);
    expect(sharedComputersEnabled({ features: { sharedComputers: true } })).toBe(true);
  });

  it("keeps the Decision model section off unless the experimental option is on", () => {
    expect(decisionModelEnabled(null)).toBe(false);
    expect(decisionModelEnabled({})).toBe(false);
    expect(decisionModelEnabled({ features: {} })).toBe(false);
    expect(decisionModelEnabled({ features: { decisionModel: false } })).toBe(false);
    expect(decisionModelEnabled({ features: { decisionModel: true } })).toBe(true);
  });

  it("keeps the Data window off unless the experimental option is on", () => {
    expect(dataWindowEnabled(null)).toBe(false);
    expect(dataWindowEnabled({})).toBe(false);
    expect(dataWindowEnabled({ features: {} })).toBe(false);
    expect(dataWindowEnabled({ features: { dataWindow: false } })).toBe(false);
    expect(dataWindowEnabled({ features: { dataWindow: true } })).toBe(true);
  });

  it("offers Regenerate title only while the server has generated titles on", () => {
    expect(llmThreadTitlesEnabled(null)).toBe(false);
    expect(llmThreadTitlesEnabled({ features: {} })).toBe(false);
    expect(llmThreadTitlesEnabled({ features: { llmThreadTitles: false } })).toBe(false);
    expect(llmThreadTitlesEnabled({ features: { llmThreadTitles: true } })).toBe(true);
  });
});
