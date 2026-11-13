// Texting your own bot (server/sms-conversation.ts): who counts as the
// person, the answer texted back once, a long answer cut to one text, and
// no text the bot did not write (#4114). No network: every send is a fake.
import { describe, expect, it } from "vitest";

import { SMS_REPLY_MAX, SMS_TURN_WAIT_MS, SmsConversation, isCarrierKeyword, isOwnText, ownLineVia, smsReplyBody, type SmsTurnState } from "./sms-conversation.ts";

describe("whose text it is", () => {
  it("the line owner, PIN session open, words that are not a carrier keyword", () => {
    const own = { event: "sms", authenticated: true, personId: "u_1", sub: "u_1", text: "Quoi de neuf ?" };
    expect(isOwnText(own)).toBe(true);
    expect(isOwnText({ ...own, sender: "owner_mobile" })).toBe(true);
    expect(isOwnText({ ...own, sender: "allowlisted" })).toBe(false);
    expect(isOwnText({ ...own, sender: "verified_caller" })).toBe(false);
    expect(isOwnText({ ...own, personId: "u_2" })).toBe(false);
    expect(isOwnText({ ...own, personId: null })).toBe(false);
    expect(isOwnText({ ...own, authenticated: false })).toBe(false);
    expect(isOwnText({ ...own, text: "  " })).toBe(false);
    for (const word of ["STOP", "stop.", "Arrêt", "HELP", "aide", "START"]) expect(isCarrierKeyword(word), word).toBe(true);
    expect(isCarrierKeyword("stop the build")).toBe(false);
  });

  it("an authenticated call_request from the owner is an own-line turn (#2194)", () => {
    const own = { event: "call_request", authenticated: true, personId: "u_1", sub: "u_1", text: "Statut du billet ?" };
    expect(isOwnText(own)).toBe(true);
    expect(ownLineVia("call_request")).toBe("call");
    expect(ownLineVia("sms")).toBe("sms");
    expect(isOwnText({ ...own, authenticated: false })).toBe(false);
    expect(isOwnText({ ...own, personId: "u_2" })).toBe(false);
    expect(isOwnText({ ...own, text: "  " })).toBe(false);
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
  const sent: Array<{ person: string; botId: string; text: string; label: string; via: "sms" | "call" }> = [];
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
    expect(sent).toEqual([{ person: "pr_a", sub: "u_1", botId: "b1", text: "Quoi de neuf ?", label: "Osprey", via: "sms" }]);
    expect(texts).toEqual([{ to: "+15145550100", body: "Trois factures, 3 en tout." }]);
  });

  it("a call_request stamps via call and still texts the answer back", async () => {
    const { conversation, texts, sent } = harness(["running", "idle"]);
    expect(await conversation.start({ ...EVENT, via: "call", text: "Statut ?" })).toBe(true);
    await conversation.drain();
    expect(sent).toEqual([{ person: "pr_a", sub: "u_1", botId: "b1", text: "Statut ?", label: "Osprey", via: "call" }]);
    expect(texts).toEqual([{ to: "+15145550100", body: "Trois factures, 3 en tout." }]);
  });

  it("a card waiting on the person sends nothing; only the answer goes back (#4114)", async () => {
    const { conversation, texts } = harness(["running", "waiting", "waiting", "idle"]);
    await conversation.start(EVENT);
    await conversation.drain();
    expect(texts.map((entry) => entry.body)).toEqual(["Trois factures, 3 en tout."]);
  });

  it("a turn that could not start sends nothing and says so", async () => {
    const { conversation, texts } = harness(["idle"], "", false);
    expect(await conversation.start(EVENT)).toBe(false);
    await conversation.drain();
    expect(texts).toEqual([]);
  });

  it("a turn with no words sends nothing", async () => {
    const quiet = harness(["idle"], "");
    await quiet.conversation.start(EVENT);
    await quiet.conversation.drain();
    expect(quiet.texts).toEqual([]);
  });

  it("the wait limit passes: nothing is sent, the loop ends, one log line without words (#4114)", async () => {
    const logs: string[] = [];
    let clock = 0;
    const conversation = new SmsConversation({
      send: async () => ({ ok: true, threadId: "t1", messageId: "m1" }),
      state: () => "running",
      replyAfter: () => "",
      textBack: async () => { throw new Error("nothing may be texted"); },
      language: () => "fr",
      sleep: async (ms) => { clock += ms; },
      now: () => clock,
      log: (line) => logs.push(line),
    });
    await conversation.start(EVENT);
    await conversation.drain();
    expect(clock).toBeGreaterThanOrEqual(SMS_TURN_WAIT_MS);
    expect(logs).toEqual([`sms-conversation: b1 wait limit reached for ***0100 after ${SMS_TURN_WAIT_MS / 1_000}s (started)`]);
  });
});

// #4046: a text that lands while a turn runs is answered within seconds, not
// at the end of the turn. The send says how the words were taken: steered
// into the running turn (the chat's mid-turn path), queued behind it, or the
// start of a turn of their own. Poll n happens at n * 2s; a bot row of step n
// is finished at that time; the engine takes the steered line in half a
// poll before `takenStep` (`steer.received`).
const POLL = 2_000;
function midTurn(opts: {
  delivery: "started" | "steered" | "queued";
  script: SmsTurnState[];
  /** The bot's text rows after the line, by the poll step they finished. */
  rows: Array<{ step: number; text: string; attention?: boolean }>;
  /** The step by which the engine said it took the line in; none when it never says. */
  takenStep?: number;
}) {
  const texts: Array<{ body: string; step: number }> = [];
  const logs: string[] = [];
  let step = 0;
  let clock = 0;
  const at = () => opts.script[Math.min(step, opts.script.length - 1)]!;
  const conversation = new SmsConversation({
    send: async () => ({ ok: true, threadId: "t1", messageId: opts.delivery === "queued" ? "" : "m1", delivery: opts.delivery }),
    state: () => at(),
    replyAfter: (_thread, _message, since) => opts.rows
      .filter((row) => row.step <= step && !row.attention && (since === undefined || row.step * POLL > since))
      .map((row) => row.text).join("\n\n"),
    ...(opts.takenStep === undefined ? {} : { receivedAt: () => (step >= opts.takenStep! ? opts.takenStep! * POLL - POLL / 2 : undefined) }),
    textBack: async ({ body }) => { texts.push({ body, step }); return true; },
    language: () => "fr",
    sleep: async (ms) => { step += 1; clock += ms; },
    now: () => clock,
    log: (line) => logs.push(line),
  });
  return { conversation, texts, logs };
}

const LONG_TURN: SmsTurnState[] = [...Array.from({ length: 200 }, () => "running" as const), "idle"];
const ANSWER = "Oui, la facture est partie.";
const NARRATION = "Je vérifie maintenant les factures du mois.";

describe("a text while a turn runs (#4046)", () => {
  it("steered into the running turn: the answer leaves as soon as the bot wrote it, long before the turn ends", async () => {
    const { conversation, texts, logs } = midTurn({ delivery: "steered", script: LONG_TURN, rows: [{ step: 2, text: ANSWER }], takenStep: 1 });
    await conversation.start(EVENT);
    await conversation.drain();
    expect(texts).toEqual([{ body: ANSWER, step: 2 }]);
    expect(texts[0]!.step).toBeLessThan(200);
    expect(logs.some((line) => /^sms-conversation: b1 answered \*\*\*0100 after 4s \(steered\)$/.test(line))).toBe(true);
  });

  it("a narration finished before the engine took the line in is not the answer", async () => {
    const { conversation, texts } = midTurn({
      delivery: "steered", script: LONG_TURN, takenStep: 2,
      rows: [{ step: 1, text: NARRATION }, { step: 3, text: ANSWER }],
    });
    await conversation.start(EVENT);
    await conversation.drain();
    expect(texts).toEqual([{ body: ANSWER, step: 3 }]);
  });

  it("a relayed card written after the line is never sent as the answer", async () => {
    const { conversation, texts } = midTurn({
      delivery: "steered", script: LONG_TURN, takenStep: 1,
      rows: [{ step: 2, text: "Une autre personne attend une carte.", attention: true }, { step: 4, text: ANSWER }],
    });
    await conversation.start(EVENT);
    await conversation.drain();
    expect(texts).toEqual([{ body: ANSWER, step: 4 }]);
  });

  it("an engine that never says it took the line in: answered when the turn ends, as before", async () => {
    const { conversation, texts } = midTurn({ delivery: "steered", script: ["running", "running", "running", "idle"], rows: [{ step: 1, text: ANSWER }] });
    await conversation.start(EVENT);
    await conversation.drain();
    expect(texts).toEqual([{ body: ANSWER, step: 3 }]);
  });

  it("a call request steered into the running turn is answered the same way", async () => {
    const { conversation, texts } = midTurn({ delivery: "steered", script: LONG_TURN, rows: [{ step: 1, text: ANSWER }], takenStep: 1 });
    await conversation.start({ ...EVENT, via: "call" });
    await conversation.drain();
    expect(texts.map((entry) => entry.step)).toEqual([1]);
  });

  it("the running turn cannot take it: nothing until the answer, which is sent once (#4114)", async () => {
    const { conversation, texts, logs } = midTurn({ delivery: "queued", script: [...LONG_TURN.slice(0, 5), "waiting", "running", "idle"], rows: [{ step: 0, text: ANSWER }] });
    await conversation.start(EVENT);
    await conversation.drain();
    expect(texts).toEqual([{ body: ANSWER, step: 7 }]);
    expect(logs.filter((line) => line === "sms-conversation: b1 queued for ***0100 after 0s (queued)")).toHaveLength(1);
    expect(logs.filter((line) => line === "sms-conversation: b1 waiting on a card for ***0100 after 10s (queued)")).toHaveLength(1);
    expect(logs.some((line) => line.includes(ANSWER) || line.includes("Quoi de neuf"))).toBe(false);
  });

  it("steered into a turn blocked on a card: nothing until the answer, which is sent once (#4114)", async () => {
    const { conversation, texts, logs } = midTurn({ delivery: "steered", script: ["waiting", "waiting", "waiting", "running", ...LONG_TURN], rows: [{ step: 4, text: ANSWER }], takenStep: 3 });
    await conversation.start(EVENT);
    await conversation.drain();
    expect(texts).toEqual([{ body: ANSWER, step: 4 }]);
    expect(logs.filter((line) => line.startsWith("sms-conversation: b1 waiting on a card for ***0100"))).toHaveLength(1);
  });

  it("the idle case is unchanged: a turn of its own is answered when it ends", async () => {
    const { conversation, texts } = midTurn({ delivery: "started", script: ["running", "running", "running", "idle"], rows: [{ step: 1, text: ANSWER }] });
    await conversation.start(EVENT);
    await conversation.drain();
    expect(texts).toEqual([{ body: ANSWER, step: 3 }]);
  });

  it("no automatic text is left to send (#4114)", async () => {
    const mod: Record<string, unknown> = await import("./sms-conversation.ts");
    expect(Object.keys(mod).filter((name) => /^sms(Busy|Waiting|Late)Body$/.test(name))).toEqual([]);
  });
});
