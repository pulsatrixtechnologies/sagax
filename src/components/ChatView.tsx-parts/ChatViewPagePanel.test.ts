// The in-place ask about a selected passage (#4099) is the person's ordinary
// message in the bot's conversation: it shows in the chat at once with the
// page chip and the passage, like a message from the chat's own composer.
import { describe, expect, it } from "vitest";

import { initialState, reducer, type Bot } from "@/state/store";
import { pageAskOffered, pageAskSend } from "./ChatViewPagePanel";

const selection = { kind: "text" as const, quote: "Closed tickets, response times", prefix: "", suffix: " and backlog", path: "body > p", tag: "p" };
const page = { pageId: "abcdefgh12345678", title: "Report", version: 2, selection };

describe("pageAskSend (#4099)", () => {
  it("carries the page and the passage, with a sendId so the message shows in the chat at once", () => {
    const action = pageAskSend("scout", "Make this shorter", page);
    expect(action).toMatchObject({ type: "send", botId: "scout", text: "Make this shorter", dataContext: { page: { pageId: page.pageId, title: "Report", version: 2, selection } } });
    expect(typeof (action as { sendId?: unknown }).sendId).toBe("string");

    const bot = { id: "scout", threadId: "t", name: "Scout", messages: [], busy: true } as unknown as Bot;
    const next = reducer({ ...initialState, bots: [bot], selectedId: "scout" }, action);
    const shown = next.bots[0]!.messages.at(-1)!;
    expect(shown.role).toBe("user");
    expect(shown.text).toBe("Make this shorter");
    expect(shown.dataContext?.page?.selection).toEqual(selection);
  });
});

describe("pageAskOffered (#4099)", () => {
  it("is offered where the person can write in this bot's conversation, and not on a page they only read", () => {
    expect(pageAskOffered(true, "scout", "scout")).toBe(true);
    expect(pageAskOffered(null, undefined, "scout")).toBe(true);
    expect(pageAskOffered(undefined, "scout", "scout")).toBe(true);
    // read only for this person: no composer
    expect(pageAskOffered(false, "scout", "scout")).toBe(false);
    // another bot's page
    expect(pageAskOffered(true, "other", "scout")).toBe(false);
  });
});
