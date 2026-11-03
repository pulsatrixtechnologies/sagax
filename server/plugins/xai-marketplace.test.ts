// The xAI Bot Marketplace reader (server/plugins/xai-marketplace.ts): the parser on
// a recorded sample of the real pages (server/fixtures/xai-marketplace-*.html,
// the structure of 2026-10-28 with neutral names), the source errors, and
// the few-hours cache with its manual refresh.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { fetchXaiPage, parseXaiMarketplaceBot, parseXaiMarketplaceList, XaiMarketplaceError, XaiMarketplaceSource } from "./xai-marketplace.ts";

const fixture = (name: string) => readFileSync(join(import.meta.dirname, "..", "fixtures", name), "utf8");
const listPage = fixture("xai-marketplace-list.html");
const botPage = fixture("xai-marketplace-bot.html");
const html = (body: string, status = 200, headers: Record<string, string> = {}) => new Response(body, { status, headers: { "content-type": "text/html", ...headers } });

describe("parseXaiMarketplaceList", () => {
  it("reads every bot once, in the page's catalogue order, with its card", () => {
    const bots = parseXaiMarketplaceList(listPage);
    expect(bots.map((bot) => bot.slug)).toEqual(["demo-helper", "sample-desk", "test-coach"]);
    expect(bots[1]).toEqual({
      slug: "sample-desk",
      name: "Sample Desk",
      creator: "Alex Example",
      description: "Turns a pasted list into a short weekly brief. Nothing is sent without your yes.",
      categories: ["Staff Picks", "Sales"],
      color: "magenta",
      shape: "pebble",
      shareId: "AbCdEfGhIjKlMnOpQrStU",
      url: "https://x.ai/bot/marketplace/bots/sample-desk",
    });
  });

  it("calls a page without bot cards a change of format", () => {
    expect(() => parseXaiMarketplaceList("<html><body>Sign in</body></html>")).toThrow(expect.objectContaining({ code: "xai_format" }));
  });
});

describe("parseXaiMarketplaceBot", () => {
  it("reads the memories (following a moved text row), skills, routines and apps", () => {
    const bot = parseXaiMarketplaceBot(botPage, "sample-desk");
    expect(bot.name).toBe("Sample Desk");
    expect(bot.memories).toHaveLength(2);
    expect(bot.memories[0]).toMatch(/^I keep a short weekly brief/);
    expect(bot.memories[0]).toMatch(/Café notes stay in your files\.$/);
    expect(bot.skills.map((skill) => skill.name)).toEqual(["Getting started", "Weekly brief"]);
    expect(bot.routines).toEqual([
      { name: "Weekday draft batch", summary: "Every weekday morning, drafts the next few items and waits on your yes." },
      { name: "Friday recap", summary: "Every Friday, what went out this week and what is waiting on you." },
      { name: "Inbox watch", summary: "When a new reply arrives, files it under the right row." },
    ]);
    expect(bot.integrations.map((app) => app.name)).toEqual(["notion-workspace", "Google Sheets"]);
  });

  it("refuses a page that is not that bot's", () => {
    expect(() => parseXaiMarketplaceBot(botPage, "other-bot")).toThrow(XaiMarketplaceError);
  });
});

describe("fetchXaiPage errors", () => {
  const codeOf = async (fetcher: typeof fetch) => fetchXaiPage("https://x.ai/bot/marketplace", fetcher).then(() => "ok", (error: XaiMarketplaceError) => error.code);

  it("names each failure, never x.ai's raw error", async () => {
    expect(await codeOf(async () => html("", 404))).toBe("xai_not_found");
    expect(await codeOf(async () => html("", 403))).toBe("xai_blocked");
    expect(await codeOf(async () => html("", 503))).toBe("xai_unreachable");
    expect(await codeOf(async () => { throw new TypeError("fetch failed"); })).toBe("xai_unreachable");
    // A sign-in page off x.ai is never followed.
    expect(await codeOf(async () => html("", 302, { location: "https://accounts.example.test/sign-in" }))).toBe("xai_blocked");
  });

  it("follows a redirect that stays on x.ai", async () => {
    const fetcher = vi.fn(async (url: string) => (url.startsWith("https://x.ai/") ? html("", 301, { location: "https://www.x.ai/bot/marketplace" }) : html(listPage)));
    await expect(fetchXaiPage("https://x.ai/bot/marketplace", fetcher as unknown as typeof fetch)).resolves.toContain("sample-desk");
  });
});

describe("XaiMarketplaceSource", () => {
  it("keeps the list a few hours, reads again on refresh, and keeps the earlier list when a refresh fails", async () => {
    let now = 1_000;
    let down = false;
    const fetcher = vi.fn(async () => (down ? html("", 503) : html(listPage)));
    const source = new XaiMarketplaceSource({ fetcher: fetcher as unknown as typeof fetch, now: () => now, ttlMs: 60_000 });
    const first = await source.listBots();
    expect(first).toMatchObject({ label: "xAI Bot Marketplace", url: "https://x.ai/bot/marketplace", fetchedAt: 1_000 });
    expect(first.bots).toHaveLength(3);
    now += 30_000;
    await source.listBots();
    expect(fetcher).toHaveBeenCalledTimes(1);
    await source.listBots({ refresh: true });
    expect(fetcher).toHaveBeenCalledTimes(2);
    down = true;
    const stale = await source.listBots({ refresh: true });
    expect(stale.stale).toEqual({ code: "xai_unreachable" });
    expect(stale.bots).toHaveLength(3);
  });

  it("throws the source error when nothing was read yet, and reads a bot's page once", async () => {
    const failing = new XaiMarketplaceSource({ fetcher: (async () => html("<html></html>")) as unknown as typeof fetch });
    await expect(failing.listBots()).rejects.toMatchObject({ code: "xai_format", status: 502 });
    const fetcher = vi.fn(async () => html(botPage));
    const source = new XaiMarketplaceSource({ fetcher: fetcher as unknown as typeof fetch });
    const [a, b] = await Promise.all([source.bot("sample-desk"), source.bot("sample-desk")]);
    expect(a.bot.skills).toHaveLength(2);
    expect(b.bot.name).toBe("Sample Desk");
    expect(fetcher).toHaveBeenCalledTimes(1);
    await expect(source.bot("../etc")).rejects.toMatchObject({ code: "xai_not_found", status: 404 });
  });
});
