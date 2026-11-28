import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { postedPost, postedReply, quotePost, sampleDraft, samplePost, timelinePosts } from "@/lib/x-post-fixtures";
import { XDraftCard, XPostList, XPostStack, withAccount, xDateText, xFanStyle, xTimeText } from "./XPostCards";

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

describe("held X post call and the footer (#4638)", () => {
  it("shows the same card for a held call, with Post and Discard answering it", () => {
    const html = renderToStaticMarkup(createElement(XDraftCard, { draft: sampleDraft("en"), held: { onPost: () => {}, onDiscard: () => {} } }));
    expect(html).toContain("data-x-post-button");
    expect(html).toContain("data-x-discard");
    const post = /<button[^>]*data-x-post-button[^>]*>/.exec(html)?.[0] ?? "";
    expect(post).not.toContain('disabled=""');
  });
  it("spreads the four counts evenly and keeps bookmark and share at the right", () => {
    const html = renderToStaticMarkup(createElement(XPostList, { posts: [samplePost("en")] }));
    expect(html.match(/flex min-w-0 flex-1 items-center gap-1/g)).toHaveLength(4);
    expect(html).toContain("ms-auto flex shrink-0");
    expect(html).not.toContain("max-w-[425px]");
  });
});

describe("the posted card and the stack (#4640)", () => {
  it("is one card as the account that posted: its picture, name, badge, handle, a Posted chip, X's logo, no second frame or link", () => {
    const html = renderToStaticMarkup(createElement(XPostList, { posts: [postedPost("en")] }));
    expect(html).toContain("Sample Account");
    expect(html).toContain("@sample");
    expect(html).toContain('title="Verified account"');
    expect(html).toContain("pbs.twimg.com/profile_images");
    expect(html).toContain("data-x-posted-chip");
    expect(html).toContain("data-x-logo");
    expect(html).not.toContain("data-x-view-link");
    expect(html).not.toContain("View on X");
    expect(html).not.toContain("Your account");
    expect(html).not.toContain(">SA<");
    expect(html.match(/<article/g)).toHaveLength(1);
    expect(html.match(/<section/g)).toHaveLength(1);
    expect(html).toContain('data-x-url="https://x.com/sample/status/1000000000000000100"');
    // muted action icons when no count is known
    for (const key of ["replies", "reposts", "likes", "views"]) expect(html).toContain(`data-x-metric="${key}"`);
  });
  it("shows the initials only when there is really no data, never an invented account", () => {
    const html = renderToStaticMarkup(createElement(XPostList, { posts: [postedPost("en", 0, { name: "", handle: "", verified: false, avatarUrl: undefined })] }));
    expect(html).toContain("Your account");
    expect(html).not.toContain(">YA<");
    expect(html).not.toContain("@x");
    expect(html).not.toContain('title="Verified account"');
  });
  // #5553 [M-20261128-006]: connected account fills empty posted fields and upgrades a URL placeholder.
  it("fills a posted card from the connected X account, including a URL-learned placeholder (#5553)", () => {
    const account = { handle: "demo_handle", name: "Demo Name", verified: true, avatarUrl: "https://pbs.twimg.com/profile_images/1/demo_normal.jpg" };
    const empty = withAccount(postedPost("en", 0, { name: "", handle: "", verified: false, avatarUrl: undefined }), account);
    expect(empty).toMatchObject({ name: "Demo Name", handle: "demo_handle", verified: true, avatarUrl: account.avatarUrl });
    const placeholder = withAccount(postedPost("en", 0, { name: "demo_handle", handle: "demo_handle", verified: false, avatarUrl: undefined }), account);
    expect(placeholder).toMatchObject({ name: "Demo Name", handle: "demo_handle", verified: true, avatarUrl: account.avatarUrl });
    const html = renderToStaticMarkup(createElement(XPostList, { posts: [empty] }));
    expect(html).toContain("Demo Name");
    expect(html).toContain("@demo_handle");
    expect(html).not.toContain("Your account");
  });
  it("draws a reply with Replying to @handle and the parent quoted compactly", () => {
    const html = renderToStaticMarkup(createElement(XPostList, { posts: [postedReply("en")] }));
    expect(html).toContain("Replying to");
    expect(html).toContain("@example_two");
    expect(html).toContain("data-x-parent");
    expect(html).toContain("The quoted post");
  });
  it("fans several posts of a turn: the front card, the others behind, a label, and a click on the label opens them all", () => {
    const posts = [0, 1, 2].map((index) => postedPost("en", index));
    const html = renderToStaticMarkup(createElement(XPostList, { posts }));
    expect(html).toContain("data-x-stack");
    expect(html).toContain("3 posts");
    expect(html).toContain('data-x-stack-card="front"');
    expect(html).toContain('data-x-stack-card="1"');
    expect(html).toContain('data-x-stack-card="2"');
    expect(html).toContain('aria-roledescription="stack of posts"');
    // only the front card is reachable: the ones behind are inert and hidden from readers
    expect(html.match(/aria-hidden="true"[^>]*data-x-stack-card|data-x-stack-card="[12]"[^>]*aria-hidden="true"/g) ?? []).toHaveLength(2);
    expect(renderToStaticMarkup(createElement(XPostStack, { posts }))).toContain('aria-expanded="false"');
  });
  it("a single posted post is just the card, not a stack", () => {
    expect(renderToStaticMarkup(createElement(XPostList, { posts: [postedPost("en")] }))).not.toContain("data-x-stack");
  });
  it("read posts keep their timeline, and a batch mixing read posts is not a stack", () => {
    const html = renderToStaticMarkup(createElement(XPostList, { posts: [postedPost("en"), samplePost("en")] }));
    expect(html).not.toContain("data-x-stack");
  });
  it("fans the cards back with a turn and an offset, and keeps them straight under reduced motion", () => {
    expect(xFanStyle(0, false).transform).toBe("none");
    expect(String(xFanStyle(1, false).transform)).toMatch(/rotate\(5\.7deg\)/);
    expect(String(xFanStyle(2, false).transform)).toMatch(/rotate\(-7\.9deg\)/);
    expect(String(xFanStyle(2, true).transform)).toContain("rotate(0deg)");
    expect(xFanStyle(6, false).opacity).toBe(0);
  });
  it("shows the cards behind on both sides and above, alternating, each smaller than the one before", () => {
    const x = (depth: number) => Number(/translate\((-?\d+)px/.exec(String(xFanStyle(depth, false).transform))?.[1]);
    const y = (depth: number) => Number(/translate\(-?\d+px, (-?\d+)px/.exec(String(xFanStyle(depth, false).transform))?.[1]);
    const scale = (depth: number) => Number(/scale\(([\d.]+)\)/.exec(String(xFanStyle(depth, false).transform))?.[1]);
    expect(x(1)).toBeGreaterThan(0);
    expect(x(2)).toBeLessThan(0);
    expect(x(3)).toBeGreaterThan(0);
    expect(y(1)).toBeLessThan(0);
    expect(scale(1)).toBeGreaterThan(scale(2));
    expect(scale(2)).toBeGreaterThan(scale(3));
    // reduced motion keeps the cards visible behind (offset), without any turn
    expect(String(xFanStyle(1, true).transform)).toContain("rotate(0deg)");
  });
  it("writes the time the way the timeline does", () => {
    const now = Date.parse("2026-11-18T12:00:00Z");
    expect(xTimeText("2026-11-18T11:55:00Z", now)).toBe("5m");
    expect(xTimeText("2026-11-18T09:00:00Z", now)).toBe("3h");
    expect(xTimeText("2026-11-10T09:00:00Z", now)).not.toMatch(/\dh$/);
  });
});
