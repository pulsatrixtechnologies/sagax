// Slice 5: Perspicax MCP for the person who speaks (server/perspicax/perspicax-mcp.ts).
import { describe, expect, it } from "vitest";

import voiceFixture from "../fixtures/perspicax-voice-tools.json" with { type: "json" };
import type { McpAuditRecord } from "../mcp/mcp-permissions.ts";
import { WarmResourceBudget, MiB } from "../resources/warm-resources.ts";
import type { SubjectTokenOutcome } from "../auth/idp-session.ts";
import type { ExchangeResult } from "./perspicax-link.ts";
import { PERSPICAX_ACCESS_ENDED, PERSPICAX_KEEPALIVE_PER_PERSON, PERSPICAX_ROUTINE_RETRY_MS, PERSPICAX_SESSION_RESET, PERSPICAX_UNAVAILABLE_WHY, PerspicaxMcp, parseMcpBody, perspicaxReadOnlyToolsOf, perspicaxReplayable, reviewedReadsOf, perspicaxSessionLost, perspicaxUnavailableRow, perspicaxUnavailableWhy, withFailureWords, type PerspicaxMcpLink, type PerspicaxMcpOptions } from "./perspicax-mcp.ts";

const ISS = "https://px.example.test";
const ALICE = "pr_alice";
const BOB = "pr_bob";
const CAROL = "pr_carol";
function harness(options: {
  warmBudget?: WarmResourceBudget;
  writeOnceScope?: PerspicaxMcpOptions["writeOnceScope"];
  mcp?: (request: { headers: Record<string, string>; body: any; method: string }) => Response | Promise<Response>;
  onCall?: Set<string>;
  engineWarm?: Set<string>;
  keepaliveMs?: number;
  keepaliveJitterMs?: number;
  maxPingedPerPerson?: number;
  guard?: PerspicaxMcpOptions["permissionGuard"];
  remoteSupport?: PerspicaxMcpOptions["onRemoteSupport"];
  productKeyState?: PerspicaxMcpOptions["onProductKeyState"];
  records?: PerspicaxMcpOptions["onRecords"];
  botProductsOff?: PerspicaxMcpOptions["botProductsOff"];
  askGo?: PerspicaxMcpOptions["askGo"];
  judge?: PerspicaxMcpOptions["judgeResolved"];
} = {}) {
  let clock = 1_000_000;
  const timers: Array<{ at: number; fn: () => void | Promise<void>; cancelled: boolean }> = [];
  const subjects: Record<string, { iss: string; sub: string; disabled: boolean }> = {
    [ALICE]: { iss: ISS, sub: "A", disabled: false },
    [BOB]: { iss: ISS, sub: "B", disabled: false },
    [CAROL]: { iss: ISS, sub: "C", disabled: false },
  };
  const liveBots = new Set(["x"]);
  const exchanges: string[] = [];
  const revoked: string[] = [];
  const logs: string[] = [];
  const mcpCalls: Array<{ method: string; headers: Record<string, string>; body: any }> = [];
  const subjectCalls: string[] = [];
  const sleeps: number[] = [];
  let signInFails: SubjectTokenOutcome | null = null;
  let exchangeFails: ExchangeResult | null = null;
  let exchangeFailsOnce: ExchangeResult | null = null;
  /** Slice 6: who holds a routine delegation (issued from a recent sign-in). */
  const delegations = new Set<string>();
  const delegationCalls: string[] = [];
  const refusedDelegations: string[] = [];
  let n = 0;
  const link: PerspicaxMcpLink = {
    exchangeToken: async (subjectToken): Promise<ExchangeResult> => {
      exchanges.push(subjectToken);
      if (exchangeFails) return exchangeFails;
      if (exchangeFailsOnce) {
        const once = exchangeFailsOnce;
        exchangeFailsOnce = null;
        return once;
      }
      const sub = subjectToken.split(".")[1]!;
      if (subjects[`pr_${{ A: "alice", B: "bob", C: "carol" }[sub]}`]?.disabled) return { ok: false, error: "subject" };
      return { ok: true, token: `pxlo1.${sub}.mcp-P1-${++n}`, expiresAt: clock + 900_000 };
    },
    revokeExchanged: async (token) => { revoked.push(token); return true; },
    mcpEndpoint: () => "http://perspicax:8787/mcp",
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
    writeOnceScope: options.writeOnceScope,
    warmBudget: options.warmBudget ?? new WarmResourceBudget({ intervalMs: 0 }),
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
    botExists: (id) => liveBots.has(id),
    ...(options.onCall ? { keepWarm: (threadId: string) => options.onCall!.has(threadId) } : {}),
    ...(options.engineWarm ? { engineWarm: (threadId: string) => options.engineWarm!.has(threadId) } : {}),
    ...(options.keepaliveMs !== undefined ? { keepaliveMs: options.keepaliveMs } : {}),
    ...(options.keepaliveJitterMs !== undefined ? { keepaliveJitterMs: options.keepaliveJitterMs } : { keepaliveJitterMs: 0 }),
    ...(options.maxPingedPerPerson !== undefined ? { maxPingedPerPerson: options.maxPingedPerPerson } : {}),
    after: (ms, fn) => {
      const timer = { at: clock + ms, fn, cancelled: false };
      timers.push(timer);
      return { cancel: () => { timer.cancelled = true; } };
    },
    version: "0.1.89",
    ...(options.guard ? { permissionGuard: options.guard } : {}),
    ...(options.remoteSupport ? { onRemoteSupport: options.remoteSupport } : {}),
    ...(options.productKeyState ? { onProductKeyState: options.productKeyState } : {}),
    ...(options.records ? { onRecords: options.records } : {}),
    ...(options.botProductsOff ? { botProductsOff: options.botProductsOff } : {}),
    ...(options.askGo ? { askGo: options.askGo } : {}),
    ...(options.judge ? { judgeResolved: options.judge } : {}),
    fetch: fetcher,
    now: () => clock,
    log: (line) => logs.push(line),
    // routine backoff waits are recorded, never slept (2026-11-02)
    sleep: async (ms) => { sleeps.push(ms); clock += ms; },
  });
  return {
    mcp, subjects, sleeps, liveBots, exchanges, revoked, logs, mcpCalls, subjectCalls, delegations, delegationCalls, refusedDelegations,
    advance: (ms: number) => { clock += ms; },
    /** Fire keep-alive timers that are due at the current clock. */
    runDue: async () => {
      const due = timers.filter((timer) => !timer.cancelled && timer.at <= clock).sort((a, b) => a.at - b.at);
      for (const timer of due) {
        if (timer.cancelled) continue;
        timer.cancelled = true;
        await timer.fn();
      }
    },
    failSignIn: (outcome: SubjectTokenOutcome | null) => { signInFails = outcome; },
    failExchange: (outcome: ExchangeResult | null) => { exchangeFails = outcome; },
    failExchangeOnce: (outcome: ExchangeResult) => { exchangeFailsOnce = outcome; },
    /** The next `times` exchanges fail with `outcome`, then they pass. */
    failExchangeTimes: (outcome: ExchangeResult, times: number) => {
      let left = times;
      const original = link.exchangeToken;
      link.exchangeToken = async (token) => {
        if (left > 0) { left -= 1; exchanges.push(token); return outcome; }
        return original(token);
      };
    },
  };
}

const bot = { id: "x" };
const turn = { threadId: "t1", generation: "g1" };

describe("Perspicax shared warm budget", () => {
  it("protects active generations and revokes an idle session evicted by the global cap", async () => {
    const budget = new WarmResourceBudget({ intervalMs: 0, limits: { count: 1, bytes: 10 * MiB, personCount: 10, personBytes: 10 * MiB, followUpMs: 0 } });
    const h = harness({ warmBudget: budget, engineWarm: new Set(["t1", "t2"]) });
    try {
      await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
      await h.mcp.relay({ ...turn, botId: "x", frame: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
      await h.mcp.prepareTurn({ threadId: "t2", generation: "g2", bot, speakerPrincipalId: ALICE, speakerOrigin: "person" });
      expect(budget.stats()).toMatchObject({ active: 2, evictions: 0, overBudget: true });
      // #4228 (#4215): the caps bound idle retention only. While t2 still
      // runs, t1's idle session is the only one retained and stays.
      await h.mcp.endGeneration("t1", "g1"); await budget.settled();
      expect(h.revoked).toHaveLength(0);
      expect(budget.stats()).toMatchObject({ active: 1, resources: 2, evictions: 0 });
      await h.mcp.endGeneration("t2", "g2"); await budget.settled();
      expect(h.revoked).toHaveLength(1); expect(h.mcpCalls.some(c => c.method === "DELETE")).toBe(true);
      expect(budget.stats()).toMatchObject({ active: 0, resources: 1, evictions: 1 });
      await h.mcp.prepareTurn({ threadId: "t1", generation: "g3", bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
      expect(h.exchanges).toHaveLength(3);
    } finally { await h.mcp.endAll(); }
    expect(budget.stats().resources).toBe(0);
  });

  it("evicts only the person exceeding their retained memory cap", async () => {
    const budget = new WarmResourceBudget({ intervalMs: 0, limits: { count: 10, bytes: 10 * MiB, personCount: 10, personBytes: MiB + 1024, followUpMs: 0 } });
    const h = harness({ warmBudget: budget, engineWarm: new Set(["wren", "osprey-one", "osprey-two"]) });
    try {
      for (const [threadId, speakerPrincipalId] of [["wren", BOB], ["osprey-one", ALICE], ["osprey-two", ALICE]]) {
        await h.mcp.prepareTurn({ threadId: threadId!, generation: "g", bot, speakerPrincipalId: speakerPrincipalId!, speakerOrigin: "person" });
        await h.mcp.endGeneration(threadId!, "g"); await budget.settled();
      }
      expect(budget.stats()).toMatchObject({ resources: 2, personEvictions: 1, globalEvictions: 0 });
      const before = h.exchanges.length;
      await h.mcp.prepareTurn({ threadId: "wren", generation: "g2", bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
      expect(h.exchanges.length).toBe(before);
    } finally { await h.mcp.endAll(); }
  });
});

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
    const asked: Array<{ threadId: string; botId: string; message: string }> = [];
    const h = harness({ mcp: server.mcp, askGo: async (input) => { asked.push(input); return "allow"; } });
    await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
    await h.mcp.relay({ ...turn, botId: "x" , frame: { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: { roots: {} }, clientInfo: { name: "engine", version: "1" } } } });
    expect(h.mcpCalls[0]!.body.params.capabilities).toEqual({ roots: {}, elicitation: { form: {} } });
    const answer = await h.mcp.relay({ ...turn, botId: "x" , frame: { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "cw_psa_update_ticket", arguments: {} } } });
    expect(asked).toEqual([{ threadId: "t1", botId: "x", message: "Flow: update ticket 42 (dry run done). GO?" }]);
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
      const answer = await h.mcp.relay({ ...turn, botId: "x" , frame: { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "w", arguments: {} } } });
      expect(server.answers).toEqual([{ jsonrpc: "2.0", id: 0, result: { action } }]);
      expect((answer.body as any).result.isError).toBe(true);
    }
    const other = goServer({ type: "object", properties: { email: { type: "string" } } });
    const asked: unknown[] = [];
    const h = harness({ mcp: other.mcp, askGo: async (input) => { asked.push(input); return "allow"; } });
    await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
    await h.mcp.relay({ ...turn, botId: "x" , frame: { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "w", arguments: {} } } });
    expect(asked).toEqual([]);
    expect(other.answers).toEqual([{ jsonrpc: "2.0", id: 0, result: { action: "decline" } }]);
  });

  it("declares nothing without askGo", async () => {
    const h = harness();
    await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
    await h.mcp.relay({ ...turn, botId: "x" , frame: { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "engine", version: "1" } } } });
    expect(h.mcpCalls[0]!.body.params.capabilities).toEqual({});
  });
});

describe("PerspicaxMcp", () => {
  it("#1935: names the MCP server of this turn that runs a profile tool", async () => {
    const h = harness({
      mcp: ({ body }) => {
        if (body.id === undefined) return new Response(null, { status: 202 });
        const result = body.method === "tools/list" ? { tools: [{ name: "cw_psa_query" }, { name: "api_search" }] } : {};
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), { status: 200, headers: { "content-type": "application/json", "mcp-session-id": "sess-1" } });
      },
    });
    await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
    // no mount name recorded yet: nothing to name
    expect(h.mcp.toolHome(turn.threadId, turn.generation, "x", "cw_psa_query")).toBeUndefined();
    h.mcp.setMount(turn.threadId, turn.generation, "perspicax");
    // before any listing: the server the gateway tools answer from, not sure
    expect(h.mcp.toolHome(turn.threadId, turn.generation, "x", "cw_psa_query")).toEqual({ server: "perspicax", served: false });
    await h.mcp.relay({ ...turn, botId: "x" , frame: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
    expect(h.mcp.toolHome(turn.threadId, turn.generation, "x", "cw_psa_query")).toEqual({ server: "perspicax", served: true });
    // an earlier spelling with `__` is the same tool
    expect(h.mcp.toolHome(turn.threadId, turn.generation, "x", "cw_psa__query")).toEqual({ server: "perspicax", served: true });
    // another bot, or another turn, gets nothing
    expect(h.mcp.toolHome(turn.threadId, turn.generation, "y", "cw_psa_query")).toBeUndefined();
    expect(h.mcp.toolHome(turn.threadId, "g-other", "x", "cw_psa_query")).toBeUndefined();
  });

  it("exchanges the speaker's own sign-in, never the owner's", async () => {
    const h = harness();
    const plan = await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
    expect(plan).toEqual({ mounted: [{ name: "Perspicax" }], unavailable: [] });
    expect(h.subjectCalls).toEqual(["B"]);
    expect(h.exchanges).toEqual(["pxlo1.B.signin"]);
    const answer = await h.mcp.relay({ ...turn, botId: "x" , frame: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
    expect(answer).toEqual({ status: 200, body: { jsonrpc: "2.0", id: 1, result: { tools: [], seenAs: "B" } } });
    expect(h.mcpCalls[0]!.headers).toMatchObject({ accept: "application/json, text/event-stream", authorization: "Bearer pxlo1.B.mcp-P1-1" });
  });

  it("mounts without bot profile settings and honors the speaker origin", async () => {
    const h = harness();
    expect(await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: ALICE, speakerOrigin: "owner-routine" })).toEqual({
      mounted: [], unavailable: [{ name: "Perspicax", reason: "no_delegation" }],
    });
    expect(h.subjectCalls).toEqual([]);
    // A missing person or peer never widens to the bot owner.
    expect(await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: "", speakerOrigin: "person" })).toMatchObject({ mounted: [], unavailable: [{ reason: "unknown_speaker" }] });
    expect(await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: "", speakerOrigin: "person", ownerPrincipalId: BOB })).toMatchObject({ mounted: [], unavailable: [{ reason: "unknown_speaker" }] });
    expect(await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: "", speakerOrigin: "peer", ownerPrincipalId: BOB })).toMatchObject({ mounted: [], unavailable: [{ reason: "unknown_speaker" }] });
    expect(await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: "pr_nobody", speakerOrigin: "peer", ownerPrincipalId: BOB })).toMatchObject({ mounted: [], unavailable: [{ reason: "unknown_speaker" }] });
    // `operator` is the owner speaking, so the explicit owner fallback is valid.
    expect(await h.mcp.prepareTurn({ threadId: "operator", generation: "g", bot, speakerPrincipalId: "", speakerOrigin: "operator", ownerPrincipalId: BOB })).toEqual({
      mounted: [{ name: "Perspicax" }], unavailable: [],
    });
    // There is no profile setting on this bot: every account turn still mounts.
    expect(await h.mcp.prepareTurn({ threadId: "plain", generation: "g", bot: { id: "x" }, speakerPrincipalId: BOB, speakerOrigin: "person" })).toEqual({
      mounted: [{ name: "Perspicax" }], unavailable: [],
    });
    const solo = new PerspicaxMcp({ issuer: ISS, link: () => null, subjectOf: () => null, subjectToken: async () => ({ ok: false, error: "no_session" }), version: "1" });
    expect(await solo.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "person" })).toEqual({ mounted: [], unavailable: [] });
  });

  it("#1941 owner-routine with empty speaker mounts via the bot owner (delegation)", async () => {
    const h = harness();
    h.delegations.add(BOB);
    expect(await h.mcp.prepareTurn({
      ...turn, bot, speakerPrincipalId: "", speakerOrigin: "owner-routine", routine: true, ownerPrincipalId: BOB,
    })).toEqual({
      mounted: [{ name: "Perspicax" }], unavailable: [],
    });
    expect(h.delegationCalls).toEqual([BOB]);
    // Empty without owner still refuses; never widens to another person.
    expect(await h.mcp.prepareTurn({
      ...turn, bot, speakerPrincipalId: "", speakerOrigin: "owner-routine", routine: true,
    })).toMatchObject({ mounted: [], unavailable: [{ reason: "unknown_speaker" }] });
  });

  it("a turn in a routine's lineage never uses a sign-in, even for a peer hop that names a live person", async () => {
    const h = harness();
    expect(await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: ALICE, speakerOrigin: "peer", routine: true })).toEqual({
      mounted: [], unavailable: [{ name: "Perspicax", reason: "no_delegation" }],
    });
    expect(await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "person", routine: true })).toMatchObject({ mounted: [], unavailable: [{ reason: "no_delegation" }] });
    expect(h.subjectCalls).toEqual([]);
    expect(h.exchanges).toEqual([]);
  });

  it("a routine exchanges its runAs person's delegation (slice 6)", async () => {
    const h = harness();
    h.delegations.add(BOB);
    const plan = await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "owner-routine" });
    expect(plan).toEqual({ mounted: [{ name: "Perspicax" }], unavailable: [] });
    expect(h.delegationCalls).toEqual([BOB]);
    expect(h.subjectCalls).toEqual([]);
    expect(h.exchanges).toEqual(["pxlo1.B.delegation"]);
    // a peer hop in the routine's lineage uses the root person's delegation
    await h.mcp.prepareTurn({ threadId: "t2", generation: "g", bot, speakerPrincipalId: BOB, speakerOrigin: "peer", routine: true });
    expect(h.exchanges.at(-1)).toBe("pxlo1.B.delegation");
    expect(h.subjectCalls).toEqual([]);
    // a token near its end renews through the delegation, not a sign-in
    h.advance(900_000 - 30_000);
    const answer = await h.mcp.relay({ ...turn, botId: "x" , frame: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
    expect(answer).toMatchObject({ status: 200, body: { result: { seenAs: "B" } } });
    expect(h.delegationCalls).toEqual([BOB, BOB, BOB]);
    expect(h.subjectCalls).toEqual([]);
    // the delegation ends: its tokens are revoked and calls end
    const before = h.revoked.length;
    h.mcp.forgetPrincipal(BOB);
    await new Promise((resolve) => setImmediate(resolve));
    expect(h.revoked.length).toBe(before + 2);
    expect(await h.mcp.relay({ ...turn, botId: "x" , frame: { jsonrpc: "2.0", id: 2, method: "tools/list" } })).toMatchObject({ body: { error: { message: PERSPICAX_ACCESS_ENDED } } });
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
    link.exchangeToken = async (subjectToken) => (refusals-- > 0 ? { ok: false, error: "subject" } : exchange(subjectToken));
    expect(await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "owner-routine" })).toEqual({
      mounted: [{ name: "Perspicax" }], unavailable: [],
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

  it("an account-level exchange refusal is unavailable; no sign-in is no_session", async () => {
    const h = harness();
    h.failExchange({ ok: false, error: "not_held", description: "No account MCP access" });
    expect(await h.mcp.prepareTurn({ threadId: "t2", generation: "g", bot, speakerPrincipalId: CAROL, speakerOrigin: "person" })).toEqual({
      mounted: [], unavailable: [{ name: "Perspicax", reason: "not_held", detail: "No account MCP access" }],
    });
    expect(await h.mcp.relay({ threadId: "t2", generation: "g", botId: "x" , frame: { jsonrpc: "2.0", id: 1, method: "tools/list" } })).toMatchObject({ status: 403, body: { code: "profile_not_mounted" } });
    h.failExchange(null);
    h.failSignIn({ ok: false, error: "no_session" });
    expect(await h.mcp.prepareTurn({ threadId: "t3", generation: "g", bot, speakerPrincipalId: BOB, speakerOrigin: "person" })).toMatchObject({ unavailable: [{ reason: "no_session" }] });
    h.failSignIn({ ok: false, error: "unreachable" });
    expect(await h.mcp.prepareTurn({ threadId: "t3", generation: "g", bot, speakerPrincipalId: BOB, speakerOrigin: "person" })).toMatchObject({ unavailable: [{ reason: "unreachable" }] });
  });

  it("reports a rate limit as rate_limited, never as could not be reached (fix 2)", async () => {
    const h = harness();
    h.failExchange({ ok: false, error: "rate_limited" });
    const plan = await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
    expect(plan).toEqual({ mounted: [], unavailable: [{ name: "Perspicax", reason: "rate_limited" }] });
    h.failExchange(null);
    h.failSignIn({ ok: false, error: "rate_limited", retryAfterMs: 60_000 });
    expect(await h.mcp.prepareTurn({ threadId: "t9", generation: "g", bot, speakerPrincipalId: BOB, speakerOrigin: "person" })).toMatchObject({ unavailable: [{ reason: "rate_limited" }] });
    expect(h.logs.join("\n")).not.toMatch(/could not be reached/);
  });

  it("on a live call, keeps a turn's token for the next turn: no new exchange, tools stay mounted", async () => {
    const onCall = new Set(["t1"]);
    const h = harness({ onCall });
    expect((await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "person" })).mounted).toHaveLength(1);
    await h.mcp.relay({ ...turn, botId: "x" , frame: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
    await h.mcp.endGeneration("t1", "g1");
    // kept, not revoked
    expect(h.revoked).toEqual([]);
    const next = await h.mcp.prepareTurn({ threadId: "t1", generation: "g2", bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
    expect(next).toEqual({ mounted: [{ name: "Perspicax" }], unavailable: [] });
    expect(h.exchanges).toHaveLength(1);
    await h.mcp.relay({ threadId: "t1", generation: "g2", botId: "x" , frame: { jsonrpc: "2.0", id: 2, method: "tools/list" } });
    // The account token is reused, but the old remote session was deleted
    // and is never sent on the next generation's first request.
    const deleted = h.mcpCalls.find((call) => call.method === "DELETE")!;
    const secondList = h.mcpCalls.find((call) => call.body?.id === 2)!;
    expect(deleted.headers["mcp-session-id"]).toBe("sess-1");
    expect(secondList.headers.authorization).toBe("Bearer pxlo1.B.mcp-P1-1");
    expect(secondList.headers["mcp-session-id"]).toBeUndefined();
    // the old turn's key no longer answers
    expect(await h.mcp.relay({ ...turn, botId: "x" , frame: { jsonrpc: "2.0", id: 3, method: "tools/list" } })).toMatchObject({ status: 403 });
    // the call ends: the kept token is revoked
    await h.mcp.endGeneration("t1", "g2");
    expect(h.revoked).toEqual([]);
    await h.mcp.endWarm("t1");
    expect(h.revoked).toEqual(["pxlo1.B.mcp-P1-1"]);
  });

  it("on a live call, a turn that starts while the last one is still closing its session takes the kept token over", async () => {
    const onCall = new Set(["t1"]);
    let releaseDelete: (() => void) | undefined;
    const h = harness({
      onCall,
      mcp: ({ method, body }) => {
        // the warm turn's session DELETE is slow: the call's first sentence lands meanwhile
        if (method === "DELETE") return new Promise<Response>((resolve) => { releaseDelete = () => resolve(new Response(null, { status: 204 })); });
        if (body.id === undefined) return new Response(null, { status: 202 });
        return new Response(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { tools: [] } })}\n\n`, {
          status: 200, headers: { "content-type": "text/event-stream", "mcp-session-id": "sess-1" },
        });
      },
    });
    await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
    await h.mcp.relay({ ...turn, botId: "x", frame: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
    const ending = h.mcp.endGeneration("t1", "g1");
    const next = h.mcp.prepareTurn({ threadId: "t1", generation: "g2", bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
    for (let i = 0; i < 20 && !releaseDelete; i += 1) await Promise.resolve();
    releaseDelete!();
    await ending;
    expect(await next).toEqual({ mounted: [{ name: "Perspicax" }], unavailable: [] });
    expect(h.exchanges).toHaveLength(1);
    expect(h.revoked).toEqual([]);
  });

  it("an engine that goes cold while its generation is retired still gets its token revoked", async () => {
    const engineWarm = new Set(["t1"]);
    let h: ReturnType<typeof harness>;
    h = harness({
      engineWarm,
      mcp: ({ method, body }) => {
        if (method === "DELETE") {
          // the pool reaps the engine while the session is being closed
          engineWarm.delete("t1");
          h.mcp.noteEngineCold("t1");
          return new Response(null, { status: 204 });
        }
        if (body.id === undefined) return new Response(null, { status: 202 });
        return new Response(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { tools: [] } })}\n\n`, {
          status: 200, headers: { "content-type": "text/event-stream", "mcp-session-id": "sess-1" },
        });
      },
    });
    await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
    await h.mcp.relay({ ...turn, botId: "x", frame: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
    await h.mcp.endGeneration("t1", "g1");
    expect(h.revoked).toEqual(["pxlo1.B.mcp-P1-1"]);
  });

  it("off a call, a turn's token is revoked when its generation ends", async () => {
    const h = harness({ onCall: new Set() });
    await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
    await h.mcp.endGeneration("t1", "g1");
    expect(h.revoked).toEqual(["pxlo1.B.mcp-P1-1"]);
  });

  it("a routine waits out a connector roll with backoff before the account connection is left out (2026-11-02)", async () => {
    const h = harness();
    h.delegations.add(BOB);
    // the connector is down for the first five exchanges (about 20 s here)
    h.failExchangeTimes({ ok: false, error: "unreachable" }, 5);
    const plan = await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "owner-routine" });
    expect(plan).toEqual({ mounted: [{ name: "Perspicax" }], unavailable: [] });
    // the quick retry, then the routine backoff until it passed
    expect(h.sleeps).toEqual([400, 2_000, 5_000, 10_000, 20_000]);
    expect(h.logs.join("\n")).toContain("still refused; trying again in 2 s");
  });

  it("a routine gives up after the whole backoff, and a person's turn keeps the single quick retry", async () => {
    const h = harness();
    h.delegations.add(BOB);
    h.failExchange({ ok: false, error: "unreachable" });
    const routine = await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "owner-routine" });
    expect(routine).toMatchObject({ mounted: [], unavailable: [{ reason: "unreachable" }] });
    expect(h.sleeps).toEqual([400, ...PERSPICAX_ROUTINE_RETRY_MS]);
    h.sleeps.length = 0;
    const person = await h.mcp.prepareTurn({ threadId: "t2", generation: "g", bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
    expect(person).toMatchObject({ mounted: [], unavailable: [{ reason: "unreachable" }] });
    expect(h.sleeps).toEqual([400]);
  });

  it("a routine's MCP read is sent again over HTTP 502 and 503 with backoff; a write only over 503 or a refused connection", async () => {
    let failures: Array<number | "refused"> = [];
    const h = harness({
      mcp: ({ body }) => {
        const next = failures.shift();
        if (next === "refused") throw Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }) });
        if (typeof next === "number") return new Response("Bad Gateway", { status: next });
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: "ok" }] } }), { status: 200, headers: { "content-type": "application/json", "mcp-session-id": "sess-1" } });
      },
    });
    h.delegations.add(BOB);
    await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "owner-routine" });
    const read = { jsonrpc: "2.0", id: 1, method: "tools/list" };
    failures = [502, 503, "refused"];
    expect(await h.mcp.relay({ ...turn, botId: "x" , frame: read })).toMatchObject({ status: 200, body: { result: { content: [{ text: "ok" }] } } });
    expect(h.sleeps).toEqual([2_000, 5_000, 10_000]);
    const write = { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "cw_psa__write", arguments: {} } };
    h.sleeps.length = 0;
    failures = ["refused", 503];
    expect(await h.mcp.relay({ ...turn, botId: "x" , frame: write })).toMatchObject({ body: { result: { content: [{ text: "ok" }] } } });
    expect(h.sleeps).toEqual([2_000, 5_000]);
    // a 502 may have run the write: never sent again, the bot gets the failure
    h.sleeps.length = 0;
    failures = [502];
    expect(await h.mcp.relay({ ...turn, botId: "x" , frame: { ...write, id: 3 } })).toMatchObject({ body: { error: { message: "Perspicax answered HTTP 502" } } });
    expect(h.sleeps).toEqual([]);
  });

  it("a person's MCP call is not held up by the routine backoff", async () => {
    let failures = [502];
    const h = harness({ mcp: ({ body }) => failures.shift()
      ? new Response("Bad Gateway", { status: 502 })
      : new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: {} }), { status: 200, headers: { "content-type": "application/json" } }) });
    await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
    expect(await h.mcp.relay({ ...turn, botId: "x" , frame: { jsonrpc: "2.0", id: 1, method: "tools/list" } })).toMatchObject({ body: { error: { message: "Perspicax answered HTTP 502" } } });
    expect(h.sleeps).toEqual([]);
    failures = [];
  });

  it("tries a refused-for-now exchange once more before leaving the profile out", async () => {
    const h = harness();
    h.failExchangeOnce({ ok: false, error: "rate_limited" });
    const plan = await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
    expect(plan).toEqual({ mounted: [{ name: "Perspicax" }], unavailable: [] });
    expect(h.exchanges).toHaveLength(2);
    expect(h.logs.join("\n")).toContain("retrying once");
  });

  it("rewrites clientInfo on initialize, carries the session id, and a notification answers 202", async () => {
    const h = harness();
    await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
    await h.mcp.relay({ ...turn, botId: "x" , frame: { jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: "claude-code", version: "2" } } } });
    expect(h.mcpCalls[0]!.body.params).toEqual({ protocolVersion: "2025-06-18", clientInfo: { name: "Pulsa Bot (x)", version: "0.1.89" } });
    expect(h.mcpCalls[0]!.headers["mcp-session-id"]).toBeUndefined();
    expect(await h.mcp.relay({ ...turn, botId: "x" , frame: { jsonrpc: "2.0", method: "notifications/initialized" } })).toEqual({ status: 202 });
    expect(h.mcpCalls[1]!.headers["mcp-session-id"]).toBe("sess-1");
    // another bot cannot use this turn's entry
    expect(await h.mcp.relay({ ...turn, botId: "y" , frame: { jsonrpc: "2.0", id: 2, method: "tools/list" } })).toMatchObject({ status: 403 });
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
    expect(await h.mcp.relay({ ...turn, botId: "x" , frame: { jsonrpc: "2.0", id: 5, method: "tools/call" } })).toEqual({ status: 200, body: { jsonrpc: "2.0", id: 5, result: { ok: true } } });
    expect(h.exchanges).toHaveLength(2);
    expect(h.subjectCalls).toEqual(["B", "B"]);
    expect(h.mcpCalls.map((call) => call.headers.authorization)).toEqual(["Bearer pxlo1.B.mcp-P1-1", "Bearer pxlo1.B.mcp-P1-2"]);
    expect(h.revoked).toEqual(["pxlo1.B.mcp-P1-1"]);
    // the person is disabled: the renewal fails and the call says so
    refuse = 1;
    h.subjects[BOB]!.disabled = true;
    expect(await h.mcp.relay({ ...turn, botId: "x" , frame: { jsonrpc: "2.0", id: 6, method: "tools/call" } })).toEqual({ status: 200, body: { jsonrpc: "2.0", id: 6, error: { code: -32001, message: PERSPICAX_ACCESS_ENDED } } });
  });

  it("a token near its end is renewed before the call; forgetSubject ends a running turn at once", async () => {
    const h = harness();
    await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
    h.advance(900_000 - 59_000);
    await h.mcp.relay({ ...turn, botId: "x" , frame: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
    expect(h.exchanges).toHaveLength(2);
    expect(h.mcpCalls[0]!.headers.authorization).toBe("Bearer pxlo1.B.mcp-P1-2");
    h.mcp.forgetSubject(ISS, "B");
    expect(h.revoked).toEqual(["pxlo1.B.mcp-P1-1", "pxlo1.B.mcp-P1-2"]);
    expect(await h.mcp.relay({ ...turn, botId: "x" , frame: { jsonrpc: "2.0", id: 2, method: "tools/call" } })).toMatchObject({ body: { error: { code: -32001, message: PERSPICAX_ACCESS_ENDED } } });
    expect(h.mcpCalls).toHaveLength(1);
    // A bot deleted mid-turn is refused; account roles are not bot settings.
    await h.mcp.prepareTurn({ threadId: "t9", generation: "g", bot, speakerPrincipalId: ALICE, speakerOrigin: "operator" });
    h.liveBots.delete("x");
    expect(await h.mcp.relay({ threadId: "t9", generation: "g", botId: "x" , frame: { jsonrpc: "2.0", id: 1, method: "tools/list" } })).toMatchObject({ status: 403 });
  });

  it("revokes each token exactly once when the generation ends, after closing the session", async () => {
    const h = harness();
    await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: ALICE, speakerOrigin: "person" });
    await h.mcp.prepareTurn({ threadId: "t1", generation: "g2", bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
    await h.mcp.relay({ ...turn, botId: "x" , frame: { jsonrpc: "2.0", id: 1, method: "initialize" } });
    await h.mcp.endGeneration("t1", "g1");
    expect(h.revoked).toEqual(["pxlo1.A.mcp-P1-1"]);
    const deletes = h.mcpCalls.filter((call) => call.method === "DELETE");
    expect(deletes).toEqual([{ method: "DELETE", headers: { authorization: "Bearer pxlo1.A.mcp-P1-1", "mcp-session-id": "sess-1" }, body: undefined }]);
    expect(h.mcp.size()).toBe(1);
    await h.mcp.endGeneration("t1", "g1");
    await h.mcp.endThread("t1");
    await h.mcp.endAll();
    expect(h.revoked.sort()).toEqual(["pxlo1.A.mcp-P1-1", "pxlo1.B.mcp-P1-2"]);
    expect(h.mcp.size()).toBe(0);
  });

  it("never puts a token in a log line or an error", async () => {
    const h = harness({ mcp: () => { throw new Error("connect ECONNREFUSED pxlo1.B.mcp-P1-1"); } });
    await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
    const answer = await h.mcp.relay({ ...turn, botId: "x" , frame: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
    expect(answer).toEqual({ status: 200, body: { jsonrpc: "2.0", id: 1, error: { code: -32000, message: "Perspicax is unavailable" } } });
    h.failSignIn({ ok: false, error: "unreachable" });
    h.advance(900_000);
    await h.mcp.relay({ ...turn, botId: "x" , frame: { jsonrpc: "2.0", id: 2, method: "tools/list" } });
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
function sessionServer(tools?: unknown[]) {
  const live = new Set<string>();
  let opened = 0;
  const ran: string[] = [];
  const mcp = ({ headers, body, method }: { headers: Record<string, string>; body: any; method: string }): Response => {
    if (method === "DELETE") return new Response(null, { status: 204 });
    if (body.method === "initialize") {
      const previous = headers["mcp-session-id"];
      if (previous && !live.has(previous)) return new Response("Not Found: Session not found", { status: 404 });
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
    if (body.method === "tools/list" && tools) {
      ran.push("tools/list");
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { tools } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { ok: true, session } }), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { mcp, live, ran, opened: () => opened, forget: () => live.clear() };
}

describe("PerspicaxMcp: a session Perspicax dropped", () => {
  const call = (name: string, id: number) => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: {} } });
  const init = { jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "grok", version: "1" } } };

  async function started(tools?: unknown[]) {
    const server = sessionServer(tools);
    const h = harness({ mcp: server.mcp });
    await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
    await h.mcp.relay({ ...turn, botId: "x" , frame: init });
    await h.mcp.relay({ ...turn, botId: "x" , frame: { jsonrpc: "2.0", method: "notifications/initialized" } });
    return { server, h, relay: (frame: unknown, generation = turn.generation) => h.mcp.relay({ threadId: turn.threadId, generation, botId: "x", frame }) };
  }

  it("classifies the losses and the replayable frames", () => {
    expect(perspicaxSessionLost(404, "Not Found: Session not found")).toBe(true);
    expect(perspicaxSessionLost(422, "Unexpected message, expect initialize request")).toBe(true);
    expect(perspicaxSessionLost(422, "something else")).toBe(false);
    expect(perspicaxSessionLost(500, "")).toBe(false);
    expect(perspicaxReplayable(call("cw_psa_query", 1))).toBe(true);
    expect(perspicaxReplayable(call("memory_search", 1))).toBe(true);
    expect(perspicaxReplayable(call("memory_find", 1))).toBe(true);
    expect(perspicaxReplayable({ jsonrpc: "2.0", id: 1, method: "tools/list" })).toBe(true);
    for (const name of ["cw_psa_write", "cw_psa_action", "memory_write", "memory_save", "memory_remove", "memory_suggestions", "sagax_send", "unknown"]) {
      expect(perspicaxReplayable(call(name, 1)), name).toBe(false);
    }
    // a Flow action writes only on a confirmed call: without confirm it reads
    expect(perspicaxReplayable(call("flow_action", 1))).toBe(true);
    expect(perspicaxReplayable({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "flow_action", arguments: { name: "free-slot-find", params: { member: "osprey", minutes: 60 } } } })).toBe(true);
    expect(perspicaxReplayable({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "flow_action", arguments: { name: "schedule-slot-create", params: {}, confirm: true } } })).toBe(false);
    // what Perspicax lists as read-only
    const readOnly = new Set(["cw_psa_find_schedule_entries"]);
    expect(perspicaxReplayable(call("cw_psa_find_schedule_entries", 1))).toBe(false);
    expect(perspicaxReplayable(call("cw_psa_find_schedule_entries", 1), readOnly)).toBe(true);
    expect(perspicaxReplayable(call("cw_psa_update_ticket", 1), readOnly)).toBe(false);
  });

  const LISTED = [
    { name: "cw_psa_find_schedule_entries", annotations: { readOnlyHint: true, destructiveHint: false } },
    { name: "cw_psa_get_ticket", annotations: { readOnlyHint: true, destructiveHint: false } },
    { name: "cw_psa_update_ticket", annotations: { readOnlyHint: false, destructiveHint: true } },
    { name: "odd_tool", annotations: { readOnlyHint: true, destructiveHint: true } },
    { name: "bare_tool" },
  ];

  it("reads which tools only read from tools/list annotations, never a destructive or unannotated one", () => {
    expect(perspicaxReadOnlyToolsOf({ jsonrpc: "2.0", id: 1, result: { tools: LISTED } })).toEqual(["cw_psa_find_schedule_entries", "cw_psa_get_ticket"]);
    expect(perspicaxReadOnlyToolsOf({ result: {} })).toEqual([]);
    expect(perspicaxReadOnlyToolsOf(null)).toEqual([]);
  });

  // 2026-11-03 (production): find_schedule_entries, get_ticket and flow_action
  // free-slot-find were all refused "can change data" after a dropped session
  it("404 on a read Perspicax listed as read-only: sends it again on the new session", async () => {
    const { server, h, relay } = await started(LISTED);
    await relay({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    server.forget();
    const answer = await relay({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "cw_psa_find_schedule_entries", arguments: { member: "Osprey", period: "this_week", limit: 100 } } });
    expect(answer).toMatchObject({ status: 200, body: { id: 5, result: { ok: true, session: "s-2" } } });
    // The old session's annotations are role/session state too. Re-list on
    // the replacement before deciding this vendor call is still replayable.
    expect(server.ran).toEqual(["tools/list", "tools/list", "cw_psa_find_schedule_entries"]);
    expect(h.logs.join("\n")).toContain("read sent again");
  });

  it("404 on a read before this entry saw tools/list: lists on the new session, then sends the read again", async () => {
    const { server, relay } = await started(LISTED);
    server.forget();
    const answer = await relay(call("cw_psa_get_ticket", 6));
    expect(answer).toMatchObject({ status: 200, body: { id: 6, result: { ok: true } } });
    expect(server.ran).toEqual(["tools/list", "cw_psa_get_ticket"]);
  });

  it("404 on a write listed by Perspicax: still never replayed", async () => {
    const { server, relay } = await started(LISTED);
    server.forget();
    const answer = await relay(call("cw_psa_update_ticket", 7));
    expect(answer).toEqual({ status: 200, body: { jsonrpc: "2.0", id: 7, error: { code: -32000, message: PERSPICAX_SESSION_RESET } } });
    expect(server.ran).toEqual(["tools/list"]);
  });

  it("404 on a Flow action without confirm is sent again; a confirmed one is not", async () => {
    const { server, relay } = await started();
    server.forget();
    const read = await relay({ jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "flow_action", arguments: { name: "free-slot-find", params: { member: "osprey", minutes: 60, days: 4, limit: 3 } } } });
    expect(read).toMatchObject({ status: 200, body: { id: 8, result: { ok: true } } });
    server.forget();
    const write = await relay({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "flow_action", arguments: { name: "schedule-slot-create", params: {}, confirm: true } } });
    expect(write).toEqual({ status: 200, body: { jsonrpc: "2.0", id: 9, error: { code: -32000, message: PERSPICAX_SESSION_RESET } } });
    expect(server.ran).toEqual(["flow_action"]);
  });

  it("404 on a read: opens a new session once and sends the read again, transparently", async () => {
    const { server, h, relay } = await started();
    server.forget();
    const answer = await relay(call("cw_psa_query", 5));
    expect(answer).toEqual({ status: 200, body: { jsonrpc: "2.0", id: 5, result: { ok: true, session: "s-2" } } });
    expect(server.opened()).toBe(2);
    expect(server.ran).toEqual(["cw_psa_query"]);
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

  it("cold engine initialize replaces the prewarmed session Perspicax expired", async () => {
    const server = sessionServer();
    const h = harness({ mcp: server.mcp });
    await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
    // Turn setup opens and lists beside a slow Cloud boot. Perspicax closes
    // that idle session before Codex starts its real MCP client.
    await h.mcp.ensureTurnSessions(turn.threadId, turn.generation);
    expect(server.opened()).toBe(1);
    server.forget();

    const answer = await h.mcp.relay({ ...turn, botId: "x", frame: { ...init, id: 41 } });

    expect(answer).toMatchObject({ status: 200, body: { id: 41, result: { protocolVersion: "2025-06-18" } } });
    expect(server.opened()).toBe(2);
    const initializeCalls = h.mcpCalls.filter((call) => call.body?.method === "initialize");
    expect(initializeCalls).toHaveLength(3);
    expect(initializeCalls.at(-1)?.headers["mcp-session-id"]).toBeUndefined();
    expect(h.mcpCalls.at(-1)).toMatchObject({ body: { method: "notifications/initialized" }, headers: { "mcp-session-id": "s-2" } });
  });

  it("404 on a write: opens a new session but never replays the write", async () => {
    const { server, h, relay } = await started();
    server.forget();
    const answer = await relay(call("cw_psa_write", 7));
    expect(answer).toEqual({ status: 200, body: { jsonrpc: "2.0", id: 7, error: { code: -32000, message: PERSPICAX_SESSION_RESET } } });
    expect(server.ran).toEqual([]);
    expect(h.mcpCalls.filter((c) => c.body?.params?.name === "cw_psa_write")).toHaveLength(1);
    expect(server.opened()).toBe(2);
    // the bot calls it again on its own: it runs, once
    await relay(call("cw_psa_write", 8));
    expect(server.ran).toEqual(["cw_psa_write"]);
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
    await relay(call("cw_psa_action", 10), "g2");
    expect(server.ran).toEqual(["api_search", "cw_psa_action"]);
  });

  it("422 with no initialize ever seen: opens a session with Sagax's own params and sends a read again", async () => {
    const server = sessionServer();
    const h = harness({ mcp: server.mcp });
    await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
    const answer = await h.mcp.relay({ ...turn, botId: "x" , frame: { jsonrpc: "2.0", id: 3, method: "tools/list" } });
    expect(answer).toMatchObject({ status: 200, body: { id: 3, result: { ok: true, session: "s-1" } } });
    expect(h.mcpCalls.find((c) => c.body?.method === "initialize")!.body.params.protocolVersion).toBe("2025-06-18");
    expect(h.logs.join("\n")).toContain("session lost (HTTP 422)");
  });

  it("concurrent calls on a dropped session share one new session", async () => {
    const { server, relay } = await started();
    server.forget();
    const answers = await Promise.all([relay(call("cw_psa_query", 11)), relay(call("memory_recall", 12)), relay(call("api_describe", 13))]);
    for (const answer of answers) expect(answer).toMatchObject({ status: 200, body: { result: { ok: true } } });
    expect(server.opened()).toBe(2);
    expect(server.ran.sort()).toEqual(["api_describe", "cw_psa_query", "memory_recall"]);
  });

  it("a new session Perspicax refuses surfaces the original status, once", async () => {
    const { server, h, relay } = await started();
    server.forget();
    server.live.add = () => server.live; // initialize answers, but no session ever becomes live
    const before = h.mcpCalls.length;
    const answer = await relay(call("cw_psa_query", 14));
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

  it("enforce judges the per-profile names Perspicax serves: a permitted cw_psa_query passes, a refused cw_psa_write is blocked", async () => {
    const rows: McpAuditRecord[] = [];
    const h = harness({ ...answerWith("done"), guard: guardFor("viewer", "enforce", rows) });
    await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
    const read = await h.mcp.relay({ ...turn, botId: "x" , frame: toolsCall("cw_psa_query", { resource: "companies" }, 8) });
    expect(read.body).toMatchObject({ id: 8, result: { content: [{ text: "done" }] } });
    const write = await h.mcp.relay({ ...turn, botId: "x" , frame: toolsCall("cw_psa_write", { resource: "companies", action: "update", id: 1, set: {} }) });
    expect(write.body).toMatchObject({ id: 9, result: { isError: true } });
    expect(JSON.stringify(write.body)).toContain("Permission denied: api:write");
    expect(relayed(h)).toEqual(["cw_psa_query"]);
    expect(rows.map((r) => [r.tool, r.permission, r.decision, r.resource])).toEqual([
      ["cw_psa_query", "api:query", "allowed", "cw_psa:companies.read"],
      ["cw_psa_write", "api:write", "denied", "cw_psa:companies.update"],
    ]);
  });

  // #4837: an unknown tool reads the whole catalog once, resolves, retries once
  type Fake = { pages: string[][]; stale?: Set<string>; lists: number; cursors: Array<string | undefined>; callOverride?: (name: string) => Response | undefined; loop?: boolean };
  const fake = (pages: string[][]): Fake => ({ pages, lists: 0, cursors: [] });
  const served = (state: Fake) => ({ mcp: ({ body }: { body: any }) => {
    const json = (payload: object) => new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, ...payload }), { status: 200, headers: { "content-type": "application/json", "mcp-session-id": "s" } });
    if (body.method === "tools/list") {
      state.lists += 1;
      const cursor = body.params?.cursor as string | undefined;
      state.cursors.push(cursor);
      const index = cursor ? Number(cursor.replace("p", "")) : 0;
      const names = state.pages[index] ?? [];
      const more = state.loop ? "p0" : index + 1 < state.pages.length ? `p${index + 1}` : undefined;
      return json({ result: { tools: names.map((name) => ({ name, annotations: { readOnlyHint: name.includes("query") } })), ...(more ? { nextCursor: more } : {}) } });
    }
    if (body.method !== "tools/call") return json({ result: {} });
    const name = body.params.name as string;
    const over = state.callOverride?.(name);
    if (over) return over;
    return state.stale?.has(name) || !state.pages.flat().includes(name)
      ? json({ error: { code: -32602, message: `Unknown tool: ${name}` } })
      : json({ result: { content: [{ type: "text", text: `ran ${name}` }] } });
  } });
  const callNames = (h: ReturnType<typeof harness>) => relayed(h);

  it("an unknown namespaced tool reads the catalog once and runs the one served name once", async () => {
    const state = fake([["cw_psa_query", "cw_psa_write"]]);
    const h = harness(served(state));
    await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
    const answer = await h.mcp.relay({ ...turn, botId: "x", frame: toolsCall("mcp__perspicax__cw_psa_query", { resource: "companies" }, 41) });
    expect(answer.body).toMatchObject({ id: 41, result: { content: [{ text: "ran cw_psa_query" }] } });
    expect(callNames(h)).toEqual(["mcp__perspicax__cw_psa_query", "cw_psa_query"]);
    expect(state.lists).toBe(1);
  });

  it("an unknown tool that the refreshed catalog serves under the exact same name is sent once more", async () => {
    const state = fake([["cw_psa_query"]]);
    state.stale = new Set(["cw_psa_query"]);
    let sent = 0;
    state.callOverride = (name) => (name === "cw_psa_query" && ++sent === 2 ? new Response(JSON.stringify({ jsonrpc: "2.0", id: 44, result: { content: [{ type: "text", text: "ran again" }] } }), { status: 200, headers: { "content-type": "application/json", "mcp-session-id": "s" } }) : undefined);
    const h = harness(served(state));
    await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
    const answer = await h.mcp.relay({ ...turn, botId: "x", frame: toolsCall("cw_psa_query", {}, 44) });
    expect(answer.body).toMatchObject({ result: { content: [{ text: "ran again" }] } });
    expect(callNames(h)).toEqual(["cw_psa_query", "cw_psa_query"]);
  });

  it("a retry that fails again answers with the close served names, resolved or not", async () => {
    const state = fake([["cw_psa_query", "cw_psa_query_list"]]);
    state.stale = new Set(["cw_psa_query"]);
    const h = harness(served(state));
    await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
    const answer = await h.mcp.relay({ ...turn, botId: "x", frame: toolsCall("cw_psa_query", {}, 45) });
    expect(JSON.stringify(answer.body)).toContain("Unknown tool: cw_psa_query");
    expect(JSON.stringify(answer.body)).toContain("Close served names: cw_psa_query");
    expect(callNames(h)).toEqual(["cw_psa_query", "cw_psa_query"]);
  });

  it("an unknown name that fits no served tool answers with the close served names and does not retry", async () => {
    const state = fake([["cw_psa_find_tickets", "cw_psa_find_companies", "cw_psa_write"]]);
    const h = harness(served(state));
    await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
    const answer = await h.mcp.relay({ ...turn, botId: "x", frame: toolsCall("cw_psa_list_tickets", {}, 42) });
    expect(JSON.stringify(answer.body)).toContain("Close served names: cw_psa_find_tickets");
    expect(callNames(h)).toEqual(["cw_psa_list_tickets"]);
  });

  it("an ambiguous name never falls through to a shorter suffix", async () => {
    const state = fake([["ns__query", "ns-query", "query"]]);
    const h = harness(served(state));
    await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
    const answer = await h.mcp.relay({ ...turn, botId: "x", frame: toolsCall("ns_query", {}, 46) });
    expect(JSON.stringify(answer.body)).toContain("Unknown tool");
    expect(callNames(h)).toEqual(["ns_query"]);
  });

  it("reads page two of the catalog and stops on a repeated cursor", async () => {
    const paged = fake([["cw_psa_find_tickets"], ["cw_psa_write", "cw_psa_query"]]);
    const h = harness(served(paged));
    await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
    const answer = await h.mcp.relay({ ...turn, botId: "x", frame: toolsCall("mcp__x__cw_psa_query", {}, 47) });
    expect(answer.body).toMatchObject({ result: { content: [{ text: "ran cw_psa_query" }] } });
    expect(paged.cursors).toEqual([undefined, "p1"]);

    const loop = fake([["cw_psa_query"]]);
    loop.loop = true;
    const g = harness(served(loop));
    await g.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
    const stuck = await g.mcp.relay({ ...turn, botId: "x", frame: toolsCall("mcp__x__cw_psa_query", {}, 48) });
    expect(JSON.stringify(stuck.body)).toContain("Unknown tool");
    expect(callNames(g)).toEqual(["mcp__x__cw_psa_query"]);
    expect(loop.lists).toBeLessThanOrEqual(3);
  });

  it("a resolved name the outer judge, the permissions or an off product refuse is never sent", async () => {
    const judged: string[] = [];
    const state = fake([["cw_psa_query", "cw_psa_write"]]);
    const judge = harness({ ...served(state), judge: async ({ asked, resolved }) => { judged.push(`${asked}>${resolved}`); return "Refused by the outer judge"; } });
    await judge.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
    const refused = await judge.mcp.relay({ ...turn, botId: "x", frame: toolsCall("mcp__x__cw_psa_query", {}, 49) });
    expect(JSON.stringify(refused.body)).toContain("Refused by the outer judge");
    expect(judged).toEqual(["mcp__x__cw_psa_query>cw_psa_query"]);
    expect(callNames(judge)).toEqual(["mcp__x__cw_psa_query"]);

    const rows: McpAuditRecord[] = [];
    const guarded = harness({ ...served(fake([["cw_psa_query", "cw_psa_write"]])), guard: ({ botId }) => ({ principal: { id: "p", role: "viewer" }, mode: "enforce", ownBotId: botId, audit: (r) => rows.push(r), deniedResources: [] }) });
    await guarded.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
    const denied = await guarded.mcp.relay({ ...turn, botId: "x", frame: toolsCall("mcp__x__cw_psa_write", { resource: "companies", action: "update", id: 1, set: {} }, 50) });
    expect(JSON.stringify(denied.body)).toContain("Permission denied");
    expect(relayed(guarded)).not.toContain("cw_psa_write");
  });

  it("never retries a failure that only mentions an unknown tool inside a longer or structured answer", async () => {
    const state = fake([["flow_run", "cw_psa_query"]]);
    state.callOverride = (name) => name === "flow_run"
      ? new Response(JSON.stringify({ jsonrpc: "2.0", id: 51, result: { isError: true, content: [{ type: "text", text: "step 2 failed: Unknown tool: flow_run after the write ran" }], structuredContent: { steps: [] } } }), { status: 200, headers: { "content-type": "application/json", "mcp-session-id": "s" } })
      : undefined;
    const h = harness(served(state));
    await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
    const answer = await h.mcp.relay({ ...turn, botId: "x", frame: toolsCall("flow_run", {}, 51) });
    expect(JSON.stringify(answer.body)).toContain("after the write ran");
    expect(callNames(h)).toEqual(["flow_run"]);
    expect(state.lists).toBe(0);
  });

  it("enforce passes the meta-tools of Perspicax 1.8.28 by their real names", async () => {
    const rows: McpAuditRecord[] = [];
    const h = harness({ ...answerWith("ok"), guard: guardFor("member", "enforce", rows) });
    await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
    const names = ["api_list", "api_search", "api_describe", "api_result_query", "api_lookup", "api_plan", "identity", "flow", "flow_action", "memory_recall"];
    for (const [i, name] of names.entries()) {
      const answer = await h.mcp.relay({ ...turn, botId: "x" , frame: toolsCall(name, {}, 20 + i) });
      expect(answer.body, name).toMatchObject({ result: { content: [{ text: "ok" }] } });
    }
    expect(relayed(h)).toEqual(names);
    expect(rows.every((r) => r.decision === "allowed")).toBe(true);
  });

  it("the telephony guard refuses a bot's own call or number purchase before it leaves, never a harness call", async () => {
    const h = harness(answerWith("done"));
    await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
    const bought = await h.mcp.relay({ ...turn, botId: "x" , frame: toolsCall("twilio_api_write", { resource: "IncomingPhoneNumbers", action: "create", set: { PhoneNumber: "+15145550142" } }, 30) });
    expect(bought.body).toMatchObject({ id: 30, result: { isError: true } });
    expect(JSON.stringify(bought.body)).toContain("never buys");
    const called = await h.mcp.relay({ ...turn, botId: "x" , frame: toolsCall("twilio_api_write", { resource: "Calls", action: "create", set: { To: "+15145550142", Url: "https://x.test" } }, 31) });
    expect(JSON.stringify(called.body)).toContain("place_phone_call");
    expect(relayed(h)).toEqual([]);
    const harnessCall = await h.mcp.relay({ ...turn, botId: "x" , frame: toolsCall("twilio_api_write", { resource: "Calls", action: "create", set: {} }, 32), judged: true });
    expect(harnessCall.body).toMatchObject({ id: 32, result: { content: [{ text: "done" }] } });
    expect(relayed(h)).toEqual(["twilio_api_write"]);
  });

  it("refuses a tools/call without an id, and guards a Twilio catalog named otherwise (re-review)", async () => {
    const h = harness({ mcp: ({ body }: { body: any }) => body.method === "tools/list"
      ? new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { tools: [{ name: "sms_gateway__write", description: "Write to the Twilio REST API (api.twilio.com)" }, { name: "cw_psa_write", description: "ConnectWise" }] } }), { status: 200, headers: { "content-type": "application/json", "mcp-session-id": "s" } })
      : new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: "done" }] } }), { status: 200, headers: { "content-type": "application/json", "mcp-session-id": "s" } }) });
    await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
    const noId = await h.mcp.relay({ ...turn, botId: "x" , frame: { jsonrpc: "2.0", method: "tools/call", params: { name: "cw_psa_query", arguments: {} } } });
    expect(noId.status).toBe(400);
    await h.mcp.relay({ ...turn, botId: "x" , frame: { jsonrpc: "2.0", id: 40, method: "tools/list" } });
    const aliased = await h.mcp.relay({ ...turn, botId: "x" , frame: toolsCall("sms_gateway__write", { resource: "Calls", action: "create" }, 41) });
    expect(JSON.stringify(aliased.body)).toContain("place_phone_call");
    const other = await h.mcp.relay({ ...turn, botId: "x" , frame: toolsCall("cw_psa_write", { resource: "companies", action: "update" }, 42) });
    expect(other.body).toMatchObject({ id: 42, result: { content: [{ text: "done" }] } });
  });

  it("a bot's own line tools reach the gateway when its tools/list names the vendor; a raw number write does not (#3603)", async () => {
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json", "mcp-session-id": "s" } });
    const h = harness({ mcp: ({ body }: { body: any }) => body.method === "tools/list"
      ? json({ jsonrpc: "2.0", id: body.id, result: { tools: [...voiceFixture.tools, { name: "twilio_api_write", description: "Write to the Twilio REST API" }] } })
      : json({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: "sent" }] } }) });
    await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
    await h.mcp.relay({ ...turn, botId: "x", frame: { jsonrpc: "2.0", id: 50, method: "tools/list" } });
    const sms = await h.mcp.relay({ ...turn, botId: "x", frame: toolsCall("voice_sms", { to: "+15145550142", body: "On arrive jeudi." }, 51) });
    expect(sms.body).toMatchObject({ id: 51, result: { content: [{ text: "sent" }] } });
    const number = await h.mcp.relay({ ...turn, botId: "x", frame: toolsCall("voice_number", { action: "verify", phone_number: "+15145550143" }, 52) });
    expect(number.body).toMatchObject({ id: 52, result: { content: [{ text: "sent" }] } });
    const code = await h.mcp.relay({ ...turn, botId: "x", frame: toolsCall("voice_client_code", { action: "send", phone: "+15145550144" }, 53) });
    expect(code.body).toMatchObject({ id: 53, result: { content: [{ text: "sent" }] } });
    const raw = await h.mcp.relay({ ...turn, botId: "x", frame: toolsCall("twilio_api_write", { resource: "IncomingPhoneNumbers", action: "create" }, 54) });
    expect(JSON.stringify(raw.body)).toContain("never buys");
    expect(h.mcpCalls.filter((c) => c.body?.method === "tools/call").map((c) => c.body.params.name)).toEqual(["voice_sms", "voice_number", "voice_client_code"]);
  });

  it("shadow lets a denial through and audits only the denial", async () => {
    const rows: McpAuditRecord[] = [];
    const h = harness({ ...answerWith("done"), guard: guardFor("viewer", "shadow", rows) });
    await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
    await h.mcp.relay({ ...turn, botId: "x" , frame: toolsCall("cw_psa_query", { resource: "companies" }, 8) });
    const answer = await h.mcp.relay({ ...turn, botId: "x" , frame: toolsCall("cw_psa_write", { resource: "companies", action: "update" }) });
    expect(answer.body).toMatchObject({ result: { content: [{ text: "done" }] } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tool: "cw_psa_write", decision: "denied", enforced: false });
  });

  it("a per-resource deny refuses cw_psa:tickets.update for a role that may write", async () => {
    const rows: McpAuditRecord[] = [];
    const h = harness({ ...answerWith("done"), guard: guardFor("operator", "enforce", rows) });
    await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
    const denied = await h.mcp.relay({ ...turn, botId: "x" , frame: toolsCall("cw_psa_write", { resource: "tickets", action: "update" }) });
    expect(JSON.stringify(denied.body)).toContain("cw_psa:tickets.update");
    const allowed = await h.mcp.relay({ ...turn, botId: "x" , frame: toolsCall("cw_psa_write", { resource: "contacts", action: "update" }, 10) });
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
    await h.mcp.relay({ ...turn, botId: "x" , frame: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
    await h.mcp.relay({ ...turn, botId: "x" , frame: { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "api_search", arguments: {} } } });
    const answer = await h.mcp.relay({ ...turn, botId: "x" , frame: { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "remote_support_status", arguments: { code: "BQDHS7" } } } });
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

describe("PerspicaxMcp product key state (#4185)", () => {
  const keyMissing = { code: "auth_unavailable", message: "no usable key", hint: "", details: { product: "acme_psa", key_state: "key_missing" } };
  const mcpAnswering = (result: Record<string, unknown>) => ({ body }: { body: any }) => {
    if (body.id === undefined) return new Response(null, { status: 202 });
    const answer = body.method === "tools/call" ? result : { tools: [] };
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: answer }), { status: 200, headers: { "content-type": "application/json", "mcp-session-id": "sess-1" } });
  };

  it("a product tool refused for a key state raises the card through the hook and tells the bot in one more sentence", async () => {
    const seen: unknown[] = [];
    const h = harness({
      productKeyState: async (turnInfo, state) => { seen.push({ turnInfo, state }); return "A secure card for Acme PSA was shown to the person. End this turn now."; },
      mcp: mcpAnswering({ isError: true, structuredContent: keyMissing, content: [{ type: "text", text: JSON.stringify(keyMissing) }] }),
    });
    await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
    const answer = await h.mcp.relay({ ...turn, botId: "x", frame: { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "cw_psa_query", arguments: {} } } });
    expect(seen).toEqual([{ turnInfo: { threadId: "t1", botId: "x", principalId: "pr_bob", routine: false }, state: { product: "acme_psa", keyState: "key_missing" } }]);
    const content = (answer.body as { result: { isError: boolean; content: Array<{ text: string }> } }).result;
    expect(content.isError).toBe(true);
    expect(content.content).toHaveLength(2);
    expect(content.content[1]!.text).toMatch(/secure card for Acme PSA/);
  });

  it("leaves the answer unchanged when nothing was raised, the hook fails, or the error carries no key state", async () => {
    let calls = 0;
    const plain = { code: "upstream_error", message: "boom", details: {} };
    for (const [result, hook] of [
      [{ isError: true, structuredContent: keyMissing, content: [{ type: "text", text: "x" }] }, async () => { calls++; return null; }],
      [{ isError: true, structuredContent: keyMissing, content: [{ type: "text", text: "x" }] }, async () => { calls++; throw new Error("never changes the answer"); }],
      [{ isError: true, structuredContent: plain, content: [{ type: "text", text: "x" }] }, async () => { calls++; return "never"; }],
    ] as const) {
      const h = harness({ productKeyState: hook, mcp: mcpAnswering(result as Record<string, unknown>) });
      await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
      const answer = await h.mcp.relay({ ...turn, botId: "x", frame: { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "cw_psa_query", arguments: {} } } });
      expect((answer.body as { result: { content: unknown[] } }).result.content).toHaveLength(1);
    }
    expect(calls).toBe(2);
  });
});

describe("PerspicaxMcp records on a tool result (#4507)", () => {
  // invented product and records; the console's own metadata shape
  const answering = (result: Record<string, unknown>) => ({ body }: { body: any }) => {
    if (body.id === undefined) return new Response(null, { status: 202 });
    const answer = body.method === "tools/call" ? result : { tools: [] };
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: answer }), { status: 200, headers: { "content-type": "application/json", "mcp-session-id": "sess-1" } });
  };
  const content = [{ type: "text", text: JSON.stringify({ id: 481516, summary: "Imprimante hors ligne" }) }];
  const records = { "pulsatrix/records": [{ product: "nimbus_desk", kind: "ticket", records: [{ id: "481516", label: "#481516" }], more: 0 }] };
  const call = (id: number) => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name: "nimbus_desk_query", arguments: {} } });

  it("hands the records to the hook and appends its one line after the result", async () => {
    const seen: unknown[] = [];
    const h = harness({
      records: async (turnInfo, groups) => { seen.push({ turnInfo, groups }); return "Mention it as [#481516](sagax://record/nimbus_desk/ticket/481516)."; },
      mcp: answering({ content, _meta: records }),
    });
    await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
    const answer = await h.mcp.relay({ ...turn, botId: "x", frame: call(7) });
    expect(seen).toEqual([{ turnInfo: { threadId: "t1", generation: "g1", botId: "x", principalId: "pr_bob" }, groups: records["pulsatrix/records"] }]);
    const result = (answer.body as { result: { content: Array<{ type: string; text: string }> } }).result;
    expect(result.content).toEqual([...content, { type: "text", text: "Mention it as [#481516](sagax://record/nimbus_desk/ticket/481516)." }]);
  });

  it("puts the line in the structured result too, the copy a Claude bot reads instead of the text", async () => {
    const structuredContent = { items: [{ id: 481516, summary: "Imprimante hors ligne" }], next: null };
    const h = harness({
      records: async () => "Mention it as [#481516](sagax://record/nimbus_desk/ticket/481516).",
      mcp: answering({ content, structuredContent, _meta: records }),
    });
    await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
    const answer = await h.mcp.relay({ ...turn, botId: "x", frame: call(8) });
    const result = (answer.body as { result: { structuredContent: Record<string, unknown> } }).result;
    expect(result.structuredContent).toEqual({ ...structuredContent, _sagax_note: "Mention it as [#481516](sagax://record/nimbus_desk/ticket/481516)." });
  });

  it("sends every console tool's arguments with each record link reduced to its label", async () => {
    const h = harness({ mcp: answering({ content }) });
    await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
    const args = { to: "+15550100", body: "Votre billet [#481516](sagax://record/nimbus_desk/ticket/481516) est fermé." };
    await h.mcp.relay({ ...turn, botId: "x", frame: { jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "nimbus_messaging_send_message", arguments: args } } });
    const sent = h.mcpCalls.find((entry) => entry.body?.method === "tools/call" && entry.body.id === 9)!;
    expect(sent.body.params.arguments).toEqual({ to: "+15550100", body: "Votre billet #481516 est fermé." });
    // every console tool: a write (a ticket note), a memory write, a query
    const rows: Array<[string, Record<string, unknown>, Record<string, unknown>]> = [
      ["nimbus_desk_write", { resource: "ticket_notes", set: { text: "Suivi de [#481516](sagax://record/nimbus_desk/ticket/481516)." } }, { resource: "ticket_notes", set: { text: "Suivi de #481516." } }],
      ["memory_write", { text: "Le client attend [#481516](sagax://record/nimbus_desk/ticket/481516)" }, { text: "Le client attend #481516" }],
      ["nimbus_desk_query", { q: "[#1](sagax://record/nimbus_desk/ticket/1)", limit: 5 }, { q: "#1", limit: 5 }],
      ["nimbus_desk_query", { q: "plain words", limit: 5 }, { q: "plain words", limit: 5 }],
    ];
    let id = 10;
    for (const [name, args, expected] of rows) {
      id += 1;
      await h.mcp.relay({ ...turn, botId: "x", frame: { jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } } });
      expect(h.mcpCalls.find((entry) => entry.body?.id === id)!.body.params.arguments, name).toEqual(expected);
    }
  });

  it("names the person a turn was started for, not whoever speaks into it later", async () => {
    const h = harness({ mcp: answering({ content }) });
    await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: ALICE, speakerOrigin: "person" });
    expect(h.mcp.turnPersonOf("t1", "x")).toBe(ALICE);
    await h.mcp.endGeneration("t1", "g1");
    expect(h.mcp.turnPersonOf("t1", "x")).toBe(ALICE);
    await h.mcp.prepareTurn({ threadId: "t1", generation: "g2", bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
    expect(h.mcp.turnPersonOf("t1", "x")).toBe(BOB);
    expect(h.mcp.turnPersonOf("t2", "x")).toBeUndefined();
    await h.mcp.endAll();
  });

  it("leaves a result without the metadata, an error, a mapping call and a failing hook byte for byte unchanged", async () => {
    let calls = 0;
    for (const [result, hook, mapping] of [
      [{ content }, async () => { calls++; return "never"; }, false],
      [{ content, _meta: { other: true } }, async () => { calls++; return "never"; }, false],
      [{ isError: true, content, _meta: records }, async () => { calls++; return "never"; }, false],
      [{ content, _meta: records }, async () => { calls++; return "never"; }, true],
      [{ content, _meta: records }, async () => { calls++; throw new Error("never changes the answer"); }, false],
      [{ content, _meta: records }, async () => { calls++; return null; }, false],
    ] as const) {
      const h = harness({ records: hook, mcp: answering(result as Record<string, unknown>) });
      await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
      const answer = await h.mcp.relay({ ...turn, botId: "x", frame: call(8), ...(mapping ? { mapping: true } : {}) });
      expect(JSON.stringify((answer.body as { result: unknown }).result)).toBe(JSON.stringify(result));
    }
    expect(calls).toBe(2);
  });
});

describe("PerspicaxMcp products off for one bot (#4359)", () => {
  // The real shapes: a product id is the api_list id; a family (`group`)
  // shares its tools, whose names never start with a product id.
  const tools = [
    "cw_psa_query", "cw_psa_write", "cw_psa_action", "cw_psa_find_tickets", "cw_psa_log_time", "flow_action", "flow_filter",
    "edrtool_query", "twilio_api_query", "memory_recall", "api_search", "api_describe",
  ].map((name) => ({ name, inputSchema: { type: "object" } }));
  const family = (id: string, title: string) => ({ id, group: "cw_psa", title: `Connectwise Manage Public Endpoints: ${title}` });
  const listValue = {
    apis: [
      family("cw_psa_service", "service"), family("cw_psa_time", "time"), family("cw_psa_finance", "finance"), family("cw_psa_project", "project"),
      { id: "cw_rmm", title: "ConnectWise Platform APIs" }, { id: "edrtool", title: "S1 MGMT API" }, { id: "twilio_api", title: "Twilio - Api" },
    ],
  };
  const searchValue = { results: [{ api: "cw_psa_service", tool: "cw_psa_query", op_id: "getServiceTickets" }, { api: "cw_psa_finance", tool: "cw_psa_query", op_id: "getFinanceAgreements" }, { api: "edrtool", tool: "edrtool_query", op_id: "agents" }], total: 3 };
  // Perspicax's own mapping (api_describe), as it answers live
  const described: Record<string, unknown> = {
    "service.tickets": { api: "cw_psa_service", resource: "tickets" },
    "service.tickets_write": { api: "cw_psa_service", resource: "tickets" },
    agreements: { api: "cw_psa_finance", resource: "agreements" },
    sheets_approve: { api: "cw_psa_time", op_id: "postTimeSheetsByIdApprove" },
    cw_psa_find_tickets: { kind: "task", target: "cw_psa_service/tickets", tool: "cw_psa_find_tickets" },
    cw_psa_log_time: { kind: "task", target: "cw_psa_time/entries", tool: "cw_psa_log_time" },
    cw_psa_update_ticket: { kind: "task", target: "cw_psa_service/tickets", tool: "cw_psa_update_ticket" },
  };
  // Perspicax's own card of a Flow action or routine (`flow` describe)
  const flowCards: Record<string, unknown> = {
    close_ticket: { action: { name: "close_ticket", tools: ["cw_psa_find_tickets", "cw_psa_update_ticket"], products: ["connectwise"] } },
    "time-entry-log": { action: { name: "time-entry-log", tools: ["cw_psa_log_time"], products: ["connectwise"] } },
    "isolate-endpoint": { action: { name: "isolate-endpoint", tools: ["cw_psa_log_time", "edrtool__write"], products: ["edrtool", "connectwise"] } },
    "threat-watch": { routine: { name: "threat-watch", server_profiles: ["watch"], steps: "1. List open threats with edrtool_query.\n2. Log the time with cw_psa_log_time." } },
  };
  const ambiguous = { code: "params_invalid", details: { apis: ["cw_psa_project", "cw_psa_service", "cw_rmm"], status: 400 }, message: "tickets is found in 3 apis" };
  const answering = ({ body }: { body: any }) => {
    if (body.id === undefined) return new Response(null, { status: 202 });
    const name = body.params?.name;
    const op = body.params?.arguments?.op_id;
    let result: unknown;
    if (body.method === "tools/list") result = { tools };
    else if (name === "flow") result = { content: [{ type: "text", text: JSON.stringify(flowCards[body.params?.arguments?.args?.name] ?? { status: "blocked", reason: "routine_not_in_pack" }) }] };
    else if (name === "api_describe" && op === "tickets") result = { isError: true, content: [{ type: "text", text: JSON.stringify(ambiguous) }] };
    else if (name === "identity") {
      // Perspicax sweeps the asked apis, else every served one
      const asked: string[] | undefined = body.params?.arguments?.apis;
      const swept = listValue.apis.map((api) => api.id).filter((id) => !asked?.length || asked.includes(id));
      const value = { query: body.params?.arguments?.query, matches: swept.map((api) => ({ api, resource: "devices", field: "name", items: [{ id: 1 }] })), lookups: swept.map((api) => ({ api, type: "status", entries: [] })), errors: [], calls: swept.length };
      result = { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value };
    }
    else {
      const value = name === "api_search" ? searchValue : name === "api_list" ? listValue : name === "api_describe" ? described[op] ?? { api: "cw_rmm" } : { ok: true };
      result = { content: [{ type: "text", text: JSON.stringify(value) }] };
    }
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), { status: 200, headers: { "content-type": "application/json", "mcp-session-id": "sess-1" } });
  };
  const offFor = (ids: string[]) => (botId: string) => (botId === "x" ? new Set(ids) : null);
  const called = (h: ReturnType<typeof harness>, name: string) => h.mcpCalls.filter((c) => c.body?.method === "tools/call" && c.body.params?.name === name).length;
  const call = (h: ReturnType<typeof harness>, id: number, name: string, args: Record<string, unknown> = {}) =>
    h.mcp.relay({ ...turn, botId: "x", frame: { jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } } });
  const refused = (answer: { body?: unknown }) => (answer.body as any).result?.isError === true && /off for this bot/.test((answer.body as any).result.content[0].text);
  const ready = async (off: string[]) => {
    const h = harness({ mcp: answering, botProductsOff: offFor(off) });
    await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
    return h;
  };

  it("refuses a family call whose resource is an off product, by Perspicax's mapping, and lets the family's other products through", async () => {
    const h = await ready(["cw_psa_service"]);
    const query = await call(h, 1, "cw_psa_query", { resource: "service.tickets" });
    expect(refused(query)).toBe(true);
    expect((query.body as any).result.content[0].text).toMatch(/^Connectwise Manage Public Endpoints: service is off for this bot/);
    expect((query.body as any).result.content[0].text).toContain('{"cw_psa_service": true}');
    expect(refused(await call(h, 2, "cw_psa_write", { resource: "service.tickets", action: "update", id: 1, set: {} }))).toBe(true);
    expect(refused(await call(h, 3, "cw_psa_query", { resource: "tickets" }))).toBe(true);
    expect(refused(await call(h, 4, "cw_psa_find_tickets", { state: "open" }))).toBe(true);
    expect(refused(await call(h, 5, "api_plan", { steps: [{ tool: "cw_psa_query", args: { resource: "agreements" } }, { tool: "cw_psa_query", args: { resource: "service.tickets" } }] }))).toBe(true);
    expect(refused(await call(h, 6, "flow_action", { name: "close_ticket", params: {} }))).toBe(true);
    expect(called(h, "cw_psa_query")).toBe(0);
    expect(called(h, "cw_psa_write")).toBe(0);
    expect(called(h, "cw_psa_find_tickets")).toBe(0);
    expect(called(h, "flow_action")).toBe(0);
    // the family's other products, and its compute tools, go through
    expect(refused(await call(h, 7, "cw_psa_query", { resource: "agreements" }))).toBe(false);
    expect(refused(await call(h, 8, "cw_psa_log_time", { ticket: "1" }))).toBe(false);
    expect(refused(await call(h, 9, "cw_psa_action", { action: "sheets_approve", id: 1 }))).toBe(false);
    expect(refused(await call(h, 10, "flow_filter", { items: [] }))).toBe(false);
    expect(called(h, "cw_psa_query")).toBe(1);
    expect(called(h, "cw_psa_log_time")).toBe(1);
    expect(called(h, "cw_psa_action")).toBe(1);
    // describing it is refused like a call
    expect(refused(await call(h, 11, "api_describe", { op_id: "service.tickets" }))).toBe(true);
    expect(refused(await call(h, 12, "api_describe", { op_id: "cw_psa_find_tickets" }))).toBe(true);
  });

  it("resolves a Flow action or routine by Perspicax's card of it: refused when it reaches an off product outside the family, let through when only an unrelated family product is off", async () => {
    const h = await ready(["edrtool"]);
    expect(refused(await call(h, 1, "flow_action", { name: "isolate-endpoint", params: {} }))).toBe(true);
    expect(refused(await call(h, 2, "flow_run", { command: "run.init", args: { routine: "threat-watch" } }))).toBe(true);
    expect(refused(await call(h, 3, "flow_action", { name: "time-entry-log", params: {} }))).toBe(false);
    expect(called(h, "flow_action")).toBe(1);
    expect(called(h, "flow_run")).toBe(0);
    // the card is read once per name, kept with the bot's api_list
    await call(h, 4, "flow_action", { name: "isolate-endpoint", params: {} });
    expect(h.mcpCalls.filter((c) => c.body?.params?.name === "flow" && c.body.params.arguments?.args?.name === "isolate-endpoint")).toHaveLength(1);

    const k = await ready(["cw_psa_finance"]);
    expect(refused(await call(k, 1, "flow_action", { name: "close_ticket", params: {} }))).toBe(false);
    expect(refused(await call(k, 2, "flow_action", { name: "time-entry-log", params: {} }))).toBe(false);
    expect(refused(await call(k, 3, "flow_run", { command: "status" }))).toBe(false);
    expect(called(k, "flow_action")).toBe(2);
    expect(called(k, "flow_run")).toBe(1);
    // Flow's tools stay listed: only a run that reaches an off product is refused
    const listed = await k.mcp.relay({ ...turn, botId: "x", frame: { jsonrpc: "2.0", id: 9, method: "tools/list" } });
    expect((listed.body as any).result.tools.map((tool: { name: string }) => tool.name)).toContain("flow_action");
  });

  it("leaves an off product's tools out of the list (a family's task tools too) and its search results, and marks it in api_list", async () => {
    const h = await ready(["cw_psa_service", "edrtool"]);
    const listed = await h.mcp.relay({ ...turn, botId: "x", frame: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
    expect((listed.body as any).result.tools.map((tool: { name: string }) => tool.name)).toEqual([
      "cw_psa_query", "cw_psa_write", "cw_psa_action", "cw_psa_log_time", "flow_action", "flow_filter", "twilio_api_query", "memory_recall", "api_search", "api_describe",
    ]);
    const search = await call(h, 2, "api_search", { query: "tickets" });
    expect(JSON.parse((search.body as any).result.content[0].text).results.map((r: { api: string }) => r.api)).toEqual(["cw_psa_finance"]);
    const apis = await call(h, 3, "api_list");
    const value = JSON.parse((apis.body as any).result.content[0].text);
    expect(value.apis.filter((api: { off_for_this_bot?: boolean }) => api.off_for_this_bot).map((api: { id: string }) => api.id)).toEqual(["cw_psa_service", "edrtool"]);
    expect(refused(await call(h, 4, "edrtool_query", { resource: "agents" }))).toBe(true);
    expect(called(h, "edrtool_query")).toBe(0);
  });

  it("drops the family's shared tools when every product of it is off", async () => {
    const h = await ready(["cw_psa_service", "cw_psa_time", "cw_psa_finance", "cw_psa_project"]);
    const listed = await h.mcp.relay({ ...turn, botId: "x", frame: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
    expect((listed.body as any).result.tools.map((tool: { name: string }) => tool.name)).toEqual(["flow_action", "flow_filter", "edrtool_query", "twilio_api_query", "memory_recall", "api_search", "api_describe"]);
    expect(refused(await call(h, 2, "cw_psa_query", {}))).toBe(true);
  });

  it("refuses the native path (callTool) the same way, and says how to turn it on", async () => {
    const h = await ready(["twilio_api"]);
    const native = await h.mcp.callTool({ ...turn, botId: "x", name: "twilio_api_query", args: {} });
    expect(native).toMatchObject({ ok: true, isError: true });
    expect(called(h, "twilio_api_query")).toBe(0);
    const answer = await call(h, 1, "twilio_api_query");
    expect((answer.body as any).result.content[0].text).toMatch(/sagax_settings set bot\.products with \{"twilio_api": true\}/);
  });

  it("takes an off product out of an identity sweep: its apis, the served ones when it names none, an api_plan step, and the answer", async () => {
    const h = await ready(["cw_psa_service", "edrtool"]);
    const sweptApis = () => h.mcpCalls.filter((c) => c.body?.params?.name === "identity").map((c) => c.body.params.arguments.apis);
    const answeredApis = (answer: { body?: unknown }) => JSON.parse((answer.body as any).result.content[0].text).matches.map((m: { api: string }) => m.api).sort();
    const served = ["cw_psa_finance", "cw_psa_project", "cw_psa_time", "cw_rmm", "twilio_api"];
    // no apis: the served ones minus the off ones
    const all = await call(h, 1, "identity", { query: "host-123" });
    expect(refused(all)).toBe(false);
    expect([...sweptApis()[0]].sort()).toEqual(served);
    expect(answeredApis(all)).toEqual(served);
    expect(JSON.stringify((all.body as any).result.structuredContent)).not.toMatch(/edrtool|cw_psa_service/);
    // apis naming an off product: it is dropped, the others are swept
    const some = await call(h, 2, "identity", { query: "host-123", apis: ["edrtool", "twilio_api"] });
    expect(sweptApis()[1]).toEqual(["twilio_api"]);
    expect(answeredApis(some)).toEqual(["twilio_api"]);
    // apis naming only off products: refused, nothing swept
    const off = await call(h, 3, "identity", { query: "host-123", apis: ["edrtool"] });
    expect(refused(off)).toBe(true);
    expect((off.body as any).result.content[0].text).toMatch(/^S1 MGMT API is off for this bot/);
    expect(called(h, "identity")).toBe(2);
    // an api_plan step sweeps the same way
    await call(h, 4, "api_plan", { steps: [{ tool: "identity", args: { query: "host-123" } }] });
    const plan = h.mcpCalls.filter((c) => c.body?.params?.name === "api_plan").at(-1)!;
    expect([...plan.body.params.arguments.steps[0].args.apis].sort()).toEqual(served);
  });

  it("drops an off product's rows from an identity answer even when the sweep reached it", async () => {
    const loose = ({ body }: { body: any }) => {
      if (body.params?.name !== "identity") return answering({ body });
      const value = { matches: [{ api: "edrtool", items: [{ id: 7 }] }, { api: "twilio_api", items: [{ id: 8 }] }], lookups: [{ api: "edrtool", entries: [] }], errors: [{ api: "edrtool", error: "x" }], calls: 3 };
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: JSON.stringify(value) }] } }), { status: 200, headers: { "content-type": "application/json", "mcp-session-id": "sess-1" } });
    };
    const h = harness({ mcp: loose, botProductsOff: offFor(["edrtool"]) });
    await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
    const answer = await call(h, 1, "identity", { query: "host-123" });
    const value = JSON.parse((answer.body as any).result.content[0].text);
    expect(value.matches.map((m: { api: string }) => m.api)).toEqual(["twilio_api"]);
    expect(value.lookups).toEqual([]);
    expect(value.errors).toEqual([]);
  });

  it("changes nothing for a bot with no product off (other bots, every bot before the switch)", async () => {
    const h = harness({ mcp: answering, botProductsOff: () => null });
    await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
    const listed = await h.mcp.relay({ ...turn, botId: "x", frame: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
    expect((listed.body as any).result.tools).toHaveLength(tools.length);
    await call(h, 2, "cw_psa_query", { resource: "service.tickets" });
    expect(called(h, "cw_psa_query")).toBe(1);
    expect(called(h, "api_describe")).toBe(0);
    expect(called(h, "api_list")).toBe(0);
  });
});

describe("PerspicaxMcp keep-alive (#1955)", () => {
  const warm = new Set(["t1"]);

  it("sends a ping on the schedule while the engine is warm, and re-arms after it", async () => {
    const h = harness({ engineWarm: warm, keepaliveMs: 90_000, keepaliveJitterMs: 0 });
    await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
    await h.mcp.relay({ ...turn, botId: "x" , frame: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
    const before = h.mcpCalls.filter((c) => c.body?.method === "ping").length;
    h.advance(90_000);
    await h.runDue();
    expect(h.mcpCalls.filter((c) => c.body?.method === "ping").length).toBe(before + 1);
    h.advance(90_000);
    await h.runDue();
    expect(h.mcpCalls.filter((c) => c.body?.method === "ping").length).toBe(before + 2);
  });

  it("never pings a cold thread", async () => {
    const h = harness({ keepaliveMs: 1_000, keepaliveJitterMs: 0 });
    await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
    await h.mcp.relay({ ...turn, botId: "x" , frame: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
    h.advance(5_000);
    await h.runDue();
    expect(h.mcpCalls.some((c) => c.body?.method === "ping")).toBe(false);
  });

  it("stops on noteEngineCold (engine idle close)", async () => {
    const h = harness({ engineWarm: warm, keepaliveMs: 90_000, keepaliveJitterMs: 0 });
    await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
    await h.mcp.relay({ ...turn, botId: "x" , frame: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
    h.mcp.noteEngineCold("t1");
    h.advance(90_000);
    await h.runDue();
    expect(h.mcpCalls.some((c) => c.body?.method === "ping")).toBe(false);
  });

  it("stops on endGeneration retire when the engine is cold", async () => {
    const h = harness({ engineWarm: new Set(), keepaliveMs: 90_000, keepaliveJitterMs: 0 });
    await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
    await h.mcp.relay({ ...turn, botId: "x" , frame: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
    await h.mcp.endGeneration("t1", "g1");
    h.advance(90_000);
    await h.runDue();
    expect(h.mcpCalls.some((c) => c.body?.method === "ping")).toBe(false);
  });

  it("stops on endAll (process shutdown)", async () => {
    const h = harness({ engineWarm: warm, keepaliveMs: 90_000, keepaliveJitterMs: 0 });
    await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
    await h.mcp.relay({ ...turn, botId: "x" , frame: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
    await h.mcp.endAll();
    h.advance(90_000);
    await h.runDue();
    expect(h.mcpCalls.some((c) => c.body?.method === "ping")).toBe(false);
  });

  it("does not re-arm when the token is near expiry", async () => {
    const h = harness({ engineWarm: warm, keepaliveMs: 90_000, keepaliveJitterMs: 0 });
    await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
    await h.mcp.relay({ ...turn, botId: "x" , frame: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
    h.mcp.noteEngineCold("t1");
    // Exchange minted expiresAt = now + 900_000; leave under PERSPICAX_TOKEN_MIN_LIFE_MS (60 s).
    h.advance(850_000);
    h.mcp.noteEngineWarm("t1");
    h.advance(90_000);
    await h.runDue();
    expect(h.mcpCalls.some((c) => c.body?.method === "ping")).toBe(false);
  });

  it("a failed ping ends the entry; the next turn reopens", async () => {
    let failPing = false;
    const engineWarm = new Set(["t1"]);
    const h = harness({
      engineWarm,
      keepaliveMs: 90_000,
      keepaliveJitterMs: 0,
      mcp: ({ body, method }) => {
        if (method === "DELETE") return new Response(null, { status: 204 });
        if (body?.method === "ping" && failPing) return new Response("gone", { status: 404 });
        if (body?.id === undefined) return new Response(null, { status: 202 });
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: body.method === "tools/list" ? { tools: [] } : {} }), {
          status: 200,
          headers: { "content-type": "application/json", "mcp-session-id": "sess-1" },
        });
      },
    });
    await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
    await h.mcp.relay({ ...turn, botId: "x" , frame: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
    failPing = true;
    h.advance(90_000);
    await h.runDue();
    expect(h.mcpCalls.some((c) => c.body?.method === "ping")).toBe(true);
    // Entry ended: next turn with a cold-then-warm engine pays a fresh exchange
    engineWarm.delete("t1");
    await h.mcp.endGeneration("t1", "g1");
    const exchangesBefore = h.exchanges.length;
    engineWarm.add("t1");
    await h.mcp.prepareTurn({ threadId: "t1", generation: "g2", bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
    expect(h.exchanges.length).toBeGreaterThan(exchangesBefore);
  });

  it("keeps at most maxPingedPerPerson entries pinged (newest)", async () => {
    const engineWarm = new Set<string>();
    for (let i = 0; i < 10; i += 1) engineWarm.add(`t${i}`);
    const h = harness({
      engineWarm,
      keepaliveMs: 90_000,
      keepaliveJitterMs: 0,
      maxPingedPerPerson: 8,
    });
    for (let i = 0; i < 10; i += 1) {
      await h.mcp.prepareTurn({ threadId: `t${i}`, generation: "g", bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
      await h.mcp.relay({ threadId: `t${i}`, generation: "g", botId: "x" , frame: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
    }
    h.advance(90_000);
    await h.runDue();
    const pings = h.mcpCalls.filter((c) => c.body?.method === "ping");
    expect(pings.length).toBe(PERSPICAX_KEEPALIVE_PER_PERSON);
    expect(pings.length).toBe(8);
  });

  it("keeps the account token but opens a fresh MCP session across warm turns", async () => {
    const h = harness({ engineWarm: warm, keepaliveMs: 90_000, keepaliveJitterMs: 0 });
    await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
    await h.mcp.relay({ ...turn, botId: "x" , frame: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
    const exchangesAfterFirst = h.exchanges.length;
    await h.mcp.endGeneration("t1", "g1");
    await h.mcp.prepareTurn({ threadId: "t1", generation: "g2", bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
    expect(h.exchanges.length).toBe(exchangesAfterFirst);
    expect(h.logs.some((line) => /warm engine/.test(line))).toBe(true);
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

describe("PerspicaxMcp apiListForTurn (D-20261119-087, #5105)", () => {
  // Perspicax as the person's products make it: tools/list names the tools
  // of the served products, api_list lists them.
  function served(apis: string[]) {
    const state = { apis, apiListCalls: 0 };
    const mcp = ({ body }: { body: any }) => {
      if (body?.id === undefined) return new Response(null, { status: 202 });
      const tools = ["api_list", ...state.apis.map((id) => `${id}_query`)].map((name) => ({ name, inputSchema: { type: "object" } }));
      if (body.method === "tools/call" && body.params?.name === "api_list") state.apiListCalls += 1;
      const result = body.method === "tools/list" ? { tools }
        : body.method === "tools/call" ? { content: [{ type: "text", text: JSON.stringify({ apis: state.apis.map((id) => ({ id, group: id.startsWith("acme_psa") ? "acme_psa" : undefined })) }) }] }
        : {};
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), { status: 200, headers: { "content-type": "application/json", "mcp-session-id": "s" } });
    };
    return { state, mcp };
  }
  async function aTurn(h: ReturnType<typeof harness>, generation: string) {
    await h.mcp.prepareTurn({ threadId: "t1", generation, bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
    await h.mcp.ensureTurnSessions("t1", generation);
    await h.mcp.apiListForTurn({ threadId: "t1", generation, botId: "x" });
    const ids = [...(h.mcp.servedApis("x")?.ids ?? [])].sort();
    await h.mcp.endGeneration("t1", generation);
    return ids;
  }

  it("waits for the first api_list of a bot, then reads it beside the turns while nothing changes", async () => {
    const perspicax = served(["acme_psa_service", "acme_psa_time"]);
    const h = harness({ mcp: perspicax.mcp });
    expect(h.mcp.servedApis("x")).toBeUndefined();
    expect(await aTurn(h, "g1")).toEqual(["acme_psa_service", "acme_psa_time"]);
    expect(h.mcp.servedApis("x")?.groups.get("acme_psa")).toEqual(["acme_psa_service", "acme_psa_time"]);
    expect(await aTurn(h, "g2")).toEqual(["acme_psa_service", "acme_psa_time"]);
    expect(perspicax.state.apiListCalls).toBe(1);
  });

  it("reads api_list again at the next turn when a product was taken away or given", async () => {
    const perspicax = served(["acme_psa_service", "acme_psa_time", "nimbus_backup"]);
    const h = harness({ mcp: perspicax.mcp });
    expect(await aTurn(h, "g1")).toEqual(["acme_psa_service", "acme_psa_time", "nimbus_backup"]);
    perspicax.state.apis = ["nimbus_backup"];
    expect(await aTurn(h, "g2")).toEqual(["nimbus_backup"]);
    perspicax.state.apis = ["acme_psa_service", "nimbus_backup"];
    expect(await aTurn(h, "g3")).toEqual(["acme_psa_service", "nimbus_backup"]);
    expect(perspicax.state.apiListCalls).toBe(3);
  });
});

describe("withFailureWords (2026-11-05)", () => {
  it("gives an empty isError result words from structuredContent, else a sentence", () => {
    const structured = withFailureWords({ jsonrpc: "2.0", id: 1, result: { isError: true, content: [], structuredContent: { status: "blocked", reason: "run_not_yours", detail: "this run is not held by your account" } } }, "flow_run") as any;
    expect(structured.result.content).toEqual([{ type: "text", text: "this run is not held by your account" }]);
    const bare = withFailureWords({ jsonrpc: "2.0", id: 1, result: { isError: true, content: [{ type: "text", text: " " }] } }, "flow_run") as any;
    expect(bare.result.content).toEqual([{ type: "text", text: "flow_run failed on Perspicax and its answer carried no error message." }]);
  });

  it("leaves a result with words, and a success, as they are", () => {
    const worded = { jsonrpc: "2.0", id: 1, result: { isError: true, content: [{ type: "text", text: "refused" }] } };
    expect(withFailureWords(worded, "flow_run")).toBe(worded);
    const ok = { jsonrpc: "2.0", id: 1, result: { content: [] } };
    expect(withFailureWords(ok, "flow_run")).toBe(ok);
  });
});

describe("large memory journals", () => {
  it.each(["memory_write", "memory_propose", "memory_save"])("preserves every byte of %s and the audience of each part", async (name) => {
    const args = name === "memory_save" ? { place: "personal" } : name === "memory_write" ? { scope: "me", topic: "work" } : { target: "team:review", topic: "work" };
    const original = "é".repeat(1950) + "📝\n".repeat(1800) + "\n";
    const parts: string[] = [];
    const h = harness({ mcp: ({ body }) => {
      if (!body) return new Response(null, { status: 204 });
      if (body.id === undefined) return new Response(null, { status: 202 });
      if (body.method === "tools/list") return Response.json({ jsonrpc: "2.0", id: body.id, result: { tools: [
        { name, inputSchema: { properties: { body: { type: "string", maxLength: 4096 } } } },
      ] } });
      if (body.method === "tools/call") {
        expect(body.params.name).toBe(name);
        const { body: piece, ...fields } = body.params.arguments;
        expect(fields).toEqual(args);
        expect(Buffer.byteLength(piece)).toBeLessThanOrEqual(4096);
        parts.push(piece);
      }
      return Response.json({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: "stored" }] } });
    } });
    await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
    const listed = await h.mcp.relay({ ...turn, botId: "x", frame: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
    expect(listed.body).toMatchObject({ result: { tools: [{ inputSchema: { properties: { body: { type: "string" } } } }] } });
    expect(JSON.stringify(listed.body)).not.toContain("maxLength");
    const result = await h.mcp.relay({ ...turn, botId: "x", frame: { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: { ...args, body: original } } } });
    expect(parts.length).toBeGreaterThan(1);
    const journal = (result.body as { result: { structuredContent: { journal: string } } }).result.structuredContent.journal;
    expect(parts.map((part, i) => {
      const header = `[journal ${journal} ${i + 1}/${parts.length}]\n`;
      expect(part.startsWith(header)).toBe(true);
      expect(part.endsWith("\n[/journal]")).toBe(true);
      return part.slice(header.length, -"\n[/journal]".length);
    }).join("")).toEqual(original);
    await h.mcp.endAll();
  });

  it("sends each part of a rewrite with the latest base version, after a stale base is refused (#5143)", async () => {
    const original = `${"é".repeat(2100)}\n`;
    expect(original.length).toBeLessThanOrEqual(4096);
    expect(Buffer.byteLength(original)).toBeGreaterThan(4096);
    let version = "v1";
    const accepted: { base: string; body: string }[] = [];
    const refused: string[] = [];
    const h = harness({ mcp: ({ body }) => {
      if (!body) return new Response(null, { status: 204 });
      if (body.id === undefined) return new Response(null, { status: 202 });
      if (body.method !== "tools/call") return Response.json({ jsonrpc: "2.0", id: body.id, result: { content: [] } });
      const base = body.params?.arguments?.base_version;
      const piece = String(body.params?.arguments?.body ?? "");
      expect(Buffer.byteLength(piece)).toBeLessThanOrEqual(4096);
      if (base !== version) {
        refused.push(String(base));
        return Response.json({ jsonrpc: "2.0", id: body.id, result: {
          isError: true,
          content: [{ type: "text", text: "the note changed since you read it" }],
          structuredContent: {
            code: "policy_denied",
            details: { reason: "memory_conflict", status: 403, current_version: version, current: { version, title: "Journal", body: "" } },
          },
        } });
      }
      accepted.push({ base, body: piece });
      version = `v${accepted.length + 1}`;
      return Response.json({ jsonrpc: "2.0", id: body.id, result: {
        structuredContent: { id: "note-1", place: "team:desk", status: "published" },
        content: [{ type: "text", text: "stored" }],
      } });
    } });
    await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
    const result = await h.mcp.relay({ ...turn, botId: "x", frame: { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "memory_save", arguments: { id: "note-1", place: "team:desk", base_version: "v1", body: original } } } });
    expect(result.body).toMatchObject({ result: { structuredContent: { parts: expect.any(Array) } } });
    expect(accepted.map((part) => part.base)).toEqual(["v1", "v2"]);
    expect(refused).toEqual(["v1"]);
    const journal = (result.body as { result: { structuredContent: { journal: string } } }).result.structuredContent.journal;
    expect(accepted.map((part) => {
      const header = `[journal ${journal} ${accepted.indexOf(part) + 1}/${accepted.length}]\n`;
      expect(part.body.startsWith(header)).toBe(true);
      expect(part.body.endsWith("\n[/journal]")).toBe(true);
      return part.body.slice(header.length, -"\n[/journal]".length);
    }).join("")).toEqual(original);
    expect(accepted.every((part) => part.body.includes("é"))).toBe(true);
    await h.mcp.endAll();
  });

  it("retries an interrupted journal without sending its acknowledged prefix again", async () => {
    const attempts: number[] = [];
    const h = harness({ writeOnceScope: () => "run", mcp: ({ body }) => {
      if (!body) return new Response(null, { status: 204 });
      if (body.id === undefined) return new Response(null, { status: 202 });
      const part = Number(/ (\d+)\/\d+\]/.exec(body.params?.arguments?.body ?? "")?.[1]);
      const refused = part === 2 && !attempts.includes(2);
      if (part) attempts.push(part);
      const result = { content: [{ type: "text", text: refused ? "Unavailable" : "Saved" }], isError: refused };
      return Response.json({ jsonrpc: "2.0", id: body.id, result });
    } });
    await h.mcp.prepareTurn({ ...turn, bot, speakerPrincipalId: BOB, speakerOrigin: "person" });
    const save = (id: number) => h.mcp.relay({ ...turn, botId: "x", frame: { jsonrpc: "2.0", id, method: "tools/call", params: { name: "memory_save", arguments: { body: "a".repeat(9000) } } } });
    expect((await save(1)).body).toMatchObject({ result: { isError: true, content: [ { text: expect.stringContaining("1 of 3 parts acknowledged") }, { text: "Unavailable", type: "text" } ] } });
    expect((await save(2)).body).toMatchObject({ id: 2, result: { structuredContent: { parts: expect.any(Array) } } });
    expect(attempts).toEqual([1, 2, 2, 3]);
    await h.mcp.endAll();
  });
});
