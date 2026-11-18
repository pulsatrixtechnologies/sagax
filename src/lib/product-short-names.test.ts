import { describe, expect, it } from "vitest";

import { commonPrefixWords, distinguishingNames } from "./product-short-names";

const FAMILY = ["Company", "Finance", "Service", "Time", "Procurement"].map((area) => `Harbor Suite Public Endpoints: ${area}`);

describe("what tells the connectors of a bundle apart", () => {
  it("shows the module of a family that shares a long vendor prefix", () => {
    expect(distinguishingNames(FAMILY)).toEqual(["Company", "Finance", "Service", "Time", "Procurement"]);
  });
  it("cuts on whole words, ignoring case and the separator after the prefix", () => {
    expect(commonPrefixWords(["Harbor Suite - Alpha", "harbor suite - Beta"])).toEqual(["Harbor", "Suite", "-"]);
    expect(distinguishingNames(["Harbor Suite - Alpha", "harbor suite - Beta"])).toEqual(["Alpha", "Beta"]);
  });
  it("keeps the full names when nothing is shared, when one name would be left empty, or when two would read alike", () => {
    expect(distinguishingNames(["Alpha API", "Beta API"])).toEqual(["Alpha API", "Beta API"]);
    expect(distinguishingNames(["Harbor Suite", "Harbor Suite Reports"])).toEqual(["Harbor Suite", "Harbor Suite Reports"]);
    expect(distinguishingNames(["Harbor: Reports", "Harbor - Reports", "Harbor Other"])).toEqual(["Harbor: Reports", "Harbor - Reports", "Harbor Other"]);
  });
  it("leaves a single connector alone", () => {
    expect(distinguishingNames(["Harbor Suite Public Endpoints: Service"])).toEqual(["Harbor Suite Public Endpoints: Service"]);
  });
});
