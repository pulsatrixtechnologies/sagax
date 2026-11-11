// #3542: the pinned row asks the server what waits on the person when a
// live frame says something opened or closed, never on a short timer.
import { describe, expect, it } from "vitest";

import { waitingChangeFrame } from "./waiting-items.ts";

const own = new Set(["conv", "topic"]);
const waiting = new Set(["topic"]);

describe("waitingChangeFrame (#3542)", () => {
  it("asks again when a card, a question in words or an offer opens or closes in the bot's conversations", () => {
    expect(waitingChangeFrame({ kind: "message", threadId: "conv", message: { role: "bot", card: { requestId: "r1" } } }, own, waiting)).toBe(true);
    expect(waitingChangeFrame({ kind: "message.patch", threadId: "conv", message: { role: "bot", card: { requestId: "r1", answered: "Allow" } } }, own, waiting)).toBe(true);
    expect(waitingChangeFrame({ kind: "message", threadId: "topic", message: { role: "bot", attention: { kind: "human" } } }, own, waiting)).toBe(true);
    expect(waitingChangeFrame({ kind: "message.patch", threadId: "conv", message: { role: "bot", inputRequest: { answered: true } } }, own, waiting)).toBe(true);
    expect(waitingChangeFrame({ kind: "message", threadId: "conv", message: { role: "bot", card: { proactiveProposal: { id: "p" } } } }, own, waiting)).toBe(true);
  });

  it("asks again when the person writes where something waits (their words settle a needs you card)", () => {
    expect(waitingChangeFrame({ kind: "message", threadId: "topic", message: { role: "user", text: "done" } }, own, waiting)).toBe(true);
    expect(waitingChangeFrame({ kind: "message", threadId: "conv", message: { role: "user", text: "hi" } }, own, waiting)).toBe(false);
  });

  it("ignores the bot's words, other bots' conversations and other frames", () => {
    expect(waitingChangeFrame({ kind: "message", threadId: "conv", message: { role: "bot", text: "hello" } }, own, waiting)).toBe(false);
    expect(waitingChangeFrame({ kind: "message", threadId: "elsewhere", message: { role: "bot", card: { requestId: "r1" } } }, own, waiting)).toBe(false);
    expect(waitingChangeFrame({ kind: "bot", threadId: "conv" }, own, waiting)).toBe(false);
    expect(waitingChangeFrame({ kind: "ping" }, own, waiting)).toBe(false);
  });
});
