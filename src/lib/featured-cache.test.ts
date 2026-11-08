// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { readFeaturedCache, writeFeaturedCache } from "./featured-cache";

describe("featured catalog cache (Plugins first render, the owner 2026-11-06)", () => {
  beforeEach(() => window.localStorage.clear());
  it("is empty on the first open", () => {
    expect(readFeaturedCache()).toBeNull();
  });
  it("returns the last catalog at once so rows draw before the network answers", () => {
    const rows = [{ id: "github", name: "GitHub" }] as never;
    writeFeaturedCache(rows);
    expect(readFeaturedCache()).toEqual(rows);
  });
  it("never stores an empty answer over a good copy", () => {
    writeFeaturedCache([{ id: "a" }] as never);
    writeFeaturedCache([]);
    expect(readFeaturedCache()).toHaveLength(1);
  });
  it("survives corrupt storage", () => {
    window.localStorage.setItem("sagax.plugins.featured.v1", "{nope");
    expect(readFeaturedCache()).toBeNull();
  });
});
