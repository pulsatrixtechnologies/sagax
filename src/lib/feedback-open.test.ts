import { describe, expect, it } from "vitest";
import { osFromUserAgent, requestFeedback } from "./feedback-open";

describe("requestFeedback (#2618)", () => {
  it("attaches version, OS, platform, page, logs and the window's PNG, and nothing else", async () => {
    const sent: unknown[] = [];
    const out = await requestFeedback({
      post: async (body) => { sent.push(body); return { botId: "b1", threadId: "t1" }; },
      capture: async () => "data:image/png;base64,iVBORw0KGgo=",
      appVersion: "0.8.70",
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_4) AppleWebKit/537.36 Sagax/0.8.70 Electron/38",
      desktop: true,
      page: "chat",
      locale: "fr-CA",
      logs: () => Array.from({ length: 60 }, (_, index) => `line ${index}`),
    }, { source: "error", error: "Network timeout" });
    expect(out).toEqual({ botId: "b1", threadId: "t1" });
    const body = sent[0] as Record<string, unknown>;
    expect(body).toMatchObject({ source: "error", platform: "desktop", appVersion: "0.8.70", os: "macOS 15.4", page: "chat", locale: "fr", error: "Network timeout" });
    expect((body.clientLogs as string[]).length).toBe(40);
    expect(body.screenshot).toMatch(/^data:image\/png;base64,/);
  });

  it("still opens a report on the web when the capture is missing or fails", async () => {
    const sent: Array<Record<string, unknown>> = [];
    await requestFeedback({ post: async (body) => { sent.push(body as never); return { botId: "b", threadId: "t" }; }, desktop: false, locale: "en" }, { source: "shortcut" });
    await requestFeedback({ post: async (body) => { sent.push(body as never); return { botId: "b", threadId: "t" }; }, capture: async () => { throw new Error("no"); }, desktop: false, locale: "en-US" }, { source: "sidebar" });
    expect(sent[0]).toEqual({ source: "shortcut", platform: "web", locale: "en" });
    expect(sent[1]).not.toHaveProperty("screenshot");
  });

  it("sends the words typed after /feedback so the flow starts from them (#2955)", async () => {
    const sent: Array<Record<string, unknown>> = [];
    const post = async (body: unknown) => { sent.push(body as never); return { botId: "b", threadId: "t" }; };
    await requestFeedback({ post, desktop: false, locale: "en" }, { source: "slash", text: "  bug the routines are missing  " });
    await requestFeedback({ post, desktop: false, locale: "en" }, { source: "slash", text: "   " });
    expect(sent[0]).toMatchObject({ source: "slash", text: "bug the routines are missing" });
    expect(sent[1]).not.toHaveProperty("text");
  });

  it("names the OS briefly, never the whole user agent", () => {
    expect(osFromUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("Windows NT 10.0");
    expect(osFromUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X)")).toBe("iOS 18.2");
    expect(osFromUserAgent("Mozilla/5.0 (X11; Linux x86_64)")).toBe("Linux");
    expect(osFromUserAgent(undefined)).toBeUndefined();
  });
});
