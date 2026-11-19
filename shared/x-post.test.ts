import { describe, expect, it } from "vitest";
import {
  X_POST_LIMIT, isXPostTool, normalizeXDraft, parseXDraftFence, parseXPostsFence, readXPost,
  heldXDraft, xPostTextOfInput, xCount, xCounter, xDraftKey, xPostCallMatches, xPostUrlFromResult, xWeightedLength, xSiteUrl,
  isXAccountTool, xAccountFromOutput, xAvatarSized, xReplyFromInput, parseXIdentity, isXSitePage, isXurlWhoAmI,
} from "./x-post.ts";

describe("X character count", () => {
  it("counts a link as 23 and a wide letter or emoji as 2", () => {
    expect(xWeightedLength("hello")).toBe(5);
    expect(xWeightedLength("see https://example.com/a/very/long/path/that/goes/on")).toBe(4 + 23);
    expect(xWeightedLength("日本")).toBe(4);
    expect(xWeightedLength("ok 🙂")).toBe(5);
  });
  it("shows the counter only near the limit", () => {
    expect(xCounter("short").show).toBe(false);
    expect(xCounter("a".repeat(X_POST_LIMIT - 20)).show).toBe(true);
    expect(xCounter("a".repeat(X_POST_LIMIT - 21)).show).toBe(false);
    expect(xCounter("a".repeat(X_POST_LIMIT + 1))).toMatchObject({ over: true, remaining: -1 });
  });
});

describe("X draft", () => {
  it("reads JSON or bare text, keeping paragraphs", () => {
    expect(parseXDraftFence('{"text":"One\\n\\nTwo","name":"Sample Account","handle":"@sample"}')).toEqual({ text: "One\n\nTwo", name: "Sample Account", handle: "sample" });
    expect(parseXDraftFence("Just text\n\nmore")).toEqual({ text: "Just text\n\nmore" });
    expect(parseXDraftFence("   ")).toBeNull();
  });
  it("refuses an empty, invisible or over-long text, and folds blank space", () => {
    expect("problems" in normalizeXDraft({ text: "  " })).toBe(true);
    expect("problems" in normalizeXDraft({ text: "a‮b" })).toBe(true);
    expect("problems" in normalizeXDraft({ text: "a".repeat(281) })).toBe(true);
    expect(normalizeXDraft({ text: "  hi \r\n\r\n\r\n\r\nthere  " })).toEqual({ text: "hi\n\nthere" });
  });
  it("keys the same text the same way", () => {
    expect(xDraftKey("a\r\nb")).toBe(xDraftKey("a\nb "));
    expect(xDraftKey("a")).not.toBe(xDraftKey("b"));
  });
});

describe("the bot's X tool and the Post pass", () => {
  it("knows an X tool that publishes, and not one that reads or deletes", () => {
    expect(isXPostTool("mcp__x__create_post")).toBe(true);
    expect(isXPostTool("mcp__claude_ai_X__post_tweet")).toBe(true);
    expect(isXPostTool("mcp__x__get_posts")).toBe(false);
    expect(isXPostTool("mcp__x__delete_post")).toBe(false);
    expect(isXPostTool("mcp__github__create_issue")).toBe(false);
    expect(isXPostTool("mcp__x__like_post")).toBe(false);
  });
  it("matches only a call that carries exactly the approved text", () => {
    const tool = "mcp__x__create_post";
    expect(xPostCallMatches("Hello\n\nthere", tool, JSON.stringify({ text: "Hello\n\nthere" }))).toBe(true);
    expect(xPostCallMatches("Hello", tool, JSON.stringify({ params: { status: " Hello " } }))).toBe(true);
    expect(xPostCallMatches("Hello", tool, JSON.stringify({ text: "Hello!" }))).toBe(false);
    expect(xPostCallMatches("Hello", "mcp__x__search_posts", JSON.stringify({ query: "Hello" }))).toBe(false);
    expect(xPostCallMatches("Hello", tool, "not json")).toBe(false);
  });
  it("finds the published post's link in a tool answer", () => {
    expect(xPostUrlFromResult('{"url":"https://x.com/sample/status/1234567890123"}')).toBe("https://x.com/sample/status/1234567890123");
    expect(xPostUrlFromResult('{"data":{"id":"1234567890123"}}')).toBe("https://x.com/i/web/status/1234567890123");
    expect(xPostUrlFromResult("no link")).toBeUndefined();
  });
});

describe("X posts a bot read", () => {
  it("reads the card's own fields", () => {
    const posts = parseXPostsFence(JSON.stringify({ posts: [{ id: "1234567890", name: "Sample Account", handle: "sample", verified: true, text: "Hi", metrics: { replies: 1, likes: 2, views: 3 } }] }));
    expect(posts?.[0]).toMatchObject({ name: "Sample Account", handle: "sample", verified: true, url: "https://x.com/sample/status/1234567890", metrics: { replies: 1, likes: 2, views: 3 } });
  });
  it("reads an X API v2 answer with its includes, quote and media", () => {
    const answer = {
      data: [{
        id: "1234567890", author_id: "9", text: "Post", created_at: "2026-11-16T10:00:00.000Z",
        public_metrics: { reply_count: 4, retweet_count: 5, like_count: 6, impression_count: 7, bookmark_count: 8 },
        attachments: { media_keys: ["m1"] },
        referenced_tweets: [{ type: "quoted", id: "55555" }],
      }],
      includes: {
        users: [{ id: "9", name: "Sample Account", username: "sample", verified: true, profile_image_url: "https://pbs.twimg.com/a.jpg" }, { id: "8", name: "Example Two", username: "example_two" }],
        media: [{ media_key: "m1", type: "photo", url: "https://pbs.twimg.com/media/x.jpg", alt_text: "Alt" }],
        tweets: [{ id: "55555", author_id: "8", text: "Quoted" }],
      },
    };
    const [post] = parseXPostsFence(JSON.stringify(answer))!;
    expect(post).toMatchObject({ handle: "sample", verified: true, metrics: { replies: 4, reposts: 5, likes: 6, views: 7, bookmarks: 8 } });
    expect(post!.media).toEqual([{ type: "photo", url: "https://pbs.twimg.com/media/x.jpg", alt: "Alt" }]);
    expect(post!.quoted).toMatchObject({ handle: "example_two", text: "Quoted" });
  });
  it("drops what is not a post and never trusts a non-https or foreign link", () => {
    expect(parseXPostsFence("not json")).toBeNull();
    expect(parseXPostsFence("[{\"nothing\":1}]")).toBeNull();
    const post = readXPost({ handle: "sample", text: "Hi", url: "https://evil.example/status/1", avatarUrl: "http://pbs.twimg.com/a.jpg" })!;
    expect(post.url).toBeUndefined();
    expect(post.avatarUrl).toBeUndefined();
    expect(xSiteUrl("https://x.com/sample/status/1")).toBeTruthy();
    expect(xSiteUrl("https://x.com.evil.example/a")).toBeUndefined();
  });
  it("shortens counts the way X does", () => {
    expect(xCount(950)).toBe("950");
    expect(xCount(4210)).toBe("4,210");
    expect(xCount(12_300)).toBe("12.3K");
    expect(xCount(128_500)).toBe("129K");
    expect(xCount(2_400_000, "fr")).toBe("2,4\u00a0M");
  });
});

describe("a bot's own X post call, shown as the draft card (#4638)", () => {
  it("reads the text of a held X post call, and nothing for another tool", () => {
    expect(heldXDraft("mcp__x__create_post", JSON.stringify({ text: "Hello\n\n\n\nthere" }))).toEqual({ text: "Hello\n\nthere" });
    expect(heldXDraft("mcp__x__create_post", JSON.stringify({ params: { status: " Hi " } }))).toEqual({ text: "Hi" });
    expect(heldXDraft("mcp__x__search_posts", JSON.stringify({ text: "Hi" }))).toBeNull();
    expect(heldXDraft("mcp__github__create_issue", JSON.stringify({ text: "Hi" }))).toBeNull();
    expect(xPostTextOfInput("{}")).toBeUndefined();
  });
  it("shows a draft with one blank line between paragraphs", () => {
    expect(parseXDraftFence('{"text":"One\\n\\n\\n\\nTwo"}')?.text).toBe("One\n\nTwo");
    expect(parseXDraftFence("One\n \n \n\nTwo")?.text).toBe("One\n\nTwo");
  });
});

describe("who posted (#4640)", () => {
  it("reads the account of a who-am-i answer and of a post's includes", () => {
    const me = xAccountFromOutput(JSON.stringify({ data: { username: "sample", name: "Sample Account", verified: true, profile_image_url: "https://pbs.twimg.com/profile_images/1/a_normal.jpg" } }), true);
    expect(me).toMatchObject({ handle: "sample", name: "Sample Account", verified: true });
    expect(xAvatarSized(me!.avatarUrl!)).toBe("https://pbs.twimg.com/profile_images/1/a_400x400.jpg");
    const post = xAccountFromOutput(JSON.stringify({ data: { id: "1" }, includes: { users: [{ username: "sample", name: "S", verified_type: "blue" }] } }));
    expect(post).toMatchObject({ handle: "sample", verified: true });
    expect(xAccountFromOutput("not json")).toBeNull();
    expect(isXAccountTool("mcp__x__get_me")).toBe(true);
    expect(isXAccountTool("mcp__x__create_post")).toBe(false);
  });
  it("reads a reply's target from the call and a posted card without an account yet", () => {
    expect(xReplyFromInput(JSON.stringify({ text: "hi", reply: { in_reply_to_tweet_id: "1234567890123" } }))).toEqual({ id: "1234567890123" });
    expect(xReplyFromInput(JSON.stringify({ text: "hi", reply_to_url: "https://x.com/example_two/status/1234567890123" }))).toEqual({ id: "1234567890123", handle: "example_two" });
    expect(xReplyFromInput(JSON.stringify({ text: "hi" }))).toBeNull();
    const posts = parseXPostsFence(JSON.stringify({ posts: [{ text: "Hi", posted: true, replyTo: { handle: "example_two" } }] }));
    expect(posts?.[0]).toMatchObject({ posted: true, handle: "", replyTo: { handle: "example_two" } });
    expect(parseXPostsFence(JSON.stringify({ posts: [{ text: "Hi" }] }))).toBeNull();
  });
});

describe("the account of a signed-in x.com session (#4895)", () => {
  const eval_ = (value: unknown) => ({ content: [{ type: "text", text: JSON.stringify(JSON.stringify(value)) }] });
  it("reads the page's answer, keeping only X's own picture host", () => {
    expect(parseXIdentity(eval_({ handle: "sample", name: "Sample Account", verified: true, avatarUrl: "https://pbs.twimg.com/profile_images/1/s_normal.jpg" })))
      .toEqual({ handle: "sample", name: "Sample Account", verified: true, avatarUrl: "https://pbs.twimg.com/profile_images/1/s_normal.jpg" });
    expect(parseXIdentity(eval_({ handle: "sample", name: "", avatarUrl: "https://evil.example/a.png" }))).toEqual({ handle: "sample", name: "sample", verified: false });
    expect(parseXIdentity(eval_(null))).toBeNull();
    expect(parseXIdentity(eval_({ handle: "not a handle!" }))).toBeNull();
    expect(parseXIdentity({ isError: true, content: [] })).toBeNull();
  });
  it("runs only on x.com over https, and knows xurl whoami", () => {
    expect(isXSitePage("https://x.com/home")).toBe(true);
    expect(isXSitePage("https://x.com.evil.example/")).toBe(false);
    expect(isXSitePage("http://x.com/")).toBe(false);
    expect(isXurlWhoAmI(JSON.stringify({ command: "xurl whoami" }))).toBe(true);
    expect(isXurlWhoAmI(JSON.stringify({ command: "xurl post hello" }))).toBe(false);
  });
});
