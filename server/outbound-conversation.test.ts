// Conversation calls, the whole cycle (2026-10-28): place_phone_call in
// mode conversation, the approval card, the placement through Perspicax
// Voice (voice_call as the person who speaks, their own line), a fake
// Twilio and a fake realtime voice that talk with a scripted callee, the
// call_result Perspicax posts to the real telephony route, the result card,
// the bot's next turn, the stop list, the 30 day transcript and the
// isolation between people. Nothing here reaches a network but loopback.
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { conversationDisclosure, parseOutboundCall } from "../shared/outbound-call.ts";
import type { CustomRule } from "../shared/custom-rules.ts";
import type { OutboundCallResult, OutboundCard, OutboundTranscriptLine } from "../shared/wire.ts";
import { TELEPHONY_PATH, createBotInboundTelephonyRoute, type TelephonyRouteDeps } from "./bot-inbound-telephony.ts";
import { reviewCustomRules } from "./custom-rules-review.ts";
import type { ConsoleAssertion } from "./oidc-rp.ts";
import { TRANSCRIPT_RETENTION_MS } from "./outbound-calls.ts";
import { outboundWiring } from "./outbound-wiring.ts";
import type { Message } from "./store.ts";

const ORIGIN = "https://sagax.example";
const NUMBER = "+15145550142";
const LINE = "+14385550100";
const PEOPLE = {
  alex: { principalId: "pr_alex", sub: "u_alex", name: "Alex Example" },
  sam: { principalId: "pr_sam", sub: "u_sam", name: "Sam Example" },
} as const;
const THREAD = { alex: "t-alex", sam: "t-sam" } as const;
const ARGS = {
  to: "+1 514 555 0142",
  mode: "conversation",
  objective: "Savoir s'il entend bien la ligne et s'il peut parler deux minutes",
  instructions: "Rester bref. Ne rien promettre au nom de la personne.",
  max_minutes: 3,
  language: "fr",
};

// ── a fake Twilio and a fake realtime voice, as Perspicax Voice runs them ──

interface PlacedCall { sid: string; ref: string; to: string; botName: string; person: string; maxMinutes: number; objective: string; language: "fr" | "en"; voicemail?: string }

/** The callee, scripted: what they answer to each thing the bot says. */
type Callee = { kind: "human"; lines: string[]; stopAfter?: number } | { kind: "machine" } | { kind: "no-answer" } | { kind: "busy" };

/** A stand-in for the realtime model: pursues the objective, ends the call
 * when the callee answered, when they ask to stop, or at the time limit. */
function realtimeDialogue(call: PlacedCall, callee: Extract<Callee, { kind: "human" }>, secondsPerTurn: number): { transcript: OutboundTranscriptLine[]; endedBy: NonNullable<OutboundCallResult["endedBy"]>; seconds: number; stop: boolean } {
  // the line says the disclosure first (a <Say> before the stream), never the model
  const transcript: OutboundTranscriptLine[] = [{ speaker: "bot", text: conversationDisclosure({ botName: call.botName, personName: call.person, language: call.language }) }];
  transcript.push({ speaker: "bot", text: `Je vous appelle pour ceci : ${call.objective}.` });
  let seconds = 6;
  for (const [index, said] of callee.lines.entries()) {
    if (seconds + secondsPerTurn > call.maxMinutes * 60) {
      transcript.push({ speaker: "bot", text: "Je dois vous laisser, merci beaucoup. Au revoir." });
      return { transcript, endedBy: "time-limit", seconds: call.maxMinutes * 60, stop: false };
    }
    seconds += secondsPerTurn;
    transcript.push({ speaker: "callee", text: said });
    if (callee.stopAfter === index) {
      transcript.push({ speaker: "bot", text: "Désolé du dérangement, on ne vous rappellera pas. Au revoir." });
      return { transcript, endedBy: "stop-request", seconds, stop: true };
    }
    transcript.push({ speaker: "bot", text: index === callee.lines.length - 1 ? "Parfait, merci. Bonne journée." : "D'accord, et pouvez-vous me dire autre chose ?" });
  }
  return { transcript, endedBy: "goal", seconds, stop: false };
}

let sidCounter = 0;

class FakeVoice {
  /** Calls create the fake Twilio received (never a real one). */
  readonly twilioCreates: Array<{ To: string; MachineDetection: string; TimeLimit: number }> = [];
  readonly toolCalls: Array<{ person: string; args: Record<string, unknown> }> = [];
  readonly placed: PlacedCall[] = [];
  /** voice_call as `person` (the turn's speaker): their own line. */
  async call(person: keyof typeof PEOPLE, args: Record<string, unknown>) {
    this.toolCalls.push({ person, args });
    if (args.mode !== "conversation") return { ok: false as const, code: "rpc_error", error: "unexpected mode" };
    if (args.dry_run === true) return { ok: true as const, isError: false, value: { dry_run: true, mode: "conversation", request: { method: "POST", form: { To: args.to } } } };
    // unique across tests: the route remembers event ids it answered
    sidCounter += 1;
    const sid = `CA${String(sidCounter).padStart(32, "0")}`;
    const maxMinutes = Number(args.max_minutes);
    this.twilioCreates.push({ To: String(args.to), MachineDetection: "DetectMessageEnd", TimeLimit: maxMinutes * 60 + 30 });
    this.placed.push({
      sid, ref: String(args.ref), to: String(args.to), botName: String(args.bot_name), person: PEOPLE[person].name, maxMinutes,
      objective: String(args.purpose), language: args.language === "en" ? "en" : "fr", ...(typeof args.voicemail === "string" ? { voicemail: args.voicemail } : {}),
    });
    return { ok: true as const, isError: false, value: { placed: true, sid, status: "queued", mode: "conversation" } };
  }

  /** What Perspicax posts when the call ends. */
  resultFor(call: PlacedCall, callee: Callee): Record<string, unknown> {
    if (callee.kind === "no-answer" || callee.kind === "busy") {
      return { ref: call.ref, callSid: call.sid, outcome: callee.kind, durationSec: 0, points: [], commitments: [] };
    }
    if (callee.kind === "machine") {
      const said = `${conversationDisclosure({ botName: call.botName, personName: call.person, language: call.language })} ${call.voicemail ?? "Je rappellerai plus tard."}`;
      return { ref: call.ref, callSid: call.sid, outcome: "voicemail", durationSec: 0, points: [], commitments: [], transcript: [{ speaker: "bot", text: said }] };
    }
    const talk = realtimeDialogue(call, callee, 40);
    const heard = talk.transcript.filter((line) => line.speaker === "callee").map((line) => line.text);
    return {
      ref: call.ref, callSid: call.sid, outcome: "completed", endedBy: talk.endedBy, durationSec: talk.seconds,
      points: [`La ligne est claire et la personne répond (${heard.length} réponses).`, ...heard.slice(0, 3).map((text) => `Réponse : ${text}`)].slice(0, 5),
      commitments: talk.stop ? [] : ["Rappeler demain matin pour confirmer."],
      transcript: talk.transcript,
      ...(talk.stop ? { doNotCallAgain: true } : {}),
    };
  }
}

// ── the conversation store and the wiring ──

let dir: string;
let clock: number;
let threads: Map<string, Message[]>;
let wakes: Array<{ botId: string; threadId: string; prompt: string }>;
let voice: FakeVoice;
let wiring: ReturnType<typeof outboundWiring>;
let messageCounter = 0;

function makeWiring() {
  const made = outboundWiring({
    dataDir: dir,
    now: () => clock,
    store: {
      messagesFor: (threadId) => threads.get(threadId) ?? [],
      appendMessage: (threadId, message) => {
        messageCounter += 1;
        const row = { ...message, id: `m-${messageCounter}`, at: clock } as Message;
        threads.set(threadId, [...(threads.get(threadId) ?? []), row]);
        return row;
      },
      patchMessage: (threadId, messageId, patch) => {
        const rows = threads.get(threadId) ?? [];
        const index = rows.findIndex((row) => row.id === messageId);
        if (index < 0) return null;
        rows[index] = { ...rows[index]!, ...patch } as Message;
        return rows[index]!;
      },
    },
    botName: () => "Rocket",
    personName: () => "Organisation Exemple",
    language: () => "fr",
    twilio: async () => ({ ok: false, code: "rpc_error", error: "a conversation never uses twilio_api_write" }),
    voice: (turn, args) => voice.call(turn.threadId === THREAD.sam ? "sam" : "alex", args),
    principalName: (principalId) => Object.values(PEOPLE).find((person) => person.principalId === principalId)?.name,
    principalSub: (principalId) => Object.values(PEOPLE).find((person) => person.principalId === principalId)?.sub ?? null,
    wake: (botId, threadId, _messageId, prompt) => wakes.push({ botId, threadId, prompt }),
  });
  // the one-time acceptable-use consent (5e792c845) is its own gate, tested in
  // outbound-wiring.test.ts; these people accepted it already
  for (const person of Object.values(PEOPLE)) made.consentStore.accept(person.principalId, "bot-rocket");
  return made;
}

const placeAs = (who: keyof typeof PEOPLE, args: Record<string, unknown> = ARGS) =>
  wiring.placeCall({ principalId: PEOPLE[who].principalId, botId: "bot-rocket", threadId: THREAD[who], generation: "g1", room: false }, args);

const cardOf = (who: keyof typeof PEOPLE): OutboundCard => {
  const row = [...(threads.get(THREAD[who]) ?? [])].reverse().find((message) => message.outbound?.kind === "call");
  return row!.outbound!;
};

/** The person ticks the number and chooses Call on the card. */
function approve(who: keyof typeof PEOPLE): void {
  const row = wiring.calls.pending(PEOPLE[who].principalId)[0]!;
  wiring.calls.answer(PEOPLE[who].principalId, row.id, "call", "card", NUMBER, true);
}

// ── the real telephony route, with a fake assertion verifier ──

const tokens = new Map<string, ConsoleAssertion>();
let jti = 0;
const routeDeps: TelephonyRouteDeps = {
  identity: () => "perspicax",
  publicOrigin: () => ORIGIN,
  linkServerId: () => "srv",
  verify: async (bearer) => {
    const found = tokens.get(bearer);
    if (!found) throw new Error("no");
    return found;
  },
  // the line of each person reports to their own bot
  bot: (id) => (id === "bot-line-alex" || id === "bot-line-sam" ? { id, name: "Rocket" } : null),
  owner: (id) => (id === "bot-line-alex" ? { principalId: PEOPLE.alex.principalId, sub: PEOPLE.alex.sub, active: true }
    : id === "bot-line-sam" ? { principalId: PEOPLE.sam.principalId, sub: PEOPLE.sam.sub, active: true } : null),
  triggers: () => [],
  ingest: () => null,
  callResult: (input) => wiring.callResult(input),
  record: () => {},
};
let server: Server;
let base = "";
beforeAll(async () => {
  const handle = createBotInboundTelephonyRoute(routeDeps);
  server = createServer(async (req, res) => {
    if (!(await handle(req, res, new URL(req.url ?? "/", "http://localhost")))) {
      res.writeHead(418);
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));

/** Perspicax posts the call's result, signed for the line's owner. */
async function postResult(lineOwner: keyof typeof PEOPLE, result: Record<string, unknown>, to = NUMBER) {
  const body = JSON.stringify({
    contract: "perspicax-voice/1", event: "call_result", eventId: `call_result:${String(result.callSid)}`,
    receivedAt: "2026-10-28T15:00:00Z", line: { id: `line_${lineOwner}`, number: LINE }, from: to, authenticated: false,
    botId: `bot-line-${lineOwner}`, directives: { thirdPartyCall: "card", clientPhoneSource: "provided" }, result,
  });
  jti += 1;
  const id = `tok${jti}`;
  tokens.set(id, {
    iss: "https://perspicax.example", sub: PEOPLE[lineOwner].sub, jti: `jti-call-${String(jti).padStart(10, "0")}`, iat: 0,
    exp: Math.floor(Date.now() / 1000) + 60, serverId: "srv", role: "employee", teams: [], actor: "perspicax-voice",
    bodySha256: createHash("sha256").update(body).digest("hex"),
  });
  const res = await fetch(`${base}${TELEPHONY_PATH}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${id}` }, body });
  return { status: res.status, body: await res.json() as Record<string, unknown> };
}

/** Card, approval, placement: the call is under way. */
async function placedCall(who: keyof typeof PEOPLE = "alex", args: Record<string, unknown> = ARGS): Promise<PlacedCall> {
  await placeAs(who, args);
  approve(who);
  const placed = await placeAs(who, args);
  expect(placed.isError, placed.text).toBeUndefined();
  return voice.placed.at(-1)!;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "outbound-conversation-"));
  clock = Date.UTC(2026, 9, 28, 15, 0, 0);
  threads = new Map();
  wakes = [];
  voice = new FakeVoice();
  wiring = makeWiring();
  wiring.calls.updateSettings({ enabled: true, callbackNumber: "+14385550199" });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("place_phone_call, mode conversation", () => {
  it("reads objective, guidance, length and language; a bad length or a missing objective is refused", () => {
    expect(parseOutboundCall(ARGS)).toMatchObject({ to: NUMBER, mode: "conversation", purpose: ARGS.objective, maxMinutes: 3, language: "fr", from: "", message: "" });
    expect(parseOutboundCall({ to: NUMBER, mode: "conversation", objective: "Confirmer" })).toMatchObject({ maxMinutes: 5 });
    expect(parseOutboundCall({ ...ARGS, max_minutes: 21 })).toMatch(/max_minutes/);
    expect(parseOutboundCall({ ...ARGS, max_minutes: 2.5 })).toMatch(/max_minutes/);
    expect(parseOutboundCall({ to: NUMBER, mode: "conversation" })).toMatch(/objective/);
    expect(parseOutboundCall({ ...ARGS, mode: "chat" })).toMatch(/mode is message/);
  });

  it("approval: a dry run on the person's own line, then one card with the number, the objective, the length and the AI disclosure; nothing placed", async () => {
    const answer = await placeAs("alex");
    expect(answer.isError).toBeUndefined();
    expect(answer.text).toContain("Nothing was placed");
    expect(voice.twilioCreates).toHaveLength(0);
    expect(voice.toolCalls).toHaveLength(1);
    expect(voice.toolCalls[0]).toMatchObject({ person: "alex", args: { mode: "conversation", dry_run: true, to: NUMBER, max_minutes: 3, bot_name: "Rocket", confirm: true } });
    const card = cardOf("alex");
    expect(card).toMatchObject({
      kind: "call", status: "pending", mode: "conversation", destination: "+1 514 555 0142", objective: ARGS.objective, maxMinutes: 3,
      instructions: ARGS.instructions, script: "Bonjour, ici Rocket, un assistant IA qui appelle au nom d'Alex Example.",
    });
    expect(card.from).toBeUndefined();
    expect(card.callback).toBeUndefined();
  });

  it("one approval places one call, with the person's own line; a retry needs a new card", async () => {
    await placeAs("alex");
    approve("alex");
    expect(wakes.length).toBe(0);
    const placed = await placeAs("alex");
    expect(placed.text).toContain("Conversation call placed");
    expect(voice.twilioCreates).toEqual([{ To: NUMBER, MachineDetection: "DetectMessageEnd", TimeLimit: 3 * 60 + 30 }]);
    const real = voice.toolCalls.at(-1)!;
    expect(real.person).toBe("alex");
    expect(real.args).not.toHaveProperty("dry_run");
    expect(real.args.ref).toMatch(/^call_[0-9a-f]{16}$/);
    expect(cardOf("alex")).toMatchObject({ status: "done", mode: "conversation" });
    expect(cardOf("alex").result).toBeUndefined();
    const again = await placeAs("alex");
    expect(again.text).toContain("Nothing was placed");
    expect(voice.twilioCreates).toHaveLength(1);
  });

  it("a changed objective or length is another call and another card", async () => {
    await placeAs("alex");
    approve("alex");
    await placeAs("alex", { ...ARGS, max_minutes: 10 });
    await placeAs("alex", { ...ARGS, objective: "Autre chose" });
    expect(voice.twilioCreates).toHaveLength(0);
  });

  it("dialogue: the disclosure first, the conversation, the end at the objective; the result card and the bot's next turn", async () => {
    const call = await placedCall();
    const result = voice.resultFor(call, { kind: "human", lines: ["Oui, je vous entends très bien.", "J'ai le temps, allez-y.", "Merci, c'est noté."] });
    const posted = await postResult("alex", result);
    expect(posted).toMatchObject({ status: 202, body: { event: "call_result", applied: true } });
    const card = cardOf("alex");
    expect(card.result).toMatchObject({ outcome: "completed", endedBy: "goal", durationSec: 126, commitments: ["Rappeler demain matin pour confirmer."] });
    expect(card.result!.points.length).toBeGreaterThanOrEqual(3);
    expect(card.result!.points.length).toBeLessThanOrEqual(5);
    expect(card.result!.transcript![0]).toEqual({ speaker: "bot", text: "Bonjour, ici Rocket, un assistant IA qui appelle au nom d'Alex Example." });
    expect(card.result!.transcript!.filter((line) => line.speaker === "callee").map((line) => line.text)).toEqual(["Oui, je vous entends très bien.", "J'ai le temps, allez-y.", "Merci, c'est noté."]);
    // the bot gets the result to answer the person, the other party's words as data
    expect(wakes).toHaveLength(1);
    expect(wakes[0]).toMatchObject({ botId: "bot-rocket", threadId: THREAD.alex });
    expect(wakes[0]!.prompt).toContain("completed after 2:06; the objective was reached");
    expect(wakes[0]!.prompt).toContain("<<<UNTRUSTED source=\"phone call\">>>");
    expect(wakes[0]!.prompt).toContain("Other party: J'ai le temps, allez-y.");
    expect(wakes[0]!.prompt).toContain("Rappeler demain matin");
    // the record file keeps metadata, never a word said, and the number only in its own card
    const saved = readFileSync(join(dir, "outbound-calls.json"), "utf8");
    expect(saved).not.toContain("allez-y");
    expect(saved).not.toContain("Rappeler demain");
    expect(saved).toContain("\"outcome\":\"completed\"");
  });

  it("a result comes once: the same result again changes nothing", async () => {
    const call = await placedCall();
    const result = voice.resultFor(call, { kind: "human", lines: ["Oui."] });
    expect((await postResult("alex", result)).status).toBe(202);
    const again = await postResult("alex", result);
    expect(again.status).toBe(202);
    expect(again.body.applied).toBe(false);
    expect(wakes).toHaveLength(1);
  });

  it("the time limit ends the call politely at max_minutes", async () => {
    const call = await placedCall("alex", { ...ARGS, max_minutes: 1 });
    expect(call.maxMinutes).toBe(1);
    const result = voice.resultFor(call, { kind: "human", lines: ["Oui.", "Attendez.", "Encore une chose.", "Et puis."] });
    await postResult("alex", result);
    expect(cardOf("alex").result).toMatchObject({ outcome: "completed", endedBy: "time-limit", durationSec: 60 });
    expect(cardOf("alex").result!.transcript!.at(-1)!.text).toContain("Au revoir");
  });

  it("voicemail: the short message is left, the card says so", async () => {
    const call = await placedCall("alex", { ...ARGS, voicemail: "Je rappellerai demain." });
    expect(call.voicemail).toBe("Je rappellerai demain.");
    await postResult("alex", voice.resultFor(call, { kind: "machine" }));
    expect(cardOf("alex").result).toMatchObject({ outcome: "voicemail", durationSec: 0 });
    expect(cardOf("alex").result!.transcript![0]!.text).toContain("assistant IA");
    expect(wakes[0]!.prompt).toContain("reached voicemail");
    expect(wakes[0]!.prompt).toContain("Your voicemail message was left.");
  });

  it.each(["no-answer", "busy"] as const)("%s: no conversation, the bot does not call again on its own", async (kind) => {
    const call = await placedCall();
    await postResult("alex", voice.resultFor(call, { kind }));
    expect(cardOf("alex").result).toMatchObject({ outcome: kind, durationSec: 0, points: [], commitments: [] });
    expect(wakes[0]!.prompt).toContain("Do not call again on your own");
  });

  it("the callee asks to stop: the call ends, this person never calls the number again", async () => {
    const call = await placedCall();
    await postResult("alex", voice.resultFor(call, { kind: "human", lines: ["Ne me rappelez plus, s'il vous plaît."], stopAfter: 0 }));
    expect(cardOf("alex").result).toMatchObject({ outcome: "completed", endedBy: "stop-request", doNotCallAgain: true });
    expect(wakes[0]!.prompt).toContain("never call this number again");
    const retry = await placeAs("alex");
    expect(retry.isError).toBe(true);
    expect(retry.text).toContain("asked not to be called again");
    // the stop list is this person's own: another person's bot may still ask
    const other = await placeAs("sam");
    expect(other.isError).toBeUndefined();
  });

  it("isolation: another person's line, a wrong call or an unknown call never settles a card", async () => {
    const call = await placedCall("alex");
    const result = voice.resultFor(call, { kind: "human", lines: ["Oui."] });
    // signed for another person (their own line): refused, nothing changes
    expect((await postResult("sam", result)).status).toBe(403);
    // the right person, another call's sid
    expect((await postResult("alex", { ...result, callSid: `CA${"f".repeat(32)}` })).status).toBe(403);
    // a ref nobody placed
    expect((await postResult("alex", { ...result, ref: "call_0123456789abcdef" })).status).toBe(404);
    expect(cardOf("alex").result).toBeUndefined();
    expect(wakes).toHaveLength(0);
    // another person can neither see nor answer this person's card
    await placeAs("alex", { ...ARGS, objective: "Une autre question" });
    const pending = wiring.calls.pending(PEOPLE.alex.principalId)[0]!;
    expect(wiring.calls.pending(PEOPLE.sam.principalId)).toHaveLength(0);
    expect(() => wiring.calls.answer(PEOPLE.sam.principalId, pending.id, "call", "card", NUMBER, true)).toThrow(/No such call/);
    // each person's call goes out on their own line (voice_call as the speaker)
    await placedCall("sam");
    expect(voice.toolCalls.filter((entry) => entry.person === "sam").every((entry) => entry.args.to === NUMBER)).toBe(true);
    expect(voice.placed.at(-1)!.person).toBe("Sam Example");
  });

  it("a result with an unknown field shape is refused before it reaches the card", async () => {
    const call = await placedCall();
    const bad = { ...voice.resultFor(call, { kind: "human", lines: ["Oui."] }), outcome: "transferred" };
    expect((await postResult("alex", bad)).status).toBe(400);
    expect(cardOf("alex").result).toBeUndefined();
  });

  it("the transcript leaves the card 30 days after the call; the summary stays", async () => {
    const call = await placedCall();
    await postResult("alex", voice.resultFor(call, { kind: "human", lines: ["Oui, très bien."] }));
    clock += TRANSCRIPT_RETENTION_MS - 60_000;
    expect(wiring.sweepTranscripts()).toBe(0);
    clock += 120_000;
    expect(wiring.sweepTranscripts()).toBe(1);
    const result = cardOf("alex").result!;
    expect(result.transcript).toBeUndefined();
    expect(result.transcriptExpired).toBe(true);
    expect(result.points.length).toBeGreaterThan(0);
    expect(wiring.sweepTranscripts()).toBe(0);
  });

  it("organization rules: the pilot switch and the do-not-call list hold a conversation too", async () => {
    wiring.calls.updateSettings({ addDoNotCall: NUMBER });
    expect((await placeAs("alex")).text).toContain("do-not-call");
    wiring.calls.updateSettings({ removeDoNotCall: NUMBER, enabled: false });
    expect((await placeAs("alex")).text).toContain("Phone calls are off");
    expect(voice.toolCalls).toHaveLength(0);
  });

  it("organization rules: Refuser and Demander d'abord on place_phone_call decide a conversation call", () => {
    const rule = (behavior: CustomRule["behavior"]): CustomRule => ({
      id: `r-${behavior}`, ownerId: "pr_alex", botId: null, when: "utiliser l'outil agents__place_phone_call",
      behavior, riskScope: [], enabled: true, org: true, createdAt: 1, updatedAt: 1,
    });
    const call = { tool: "agents__place_phone_call", input: JSON.stringify(ARGS) };
    expect(reviewCustomRules([rule("deny")], call, "bot-rocket", "/Users/example").decision.kind).toBe("deny");
    expect(reviewCustomRules([rule("ask")], call, "bot-rocket", "/Users/example").decision.kind).toBe("ask");
  });

  it("an older Perspicax that does not know conversation calls gets a clear refusal and no card", async () => {
    voice.call = async () => ({ ok: false as const, code: "rpc_error", error: "Invalid params: unexpected field mode" });
    const answer = await placeAs("alex");
    expect(answer.isError).toBe(true);
    expect(answer.text).toContain("needs a newer Perspicax");
    expect(threads.get(THREAD.alex) ?? []).toHaveLength(0);
  });
});
