import { describe, expect, it } from "vitest";

import { MAX_PROVIDER_PINS, defaultProviderPins, effectiveProviderPins, parseProviderPins, serializeProviderPins, withProviderPinToggled } from "./model-provider-pins";

const candidates = [
  { key: "anthropic", starred: 0, current: false },
  { key: "openai", starred: 2, current: false },
  { key: "xai", starred: 0, current: true },
  { key: "cohere", starred: 2, current: false },
  { key: "mistral", starred: 1, current: false },
];

describe("provider pins", () => {
  it("defaults to the current provider and the two most starred, the catalog's order breaking a tie", () => {
    expect(defaultProviderPins(candidates)).toEqual(["xai", "openai", "cohere"]);
    expect(defaultProviderPins(candidates.map((candidate) => ({ ...candidate, current: false, starred: 0 })))).toEqual(["anthropic", "openai", "xai"]);
  });

  it("keeps the person's pins that are still listed, else the default", () => {
    expect(effectiveProviderPins(["mistral", "gone", "anthropic"], candidates)).toEqual(["mistral", "anthropic"]);
    expect(effectiveProviderPins(["gone"], candidates)).toEqual(["xai", "openai", "cohere"]);
    expect(effectiveProviderPins([], candidates)).toEqual(["xai", "openai", "cohere"]);
  });

  it("pins up to three and refuses a fourth, unpinning always works", () => {
    expect(withProviderPinToggled(["a", "b"], "c")).toEqual({ pins: ["a", "b", "c"] });
    expect(withProviderPinToggled(["a", "b", "c"], "d")).toEqual({ refused: "full" });
    expect(withProviderPinToggled(["a", "b", "c"], "b")).toEqual({ pins: ["a", "c"] });
  });

  it("stores the pins as a bounded list of ids and drops what is broken", () => {
    expect(parseProviderPins(serializeProviderPins(["a", "b", "c", "d"]))).toEqual(["a", "b", "c"]);
    expect(parseProviderPins('["a","a",3,"","b"]')).toEqual(["a", "b"]);
    expect(parseProviderPins("not json")).toEqual([]);
    expect(parseProviderPins(null)).toEqual([]);
    expect(MAX_PROVIDER_PINS).toBe(3);
  });
});
