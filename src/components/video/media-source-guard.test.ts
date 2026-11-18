import { describe, expect, it } from "vitest";

import { isAppOriginAddress } from "./media-source-guard";

const APP = "http://127.0.0.1:8799";

describe("isAppOriginAddress (#4752)", () => {
  it("names an absolute address of the app's own origin, in any spelling", () => {
    expect(isAppOriginAddress(`${APP}/api/bots`, APP)).toBe(true);
    expect(isAppOriginAddress("//127.0.0.1:8799/api/bots", APP)).toBe(true);
    expect(isAppOriginAddress("HTTP://127.0.0.1:8799/x.ts", APP)).toBe(true);
    expect(isAppOriginAddress("http:\\\\127.0.0.1:8799\\api", APP)).toBe(true);
  });

  it("leaves the app's own relative sources and other origins alone", () => {
    expect(isAppOriginAddress("/api/media/proxy/abc.mac", APP)).toBe(false);
    expect(isAppOriginAddress("http://127.0.0.1:8800/x.ts", APP)).toBe(false);
    expect(isAppOriginAddress("https://cdn.example/x.ts", APP)).toBe(false);
    expect(isAppOriginAddress(`${APP}/x`, null)).toBe(false);
  });
});
