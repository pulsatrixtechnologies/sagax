// A bot's own phone line end to end (#3603), with the gateway's contract
// (`perspicax-voice/1`, answer marked `x-sagax-telephony-api: 1`) and a mock
// gateway that serves its voice tools with the descriptions it has today
// (server/fixtures/perspicax-voice-tools.json, which name the vendor):
//   - a text from the line's owner becomes a turn of their chat with the
//     bot the line targets, stamped as a text, and the answer goes out by
//     voice_sms;
//   - a text from another sender starts the routine whose trigger is the
//     bot's phone, and the bot answers it with its own voice_sms;
//   - a call request from the owner reaches the bot the same way.
// No network beyond 127.0.0.1: the gateway is a fake fetch.
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { ConsoleAssertion } from "./auth/oidc-rp.ts";
import { TELEPHONY_PATH, createBotInboundTelephonyRoute, type TelephonyRouteDeps } from "./bots/bot-inbound-telephony.ts";
import voiceFixture from "./fixtures/perspicax-voice-tools.json" with { type: "json" };
import { PerspicaxMcp, type PerspicaxMcpLink } from "./perspicax/perspicax-mcp.ts";
import { WarmResourceBudget } from "./resources/warm-resources.ts";
import { SmsConversation, type OwnLineVia } from "./sms-conversation.ts";

const ORIGIN = "https://sagax.example";
const ISS = "https://px.example.test";
const OWNER = "pr_owner";
const BOT = "bot_line";
const OWNER_MOBILE = "+15145550101";
const STRANGER = "+15145550102";

/** What reached the mock gateway as tools/call: [tool, arguments]. */
let gatewayCalls: Array<[string, Record<string, unknown>]> = [];

function gateway(): PerspicaxMcp {
  const link: PerspicaxMcpLink = {
    exchangeToken: async () => ({ ok: true, token: "pxlo1.U.mcp", expiresAt: Date.now() + 900_000 }),
    revokeExchanged: async () => true,
    mcpEndpoint: () => "http://gateway.test/mcp",
  };
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json", "mcp-session-id": "s1" } });
  const fetcher = (async (_input: string | URL | Request, init?: RequestInit) => {
    if (String(init?.method) === "DELETE") return new Response(null, { status: 204 });
    const body = init?.body ? JSON.parse(String(init.body)) as { id?: unknown; method?: string; params?: { name: string; arguments: Record<string, unknown> } } : {};
    if (body.id === undefined) return new Response(null, { status: 202 });
    if (body.method === "tools/list") return json({ jsonrpc: "2.0", id: body.id, result: { tools: voiceFixture.tools } });
    if (body.method === "tools/call") {
      gatewayCalls.push([body.params!.name, body.params!.arguments]);
      return json({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: "{\"status\":\"sent\"}" }] } });
    }
    return json({ jsonrpc: "2.0", id: body.id, result: {} });
  }) as typeof fetch;
  return new PerspicaxMcp({
    warmBudget: new WarmResourceBudget({ intervalMs: 0 }),
    issuer: ISS,
    link: () => link,
    subjectOf: () => ({ iss: ISS, sub: "U", disabled: false }),
    subjectToken: async () => ({ ok: true, token: "pxlo1.U.signin", expiresAt: Date.now() + 3_600_000 }),
    routineSubjectToken: async () => ({ ok: true, token: "pxlo1.U.delegation", expiresAt: Date.now() + 3_600_000 }),
    botExists: (id) => id === BOT,
    keepaliveJitterMs: 0,
    after: () => ({ cancel: () => {} }),
    version: "0.0.0",
    fetch: fetcher,
    log: () => {},
    sleep: async () => {},
  });
}

let mcp: PerspicaxMcp;
let turns: Array<{ person: string; botId: string; text: string; via: OwnLineVia }> = [];
let routines: Array<{ triggerId: string; event: Record<string, unknown> }> = [];
let replies = new Map<string, string>();
let conversation: SmsConversation;
let n = 0;

/** The harness's own text back (reachMeVoice): voice_sms with the person's access. */
async function textBack(input: { person: string; botId: string; to: string; body: string }): Promise<boolean> {
  const threadId = `reach-me-${++n}`;
  await mcp.prepareTurn({ threadId, generation: "1", bot: { id: input.botId }, speakerPrincipalId: input.person, speakerOrigin: "owner-routine", routine: true, ownerPrincipalId: input.person });
  try {
    const answer = await mcp.callTool({ threadId, generation: "1", botId: input.botId, name: "voice_sms", args: { to: input.to, body: input.body } });
    return answer.ok && !answer.isError;
  } finally {
    await mcp.endGeneration(threadId, "1");
  }
}

const assertions = new Map<string, ConsoleAssertion>();
/** The gateway's assertion for the line owner, bound to this exact body. */
function token(sub: string, body: string): string {
  const id = `tok${assertions.size + 1}`;
  const bodySha256 = createHash("sha256").update(body).digest("hex");
  assertions.set(id, { iss: ISS, sub, jti: `jti-line-${String(assertions.size).padStart(10, "0")}`, iat: 0, exp: Math.floor(Date.now() / 1000) + 60, serverId: "srv", role: "employee", teams: [], actor: "perspicax-voice", bodySha256 });
  return id;
}

const deps: TelephonyRouteDeps = {
  identity: () => "perspicax",
  publicOrigin: () => ORIGIN,
  linkServerId: () => "srv",
  verify: async (bearer) => {
    const found = assertions.get(bearer);
    if (!found) throw new Error("The assertion does not verify.");
    return found;
  },
  bot: (id) => (id === BOT ? { id, name: "Helper" } : null),
  owner: (id) => (id === BOT ? { principalId: OWNER, sub: "u_owner", active: true } : null),
  triggers: (botId) => (botId === BOT ? ["phone_trigger"] : []),
  ingest: (triggerId, event) => {
    routines.push({ triggerId, event: event as unknown as Record<string, unknown> });
    return { runId: `run-${routines.length}`, deliveryId: `d-${routines.length}`, duplicate: false };
  },
  ownText: (input) => conversation.start({ person: input.ownerPrincipalId, sub: input.sub, botId: input.botId, from: input.from, text: input.text, label: input.label, via: input.via }),
  allowlistedContact: () => null,
  noticeUnknown: () => false,
  ownerNotice: () => {},
  unhandled: () => {},
  record: () => {},
};

let server: Server;
let base = "";
beforeAll(async () => {
  const handle = createBotInboundTelephonyRoute(deps);
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

beforeEach(() => {
  gatewayCalls = [];
  turns = [];
  routines = [];
  replies = new Map();
  mcp = gateway();
  conversation = new SmsConversation({
    send: async (input) => {
      turns.push({ person: input.person, botId: input.botId, text: input.text, via: input.via });
      const messageId = `m${turns.length}`;
      replies.set(messageId, "On arrive jeudi.");
      return { ok: true, threadId: `chat-${input.botId}`, messageId };
    },
    state: () => "idle",
    replyAfter: (_thread, messageId) => replies.get(messageId) ?? "",
    textBack,
    botName: () => "Helper",
    language: () => "fr",
    sleep: async () => {},
    log: () => {},
  });
});

let events = 0;
function inbound(extra: Record<string, unknown>) {
  events += 1;
  const event = String(extra.event ?? "sms");
  return {
    contract: "perspicax-voice/1",
    event,
    eventId: `${event}:SM${String(events).padStart(32, "0")}`,
    receivedAt: "2026-11-11T14:05:09Z",
    line: { id: "line_1", number: "+15145550199" },
    from: OWNER_MOBILE,
    authenticated: true,
    sender: "owner_mobile",
    person: { id: "u_owner", name: "Alex Example" },
    content: { trust: "caller", text: "Quand arrive la livraison ?" },
    botId: BOT,
    directives: { thirdPartyCall: "card", clientPhoneSource: "provided" },
    ...extra,
  };
}

async function post(body: Record<string, unknown>) {
  const text = JSON.stringify(body);
  const res = await fetch(`${base}${TELEPHONY_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token("u_owner", text)}` },
    body: text,
  });
  return { status: res.status, header: res.headers.get("x-sagax-telephony-api"), body: await res.json() as Record<string, unknown> };
}

describe("a bot's own phone line, end to end (#3603)", () => {
  it("a text from the owner is a turn of their chat with the line's bot, stamped as a text, answered by voice_sms", async () => {
    const got = await post(inbound({}));
    expect(got).toMatchObject({ status: 202, header: "1", body: { event: "sms", conversation: true, triggers: 0 } });
    await conversation.drain();
    expect(turns).toEqual([{ person: OWNER, botId: BOT, text: "Quand arrive la livraison ?", via: "sms" }]);
    expect(routines).toEqual([]);
    expect(gatewayCalls).toEqual([["voice_sms", { to: OWNER_MOBILE, body: "On arrive jeudi." }]]);
  });

  it("a call request from the owner reaches the bot the same way", async () => {
    const got = await post(inbound({ event: "call_request", eventId: `call_request:CA${"a".repeat(32)}`, sender: undefined, content: { trust: "caller", text: "Statut du dossier ?" } }));
    expect(got).toMatchObject({ status: 202, header: "1", body: { event: "call_request", conversation: true } });
    await conversation.drain();
    expect(turns).toEqual([{ person: OWNER, botId: BOT, text: "Statut du dossier ?", via: "call" }]);
    expect(gatewayCalls.map(([tool]) => tool)).toEqual(["voice_sms"]);
  });

  it("a text from another sender starts the phone routine, and the bot answers it with its own voice_sms", async () => {
    const got = await post(inbound({ from: STRANGER, authenticated: false, sender: "allowlisted", person: undefined }));
    expect(got).toMatchObject({ status: 202, header: "1", body: { event: "sms", triggers: 1 } });
    expect(turns).toEqual([]);
    expect(routines).toHaveLength(1);
    expect(routines[0]!.triggerId).toBe("phone_trigger");
    // the routine's turn: the bot's own frames, through the telephony guard
    const thread = "routine-1";
    await mcp.prepareTurn({ threadId: thread, generation: "1", bot: { id: BOT }, speakerPrincipalId: OWNER, speakerOrigin: "owner-routine", routine: true, ownerPrincipalId: OWNER });
    await mcp.relay({ threadId: thread, generation: "1", botId: BOT, frame: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
    const sent = await mcp.relay({
      threadId: thread, generation: "1", botId: BOT,
      frame: { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "voice_sms", arguments: { to: STRANGER, body: "Bien reçu." } } },
    });
    expect(sent.body).toMatchObject({ id: 2, result: { content: [{ text: "{\"status\":\"sent\"}" }] } });
    expect(JSON.stringify(sent.body)).not.toContain("Refused by Sagax");
    expect(gatewayCalls).toEqual([["voice_sms", { to: STRANGER, body: "Bien reçu." }]]);
    await mcp.endGeneration(thread, "1");
  });
});
