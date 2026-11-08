import { describe, expect, it } from "vitest";

import { isOtherChoice, otherChoiceIndex } from "./other-choice";

describe("isOtherChoice", () => {
  it("knows the escape hatches a bot writes, in English and French", () => {
    for (const label of ["Other", "Autre", "Autre fuseau", "Another time zone", "Something else", "Autre chose", "Aucune de ces réponses", "Other (I'll type it)"]) {
      expect(isOtherChoice(label), label).toBe(true);
    }
  });
  it("leaves real answers alone", () => {
    for (const label of ["America/Toronto", "Otherworld theme", "Autrement dit", "Tomorrow"]) {
      expect(isOtherChoice(label), label).toBe(false);
    }
  });
});

describe("otherChoiceIndex", () => {
  it("is the last option only", () => {
    expect(otherChoiceIndex(["America/Toronto", "America/Montreal", "Autre fuseau"])).toBe(2);
    expect(otherChoiceIndex(["Other team", "Mine"])).toBe(-1);
    expect(otherChoiceIndex(["Autre"])).toBe(-1);
  });
});
