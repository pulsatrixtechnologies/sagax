import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createXPostCard } from "./xPostCard.ts";

function setup() {
  const messages = [{ id: "m1", role: "bot", text: "```x-post\n{}\n```", from: { botId: "b1", name: "Bot" } } as any];
  const store = {
    messagesFor: () => messages,
    patchMessage: (_thread: string, id: string, patch: any) => Object.assign(messages.find((row) => row.id === id)!, patch),
    groupByThread: () => undefined,
    botByThread: () => ({ id: "b1" }),
  };
  const asked: any[] = [];
  const host: any = {
    store, DATA_DIR: "/tmp/none", appendDecision: vi.fn(),
    languageOfRequest: () => "en",
    emailDraftBot: () => ({ bot: { id: "b1", name: "Bot" } }),
    cwActionActor: () => ({ id: "actor" }),
    performBotActRoute: async (_actor: unknown, route: any) => { asked.push(route); return { status: 200 }; },
  };
  return { card: createXPostCard(() => host), messages, asked, host };
}
const TOOL = "mcp__x__create_post";

describe("the X draft card's Post (#4638)", () => {
  it("hands the bot the exact text, opens one pass, and turns posted with the link", async () => {
    const { card, messages, asked } = setup();
    const done = await card.post({}, "t1", { messageId: "m1", draftKey: "k1", draft: { text: "Hello\n\nthere" } });
    expect(done.status).toBe(200);
    expect(messages[0].xPosts.k1.status).toBe("sending");
    expect(asked[0].body.text).toContain("Hello\n\nthere");
    expect(card.takePass("t1", "b1", TOOL, JSON.stringify({ text: "Hello!" }))).toBe(false);
    expect(card.takePass("t1", "b2", TOOL, JSON.stringify({ text: "Hello\n\nthere" }))).toBe(false);
    expect(card.takePass("t1", "b1", TOOL, JSON.stringify({ text: "Hello\n\nthere" }))).toBe(true);
    // one pass, one call
    expect(card.takePass("t1", "b1", TOOL, JSON.stringify({ text: "Hello\n\nthere" }))).toBe(false);
    expect(card.finish("t1", TOOL, true, '{"url":"https://x.com/sample/status/1234567890123"}', JSON.stringify({ text: "Hello\n\nthere" }))).toBe(true);
    expect(messages[0].xPosts.k1).toMatchObject({ status: "posted", url: "https://x.com/sample/status/1234567890123" });
    expect(card.status({}, "t1", "m1", "k1").body.post).toMatchObject({ status: "posted" });
  });

  it("posts the edited text, refuses one over the limit, and a second Post while sending", async () => {
    const { card } = setup();
    expect((await card.post({}, "t1", { messageId: "m1", draftKey: "k1", draft: { text: "a".repeat(300) } })).status).toBe(400);
    expect((await card.post({}, "t1", { messageId: "m1", draftKey: "k1", draft: { text: "ok" } })).status).toBe(200);
    expect((await card.post({}, "t1", { messageId: "m1", draftKey: "k1", draft: { text: "ok" } })).status).toBe(409);
  });

  it("a failed tool call turns the card failed with the reason, and Post may be pressed again", async () => {
    const { card, messages } = setup();
    await card.post({}, "t1", { messageId: "m1", draftKey: "k1", draft: { text: "ok" } });
    card.finish("t1", TOOL, false, "rate limit reached", JSON.stringify({ text: "ok" }));
    expect(messages[0].xPosts.k1).toMatchObject({ status: "failed", error: "rate limit reached" });
    expect((await card.post({}, "t1", { messageId: "m1", draftKey: "k1", draft: { text: "ok" } })).status).toBe(200);
  });

  it("a bot that cannot be asked fails the card and leaves no pass", async () => {
    const { card, messages, host } = setup();
    host.performBotActRoute = async () => ({ status: 500 });
    expect((await card.post({}, "t1", { messageId: "m1", draftKey: "k1", draft: { text: "ok" } })).status).toBe(502);
    expect(messages[0].xPosts.k1.status).toBe("failed");
    expect(card.takePass("t1", "b1", TOOL, JSON.stringify({ text: "ok" }))).toBe(false);
  });

  it("Discard closes the card, takes the pass away, and posts nothing", async () => {
    const { card, messages, asked } = setup();
    expect(card.discard({}, "t1", { messageId: "m1", draftKey: "k1", text: "ok" }).status).toBe(200);
    expect(messages[0].xPosts.k1.status).toBe("discarded");
    expect(asked).toHaveLength(0);
    expect(card.takePass("t1", "b1", TOOL, JSON.stringify({ text: "ok" }))).toBe(false);
  });

  it("only the bot's owner may post", async () => {
    const { card, host } = setup();
    host.emailDraftBot = () => ({ status: 403, body: { error: "no" } });
    expect((await card.post({}, "t1", { messageId: "m1", draftKey: "k1", draft: { text: "ok" } })).status).toBe(403);
  });

  it("a direct X post call answered on the held card gets its published-post card (no second flow)", () => {
    const { card, messages, host } = setup();
    const appended: any[] = [];
    host.store.appendMessage = (_t: string, row: any) => { appended.push(row); messages.push({ id: `n${appended.length}`, ...row }); return row; };
    host.store.botByThread = () => ({ id: "b1", name: "Bot", color: "blue" });
    expect(card.finish("t1", TOOL, true, '{"url":"https://x.com/sample/status/1234567890123"}', JSON.stringify({ text: "Direct" }))).toBe(true);
    expect(appended[0].text).toContain("```x-posts");
    expect(appended[0].text).toContain('"text":"Direct"');
    expect(appended[0].text).toContain('"posted":true');
    expect(appended[0].text).toContain('"url":"https://x.com/sample/status/1234567890123"');
    // a failed call, or another tool, adds nothing
    expect(card.finish("t1", TOOL, false, "no", JSON.stringify({ text: "Direct" }))).toBe(false);
    expect(card.finish("t1", "mcp__x__get_posts", true, "{}", JSON.stringify({ text: "Direct" }))).toBe(false);
  });

  it("in a group chat the bot that posted speaks for the published-post card", () => {
    const { card, messages, host } = setup();
    const appended: any[] = [];
    host.store.appendMessage = (_t: string, row: any) => { appended.push(row); messages.push({ id: `g${appended.length}`, ...row }); return row; };
    host.store.groupByThread = () => ({ id: "g1" });
    host.store.botByThread = () => undefined;
    const speaker = { botId: "b7", name: "Poster", color: "green" };
    expect(card.finish("t1", TOOL, true, '{"url":"https://x.com/sample/status/1234567890123"}', JSON.stringify({ text: "In a room" }), speaker)).toBe(true);
    expect(appended[0].from).toEqual(speaker);
    expect(appended[0].text).toContain("```x-posts");
    // nobody to speak for: nothing is invented
    expect(card.finish("t1", TOOL, true, "{}", JSON.stringify({ text: "In a room" }))).toBe(false);
  });
});

describe("the posted card carries the account that posted (#4640)", () => {
  const dir = mkdtempSync(join(tmpdir(), "x-account-"));
  function turn() {
    const rows: any[] = [];
    const store = {
      messagesFor: () => rows,
      appendMessage: (_t: string, row: any) => { rows.push({ id: `p${rows.length}`, at: Date.now(), ...row }); },
      patchMessage: (_t: string, id: string, patch: any) => Object.assign(rows.find((row) => row.id === id)!, patch),
      groupByThread: () => undefined,
      botByThread: () => ({ id: "b1", name: "Bot", color: "#fff" }),
      bot: (id: string) => ({ id, name: "Bot", color: "#fff" }),
    };
    const host: any = { store, DATA_DIR: dir, appendDecision: vi.fn(), languageOfRequest: () => "en", emailDraftBot: () => ({ bot: { id: "b1" } }) };
    return { card: createXPostCard(() => host), rows, host };
  }
  const ME = JSON.stringify({ data: { id: "42", username: "sample", name: "Sample Account", verified: true, profile_image_url: "https://pbs.twimg.com/profile_images/1/sample_normal.jpg" } });
  const fenceOf = (row: any) => JSON.parse(/```x-posts\n([\s\S]*)\n```/.exec(row.text)![1]!).posts;

  it("learns the account from a who-am-i call, then draws it on the post, with a link built from its handle", () => {
    const { card, rows, host } = turn();
    card.finish("t1", "mcp__x__get_me", true, ME, "{}");
    expect(card.account({}, "t1", "b1").body.account).toMatchObject({ handle: "sample", name: "Sample Account", verified: true });
    card.finish("t1", TOOL, true, '{"data":{"id":"1234567890123"}}', JSON.stringify({ text: "One" }));
    const [post] = fenceOf(rows[0]);
    expect(post).toMatchObject({ name: "Sample Account", handle: "sample", verified: true, posted: true, url: "https://x.com/sample/status/1234567890123" });
    expect(post.avatarUrl).toContain("pbs.twimg.com");
    expect(host.DATA_DIR).toBe(dir);
  });

  it("learns the account a shell tool's `xurl whoami` answers, and the browser path keeps it with its picture (#4895)", () => {
    const { card, rows } = turn();
    card.finish("t1", "Bash", true, ME, JSON.stringify({ command: "xurl whoami" }));
    expect(card.account({}, "t1", "b1").body.account).toMatchObject({ handle: "sample", name: "Sample Account", verified: true });
    const other = turn();
    other.card.learnAccount("b1", { handle: "demo_two", name: "Demo Two", verified: false, avatarUrl: "https://pbs.twimg.com/profile_images/2/demo_normal.jpg" });
    expect(other.card.account({}, "t1", "b1").body.account).toMatchObject({ handle: "demo_two", name: "Demo Two" });
    other.card.finish("t1", TOOL, true, '{"data":{"id":"1234567890125"}}', JSON.stringify({ text: "Three" }));
    expect(fenceOf(other.rows[0])[0]).toMatchObject({ handle: "demo_two", name: "Demo Two", url: "https://x.com/demo_two/status/1234567890125" });
    expect(rows).toHaveLength(0);
  });

  it("names the account from the post's own answer", () => {
    const { card, rows } = turn();
    const answer = JSON.stringify({ data: { id: "1234567890124", text: "x" }, includes: { users: [{ id: "42", username: "sample", name: "Sample Account" }] } });
    card.finish("t1", TOOL, true, answer, JSON.stringify({ text: "Two" }));
    expect(fenceOf(rows[0])[0]).toMatchObject({ handle: "sample", name: "Sample Account" });
  });

  it("puts the posts of one turn in one message (a stack) and a reply names its parent", () => {
    const { card, rows } = turn();
    card.finish("t1", "mcp__x__get_me", true, ME, "{}");
    rows.push({ id: "tool1", role: "bot", kind: "tool", tool: { name: TOOL }, at: Date.now() });
    card.finish("t1", TOOL, true, '{"id":"1234567890001"}', JSON.stringify({ text: "One" }));
    rows.push({ id: "tool2", role: "bot", kind: "tool", tool: { name: TOOL }, at: Date.now() });
    card.finish("t1", TOOL, true, '{"id":"1234567890002"}', JSON.stringify({ text: "Two", reply: { in_reply_to_tweet_id: "999999999999" }, in_reply_to_screen_name: "example_two" }));
    const cards = rows.filter((row) => !row.tool);
    expect(cards).toHaveLength(1);
    const posts = fenceOf(cards[0]);
    expect(posts.map((post: any) => post.text)).toEqual(["One", "Two"]);
    expect(posts[1].replyTo).toMatchObject({ id: "999999999999", handle: "example_two" });
  });

  it("a person's message ends the turn: the next post starts a new stack", () => {
    const { card, rows } = turn();
    card.finish("t1", TOOL, true, '{"id":"1234567890001"}', JSON.stringify({ text: "One" }));
    rows.push({ id: "u1", role: "user", kind: "text", text: "another", at: Date.now() });
    card.finish("t1", TOOL, true, '{"id":"1234567890002"}', JSON.stringify({ text: "Two" }));
    expect(rows.filter((row) => row.text?.includes("```x-posts"))).toHaveLength(2);
  });
  it("a post made by clicking Post in the browser shows the same Posted card, once", () => {
    const { card, rows } = turn();
    card.learnAccount("b1", { handle: "sample", name: "Sample Account", verified: false });
    const found = { id: "1234567890555", url: "https://x.com/sample/status/1234567890555", text: "From the browser" };
    card.browserPost("b1", "t1", found);
    card.browserPost("b1", "t1", found);
    const cards = rows.filter((row) => row.text?.includes("```x-posts"));
    expect(cards).toHaveLength(1);
    expect(fenceOf(cards[0])[0]).toMatchObject({ id: "1234567890555", name: "Sample Account", handle: "sample", posted: true, text: "From the browser", url: found.url });
  });

  it("a browser post with no known text shows no card, and one for an approved draft turns that draft posted", () => {
    const { card, rows } = turn();
    card.browserPost("b1", "t1", { id: "1234567890556", url: "https://x.com/sample/status/1234567890556" });
    expect(rows).toHaveLength(0);
    rows.push({ id: "m9", role: "bot", text: "```x-post\n{}\n```", from: { botId: "b1", name: "Bot" }, xPosts: { k9: { draftKey: "k9", text: "Approved  text", status: "sending", at: Date.now() } } });
    card.browserPost("b1", "t1", { id: "1234567890557", url: "https://x.com/sample/status/1234567890557", text: "Approved text" });
    expect(rows[0].xPosts.k9).toMatchObject({ status: "posted", url: "https://x.com/sample/status/1234567890557" });
    expect(rows).toHaveLength(1);
  });

  // #5553 [M-20261128-006]: a tool finish that only returns the status URL must still
  // name the posting account on the card (handle from the URL), even when whoami never ran.
  it("learns the posting handle from the published URL when whoami never ran (#5553)", () => {
    const alone = mkdtempSync(join(tmpdir(), "x-account-url-"));
    const rows: any[] = [];
    const store = {
      messagesFor: () => rows,
      appendMessage: (_t: string, row: any) => { rows.push({ id: `u${rows.length}`, at: Date.now(), ...row }); },
      patchMessage: (_t: string, id: string, patch: any) => Object.assign(rows.find((row) => row.id === id)!, patch),
      groupByThread: () => undefined,
      botByThread: () => ({ id: "b1", name: "Bot", color: "#fff" }),
      bot: (id: string) => ({ id, name: "Bot", color: "#fff" }),
    };
    const host: any = { store, DATA_DIR: alone, appendDecision: vi.fn(), languageOfRequest: () => "en", emailDraftBot: () => ({ bot: { id: "b1" } }) };
    const card = createXPostCard(() => host);
    expect(card.account({}, "t1", "b1").body.account).toBeNull();
    expect(card.finish("t1", TOOL, true, '{"url":"https://x.com/demo_handle/status/1234567890999"}', JSON.stringify({ text: "Published reply" }))).toBe(true);
    const [post] = fenceOf(rows[0]);
    expect(post).toMatchObject({ handle: "demo_handle", name: "demo_handle", posted: true, url: "https://x.com/demo_handle/status/1234567890999", text: "Published reply" });
    expect(post.name).toBeTruthy();
    expect(post.handle).toBeTruthy();
    expect(card.account({}, "t1", "b1").body.account).toMatchObject({ handle: "demo_handle" });
  });
});
