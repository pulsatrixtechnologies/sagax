import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { quotePost, sampleDraft, samplePost, timelinePosts } from "@/lib/x-post-fixtures";
import { XDraftCard, XPostList, xDateText } from "./XPostCards";

describe("X draft card (#4638)", () => {
  it("shows the avatar, Post and the handle, Copy, the text, and two equal buttons", () => {
    const html = renderToStaticMarkup(createElement(XDraftCard, { draft: sampleDraft("en"), threadId: "t1", botId: "b1", messageId: "m1" }));
    expect(html).toContain("@sample");
    expect(html).toContain("data-x-copy");
    expect(html).toContain("data-x-editor");
    expect(html).toContain("A sample build is live.");
    expect(html).toContain("data-x-discard");
    expect(html).toContain("data-x-post-button");
    expect(html).toContain("grid-cols-2");
    expect(html).not.toContain("data-x-counter");
  });
  it("cannot post outside a conversation or while the bot is still writing", () => {
    const loose = renderToStaticMarkup(createElement(XDraftCard, { draft: sampleDraft("en") }));
    expect(loose).toMatch(/data-x-post-button=""[^>]*disabled|disabled=""[^>]*data-x-post-button/);
    const writing = renderToStaticMarkup(createElement(XDraftCard, { draft: sampleDraft("en"), threadId: "t1", messageId: "m1", pending: true }));
    expect(writing).toMatch(/disabled=""[^>]*data-x-post-button|data-x-post-button=""[^>]*disabled/);
  });
  it("shows the counter near the limit and disables Post over it", () => {
    const near = renderToStaticMarkup(createElement(XDraftCard, { draft: { text: "a".repeat(265) }, threadId: "t1", messageId: "m1" }));
    expect(near).toContain('data-x-counter="near"');
    const over = renderToStaticMarkup(createElement(XDraftCard, { draft: { text: "a".repeat(290) }, threadId: "t1", messageId: "m1" }));
    expect(over).toContain('data-x-counter="over"');
    expect(over).toMatch(/disabled=""[^>]*data-x-post-button|data-x-post-button=""[^>]*disabled/);
  });
});

describe("X post cards (#4638)", () => {
  it("draws a post like x.com: name, badge, handle, date, links, counts, and opens on x.com", () => {
    const html = renderToStaticMarkup(createElement(XPostList, { posts: [samplePost("en")] }));
    expect(html).toContain("Sample Account");
    expect(html).toContain("@sample");
    expect(html).toContain('title="Verified account"');
    expect(html).toContain('href="https://example.com/sample"');
    expect(html).toContain('data-x-url="https://x.com/sample/status/1000000000000000001"');
    for (const key of ["replies", "reposts", "likes", "views", "bookmark", "share"]) expect(html).toContain(`data-x-metric="${key}"`);
    expect(html).toContain("4,210");
    expect(html).toContain("129K");
  });
  it("draws a quoted post as an inner card with its own header", () => {
    const html = renderToStaticMarkup(createElement(XPostList, { posts: [samplePost("en", { quoted: quotePost("en") })] }));
    expect(html).toContain("data-x-quote");
    expect(html).toContain("Example Two");
    expect(html).toContain("The quoted post");
  });
  it("stacks several posts with dividers and never loads a foreign picture unasked", () => {
    const html = renderToStaticMarkup(createElement(XPostList, { posts: timelinePosts("en") }));
    expect(html.match(/data-x-post=""/g)).toHaveLength(3);
    expect(html.match(/border-t border-\[var\(--x-line\)\]/g)).toHaveLength(2);
    const foreign = renderToStaticMarkup(createElement(XPostList, { posts: [samplePost("en", { media: [{ type: "photo", url: "https://images.example/a.jpg" }], avatarUrl: "https://images.example/a.jpg" })] }));
    expect(foreign).not.toContain("images.example");
    const own = renderToStaticMarkup(createElement(XPostList, { posts: [samplePost("en", { media: [{ type: "photo", url: "https://pbs.twimg.com/media/a.jpg" }] })] }));
    expect(own).toContain("pbs.twimg.com/media/a.jpg");
  });
  it("shows the year only for another year", () => {
    const now = Date.parse("2026-11-17T12:00:00Z");
    expect(xDateText("2026-11-16T10:00:00Z", now)).not.toContain("2026");
    expect(xDateText("2025-03-01T10:00:00Z", now)).toContain("2025");
  });
});
