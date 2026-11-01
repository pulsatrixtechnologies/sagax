// Slice 5: Perspicax MCP for the person who speaks (server/perspicax-mcp.ts).
import { describe, expect, it } from "vitest";

import type { McpAuditRecord } from "./mcp-permissions.ts";
import type { SubjectTokenOutcome } from "./idp-session.ts";
import type { ExchangeResult } from "./perspicax-link.ts";
import { PERSPICAX_ACCESS_ENDED, PERSPICAX_SESSION_RESET, PERSPICAX_UNAVAILABLE_WHY, PerspicaxMcp, parseMcpBody, perspicaxReplayable, reviewedReadsOf, perspicaxSessionLost, perspicaxUnavailableRow, perspicaxUnavailableWhy, type PerspicaxMcpLink, type PerspicaxMcpOptions } from "./perspicax-mcp.ts";

const ISS = "https://px.example.test";
const ALICE = "pr_alice";
const BOB = "pr_bob";
const CAROL = "pr_carol";
const CATALOG = [
  { id: "P1", slug: "dispatch", name: "Dispatch", description: "" },
  { id: "P2", slug: "billing", name: "Billing", description: "" },
];

function harness(options: { held?: Record<string, string[]>; mcp?: (request: { headers: Record<string, string>; body: any; method: string }) => Response | Promise<Response>; onCall?: Set<string>; guard?: PerspicaxMcpOptions["permissionGuard"]; remoteSupport?: PerspicaxMcpOptions["onRemoteSupport"]; askGo?: PerspicaxMcpOptions["askGo"] } = {}) {
  let clock = 1_000_000;
  const held = options.held ?? { A: ["P1", "P2"], B: ["P1"], C: [] };
  const subjects: Record<string, { iss: string; sub: string; disabled: boolean }> = {
    [ALICE]: { iss: ISS, sub: "A", disabled: false },
    [BOB]: { iss: ISS, sub: "B", disabled: false },
    [CAROL]: { iss: ISS, sub: "C", disabled: false },
  };
  const botProfiles: Record<string, string[]> = { x: ["P1"] };
  const exchanges: Array<{ subject: string; profile: string }> = [];
  const revoked: string[] = [];
  const logs: string[] = [];
  const mcpCalls: Array<{ method: string; headers: Record<string, string>; body: any }> = [];
  const subjectCalls: string[] = [];
  let signInFails: SubjectTokenOutcome | null = null;
  let exchangeFails: ExchangeResult | null = null;
  let exchangeFailsOnce: ExchangeResult | null = null;
  /** Slice 6: who holds a routine delegation (issued from a recent sign-in). */
  const delegations = new Set<string>();
  const delegationCalls: string[] = [];
  const refusedDelegations: string[] = [];
  let n = 0;
  const link: PerspicaxMcpLink = {
    exchangeToken: async (subjectToken, profileId): Promise<ExchangeResult> => {
      exchanges.push({ subject: subjectToken, profile: profileId });
      if (exchangeFails) return exchangeFails;
      if (exchangeFailsOnce) {
        const once = exchangeFailsOnce;
        exchangeFailsOnce = null;
        return once;
      }
      const sub = subjectToken.split(".")[1]!;
      if (subjects[`pr_${{ A: "alice", B: "bob", C: "carol" }[sub]}`]?.disabled) return { ok: false, error: "subject" };
      if (!(held[sub] ?? []).includes(profileId)) return { ok: false, error: "not_held" };
      return { ok: true, token: `pxlo1.${sub}.mcp-${profileId}-${++n}`, expiresAt: clock + 900_000 };
    },
    revokeExchanged: async (token) => { revoked.push(token); return true; },
    mcpEndpoint: () => "http://perspicax:8787/mcp",
    profileCatalog: () => CATALOG,
  };
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const headers = { ...(init?.headers as Record<string, string>) };
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const method = String(init?.method);
    mcpCalls.push({ method, headers, body });
    expect(String(input)).toBe("http://perspicax:8787/mcp");
    if (options.mcp) return options.mcp({ headers, body, method });
    if (method === "DELETE") return new Response(null, { status: 204 });
    if (body.id === undefined) return new Response(null, { status: 202 });
    return new Response(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { tools: [], seenAs: headers.authorization.split(".")[1] } })}\n\n`, {
      status: 200,
      headers: { "content-type": "text/event-stream", "mcp-session-id": "sess-1" },
    });
  }) as typeof fetch;
  const mcp = new PerspicaxMcp({
    issuer: ISS,
    link: () => link,
    subjectOf: (id) => subjects[id] ?? null,
    subjectToken: async (subject) => {
      subjectCalls.push(subject.sub);
      if (signInFails) return signInFails;
      return { ok: true, token: `pxlo1.${subject.sub}.signin`, expiresAt: clock + 3_600_000 };
    },
    routineSubjectToken: async (principalId) => {
      delegationCalls.push(principalId);
      if (!delegations.has(principalId)) return { ok: false, error: "no_session" };
      const sub = subjects[principalId]!.sub;
      return { ok: true, token: `pxlo1.${sub}.delegation`, expiresAt: clock + 3_600_000 };
    },
    delegationRefused: (principalId) => refusedDelegations.push(principalId),
    botProfiles: (id) => botProfiles[id],
    ...(options.onCall ? { keepWarm: (threadId: string) => options.onCall!.has(threadId) } : {}),
    version: "0.1.89",
    ...(options.guard ? { permissionGuard: options.guard } : {}),
    ...(options.remoteSupport ? { onRemoteSupport: options.remoteSupport } : {}),
    ...(options.askGo ? { askGo: options.askGo } : {}),
    fetch: fetcher,
    now: () => clock,
    log: (line) => logs.push(line),
  });
  return {
    mcp, subjects, botProfiles, exchanges, revoked, logs, mcpCalls, subjectCalls, delegations, delegationCalls, refusedDelegations,
    advance: (ms: number) => { clock += ms; },
    failSignIn: (outcome: SubjectTokenOutcome | null) => { signInFails = outcome; },
    failExchange: (outcome: ExchangeResult | null) => { exchangeFails = outcome; },
    failExchangeOnce: (outcome: ExchangeResult) => { exchangeFailsOnce = outcome; },
  };
}

const bot = { id: "x", perspicax: { profiles: ["P1"] } };
const turn = { threadId: "t1", generation: "g1" };

/** The approval form of the Flow guard's GO (Perspicax approval_schema). */
const GO_SCHEMA = { type: "object", properties: { decision: { type: "string", oneOf: [{ const: "allow", title: "Allow once" }, { const: "deny", title: "Deny" }] } }, required: ["decision"] };

/** A fake Perspicax whose tools/call asks for a GO on its stream
 * (`elicitation/create`) and answers once the client's response is posted. */
function goServer(schema: unknown = GO_SCHEMA) {
  const answers: any[] = [];
  let answered: (value: any) => void = () => {};
  const mcp = ({ body }: { body: any }): Response => {
    if (body.id === undefined) return new Response(null, { status: 202 });
    if (body.method === "initialize") {
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-06-18", capabilities: {} } }), { status: 200, headers: { "content-type": "application/json", "mcp-session-id": "sess-1" } });
    }
    if (body.method === undefined) {
      // the client's answer to the elicitation
      answers.push(body);
      answered(body);
      return new Response(null, { status: 202 });
    }
    const enc = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(enc.encode(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: 0, method: "elicitation/create", params: { mode: "form", message: "Flow: update ticket 42 (dry run done). GO?", requestedSchema: schema } })}\n\n`));
        void new Promise<any>((resolve) => { answered = resolve; }).then((answer) => {
          const go = answer.result?.content?.decision === "allow";
          controller.enqueue(enc.encode(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: go ? "written" : "refused: flow_guard_declined" }], isError: !go } })}\n\n`));
          controller.close();
        });
      },
    });
    return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream", "mcp-session-id": "sess-1" } });
  };
  return { mcp, answers };
}

describe("PerspicaxMcp: the Flow guard's GO (elicitation)", () => {
  it("declares elicitation, shows the GO as a card and sends the person's answer", async () => {
    const server = goServer();
    const asked: Array<{ threadId: string; botId: string; profileId: string; message: string }> = [];
    const h = harness({ mcp: server.mcp, askGo: async (input) => { asked.push(input); return "allow"; } });
    await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
    await h.mcp.relay({ ...turn, botId: "x", profileId: "P1", frame: { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: { roots: {} }, clientInfo: { name: "engine", version: "1" } } } });
    expect(h.mcpCalls[0]!.body.params.capabilities).toEqual({ roots: {}, elicitation: { form: {} } });
    const answer = await h.mcp.relay({ ...turn, botId: "x", profileId: "P1", frame: { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "cw_psa__update_ticket", arguments: {} } } });
    expect(asked).toEqual([{ threadId: "t1", botId: "x", profileId: "P1", message: "Flow: update ticket 42 (dry run done). GO?" }]);
    expect(server.answers).toEqual([{ jsonrpc: "2.0", id: 0, result: { action: "accept", content: { decision: "allow" } } }]);
    expect(answer).toEqual({ status: 200, body: { jsonrpc: "2.0", id: 2, result: { content: [{ type: "text", text: "written" }], isError: false } } });
    // the answer went on the same session, with the person's token
    const posted = h.mcpCalls.find((c) => c.body?.id === 0 && c.body?.method === undefined)!;
    expect(posted.headers).toMatchObject({ "mcp-session-id": "sess-1", authorization: "Bearer pxlo1.B.mcp-P1-1" });
  });

  it("a denial or no answer is never a GO, and another form is declined unasked", async () => {
    for (const [reply, action] of [["deny", "decline"], ["timeout", "cancel"]] as const) {
      const server = goServer();
      const h = harness({ mcp: server.mcp, askGo: async () => reply });
      await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
      const answer = await h.mcp.relay({ ...turn, botId: "x", profileId: "P1", frame: { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "w", arguments: {} } } });
      expect(server.answers).toEqual([{ jsonrpc: "2.0", id: 0, result: { action } }]);
      expect((answer.body as any).result.isError).toBe(true);
    }
    const other = goServer({ type: "object", properties: { email: { type: "string" } } });
    const asked: unknown[] = [];
    const h = harness({ mcp: other.mcp, askGo: async (input) => { asked.push(input); return "allow"; } });
    await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
    await h.mcp.relay({ ...turn, botId: "x", profileId: "P1", frame: { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "w", arguments: {} } } });
    expect(asked).toEqual([]);
    expect(other.answers).toEqual([{ jsonrpc: "2.0", id: 0, result: { action: "decline" } }]);
  });

  it("declares nothing without askGo", async () => {
    const h = harness();
    await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
    await h.mcp.relay({ ...turn, botId: "x", profileId: "P1", frame: { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "engine", version: "1" } } } });
    expect(h.mcpCalls[0]!.body.params.capabilities).toEqual({});
  });
});

describe("PerspicaxMcp", () => {
  it("exchanges the speaker's own sign-in, never the owner's", async () => {
    const h = harness();
    const plan = await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
    expect(plan).toEqual({ mounted: [{ profileId: "P1", slug: "dispatch", name: "Dispatch" }], unavailable: [] });
    expect(h.subjectCalls).toEqual(["B"]);
    expect(h.exchanges).toEqual([{ subject: "pxlo1.B.signin", profile: "P1" }]);
    const answer = await h.mcp.relay({ ...turn, botId: "x", profileId: "P1", frame: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
    expect(answer).toEqual({ status: 200, body: { jsonrpc: "2.0", id: 1, result: { tools: [], seenAs: "B" } } });
    expect(h.mcpCalls[0]!.headers).toMatchObject({ accept: "application/json, text/event-stream", authorization: "Bearer pxlo1.B.mcp-P1-1" });
  });

  it("a routine without a delegation, an unknown speaker, an unknown profile and solo mode mount nothing", async () => {
    const h = harness();
    expect(await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: ALICE, speakerOrigin: "owner-routine" })).toEqual({
      mounted: [], unavailable: [{ profileId: "P1", name: "Dispatch", reason: "no_delegation" }],
    });
    expect(h.subjectCalls).toEqual([]);
    expect(await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: "", speakerOrigin: "person" })).toMatchObject({ mounted: [], unavailable: [{ reason: "unknown_speaker" }] });
    expect(await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: "pr_nobody", speakerOrigin: "peer" })).toMatchObject({ mounted: [], unavailable: [{ reason: "unknown_speaker" }] });
    expect(await h.mcp.prepareTurn({ ...turn, bot: { id: "x", perspicax: { profiles: ["GONE"] } }, speakerPrincipalId: BOB, speakerOrigin: "person" })).toMatchObject({ mounted: [], unavailable: [{ profileId: "GONE", name: "GONE", reason: "unknown_profile" }] });
    expect(await h.mcp.prepareTurn({ ...turn, bot: { id: "x" }, speakerPrincipalId: BOB, speakerOrigin: "person" })).toEqual({ mounted: [], unavailable: [] });
    expect(h.exchanges).toEqual([]);
    const solo = new PerspicaxMcp({ issuer: ISS, link: () => null, subjectOf: () => null, subjectToken: async () => ({ ok: false, error: "no_session" }), botProfiles: () => ["P1"], version: "1" });
    expect(await solo.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "person" })).toEqual({ mounted: [], unavailable: [] });
  });

  it("a turn in a routine's lineage never uses a sign-in, even for a peer hop that names a live person", async () => {
    const h = harness();
    expect(await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: ALICE, speakerOrigin: "peer", routine: true })).toEqual({
      mounted: [], unavailable: [{ profileId: "P1", name: "Dispatch", reason: "no_delegation" }],
    });
    expect(await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "person", routine: true })).toMatchObject({ mounted: [], unavailable: [{ reason: "no_delegation" }] });
    expect(h.subjectCalls).toEqual([]);
    expect(h.exchanges).toEqual([]);
  });

  it("a routine exchanges its runAs person's delegation (slice 6)", async () => {
    const h = harness();
    h.delegations.add(BOB);
    const plan = await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "owner-routine" });
    expect(plan).toEqual({ mounted: [{ profileId: "P1", slug: "dispatch", name: "Dispatch" }], unavailable: [] });
    expect(h.delegationCalls).toEqual([BOB]);
    expect(h.subjectCalls).toEqual([]);
    expect(h.exchanges).toEqual([{ subject: "pxlo1.B.delegation", profile: "P1" }]);
    // a peer hop in the routine's lineage uses the root person's delegation
    await h.mcp.prepareTurn({ threadId: "t2", generation: "g", bot, speakerPrincipalId: BOB, speakerOrigin: "peer", routine: true });
    expect(h.exchanges.at(-1)).toEqual({ subject: "pxlo1.B.delegation", profile: "P1" });
    expect(h.subjectCalls).toEqual([]);
    // a token near its end renews through the delegation, not a sign-in
    h.advance(900_000 - 30_000);
    const answer = await h.mcp.relay({ ...turn, botId: "x", profileId: "P1", frame: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
    expect(answer).toMatchObject({ status: 200, body: { result: { seenAs: "B" } } });
    expect(h.delegationCalls).toEqual([BOB, BOB, BOB]);
    expect(h.subjectCalls).toEqual([]);
    // the delegation ends: its tokens are revoked and calls end
    const before = h.revoked.length;
    h.mcp.forgetPrincipal(BOB);
    await new Promise((resolve) => setImmediate(resolve));
    expect(h.revoked.length).toBe(before + 2);
    expect(await h.mcp.relay({ ...turn, botId: "x", profileId: "P1", frame: { jsonrpc: "2.0", id: 2, method: "tools/list" } })).toMatchObject({ body: { error: { message: PERSPICAX_ACCESS_ENDED } } });
  });

  it("a refused delegation subject drops the delegation's cache and reads no_delegation", async () => {
    const h = harness();
    h.delegations.add(BOB);
    // the exchange refuses the subject (Perspicax revoked the family)
    const link = (h.mcp as unknown as { options: { link(): PerspicaxMcpLink } }).options.link();
    const exchange = link.exchangeToken;
    link.exchangeToken = async () => ({ ok: false, error: "subject" });
    expect(await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "owner-routine" })).toMatchObject({ mounted: [], unavailable: [{ reason: "no_delegation" }] });
    expect(h.refusedDelegations).toEqual([BOB]);
    link.exchangeToken = exchange;
  });

  it("a refused cached delegation token is renewed once for the same turn", async () => {
    const h = harness();
    h.delegations.add(BOB);
    const link = (h.mcp as unknown as { options: { link(): PerspicaxMcpLink } }).options.link();
    const exchange = link.exchangeToken;
    // the first exchange refuses the cached subject; the renewed one passes
    let refusals = 1;
    link.exchangeToken = async (subjectToken, profileId) => (refusals-- > 0 ? { ok: false, error: "subject" } : exchange(subjectToken, profileId));
    expect(await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "owner-routine" })).toEqual({
      mounted: [{ profileId: "P1", slug: "dispatch", name: "Dispatch" }], unavailable: [],
    });
    expect(h.refusedDelegations).toEqual([BOB]);
    expect(h.delegationCalls).toEqual([BOB, BOB]);
    link.exchangeToken = exchange;
  });

  it("a refused delegation whose renewal ends reads no_delegation without a second exchange", async () => {
    const h = harness();
    h.delegations.add(BOB);
    const link = (h.mcp as unknown as { options: { link(): PerspicaxMcpLink } }).options.link();
    const exchange = link.exchangeToken;
    let exchanged = 0;
    link.exchangeToken = async () => { exchanged++; h.delegations.delete(BOB); return { ok: false, error: "subject" }; };
    expect(await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "owner-routine" })).toMatchObject({ mounted: [], unavailable: [{ reason: "no_delegation" }] });
    expect(exchanged).toBe(1);
    expect(h.delegationCalls).toEqual([BOB, BOB]);
    link.exchangeToken = exchange;
  });

  it("a profile the speaker does not hold is unavailable; no sign-in is no_session", async () => {
    const h = harness();
    expect(await h.mcp.prepareTurn({ ...turn, bot: { id: "x", perspicax: { profiles: ["P1", "P2"] } }, speakerPrincipalId: BOB, speakerOrigin: "person" })).toEqual({
      mounted: [{ profileId: "P1", slug: "dispatch", name: "Dispatch" }],
      unavailable: [{ profileId: "P2", name: "Billing", reason: "not_held" }],
    });
    expect(await h.mcp.prepareTurn({ threadId: "t2", generation: "g", bot, speakerPrincipalId: CAROL, speakerOrigin: "person" })).toMatchObject({ mounted: [], unavailable: [{ reason: "not_held" }] });
    expect(await h.mcp.relay({ threadId: "t2", generation: "g", botId: "x", profileId: "P1", frame: { jsonrpc: "2.0", id: 1, method: "tools/list" } })).toMatchObject({ status: 403, body: { code: "profile_not_mounted" } });
    h.failSignIn({ ok: false, error: "no_session" });
    expect(await h.mcp.prepareTurn({ threadId: "t3", generation: "g", bot, speakerPrincipalId: BOB, speakerOrigin: "person" })).toMatchObject({ unavailable: [{ reason: "no_session" }] });
    h.failSignIn({ ok: false, error: "unreachable" });
    expect(await h.mcp.prepareTurn({ threadId: "t3", generation: "g", bot, speakerPrincipalId: BOB, speakerOrigin: "person" })).toMatchObject({ unavailable: [{ reason: "unreachable" }] });
  });

  it("reports a rate limit as rate_limited, never as could not be reached (fix 2)", async () => {
    const h = harness();
    h.failExchange({ ok: false, error: "rate_limited" });
    const plan = await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
    expect(plan).toEqual({ mounted: [], unavailable: [{ profileId: "P1", name: "Dispatch", reason: "rate_limited" }] });
    h.failExchange(null);
    h.failSignIn({ ok: false, error: "rate_limited", retryAfterMs: 60_000 });
    expect(await h.mcp.prepareTurn({ threadId: "t9", generation: "g", bot, speakerPrincipalId: BOB, speakerOrigin: "person" })).toMatchObject({ unavailable: [{ reason: "rate_limited" }] });
    expect(h.logs.join("\n")).not.toMatch(/could not be reached/);
  });

  it("on a live call, keeps a turn's token for the next turn: no new exchange, tools stay mounted", async () => {
    const onCall = new Set(["t1"]);
    const h = harness({ onCall });
    expect((await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "person" })).mounted).toHaveLength(1);
    await h.mcp.relay({ ...turn, botId: "x", profileId: "P1", frame: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
    await h.mcp.endGeneration("t1", "g1");
    // kept, not revoked
    expect(h.revoked).toEqual([]);
    const next = await h.mcp.prepareTurn({ threadId: "t1", generation: "g2", bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
    expect(next).toEqual({ mounted: [{ profileId: "P1", slug: "dispatch", name: "Dispatch" }], unavailable: [] });
    expect(h.exchanges).toHaveLength(1);
    await h.mcp.relay({ threadId: "t1", generation: "g2", botId: "x", profileId: "P1", frame: { jsonrpc: "2.0", id: 2, method: "tools/list" } });
    // the same token and the same Perspicax session serve the next turn
    expect(h.mcpCalls.map((call) => call.headers.authorization)).toEqual(["Bearer pxlo1.B.mcp-P1-1", "Bearer pxlo1.B.mcp-P1-1"]);
    expect(h.mcpCalls[1]!.headers["mcp-session-id"]).toBe("sess-1");
    // the old turn's key no longer answers
    expect(await h.mcp.relay({ ...turn, botId: "x", profileId: "P1", frame: { jsonrpc: "2.0", id: 3, method: "tools/list" } })).toMatchObject({ status: 403 });
    // the call ends: the kept token is revoked
    await h.mcp.endGeneration("t1", "g2");
    expect(h.revoked).toEqual([]);
    await h.mcp.endWarm("t1");
    expect(h.revoked).toEqual(["pxlo1.B.mcp-P1-1"]);
  });

  it("off a call, a turn's token is revoked when its generation ends", async () => {
    const h = harness({ onCall: new Set() });
    await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
    await h.mcp.endGeneration("t1", "g1");
    expect(h.revoked).toEqual(["pxlo1.B.mcp-P1-1"]);
  });

  it("tries a refused-for-now exchange once more before leaving the profile out", async () => {
    const h = harness();
    h.failExchangeOnce({ ok: false, error: "rate_limited" });
    const plan = await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
    expect(plan).toEqual({ mounted: [{ profileId: "P1", slug: "dispatch", name: "Dispatch" }], unavailable: [] });
    expect(h.exchanges).toHaveLength(2);
    expect(h.logs.join("\n")).toContain("retrying once");
  });

  it("rewrites clientInfo on initialize, carries the session id, and a notification answers 202", async () => {
    const h = harness();
    await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
    await h.mcp.relay({ ...turn, botId: "x", profileId: "P1", frame: { jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: "claude-code", version: "2" } } } });
    expect(h.mcpCalls[0]!.body.params).toEqual({ protocolVersion: "2025-06-18", clientInfo: { name: "Pulsa Bot (x)", version: "0.1.89" } });
    expect(h.mcpCalls[0]!.headers["mcp-session-id"]).toBeUndefined();
    expect(await h.mcp.relay({ ...turn, botId: "x", profileId: "P1", frame: { jsonrpc: "2.0", method: "notifications/initialized" } })).toEqual({ status: 202 });
    expect(h.mcpCalls[1]!.headers["mcp-session-id"]).toBe("sess-1");
    // another bot cannot use this turn's entry
    expect(await h.mcp.relay({ ...turn, botId: "y", profileId: "P1", frame: { jsonrpc: "2.0", id: 2, method: "tools/list" } })).toMatchObject({ status: 403 });
  });

  it("a 401 from /mcp gets one re-exchange with a fresh subject; a second failure ends the access", async () => {
    let refuse = 1;
    const h = harness({
      mcp: ({ body, method }) => {
        if (method === "DELETE") return new Response(null, { status: 204 });
        if (refuse > 0) {
          refuse -= 1;
          return new Response(JSON.stringify({ error: "invalid_token" }), { status: 401 });
        }
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { ok: true } }), { status: 200, headers: { "content-type": "application/json" } });
      },
    });
    await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
    expect(await h.mcp.relay({ ...turn, botId: "x", profileId: "P1", frame: { jsonrpc: "2.0", id: 5, method: "tools/call" } })).toEqual({ status: 200, body: { jsonrpc: "2.0", id: 5, result: { ok: true } } });
    expect(h.exchanges).toHaveLength(2);
    expect(h.subjectCalls).toEqual(["B", "B"]);
    expect(h.mcpCalls.map((call) => call.headers.authorization)).toEqual(["Bearer pxlo1.B.mcp-P1-1", "Bearer pxlo1.B.mcp-P1-2"]);
    expect(h.revoked).toEqual(["pxlo1.B.mcp-P1-1"]);
    // the person is disabled: the renewal fails and the call says so
    refuse = 1;
    h.subjects[BOB]!.disabled = true;
    expect(await h.mcp.relay({ ...turn, botId: "x", profileId: "P1", frame: { jsonrpc: "2.0", id: 6, method: "tools/call" } })).toEqual({ status: 200, body: { jsonrpc: "2.0", id: 6, error: { code: -32001, message: PERSPICAX_ACCESS_ENDED } } });
  });

  it("a token near its end is renewed before the call; forgetSubject ends a running turn at once", async () => {
    const h = harness();
    await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
    h.advance(900_000 - 59_000);
    await h.mcp.relay({ ...turn, botId: "x", profileId: "P1", frame: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
    expect(h.exchanges).toHaveLength(2);
    expect(h.mcpCalls[0]!.headers.authorization).toBe("Bearer pxlo1.B.mcp-P1-2");
    h.mcp.forgetSubject(ISS, "B");
    expect(h.revoked).toEqual(["pxlo1.B.mcp-P1-1", "pxlo1.B.mcp-P1-2"]);
    expect(await h.mcp.relay({ ...turn, botId: "x", profileId: "P1", frame: { jsonrpc: "2.0", id: 2, method: "tools/call" } })).toMatchObject({ body: { error: { code: -32001, message: PERSPICAX_ACCESS_ENDED } } });
    expect(h.mcpCalls).toHaveLength(1);
    // a profile removed from the bot mid-turn is refused
    await h.mcp.prepareTurn({ threadId: "t9", generation: "g", bot, speakerPrincipalId: ALICE, speakerOrigin: "operator" });
    h.botProfiles.x = [];
    expect(await h.mcp.relay({ threadId: "t9", generation: "g", botId: "x", profileId: "P1", frame: { jsonrpc: "2.0", id: 1, method: "tools/list" } })).toMatchObject({ status: 403 });
  });

  it("revokes each token exactly once when the generation ends, after closing the session", async () => {
    const h = harness();
    await h.mcp.prepareTurn({ ...turn, bot: { id: "x", perspicax: { profiles: ["P1", "P2"] } }, speakerPrincipalId: ALICE, speakerOrigin: "person" });
    await h.mcp.prepareTurn({ threadId: "t1", generation: "g2", bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
    await h.mcp.relay({ ...turn, botId: "x", profileId: "P1", frame: { jsonrpc: "2.0", id: 1, method: "initialize" } });
    await h.mcp.endGeneration("t1", "g1");
    expect(h.revoked.sort()).toEqual(["pxlo1.A.mcp-P1-1", "pxlo1.A.mcp-P2-2"]);
    const deletes = h.mcpCalls.filter((call) => call.method === "DELETE");
    expect(deletes).toEqual([{ method: "DELETE", headers: { authorization: "Bearer pxlo1.A.mcp-P1-1", "mcp-session-id": "sess-1" }, body: undefined }]);
    expect(h.mcp.size()).toBe(1);
    await h.mcp.endGeneration("t1", "g1");
    await h.mcp.endThread("t1");
    await h.mcp.endAll();
    expect(h.revoked.sort()).toEqual(["pxlo1.A.mcp-P1-1", "pxlo1.A.mcp-P2-2", "pxlo1.B.mcp-P1-3"]);
    expect(h.mcp.size()).toBe(0);
  });

  it("never puts a token in a log line or an error", async () => {
    const h = harness({ mcp: () => { throw new Error("connect ECONNREFUSED pxlo1.B.mcp-P1-1"); } });
    await h.mcp.prepareTurn({ ...turn, bot: { id: "x", perspicax: { profiles: ["P1", "P2"] } }, speakerPrincipalId: BOB, speakerOrigin: "person" });
    const answer = await h.mcp.relay({ ...turn, botId: "x", profileId: "P1", frame: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
    expect(answer).toEqual({ status: 200, body: { jsonrpc: "2.0", id: 1, error: { code: -32000, message: "Perspicax is unavailable" } } });
    h.failSignIn({ ok: false, error: "unreachable" });
    h.advance(900_000);
    await h.mcp.relay({ ...turn, botId: "x", profileId: "P1", frame: { jsonrpc: "2.0", id: 2, method: "tools/list" } });
    const text = JSON.stringify([h.logs, answer]);
    expect(h.logs.length).toBeGreaterThan(0);
    expect(text).not.toMatch(/pxlo1\./);
  });

  it("parses a JSON or an SSE body", () => {
    expect(parseMcpBody(`{"jsonrpc":"2.0","id":1}`, 1)).toEqual({ jsonrpc: "2.0", id: 1 });
    expect(parseMcpBody(`event: message\ndata: {"id":0}\n\ndata: {"id":1,"x":true}\n\n`, 1)).toEqual({ id: 1, x: true });
    expect(parseMcpBody("", 1)).toBeNull();
  });
});

describe("PERSPICAX_UNAVAILABLE_WHY", () => {
  it("no_delegation says the person has no recent sign-in and what to do, never that they refused routines (Perspicax 1.8.15)", () => {
    const why = PERSPICAX_UNAVAILABLE_WHY.no_delegation;
    expect(why).toContain("no recent sign-in to Sagax");
    expect(why).toContain("sign in to Sagax again");
    expect(why).not.toMatch(/allow/i);
  });
});

describe("perspicaxUnavailableRow", () => {
  it("says the rate limit sentence on the activity row, and the code for the other reasons (fix 2, e2e S6-14b)", () => {
    expect(perspicaxUnavailableRow(["Dispatch"], "bob", "rate_limited")).toBe("Perspicax: Dispatch unavailable for bob: Perspicax is rate limiting this server; try again in a minute");
    expect(perspicaxUnavailableRow(["Dispatch", "Billing"], "Carol", "not_held")).toBe("Perspicax: Dispatch, Billing unavailable for Carol (not_held)");
  });

  it("surfaces Perspicax's invalid_target description when present", () => {
    expect(perspicaxUnavailableWhy("not_held", "Carol does not hold profile Dispatch")).toBe("Carol does not hold profile Dispatch");
    expect(perspicaxUnavailableWhy("not_held")).toBe(PERSPICAX_UNAVAILABLE_WHY.not_held);
    expect(perspicaxUnavailableRow(["Dispatch"], "Carol", "not_held", "Carol does not hold profile Dispatch"))
      .toBe("Perspicax: Dispatch unavailable for Carol: Carol does not hold profile Dispatch");
  });
});

/** Perspicax as rmcp serves it in legacy session mode: initialize opens a
 * session; a call naming an unknown session is 404, a call naming none is 422. */
function sessionServer() {
  const live = new Set<string>();
  let opened = 0;
  const ran: string[] = [];
  const mcp = ({ headers, body, method }: { headers: Record<string, string>; body: any; method: string }): Response => {
    if (method === "DELETE") return new Response(null, { status: 204 });
    if (body.method === "initialize") {
      const id = `s-${++opened}`;
      live.add(id);
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} } } }), {
        status: 200, headers: { "content-type": "application/json", "mcp-session-id": id },
      });
    }
    const session = headers["mcp-session-id"];
    if (!session) return new Response("Unexpected message, expect initialize request", { status: 422 });
    if (!live.has(session)) return new Response("Not Found: Session not found", { status: 404 });
    if (body.id === undefined) return new Response(null, { status: 202 });
    if (body.method === "tools/call") ran.push(body.params.name);
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { ok: true, session } }), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { mcp, live, ran, opened: () => opened, forget: () => live.clear() };
}

describe("PerspicaxMcp: a session Perspicax dropped", () => {
  const call = (name: string, id: number) => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: {} } });
  const init = { jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "grok", version: "1" } } };

  async function started() {
    const server = sessionServer();
    const h = harness({ mcp: server.mcp });
    await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
    await h.mcp.relay({ ...turn, botId: "x", profileId: "P1", frame: init });
    await h.mcp.relay({ ...turn, botId: "x", profileId: "P1", frame: { jsonrpc: "2.0", method: "notifications/initialized" } });
    return { server, h, relay: (frame: unknown, generation = turn.generation) => h.mcp.relay({ threadId: turn.threadId, generation, botId: "x", profileId: "P1", frame }) };
  }

  it("classifies the losses and the replayable frames", () => {
    expect(perspicaxSessionLost(404, "Not Found: Session not found")).toBe(true);
    expect(perspicaxSessionLost(422, "Unexpected message, expect initialize request")).toBe(true);
    expect(perspicaxSessionLost(422, "something else")).toBe(false);
    expect(perspicaxSessionLost(500, "")).toBe(false);
    expect(perspicaxReplayable(call("cw_psa__query", 1))).toBe(true);
    expect(perspicaxReplayable(call("memory_search", 1))).toBe(true);
    expect(perspicaxReplayable(call("memory_find", 1))).toBe(true);
    expect(perspicaxReplayable({ jsonrpc: "2.0", id: 1, method: "tools/list" })).toBe(true);
    for (const name of ["cw_psa__write", "cw_psa__action", "memory_write", "memory_save", "memory_remove", "memory_suggestions", "sagax_send", "flow_action", "cw_psa_query", "unknown"]) {
      expect(perspicaxReplayable(call(name, 1)), name).toBe(false);
    }
  });

  it("404 on a read: opens a new session once and sends the read again, transparently", async () => {
    const { server, h, relay } = await started();
    server.forget();
    const answer = await relay(call("cw_psa__query", 5));
    expect(answer).toEqual({ status: 200, body: { jsonrpc: "2.0", id: 5, result: { ok: true, session: "s-2" } } });
    expect(server.opened()).toBe(2);
    expect(server.ran).toEqual(["cw_psa__query"]);
    // the new session looks like the engine's own (its params, Sagax's clientInfo)
    const reinit = h.mcpCalls.filter((c) => c.body?.method === "initialize")[1]!;
    expect(reinit.body.params).toEqual({ protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "Pulsa Bot (x)", version: "0.1.89" } });
    expect(h.mcpCalls.some((c) => c.body?.method === "notifications/initialized" && c.headers["mcp-session-id"] === "s-2")).toBe(true);
    expect(h.logs.join("\n")).toContain("session lost (HTTP 404); a new one is open; read sent again");
    // the next call uses the new session directly
    await relay(call("memory_search", 6));
    expect(h.mcpCalls.at(-1)!.headers["mcp-session-id"]).toBe("s-2");
    expect(server.opened()).toBe(2);
  });

  it("404 on a write: opens a new session but never replays the write", async () => {
    const { server, h, relay } = await started();
    server.forget();
    const answer = await relay(call("cw_psa__write", 7));
    expect(answer).toEqual({ status: 200, body: { jsonrpc: "2.0", id: 7, error: { code: -32000, message: PERSPICAX_SESSION_RESET } } });
    expect(server.ran).toEqual([]);
    expect(h.mcpCalls.filter((c) => c.body?.params?.name === "cw_psa__write")).toHaveLength(1);
    expect(server.opened()).toBe(2);
    // the bot calls it again on its own: it runs, once
    await relay(call("cw_psa__write", 8));
    expect(server.ran).toEqual(["cw_psa__write"]);
  });

  it("a later turn on an engine that kept its bridge opens a session first (no 422)", async () => {
    const { server, h, relay } = await started();
    await h.mcp.endGeneration("t1", "g1");
    await h.mcp.prepareTurn({ threadId: "t1", generation: "g2", bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
    const answer = await relay(call("api_search", 9), "g2");
    expect(answer).toMatchObject({ status: 200, body: { id: 9, result: { ok: true } } });
    expect(h.mcpCalls.some((c) => c.headers["mcp-session-id"] === undefined && c.body?.method === "tools/call")).toBe(false);
    expect(server.opened()).toBe(2);
    // a write on that turn runs once: the session was opened before it was sent
    await relay(call("cw_psa__action", 10), "g2");
    expect(server.ran).toEqual(["api_search", "cw_psa__action"]);
  });

  it("422 with no initialize ever seen: opens a session with Sagax's own params and sends a read again", async () => {
    const server = sessionServer();
    const h = harness({ mcp: server.mcp });
    await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
    const answer = await h.mcp.relay({ ...turn, botId: "x", profileId: "P1", frame: { jsonrpc: "2.0", id: 3, method: "tools/list" } });
    expect(answer).toMatchObject({ status: 200, body: { id: 3, result: { ok: true, session: "s-1" } } });
    expect(h.mcpCalls.find((c) => c.body?.method === "initialize")!.body.params.protocolVersion).toBe("2025-06-18");
    expect(h.logs.join("\n")).toContain("session lost (HTTP 422)");
  });

  it("concurrent calls on a dropped session share one new session", async () => {
    const { server, relay } = await started();
    server.forget();
    const answers = await Promise.all([relay(call("cw_psa__query", 11)), relay(call("memory_recall", 12)), relay(call("api_describe", 13))]);
    for (const answer of answers) expect(answer).toMatchObject({ status: 200, body: { result: { ok: true } } });
    expect(server.opened()).toBe(2);
    expect(server.ran.sort()).toEqual(["api_describe", "cw_psa__query", "memory_recall"]);
  });

  it("a new session Perspicax refuses surfaces the original status, once", async () => {
    const { server, h, relay } = await started();
    server.forget();
    server.live.add = () => server.live; // initialize answers, but no session ever becomes live
    const before = h.mcpCalls.length;
    const answer = await relay(call("cw_psa__query", 14));
    expect(answer).toMatchObject({ status: 200, body: { id: 14 } });
    expect(h.mcpCalls.length - before).toBeLessThanOrEqual(4);
  });
});

describe("PerspicaxMcp permissions and callTool", () => {
  const toolsCall = (name: string, args: unknown, id = 9) => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
  const answerWith = (text: string, isError = false) => ({ mcp: ({ body }: { body: any }) => body.method === "tools/call"
    ? new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text }], isError } }), { status: 200, headers: { "content-type": "application/json", "mcp-session-id": "s" } })
    : new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: {} }), { status: 200, headers: { "content-type": "application/json", "mcp-session-id": "s" } }) });
  const guardFor = (role: string, mode: "shadow" | "enforce", rows: McpAuditRecord[], deniedResources = ["cw_psa:tickets.*"]): PerspicaxMcpOptions["permissionGuard"] => ({ botId }) => ({
    principal: { id: "p", role }, mode, ownBotId: botId, audit: (r) => rows.push(r), deniedResources,
  });
  const relayed = (h: ReturnType<typeof harness>) => h.mcpCalls.filter((c) => c.body?.method === "tools/call").map((c) => c.body.params.name);

  it("enforce judges the per-profile names Perspicax serves: a permitted cw_psa__query passes, a refused cw_psa__write is blocked", async () => {
    const rows: McpAuditRecord[] = [];
    const h = harness({ ...answerWith("done"), guard: guardFor("viewer", "enforce", rows) });
    await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
    const read = await h.mcp.relay({ ...turn, botId: "x", profileId: "P1", frame: toolsCall("cw_psa__query", { resource: "companies" }, 8) });
    expect(read.body).toMatchObject({ id: 8, result: { content: [{ text: "done" }] } });
    const write = await h.mcp.relay({ ...turn, botId: "x", profileId: "P1", frame: toolsCall("cw_psa__write", { resource: "companies", action: "update", id: 1, set: {} }) });
    expect(write.body).toMatchObject({ id: 9, result: { isError: true } });
    expect(JSON.stringify(write.body)).toContain("Permission denied: api:write");
    expect(relayed(h)).toEqual(["cw_psa__query"]);
    expect(rows.map((r) => [r.tool, r.permission, r.decision, r.resource])).toEqual([
      ["cw_psa__query", "api:query", "allowed", "cw_psa:companies.read"],
      ["cw_psa__write", "api:write", "denied", "cw_psa:companies.update"],
    ]);
  });

  it("enforce passes the meta-tools of Perspicax 1.8.28 by their real names", async () => {
    const rows: McpAuditRecord[] = [];
    const h = harness({ ...answerWith("ok"), guard: guardFor("member", "enforce", rows) });
    await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
    const names = ["api_list", "api_search", "api_describe", "api_result_query", "api_lookup", "api_plan", "identity", "flow", "flow_action", "memory_recall"];
    for (const [i, name] of names.entries()) {
      const answer = await h.mcp.relay({ ...turn, botId: "x", profileId: "P1", frame: toolsCall(name, {}, 20 + i) });
      expect(answer.body, name).toMatchObject({ result: { content: [{ text: "ok" }] } });
    }
    expect(relayed(h)).toEqual(names);
    expect(rows.every((r) => r.decision === "allowed")).toBe(true);
  });

  it("the telephony guard refuses a bot's own call or number purchase before it leaves, never a harness call", async () => {
    const h = harness(answerWith("done"));
    await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
    const bought = await h.mcp.relay({ ...turn, botId: "x", profileId: "P1", frame: toolsCall("twilio_api__write", { resource: "IncomingPhoneNumbers", action: "create", set: { PhoneNumber: "+15145550142" } }, 30) });
    expect(bought.body).toMatchObject({ id: 30, result: { isError: true } });
    expect(JSON.stringify(bought.body)).toContain("never buys");
    const called = await h.mcp.relay({ ...turn, botId: "x", profileId: "P1", frame: toolsCall("twilio_api__write", { resource: "Calls", action: "create", set: { To: "+15145550142", Url: "https://x.test" } }, 31) });
    expect(JSON.stringify(called.body)).toContain("place_phone_call");
    expect(relayed(h)).toEqual([]);
    const harnessCall = await h.mcp.relay({ ...turn, botId: "x", profileId: "P1", frame: toolsCall("twilio_api__write", { resource: "Calls", action: "create", set: {} }, 32), judged: true });
    expect(harnessCall.body).toMatchObject({ id: 32, result: { content: [{ text: "done" }] } });
    expect(relayed(h)).toEqual(["twilio_api__write"]);
  });

  it("refuses a tools/call without an id, and guards a Twilio catalog named otherwise (re-review)", async () => {
    const h = harness({ mcp: ({ body }: { body: any }) => body.method === "tools/list"
      ? new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { tools: [{ name: "sms_gateway__write", description: "Write to the Twilio REST API (api.twilio.com)" }, { name: "cw_psa__write", description: "ConnectWise" }] } }), { status: 200, headers: { "content-type": "application/json", "mcp-session-id": "s" } })
      : new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: "done" }] } }), { status: 200, headers: { "content-type": "application/json", "mcp-session-id": "s" } }) });
    await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
    const noId = await h.mcp.relay({ ...turn, botId: "x", profileId: "P1", frame: { jsonrpc: "2.0", method: "tools/call", params: { name: "cw_psa__query", arguments: {} } } });
    expect(noId.status).toBe(400);
    await h.mcp.relay({ ...turn, botId: "x", profileId: "P1", frame: { jsonrpc: "2.0", id: 40, method: "tools/list" } });
    const aliased = await h.mcp.relay({ ...turn, botId: "x", profileId: "P1", frame: toolsCall("sms_gateway__write", { resource: "Calls", action: "create" }, 41) });
    expect(JSON.stringify(aliased.body)).toContain("place_phone_call");
    const other = await h.mcp.relay({ ...turn, botId: "x", profileId: "P1", frame: toolsCall("cw_psa__write", { resource: "companies", action: "update" }, 42) });
    expect(other.body).toMatchObject({ id: 42, result: { content: [{ text: "done" }] } });
  });

  it("shadow lets a denial through and audits only the denial", async () => {
    const rows: McpAuditRecord[] = [];
    const h = harness({ ...answerWith("done"), guard: guardFor("viewer", "shadow", rows) });
    await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
    await h.mcp.relay({ ...turn, botId: "x", profileId: "P1", frame: toolsCall("cw_psa__query", { resource: "companies" }, 8) });
    const answer = await h.mcp.relay({ ...turn, botId: "x", profileId: "P1", frame: toolsCall("cw_psa__write", { resource: "companies", action: "update" }) });
    expect(answer.body).toMatchObject({ result: { content: [{ text: "done" }] } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tool: "cw_psa__write", decision: "denied", enforced: false });
  });

  it("a per-resource deny refuses cw_psa:tickets.update for a role that may write", async () => {
    const rows: McpAuditRecord[] = [];
    const h = harness({ ...answerWith("done"), guard: guardFor("operator", "enforce", rows) });
    await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
    const denied = await h.mcp.relay({ ...turn, botId: "x", profileId: "P1", frame: toolsCall("cw_psa__write", { resource: "tickets", action: "update" }) });
    expect(JSON.stringify(denied.body)).toContain("cw_psa:tickets.update");
    const allowed = await h.mcp.relay({ ...turn, botId: "x", profileId: "P1", frame: toolsCall("cw_psa__write", { resource: "contacts", action: "update" }, 10) });
    expect(allowed.body).toMatchObject({ result: { content: [{ text: "done" }] } });
    expect(rows.map((r) => r.resource)).toEqual(["cw_psa:tickets.update", "cw_psa:contacts.update"]);
  });

  it("callTool answers a tool's value or Perspicax's error, refuses when no profile is mounted, and is not judged twice", async () => {
    const rows: McpAuditRecord[] = [];
    const h = harness({ ...answerWith("42 records"), guard: guardFor("viewer", "enforce", rows) });
    expect(await h.mcp.callTool({ ...turn, botId: "x", name: "api_list", args: {} })).toMatchObject({ ok: false, code: "profile_not_mounted" });
    await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
    // The agents proxy already judged the native tool: the relay does not refuse nor audit it again.
    expect(await h.mcp.callTool({ ...turn, botId: "x", name: "claim", args: { name: "x" } })).toEqual({ ok: true, isError: false, value: "42 records" });
    expect(rows).toEqual([]);
    const failing = harness(answerWith("bad filter", true));
    await failing.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
    expect(await failing.mcp.callTool({ ...turn, botId: "x", name: "api_search", args: {} })).toEqual({ ok: true, isError: true, value: "bad filter" });
    const rpcFail = harness({ mcp: ({ body }) => body.method === "tools/call" ? new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, error: { code: -32000, message: "nope" } }), { status: 200, headers: { "content-type": "application/json", "mcp-session-id": "s" } }) : new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: {} }), { status: 200, headers: { "content-type": "application/json", "mcp-session-id": "s" } }) });
    await rpcFail.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
    expect(await rpcFail.mcp.callTool({ ...turn, botId: "x", name: "api_search", args: {} })).toEqual({ ok: false, code: "rpc_error", error: "nope" });
  });
});

describe("PerspicaxMcp remote support answers", () => {
  it("hands every remote_support_* answer to onRemoteSupport, unchanged, and nothing else", async () => {
    const seen: Array<{ threadId: string; botId: string; name: string; args: unknown; result: unknown }> = [];
    const h = harness({
      remoteSupport: (call) => {
        seen.push(call);
        throw new Error("a failing hook never changes the answer");
      },
      mcp: ({ body }) => {
        if (body.id === undefined) return new Response(null, { status: 202 });
        const result = body.method === "tools/call" ? { content: [{ type: "text", text: JSON.stringify({ state: "connected", fetch_ip_count: 1 }) }] } : { tools: [] };
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), { status: 200, headers: { "content-type": "application/json", "mcp-session-id": "sess-1" } });
      },
    });
    await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
    await h.mcp.relay({ ...turn, botId: "x", profileId: "P1", frame: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
    await h.mcp.relay({ ...turn, botId: "x", profileId: "P1", frame: { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "api_search", arguments: {} } } });
    const answer = await h.mcp.relay({ ...turn, botId: "x", profileId: "P1", frame: { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "remote_support_status", arguments: { code: "BQDHS7" } } } });
    expect(answer.status).toBe(200);
    expect(answer.body).toMatchObject({ id: 3, result: { content: [{ type: "text" }] } });
    expect(seen).toEqual([{
      threadId: "t1",
      botId: "x",
      // the person whose token made the call: the session becomes theirs
      principalId: "pr_bob",
      name: "remote_support_status",
      args: { code: "BQDHS7" },
      result: { content: [{ type: "text", text: JSON.stringify({ state: "connected", fetch_ip_count: 1 }) }] },
    }]);
  });
});

describe("reviewedReadsOf", () => {
  it("keeps the APIs api_list marks as reviewed and a group whose every member is marked", () => {
    const value = { apis: [
      { id: "acme_desk_service", group: "acme_desk", reviewed_reads: true },
      { id: "acme_desk_time", group: "acme_desk", reviewed_reads: true },
      { id: "Example_Wiki", reviewed_reads: true },
      { id: "vpn_api", reviewed_reads: false },
      { id: "mixed_one", group: "mixed", reviewed_reads: true },
      { id: "mixed_two", group: "mixed" },
      { id: "  ", reviewed_reads: true },
      { reviewed_reads: true },
    ] };
    expect([...reviewedReadsOf(value)].sort()).toEqual(["acme_desk", "acme_desk_service", "acme_desk_time", "example_wiki", "mixed_one"]);
  });
  it("marks nothing for an answer that declares no mark (an older Perspicax) or no list", () => {
    expect(reviewedReadsOf({ apis: [{ id: "acme_desk", display_name: "Desk" }] }).size).toBe(0);
    expect(reviewedReadsOf(null).size).toBe(0);
    expect(reviewedReadsOf({ apis: "x" }).size).toBe(0);
  });
});

describe("PerspicaxMcp reviewedReads", () => {
  const answering = (value: unknown) => ({ mcp: ({ body }: { body: any }) => new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id,
    result: body.method === "tools/call" ? { content: [{ type: "text", text: JSON.stringify(value) }] } : {} }),
  { status: 200, headers: { "content-type": "application/json", "mcp-session-id": "s" } }) });

  it("reads the marks of api_list per bot, and answers false before the list is read", async () => {
    const h = harness(answering({ apis: [{ id: "acme_desk_service", group: "acme_desk", reviewed_reads: true }, { id: "vpn_api" }] }));
    await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
    expect(h.mcp.reviewedReads("x", "acme_desk")).toBe(false);
    await h.mcp.refreshApiNames({ ...turn, botId: "x" });
    expect(h.mcp.reviewedReads("x", "acme_desk")).toBe(true);
    expect(h.mcp.reviewedReads("x", "ACME_DESK_SERVICE")).toBe(true);
    expect(h.mcp.reviewedReads("x", "vpn_api")).toBe(false);
    expect(h.mcp.reviewedReads("y", "acme_desk")).toBe(false);
  });
});
