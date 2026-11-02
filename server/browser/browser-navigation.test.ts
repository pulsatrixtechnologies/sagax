import { describe, expect, it } from "vitest";

import { browserNavigationRefusal } from "./browser-navigation.ts";

describe("browser navigation", () => {
  it("allows a public http(s) address and refuses file, loopback and metadata", () => {
    expect(browserNavigationRefusal({ url: "https://example.com/page" })).toBeNull();
    expect(browserNavigationRefusal({ arguments: { url: "file:///etc/passwd" } })).toMatch(/http and https/);
    expect(browserNavigationRefusal({ url: "http://127.0.0.1/" })).toMatch(/metadata/);
    expect(browserNavigationRefusal({ url: "http://localhost/admin" })).toMatch(/metadata/);
    expect(browserNavigationRefusal({ url: "http://169.254.169.254/latest" })).toMatch(/metadata/);
    expect(browserNavigationRefusal({ url: "http://168.63.129.16/" })).toMatch(/metadata/);
    expect(browserNavigationRefusal({ url: "http://metadata.google.internal/" })).toMatch(/metadata/);
    expect(browserNavigationRefusal({ name: "navigate", arguments: { note: "not a url" } })).toBeNull();
  });
});
