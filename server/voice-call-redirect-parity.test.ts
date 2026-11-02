// 2026-10-28: every phone call goes through place_phone_call. A bot's own
// Perspicax `voice_call`, by every entry point that reaches the Perspicax
// relay (its own name, a server-prefixed or folded name, an MCP directory's
// call_tool, a gateway's use_tool), becomes the place_phone_call with its
// arguments: the same card, the same AI disclosure, the same organization
// pilot and do-not-call list, the same one approval. And `voice_sms` is a
// text like a Twilio Messages create: the same card and allowed recipients.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { sendRecipientsAllowed } from "../shared/allowed-recipients.ts";
import { readUseToolCall } from "../shared/mcp-gateway-call.ts";
import { isMessageSendTool, isOutboundTool } from "../shared/outbound.ts";
import { placeArgsFromVoiceCall } from "../shared/outbound-call.ts";
import type { OutboundCard } from "../shared/wire.ts";
import { directoryCallTarget } from "./mcp-directory.ts";
import { destructiveKindOf, ownerDecision } from "./owner-approval.ts";
import { outboundWiring } from "./outbound-wiring.ts";
import type { ExchangeResult } from "./perspicax-link.ts";
import { PerspicaxMcp, VOICE_CALL_REDIRECTED, VOICE_CALL_UNAVAILABLE, type PerspicaxMcpLink } from "./perspicax-mcp.ts";
import type { Message } from "./store.ts";
import { telephonyRefusal, voiceToolCall } from "./telephony-guard.ts";

const ISS = "https://px.example.test";
const PERSON = "pr_alex";
const NUMBER = "+15145550142";
const THREAD = "t-call";
const CONVERSATION = { to: "+1 514 555 0142", purpose: "Savoir s'il entend bien la ligne", mode: "conversation", instructions: "Rester bref.", max_minutes: 3, language: "fr" };
const MESSAGE = { to: "+1 514 555 0142", purpose: "Rappel de rendez-vous", message: "Le rendez-vous de mardi est confirmé." };

/** Every way a bot's frame can name voice_call on the relay. */
const ENTRIES: Record<string, (args: Record<string, unknown>) => { name: string; arguments: unknown }> = {
  "direct": (args) => ({ name: "voice_call", arguments: args }),
  "server prefix": (args) => ({ name: "perspicax_gox__voice_call", arguments: args }),
  "other separators": (args) => ({ name: "voice-call", arguments: args }),
  "call_tool": (args) => ({ name: "call_tool", arguments: { name: "voice_call", arguments: args } }),
  "call_tool, prefixed target": (args) => ({ name: "call_tool", arguments: { name: "mcp__perspicax_gox__voice_call", arguments: args } }),
  "use_tool": (args) => ({ name: "use_tool", arguments: { tool_name: "perspicax_gox__voice_call", tool_input: args } }),
  "use_tool, arguments as text": (args) => ({ name: "use_tool", arguments: { tool_name: "voice_call", tool_input: JSON.stringify(args) } }),
};

// ── a relay with a fake Perspicax (records what leaves) ──

function relayHarness(placeCall?: ConstructorParameters<typeof PerspicaxMcp>[0]["placeCall"]) {
  const sent: string[] = [];
  const link: PerspicaxMcpLink = {
    exchangeToken: async (_subject, profileId): Promise<ExchangeResult> => ({ ok: true, token: `pxlo1.A.mcp-${profileId}`, expiresAt: Date.now() + 900_000 }),
    revokeExchanged: async () => true,
    mcpEndpoint: () => "http://perspicax:8787/mcp",
    profileCatalog: () => [{ id: "P1", slug: "gox", name: "GOX", description: "" }],
  };
  const fetcher = (async (_input: string | URL | Request, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (String(init?.method) === "DELETE") return new Response(null, { status: 204 });
    if (body?.id === undefined) return new Response(null, { status: 202 });
    if (body.method === "tools/call") sent.push(String(body.params?.name));
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: "sent by Perspicax" }] } }), { status: 200, headers: { "content-type": "application/json", "mcp-session-id": "s1" } });
  }) as typeof fetch;
  const mcp = new PerspicaxMcp({
    issuer: ISS,
    link: () => link,
    subjectOf: () => ({ iss: ISS, sub: "A", disabled: false }),
    subjectToken: async () => ({ ok: true, token: "pxlo1.A.signin", expiresAt: Date.now() + 3_600_000 }),
    botProfiles: () => ["P1"],
    version: "0.1.0",
    ...(placeCall ? { placeCall } : {}),
    fetch: fetcher,
  });
  return { mcp, sent };
}

const turn = { threadId: THREAD, generation: "g1" };
let frameId = 0;
async function relayCall(mcp: PerspicaxMcp, call: { name: string; arguments: unknown }) {
  frameId += 1;
  const answer = await mcp.relay({ ...turn, botId: "bot-rocket", profileId: "P1", frame: { jsonrpc: "2.0", id: frameId, method: "tools/call", params: call } });
  const result = (answer.body as { result?: { content?: Array<{ text?: string }>; isError?: boolean } }).result;
  return { text: result?.content?.[0]?.text ?? "", isError: result?.isError === true };
}

// ── the place_phone_call side: the real wiring, a fake Perspicax Voice ──

let dir: string;
let threads: Map<string, Message[]>;
let voiceCalls: Array<Record<string, unknown>>;
let wiring: ReturnType<typeof outboundWiring>;
let counter = 0;

function makeWiring() {
  const made = outboundWiring({
    dataDir: dir,
    // a fixed clock: the card's liveStartedAt (5e792c845) is compared between runs
    now: () => Date.UTC(2026, 9, 28, 15, 0, 0),
    store: {
      messagesFor: (threadId) => threads.get(threadId) ?? [],
      appendMessage: (threadId, message) => {
        counter += 1;
        const row = { ...message, id: `m-${counter}`, at: counter } as Message;
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
    twilio: async () => ({ ok: false, code: "rpc_error", error: "not used" }),
    voice: async (_turn, args) => {
      voiceCalls.push(args);
      return args.dry_run === true
        ? { ok: true, isError: false, value: { dry_run: true } }
        : { ok: true, isError: false, value: { placed: true, sid: `CA${String(voiceCalls.length).padStart(32, "0")}` } };
    },
    principalName: () => "Alex Example",
    principalSub: () => "A",
    wake: () => {},
  });
  // the one-time acceptable-use consent (5e792c845) is its own gate, tested in
  // outbound-wiring.test.ts; this person accepted it already
  made.consentStore.accept(PERSON, "bot-rocket");
  return made;
}

/** place_phone_call exactly as the agents catalog's route calls it. */
const placeCall = (_turn: { threadId: string; generation: string; botId: string }, args: Record<string, unknown>) =>
  wiring.placeCall({ principalId: PERSON, botId: "bot-rocket", threadId: THREAD, generation: "g1", room: false }, args);

const card = (): OutboundCard | undefined => [...(threads.get(THREAD) ?? [])].reverse().find((row) => row.outbound?.kind === "call")?.outbound;
const approve = () => {
  const row = wiring.calls.pending(PERSON)[0]!;
  wiring.calls.answer(PERSON, row.id, "call", "card", NUMBER, true);
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "voice-call-redirect-"));
  threads = new Map();
  voiceCalls = [];
  wiring = makeWiring();
  wiring.calls.updateSettings({ enabled: true, callbackNumber: "+14385550199" });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** The card and the Perspicax calls a direct place_phone_call makes. */
async function directly(args: Record<string, unknown>) {
  const first = await placeCall({ ...turn, botId: "bot-rocket" }, args);
  const shown = card();
  approve();
  const second = await placeCall({ ...turn, botId: "bot-rocket" }, args);
  return { first, second, card: shown, placed: card(), voice: [...voiceCalls] };
}

describe("voice_call becomes place_phone_call by every entry point", () => {
  it.each(Object.keys(ENTRIES))("%s: what the frame runs is read the same", (entry) => {
    const call = ENTRIES[entry]!(CONVERSATION);
    expect(voiceToolCall(call.name, call.arguments)).toEqual({ tool: "voice_call", args: CONVERSATION });
  });

  it("upstream of the relay, a gate's call_tool and Grok's use_tool name voice_call too", () => {
    // the gate turns call_tool into the tool's own frame before it relays it
    expect(directoryCallTarget("call_tool", { name: "voice_call", arguments: CONVERSATION })).toBe("voice_call");
    // Grok's use_tool reads as the MCP tool it runs (the permission card's tool)
    const grok = readUseToolCall({ variant: "UseTool", tool_name: "perspicax_gox__voice_call", tool_input: CONVERSATION })!;
    expect(voiceToolCall(grok.id, grok.args)).toEqual({ tool: "voice_call", args: CONVERSATION });
  });

  it("the arguments map to place_phone_call: a conversation, or a one-way message from the person's line", () => {
    expect(placeArgsFromVoiceCall(CONVERSATION)).toEqual({ to: CONVERSATION.to, mode: "conversation", objective: CONVERSATION.purpose, instructions: "Rester bref.", max_minutes: 3, language: "fr" });
    expect(placeArgsFromVoiceCall({ ...MESSAGE, confirm: true, bot: "sagax:bot-rocket" })).toEqual(MESSAGE);
  });

  describe.each([["conversation", CONVERSATION], ["one-way message", MESSAGE]] as const)("%s", (_kind, args) => {
    it.each(Object.keys(ENTRIES))("%s: the same card, the same one approval, the same call as a direct place_phone_call", async (entry) => {
      const direct = await directly(placeArgsFromVoiceCall(args));
      // a fresh store: the redirected call starts from nothing, like the direct one
      rmSync(dir, { recursive: true, force: true });
      dir = mkdtempSync(join(tmpdir(), "voice-call-redirect-"));
      threads = new Map();
      voiceCalls = [];
      wiring = makeWiring();
      wiring.calls.updateSettings({ enabled: true, callbackNumber: "+14385550199" });

      const { mcp, sent } = relayHarness(placeCall);
      await mcp.prepareTurn({ ...turn, bot: { id: "bot-rocket", perspicax: { profiles: ["P1"] } }, speakerPrincipalId: PERSON, speakerOrigin: "person" });
      const first = await relayCall(mcp, ENTRIES[entry]!(args));
      expect(first.text.startsWith(VOICE_CALL_REDIRECTED)).toBe(true);
      expect(first.text).toContain(direct.first.text);
      expect(first.isError).toBe(false);
      // nothing left for Perspicax: the bot's frame never reached voice_call
      expect(sent).toEqual([]);
      const { id: _a, ...shown } = card()!;
      const { id: _b, ...expected } = direct.card!;
      expect(shown).toEqual(expected);
      expect(shown.status).toBe("pending");
      // the bot asks again before the answer: still one card, nothing placed
      await relayCall(mcp, ENTRIES[entry]!(args));
      expect(wiring.calls.pending(PERSON)).toHaveLength(1);
      expect(voiceCalls.every((call) => call.dry_run === true)).toBe(true);
      approve();
      const second = await relayCall(mcp, ENTRIES[entry]!(args));
      expect(second.text).toContain(direct.second.text);
      const { id: _c, ...placed } = card()!;
      const { id: _d, ...directPlaced } = direct.placed!;
      expect(placed).toEqual(directPlaced);
      // the real call goes out once, through the harness's own voice_call (judged), as directly
      const real = (calls: Array<Record<string, unknown>>) => calls.filter((call) => call.dry_run !== true).map(({ ref: _ref, ...rest }) => rest);
      expect(real(voiceCalls)).toEqual(real(direct.voice));
      expect(real(voiceCalls)).toHaveLength(1);
    });
  });

  it("the organization's pilot and do-not-call list hold a redirected call", async () => {
    const { mcp, sent } = relayHarness(placeCall);
    await mcp.prepareTurn({ ...turn, bot: { id: "bot-rocket", perspicax: { profiles: ["P1"] } }, speakerPrincipalId: PERSON, speakerOrigin: "person" });
    wiring.calls.updateSettings({ addDoNotCall: NUMBER });
    for (const entry of Object.keys(ENTRIES)) {
      const answer = await relayCall(mcp, ENTRIES[entry]!(CONVERSATION));
      expect(answer, entry).toMatchObject({ isError: true });
      expect(answer.text).toContain("do-not-call");
    }
    wiring.calls.updateSettings({ removeDoNotCall: NUMBER, enabled: false });
    expect((await relayCall(mcp, ENTRIES.call_tool!(MESSAGE))).text).toContain("Phone calls are off");
    expect(sent).toEqual([]);
    expect(voiceCalls).toEqual([]);
    expect(card()).toBeUndefined();
  });

  it("a dry run sends nothing and still goes to Perspicax; another tool is untouched; a harness call is not redirected", async () => {
    const { mcp, sent } = relayHarness(placeCall);
    await mcp.prepareTurn({ ...turn, bot: { id: "bot-rocket", perspicax: { profiles: ["P1"] } }, speakerPrincipalId: PERSON, speakerOrigin: "person" });
    expect((await relayCall(mcp, { name: "voice_call", arguments: { ...CONVERSATION, dry_run: true } })).text).toBe("sent by Perspicax");
    expect((await relayCall(mcp, { name: "voice_line", arguments: {} })).text).toBe("sent by Perspicax");
    const harness = await mcp.relay({ ...turn, botId: "bot-rocket", profileId: "P1", frame: { jsonrpc: "2.0", id: 999, method: "tools/call", params: { name: "voice_call", arguments: CONVERSATION } }, judged: true });
    expect(JSON.stringify(harness.body)).toContain("sent by Perspicax");
    expect(sent).toEqual(["voice_call", "voice_line", "voice_call"]);
    expect(card()).toBeUndefined();
  });

  it("without place_phone_call on the server, a bot's voice_call is refused, never sent", async () => {
    const { mcp, sent } = relayHarness();
    await mcp.prepareTurn({ ...turn, bot: { id: "bot-rocket", perspicax: { profiles: ["P1"] } }, speakerPrincipalId: PERSON, speakerOrigin: "person" });
    for (const entry of Object.keys(ENTRIES)) expect(await relayCall(mcp, ENTRIES[entry]!(CONVERSATION)), entry).toEqual({ text: VOICE_CALL_UNAVAILABLE, isError: true });
    expect(sent).toEqual([]);
  });

  it("a Flow action that names voice_call or voice_sms is refused like a Twilio one", () => {
    expect(telephonyRefusal("flow_action", { action: "voice_call", to: NUMBER })).not.toBeNull();
    expect(telephonyRefusal("flow_action", { steps: [{ tool: "voice_sms" }] })).not.toBeNull();
    expect(telephonyRefusal("flow_action", { action: "voice_call", _dry_run: true })).toBeNull();
  });
});

describe("voice_sms is a text like a Twilio Messages create", () => {
  const twilio = { tool: "mcp__perspicax_gox__twilio_api_write", input: JSON.stringify({ resource: "Messages", action: "create", set: { To: NUMBER, Body: "Bonjour" } }) };
  const names = ["mcp__perspicax_gox__voice_sms", "perspicax_gox__voice_sms", "voice_sms"];

  it.each(names)("%s: an outbound text, with its recipient read", (tool) => {
    expect(isOutboundTool(tool)).toBe(true);
    expect(isMessageSendTool(tool)).toBe(true);
    expect(destructiveKindOf({ tool, input: JSON.stringify({ to: NUMBER, body: "Bonjour" }) })).toBe(destructiveKindOf(twilio));
  });

  it.each(["approval", "auto", "bypass"] as const)("%s: the same card as a Twilio text", (mode) => {
    const call = (tool: string, input: string) => ({ ownerId: PERSON, botId: "bot-rocket", tool, input });
    const viaTwilio = ownerDecision({ mode, rules: [], call: call(twilio.tool, twilio.input) });
    const viaVoice = ownerDecision({ mode, rules: [], call: call("mcp__perspicax_gox__voice_sms", JSON.stringify({ to: NUMBER, body: "Bonjour" })) });
    expect(viaVoice).toEqual(viaTwilio);
    expect(viaVoice).toMatchObject({ kind: "card" });
  });

  it("allowed recipients: a listed number goes without a card, any other keeps it", () => {
    const list = [`phone:${NUMBER}`];
    expect(sendRecipientsAllowed(list, "mcp__perspicax_gox__voice_sms", { to: NUMBER, body: "Bonjour" })).toBe(true);
    expect(sendRecipientsAllowed(list, "mcp__perspicax_gox__voice_sms", { to: "+15145550143", body: "Bonjour" })).toBe(false);
    expect(sendRecipientsAllowed([], "mcp__perspicax_gox__voice_sms", { to: NUMBER, body: "Bonjour" })).toBe(false);
  });

  it("is not a call: it is never redirected to place_phone_call", () => {
    expect(voiceToolCall("call_tool", { name: "voice_sms", arguments: { to: NUMBER } })).toEqual({ tool: "voice_sms", args: { to: NUMBER } });
  });
});
