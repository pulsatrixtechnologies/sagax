import { describe, expect, it } from "vitest";
import { shortLinkLabel, splitLinks } from "./short-links";

describe("short links", () => {
  it("words an address as its host and path, never the query", () => {
    expect(shortLinkLabel("https://www.example.test/a/b/?x=1#y")).toBe("example.test/a/b");
    expect(shortLinkLabel("https://example.test/")).toBe("example.test");
  });
  it("clips a long path", () => {
    expect(shortLinkLabel(`https://example.test/${"a".repeat(80)}`).length).toBeLessThanOrEqual(38);
  });
  it("splits a text around its addresses and leaves the closing punctuation as text", () => {
    expect(splitLinks("Posted https://example.test/p/1, then stopped.")).toEqual([
      { text: "Posted " },
      { text: "example.test/p/1", href: "https://example.test/p/1" },
      { text: ", then stopped." },
    ]);
    expect(splitLinks("No link here")).toEqual([{ text: "No link here" }]);
  });
});
