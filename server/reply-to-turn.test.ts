import { describe, expect, it } from "vitest";

import type { WireMessage } from "../shared/wire.ts";
import { botReplyQuoteId } from "./reply-to-turn.ts";

let sequence = 0;
function user(text: string, extra: Partial<WireMessage> = {}): WireMessage {
  return { id: `u${++sequence}`, at: sequence, role: "user", kind: "text", text, ...extra };
}
function bot(text: string): WireMessage {
  return { id: `b${++sequence}`, at: sequence, role: "bot", kind: "text", text };
}

describe("botReplyQuoteId", () => {
  it("adds no chip to a plain single-message turn", () => {
    const only = user("salut");
    expect(botReplyQuoteId([only], only.id)).toBeUndefined();
  });

  it("adds no chip to a single message that follows an earlier answered turn", () => {
    const a = user("premier");
    const reply = bot("ok");
    const b = user("deuxième");
    expect(botReplyQuoteId([a, reply, b], b.id)).toBeUndefined();
  });

  it("quotes the triggering message when the person sent several in a row", () => {
    const a = user("fais ceci");
    const b = user("et aussi cela");
    const c = user("passe le mot aussi a katarina sur sagax");
    expect(botReplyQuoteId([a, b, c], c.id)).toBe(c.id);
  });

  it("counts a burst only within the current turn, not across a past answer", () => {
    const a = user("vieux message");
    const reply = bot("répondu");
    const b = user("nouveau message seul");
    expect(botReplyQuoteId([a, reply, b], b.id)).toBeUndefined();
  });

  it("quotes the message the person explicitly replied to", () => {
    const original = bot("voici le rapport");
    const chatter = user("merci");
    const reply = user("et pour celui-ci?", { replyToId: original.id });
    expect(botReplyQuoteId([original, chatter, reply], reply.id)).toBe(original.id);
  });

  it("ignores an explicit reply whose target is gone", () => {
    const reply = user("pour celui-ci", { replyToId: "disparu" });
    expect(botReplyQuoteId([reply], reply.id)).toBeUndefined();
  });

  it("does not count another bot's relayed line as the person's", () => {
    const peer = user("from Ember", { peerAsk: { botId: "e", name: "Ember" } });
    const mine = user("ok vas-y");
    expect(botReplyQuoteId([peer, mine], mine.id)).toBeUndefined();
  });

  it("returns undefined when the trigger is missing or not a person line", () => {
    const only = bot("hello");
    expect(botReplyQuoteId([only], only.id)).toBeUndefined();
    expect(botReplyQuoteId([only], "nope")).toBeUndefined();
    expect(botReplyQuoteId([only], undefined)).toBeUndefined();
  });
});
