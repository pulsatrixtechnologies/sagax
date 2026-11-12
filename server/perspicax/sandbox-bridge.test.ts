// #4081: a script in a bot's server environment reaches the bot's own
// Perspicax connection through the bridge, never with a Perspicax token.
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";

import { createRoutineWatchPlace } from "../index-leaves/routineWatchPlace.ts";
import { EXEC_ENV_KEY_RE } from "../sandbox/sandboxd-core.ts";
import { PASS } from "../routes/table.ts";
import {
  createSandboxBridgeRoutes,
  sandboxBridgeEnv,
  sandboxBridgeStartupNote,
  sandboxBridgeUrl,
  SandboxBridgeGrants,
  SandboxBridgeWatchSessions,
  SANDBOX_BRIDGE_PATH,
  SANDBOX_BRIDGE_WATCH_WRITE,
  type SandboxBridgeMcp,
  type SandboxBridgeRouteDeps,
} from "./sandbox-bridge.ts";

const TURN = { botId: "bot-1", principalId: "ada@acme.test", threadId: "t-1", generation: "g-1" };

function grants(active = () => true, now = () => 1_000) {
  return new SandboxBridgeGrants({ turnActive: active, now });
}

function request(token: string | null, body: unknown, method = "POST"): IncomingMessage {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  return Object.assign(Readable.from([Buffer.from(raw)]), {
    method,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  }) as unknown as IncomingMessage;
}

function response() {
  const headers: Record<string, string> = {};
  const res = {
    headersSent: false,
    writableEnded: false,
    setHeader: (name: string, value: string) => { headers[name.toLowerCase()] = value; },
    writeHead: (status: number) => { out.status = status; },
    end: () => { res.writableEnded = true; },
  };
  const out: { status?: number; body?: unknown; headers: Record<string, string> } = { headers };
  return { res: res as unknown as ServerResponse, out };
}

async function post(route: ReturnType<typeof createSandboxBridgeRoutes>, token: string | null, body: unknown, method = "POST") {
  const { res, out } = response();
  const result = await route({
    req: request(token, body, method),
    res,
    url: new URL(`http://x${SANDBOX_BRIDGE_PATH}`),
    path: SANDBOX_BRIDGE_PATH,
    method,
    auth: null,
    json: ((_res: ServerResponse, status: number, value: unknown) => { out.status = status; out.body = value; }) as never,
    readBody: (async () => ({})) as never,
  });
  return { result, out };
}

function deps(over: Partial<SandboxBridgeRouteDeps> & { grants: SandboxBridgeGrants }): SandboxBridgeRouteDeps {
  return {
    turnCapabilityToken: () => "cap-turn",
    turnPrincipal: () => TURN.principalId,
    hold: () => Promise.resolve({ behavior: "allow" as const }),
    forwardTurn: async (_req, res) => { (res as unknown as { writableEnded: boolean }).writableEnded = true; },
    watch: new SandboxBridgeWatchSessions(() => null),
    ...over,
  };
}

const call = (name: string, args: Record<string, unknown> = {}) => ({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name, arguments: args } });

describe("SandboxBridgeGrants", () => {
  it("gives one token per turn and person, valid only while the turn runs", () => {
    let running = true;
    const kept = grants(() => running);
    const token = kept.mintTurn(TURN);
    expect(token.startsWith("sgx_brg_")).toBe(true);
    expect(kept.mintTurn({ ...TURN, principalId: " Ada@Acme.test " })).toBe(token);
    expect(kept.mintTurn({ ...TURN, principalId: "bo@acme.test" })).not.toBe(token);
    expect(kept.resolve(`Bearer ${token}`)).toMatchObject({ kind: "turn", botId: "bot-1", principalId: "ada@acme.test" });
    running = false;
    expect(kept.resolve(`Bearer ${token}`)).toBeNull();
    expect(kept.size()).toBe(0);
  });

  it("refuses a missing, foreign or altered token", () => {
    const kept = grants();
    const token = kept.mintTurn(TURN);
    expect(kept.resolve(undefined)).toBeNull();
    expect(kept.resolve(token)).toBeNull();
    expect(kept.resolve("Bearer sgx_sess_abc")).toBeNull();
    expect(kept.resolve(`Bearer ${token}x`)).toBeNull();
    expect(kept.resolve([`Bearer ${token}`])).toBeNull();
  });

  it("ends a watch token on revoke or at its time limit", () => {
    let now = 1_000;
    const kept = grants(() => true, () => now);
    const first = kept.mintWatch({ botId: "bot-1", principalId: "ada@acme.test", ownerPrincipalId: "ada@acme.test", ttlMs: 60_000 });
    expect(kept.resolve(`Bearer ${first.token}`)).toMatchObject({ kind: "watch", principalId: "ada@acme.test" });
    first.revoke();
    expect(kept.resolve(`Bearer ${first.token}`)).toBeNull();
    const second = kept.mintWatch({ botId: "bot-1", principalId: "ada@acme.test", ownerPrincipalId: "ada@acme.test", ttlMs: 60_000 });
    now += 61_000;
    expect(kept.resolve(`Bearer ${second.token}`)).toBeNull();
  });
});

describe("sandboxBridgeUrl", () => {
  it("uses the environment's own address first, then the public one", () => {
    expect(sandboxBridgeUrl({ SAGAX_SANDBOX_BRIDGE_URL: "https://in.example/", SAGAX_PUBLIC_URL: "https://out.example" })).toBe(`https://in.example${SANDBOX_BRIDGE_PATH}`);
    expect(sandboxBridgeUrl({ SAGAX_PUBLIC_URL: "https://out.example" })).toBe(`https://out.example${SANDBOX_BRIDGE_PATH}`);
    expect(sandboxBridgeUrl({})).toBeNull();
    expect(sandboxBridgeUrl({ SAGAX_PUBLIC_URL: "not a url" })).toBeNull();
  });

  it("never sends the token in clear past this machine: http only on loopback", () => {
    expect(sandboxBridgeUrl({ SAGAX_SANDBOX_BRIDGE_URL: "http://sagax.example" })).toBeNull();
    expect(sandboxBridgeUrl({ SAGAX_SANDBOX_BRIDGE_URL: "http://127.0.0.1:8799" })).toBe(`http://127.0.0.1:8799${SANDBOX_BRIDGE_PATH}`);
    expect(sandboxBridgeStartupNote({ SAGAX_SANDBOX_BRIDGE_URL: "http://sagax.example" })).toMatch(/must be https/);
    expect(sandboxBridgeStartupNote({})).toMatch(/set SAGAX_SANDBOX_BRIDGE_URL/);
    expect(sandboxBridgeStartupNote({ SAGAX_PUBLIC_URL: "https://sagax.example" })).toBeNull();
  });

  it("only gives names the environment accepts", () => {
    for (const name of Object.keys(sandboxBridgeEnv("https://x.example/p", "sgx_brg_t"))) expect(EXEC_ENV_KEY_RE.test(name)).toBe(true);
  });
});

describe("the bridge route", () => {
  it("passes other paths and refuses without a live token", async () => {
    const kept = grants();
    const route = createSandboxBridgeRoutes(deps({ grants: kept }));
    const { res } = response();
    expect(await route({ req: request(null, {}), res, url: new URL("http://x/api/bots"), path: "/api/bots", method: "POST", auth: null, json: (() => undefined) as never, readBody: (async () => ({})) as never })).toBe(PASS);
    expect((await post(route, null, call("api_search"))).out).toMatchObject({ status: 401, body: { error: "unauthorized" } });
    expect((await post(route, "sgx_brg_unknown", call("api_search"))).out.status).toBe(401);
    expect((await post(route, kept.mintTurn(TURN), {}, "GET")).out.status).toBe(405);
  });

  it("answers initialize and notifications itself, never on the engine's session", async () => {
    const kept = grants();
    const forwardTurn = vi.fn(async () => undefined);
    const route = createSandboxBridgeRoutes(deps({ grants: kept, forwardTurn }));
    const token = kept.mintTurn(TURN);
    const init = await post(route, token, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
    expect(init.out.status).toBe(200);
    expect(init.out.headers["mcp-session-id"]).toBeTruthy();
    expect(init.out.body).toMatchObject({ id: 1, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} } } });
    const note = await post(route, token, { jsonrpc: "2.0", method: "notifications/initialized" });
    expect(note.out.status).toBe(202);
    expect(forwardTurn).not.toHaveBeenCalled();
  });

  it("refuses a batch and an unreadable frame", async () => {
    const kept = grants();
    const route = createSandboxBridgeRoutes(deps({ grants: kept }));
    const token = kept.mintTurn(TURN);
    expect((await post(route, token, [call("api_search")])).out.status).toBe(400);
    expect((await post(route, token, "{nope")).out.status).toBe(400);
  });

  it("relays a read through the turn's own capability after its approval", async () => {
    const kept = grants();
    const hold = vi.fn(() => Promise.resolve({ behavior: "allow" as const }));
    const forwardTurn = vi.fn(async (_req: IncomingMessage, res: ServerResponse) => { (res as unknown as { writableEnded: boolean }).writableEnded = true; });
    const route = createSandboxBridgeRoutes(deps({ grants: kept, hold, forwardTurn }));
    const frame = call("api_search", { query: "open tickets" });
    await post(route, kept.mintTurn(TURN), frame);
    expect(hold).toHaveBeenCalledWith(expect.objectContaining({ kind: "turn", threadId: "t-1" }), { name: "api_search", args: { query: "open tickets" } });
    expect(forwardTurn).toHaveBeenCalledTimes(1);
    const [, , capability, raw] = forwardTurn.mock.calls[0] as unknown as [unknown, unknown, string, Buffer];
    expect(capability).toBe("cap-turn");
    expect(JSON.parse(raw.toString("utf8"))).toEqual(frame);
  });

  it("answers a refused approval as a tool error, unsent", async () => {
    const kept = grants();
    const hold = vi.fn(() => Promise.resolve({ behavior: "deny" as const, message: "an organization rule refuses this call" }));
    const forwardTurn = vi.fn(async () => undefined);
    const route = createSandboxBridgeRoutes(deps({ grants: kept, hold, forwardTurn }));
    const { out } = await post(route, kept.mintTurn(TURN), call("api_write", { resource: "ticket" }));
    expect(out).toMatchObject({ status: 200, body: { id: 7, result: { isError: true, content: [{ text: "Refused: an organization rule refuses this call" }] } } });
    expect(forwardTurn).not.toHaveBeenCalled();
  });

  it("never sends a call whose script left while its card waited", async () => {
    const kept = grants();
    let approve!: (value: { behavior: "allow" }) => void;
    const forwardTurn = vi.fn(async () => undefined);
    const route = createSandboxBridgeRoutes(deps({ grants: kept, forwardTurn, hold: () => new Promise((resolve) => { approve = resolve; }) }));
    const { res, out } = response();
    const sent = route({
      req: request(kept.mintTurn(TURN), call("api_write", { resource: "time_entry" })),
      res, url: new URL(`http://x${SANDBOX_BRIDGE_PATH}`), path: SANDBOX_BRIDGE_PATH, method: "POST", auth: null,
      json: ((_res: ServerResponse, status: number, value: unknown) => { out.status = status; out.body = value; }) as never,
      readBody: (async () => ({})) as never,
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    (res as unknown as { destroyed: boolean }).destroyed = true;
    approve({ behavior: "allow" });
    await sent;
    expect(forwardTurn).not.toHaveBeenCalled();
    expect(out.status).toBeUndefined();
  });

  it("never sends a call whose script's connection really closed while its card waited", async () => {
    const kept = grants();
    let approve!: (value: { behavior: "allow" }) => void;
    let asked!: () => void;
    const holding = new Promise<void>((resolve) => { asked = resolve; });
    const forwardTurn = vi.fn(async () => undefined);
    const route = createSandboxBridgeRoutes(deps({
      grants: kept, forwardTurn,
      hold: () => { asked(); return new Promise((resolve) => { approve = resolve; }); },
    }));
    let served!: Promise<unknown>;
    const server = createServer((req, res) => {
      served = route({
        req, res, url: new URL(`http://x${SANDBOX_BRIDGE_PATH}`), path: SANDBOX_BRIDGE_PATH, method: "POST", auth: null,
        json: ((answer: ServerResponse, status: number, value: unknown) => { answer.writeHead(status, { "content-type": "application/json" }); answer.end(JSON.stringify(value)); }) as never,
        readBody: (async () => ({})) as never,
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const port = (server.address() as { port: number }).port;
      const client = httpRequest({ host: "127.0.0.1", port, method: "POST", path: SANDBOX_BRIDGE_PATH, headers: { authorization: `Bearer ${kept.mintTurn(TURN)}`, "content-type": "application/json" } });
      client.on("error", () => undefined);
      client.end(JSON.stringify(call("api_write", { resource: "time_entry" })));
      await holding;
      // the script is killed while the card waits: its socket closes
      client.destroy();
      await new Promise((resolve) => setTimeout(resolve, 100));
      approve({ behavior: "allow" });
      await served;
      expect(forwardTurn).not.toHaveBeenCalled();
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("keeps people apart: a turn speaking for someone else, or with no connection, relays nothing", async () => {
    const kept = grants();
    const forwardTurn = vi.fn(async () => undefined);
    const other = createSandboxBridgeRoutes(deps({ grants: kept, forwardTurn, turnPrincipal: () => "bo@acme.test" }));
    expect((await post(other, kept.mintTurn(TURN), call("api_search"))).out).toMatchObject({ status: 403, body: { code: "wrong_person" } });
    const none = createSandboxBridgeRoutes(deps({ grants: kept, forwardTurn, turnCapabilityToken: () => null }));
    expect((await post(none, kept.mintTurn(TURN), call("api_search"))).out).toMatchObject({ status: 403, body: { code: "profile_not_mounted" } });
    expect(forwardTurn).not.toHaveBeenCalled();
  });

  it("ends with the turn: no running turn to hold the call is a 401", async () => {
    const kept = grants();
    const route = createSandboxBridgeRoutes(deps({ grants: kept, hold: () => undefined }));
    expect((await post(route, kept.mintTurn(TURN), call("api_search"))).out.status).toBe(401);
  });
});

function fakeMcp(reads: boolean, mounted = true): SandboxBridgeMcp & { prepared: unknown[]; relayed: unknown[]; ended: string[] } {
  const prepared: unknown[] = [];
  const relayed: unknown[] = [];
  const ended: string[] = [];
  return {
    prepared, relayed, ended,
    prepareTurn: async (input) => { prepared.push(input); return { mounted: mounted ? [{ name: "Perspicax" }] : [], unavailable: [] }; },
    relay: async (input) => { relayed.push(input.frame); return { status: 200, body: { jsonrpc: "2.0", id: 7, result: { content: [] } } }; },
    frameReads: async () => reads,
    endGeneration: async (threadId) => { ended.push(threadId); },
  };
}

describe("a watch check's bridge", () => {
  it("reads through the person's routine delegation, once opened, ended with the check", async () => {
    const kept = grants();
    const mcp = fakeMcp(true);
    const watch = new SandboxBridgeWatchSessions(() => mcp);
    const route = createSandboxBridgeRoutes(deps({ grants: kept, watch }));
    const minted = kept.mintWatch({ botId: "bot-1", principalId: "ada@acme.test", ownerPrincipalId: "ada@acme.test", ttlMs: 60_000 });
    await post(route, minted.token, call("api_search"));
    await post(route, minted.token, call("api_result_query"));
    expect(mcp.prepared).toEqual([expect.objectContaining({ speakerPrincipalId: "ada@acme.test", speakerOrigin: "owner-routine", bot: { id: "bot-1" } })]);
    expect(mcp.relayed).toHaveLength(2);
    await watch.end(minted.grant);
    expect(mcp.ended).toEqual([minted.grant.threadId]);
    // a frame arriving after the check never opens a connection nobody ends
    expect(await watch.relay(minted.grant as never, call("api_search"))).toMatchObject({ status: 401 });
    expect(mcp.prepared).toHaveLength(1);
  });

  it("never sends a write, nobody being there to approve it", async () => {
    const kept = grants();
    const mcp = fakeMcp(false);
    const route = createSandboxBridgeRoutes(deps({ grants: kept, watch: new SandboxBridgeWatchSessions(() => mcp) }));
    const minted = kept.mintWatch({ botId: "bot-1", principalId: "ada@acme.test", ownerPrincipalId: "ada@acme.test", ttlMs: 60_000 });
    const { out } = await post(route, minted.token, call("api_write"));
    expect(out.body).toMatchObject({ result: { isError: true, content: [{ text: SANDBOX_BRIDGE_WATCH_WRITE }] } });
    expect(mcp.relayed).toHaveLength(0);
  });

  it("says when the person has no connection for the watch", async () => {
    const kept = grants();
    const route = createSandboxBridgeRoutes(deps({ grants: kept, watch: new SandboxBridgeWatchSessions(() => fakeMcp(true, false)) }));
    const minted = kept.mintWatch({ botId: "bot-1", principalId: "ada@acme.test", ownerPrincipalId: "ada@acme.test", ttlMs: 60_000 });
    expect((await post(route, minted.token, call("api_search"))).out).toMatchObject({ status: 403, body: { code: "profile_not_mounted" } });
  });
});

describe("routine watch in the server environment", () => {
  function place(bridge: { env: Record<string, string>; end: () => void } | null) {
    const execs: Array<{ argv: string[]; env?: Record<string, string> }> = [];
    const host = {
      IDENTITY: { kind: "perspicax" },
      store: { bot: () => ({ id: "bot-1" }) },
      effectiveRunAs: () => "ada@acme.test",
      effectiveBotOwner: () => "ada@acme.test",
      decideWorkplace: () => ({ target: "user-sandbox", principal: "ada@acme.test" }),
      userSandbox: { exec: async (_p: string, input: { argv: string[]; env?: Record<string, string> }) => { execs.push(input); return { exitCode: 0, stdout: "ok", truncated: false, timedOut: false }; } },
      sandboxBotFolder: () => null,
      inBotFolder: (input: unknown) => input,
      sandboxBridgeWatch: () => bridge,
    };
    const watchPlace = createRoutineWatchPlace(() => host)({ id: "r-1", botId: "bot-1" });
    return { watchPlace, execs };
  }

  it("gives the check only names the environment accepts (LANG made every check a bad_exec)", async () => {
    const { watchPlace, execs } = place(null);
    expect(watchPlace.kind).toBe("remote");
    await watchPlace.exec("echo 1", { timeoutMs: 10_000, maxOutputBytes: 1_000, signal: new AbortController().signal });
    for (const name of Object.keys(execs[0]?.env ?? {})) expect(EXEC_ENV_KEY_RE.test(name)).toBe(true);
  });

  it("exports the bridge to the check and ends it after", async () => {
    const end = vi.fn();
    const { watchPlace, execs } = place({ env: sandboxBridgeEnv("https://x.example/p", "sgx_brg_t"), end });
    await watchPlace.exec("python3 scripts/dispatch_watch.py once", { timeoutMs: 10_000, maxOutputBytes: 1_000, signal: new AbortController().signal });
    expect(execs[0]?.env).toEqual({ SAGAX_BRIDGE_MCP_URL: "https://x.example/p", SAGAX_BRIDGE_TOKEN: "sgx_brg_t" });
    expect(end).toHaveBeenCalledTimes(1);
  });
});
