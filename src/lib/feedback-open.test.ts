import { describe, expect, it } from "vitest";
import { feedbackAppContext, osFromUserAgent } from "./feedback-open";

describe("feedbackAppContext (#2618, #3299)", () => {
  it("attaches version, OS, surface, page and logs, and nothing else", () => {
    const context = feedbackAppContext({
      appVersion: "0.8.70",
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_4) AppleWebKit/537.36 Sagax/0.8.70 Electron/38",
      desktop: true,
      page: "chat",
      locale: "fr-CA",
      logs: () => Array.from({ length: 60 }, (_, index) => `line ${index}`),
    });
    expect(context).toMatchObject({ platform: "desktop", appVersion: "0.8.70", os: "macOS 15.4", page: "chat", locale: "fr" });
    expect(context.clientLogs).toHaveLength(40);
    expect(Object.keys(context).sort()).toEqual(["appVersion", "clientLogs", "locale", "os", "page", "platform"]);
  });

  it("works on the web with nothing else known", () => {
    expect(feedbackAppContext({ desktop: false, locale: "en-US" })).toEqual({ platform: "web", locale: "en" });
  });

  it("names the OS briefly, never the whole user agent", () => {
    expect(osFromUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("Windows NT 10.0");
    expect(osFromUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X)")).toBe("iOS 18.2");
    expect(osFromUserAgent("Mozilla/5.0 (X11; Linux x86_64)")).toBe("Linux");
    expect(osFromUserAgent(undefined)).toBeUndefined();
  });
});
