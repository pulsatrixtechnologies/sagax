// Texting your own bot (server/sms-conversation.ts): who counts as the
// person, the answer texted back once, a card said in one text, a long
// answer cut to one text. No network: every send is a fake.
import { describe, expect, it } from "vitest";

import { SMS_REPLY_MAX, SmsConversation, isCarrierKeyword, isOwnText, smsReplyBody, type SmsTurnState } from "./sms-conversation.ts";

describe("whose text it is", () => {
  it("the line owner, PIN session open, words that are not a carrier keyword", () => {
    const own = { event: "sms", authenticated: true, personId: "u_1", sub: "u_1", text: "Quoi de neuf ?" };
    expect(isOwnText(own)).toBe(true);
    expect(isOwnText({ ...own, personId: "u_2" })).toBe(false);
    expect(isOwnText({ ...own, personId: null })).toBe(false);
    expect(isOwnText({ ...own, authenticated: false })).toBe(false);
    expect(isOwnText({ ...own, event: "call_request" })).toBe(false);
    expect(isOwnText({ ...own, text: "  " })).toBe(false);
    for (const word of ["STOP", "stop.", "Arrêt", "HELP", "aide", "START"]) expect(isCarrierKeyword(word), word).toBe(true);
    expect(isCarrierKeyword("stop the build")).toBe(false);
  });

  it("cuts a long answer to one text", () => {
    expect(smsReplyBody("Bonjour", "fr")).toBe("Bonjour");
    const long = smsReplyBody("x".repeat(5_000), "fr");
    expect(long.length).toBeLessThanOrEqual(SMS_REPLY_MAX);
    expect(long).toContain("suite dans Sagax");
  });
});

function harness(script: SmsTurnState[], reply = "Trois factures, 3 en tout.", sendOk = true) {
  const texts: Array<{ to: string; body: string }> = [];
  const sent: Array<{ person: string; botId: string; text: string; label: string }> = [];
  let step = 0;
  let clock = 0;
  const conversation = new SmsConversation({
    send: async (input) => {
      sent.push(input);
      return sendOk ? { ok: true, threadId: "t1", messageId: "m1" } : { ok: false, error: "refused" };
    },
    state: () => script[Math.min(step, script.length - 1)]!,
    replyAfter: () => (script[Math.min(step, script.length - 1)] === "idle" ? reply : ""),
    textBack: async ({ to, body }) => { texts.push({ to, body }); return true; },
    botName: () => "Helper",
    language: () => "fr",
    sleep: async (ms) => { step += 1; clock += ms; },
    now: () => clock,
    log: () => {},
  });
  return { conversation, texts, sent };
}

const EVENT = { person: "pr_a", sub: "u_1", botId: "b1", from: "+15145550100", text: "Quoi de neuf ?", label: "Osprey" };

describe("the answer by text", () => {
  it("sends the words into the conversation and texts the answer back once", async () => {
    const { conversation, texts, sent } = harness(["running", "running", "idle"]);
    expect(await conversation.start(EVENT)).toBe(true);
    await conversation.drain();
    expect(sent).toEqual([{ person: "pr_a", sub: "u_1", botId: "b1", text: "Quoi de neuf ?", label: "Osprey" }]);
    expect(texts).toEqual([{ to: "+15145550100", body: "Trois factures, 3 en tout." }]);
  });

  it("a card waiting on the person is said in one text, then the answer", async () => {
    const { conversation, texts } = harness(["running", "waiting", "waiting", "idle"]);
    await conversation.start(EVENT);
    await conversation.drain();
    expect(texts.map((entry) => entry.body)).toEqual(["Helper attend ta réponse à une carte dans Sagax.", "Trois factures, 3 en tout."]);
  });

  it("a turn that could not start sends nothing and says so", async () => {
    const { conversation, texts } = harness(["idle"], "", false);
    expect(await conversation.start(EVENT)).toBe(false);
    await conversation.drain();
    expect(texts).toEqual([]);
  });

  it("a turn with no words sends nothing; one that never ends says the answer stays in Sagax", async () => {
    const quiet = harness(["idle"], "");
    await quiet.conversation.start(EVENT);
    await quiet.conversation.drain();
    expect(quiet.texts).toEqual([]);
    const slow = harness(["running"]);
    await slow.conversation.start(EVENT);
    await slow.conversation.drain();
    expect(slow.texts.map((entry) => entry.body)).toEqual(["Helper travaille encore. La réponse sera dans Sagax."]);
  });
});
