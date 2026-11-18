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
    expect(appended[0].text).toContain("```x-post");
    expect(Object.values(appended[0].xPosts)[0]).toMatchObject({ status: "posted", text: "Direct", url: "https://x.com/sample/status/1234567890123" });
    // a failed call, or another tool, adds nothing
    expect(card.finish("t1", TOOL, false, "no", JSON.stringify({ text: "Direct" }))).toBe(false);
    expect(card.finish("t1", "mcp__x__get_posts", true, "{}", JSON.stringify({ text: "Direct" }))).toBe(false);
  });
});
