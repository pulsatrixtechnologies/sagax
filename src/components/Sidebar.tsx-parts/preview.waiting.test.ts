// 2026-11-09: the sidebar says what a waiting bot waits on.
import { describe, expect, it } from "vitest";

import type { Bot, Message } from "@/state/store";
import { preview, teammateWaitLine, waitingLine } from "./preview";

describe("waiting lines", () => {
  it("names the card the bot waits on", () => {
    expect(waitingLine({ waitingOn: { threadId: "t", messageId: "m", text: "Which repo should I file it in?" } })).toBe("Waiting for you: Which repo should I file it in?");
  });

  it("keeps the plain line without a card (an older server)", () => {
    expect(waitingLine({})).toBe("Waiting for you…");
  });

  it("names the awaited teammates", () => {
    expect(teammateWaitLine({ waitingOnTeammates: ["Milo", "Lina"] })).toBe("Waiting on Milo, Lina…");
    expect(teammateWaitLine({})).toBe("Waiting on a teammate…");
  });
});

// #4093: every row keeps its last-message line, as the reference's rows do;
// a question card saved without a title read as an empty line.
describe("the last message's line", () => {
  const card = (extra: Record<string, unknown>) => ({
    id: "q", role: "bot", kind: "options", at: 1, text: "",
    card: { title: "", subtitle: "", options: [], requestId: "r", requestType: "question", ...extra },
  }) as unknown as Message;
  const bot = { id: "b", name: "Atlas", messages: [] } as unknown as Bot;

  it("reads an untitled question card as its first question", () => {
    const question = card({ questionRequest: { version: 1, questions: [{ question: "Which site do I migrate first?", options: [] }] } });
    expect(preview(bot, [question], [])).toBe("Which site do I migrate first?");
  });

  it("keeps a titled card's title", () => {
    const titled = card({ title: "Pick a site", questionRequest: { version: 1, questions: [{ question: "Which site?", options: [] }] } });
    expect(preview(bot, [titled], [])).toBe("Pick a site");
  });
});
