import { afterEach, describe, expect, it, vi } from "vitest";
import { PerspicaxMcp } from "./perspicax-mcp.ts";
import { identityWarning } from "./perspicax-identity.ts";

// Fake Perspicax MCP transport: no sockets, credentials or live data. Its
// connection-scoped identity is bound to the session (or token when stateless).
function fixture(options: { older?: boolean; stateless?: boolean; refuse?: string; warm?: boolean; defaultIdentity?: false; clearFails?: boolean; writeOnce?: boolean; routine?: boolean } = {}) {
  let sequence = 0;
  let sessionSequence = 0;
  let lapses = 0;
  let refuse = options.refuse;
  let unauthorized = false;
  let refreshCatalog = false;
  let loseSession = false;
  let refuseProfileRestore = false;
  let nextSession: string | undefined;
  const calls: Array<{ method: string; name?: string; args?: any; session?: string; token: string }> = [];
  const warnings: string[] = [];
  const identities = new Map<string, string>();
  const choices = new Map<string, string>();
  const profiles = [
    { slug: "dispatch", name: "Service desk", explicit_only: false, reachable: true },
    { slug: "billing", name: "Billing", explicit_only: false, reachable: true },
    { slug: "redacted", name: "Bot attribution", explicit_only: true, reachable: true },
  ];
  const tools = (acting?: string) => [
    ...(!options.older ? [{ name: "identity_switch", annotations: { readOnlyHint: true } }] : []),
    ...(!options.older ? [{ name: "profile_use", annotations: { readOnlyHint: true } }] : []),
    { name: "api_list", annotations: { readOnlyHint: true } },
    { name: acting === "redacted" ? "bot_write" : acting ? `${acting}_write` : "person_write", annotations: { readOnlyHint: false } },
    { name: "shared_write", annotations: { readOnlyHint: false } },
  ];
  const fetcher: typeof fetch = vi.fn(async (_url, init) => {
    const headers = init!.headers as Record<string, string>;
    const token = headers.authorization;
    const session = headers["mcp-session-id"];
    const key = session ?? token;
    if (init!.method === "DELETE") return new Response(null, { status: 204 });
    const frame = JSON.parse(String(init!.body));
    const name = frame.params?.name;
    const args = frame.params?.arguments;
    calls.push({ method: frame.method, name, args, session, token });
    if (loseSession && frame.method === "tools/call" && name !== "profile_use") {
      loseSession = false;
      identities.delete(key);
      choices.delete(key);
      return new Response("Session not found", { status: 404 });
    }
    if ((unauthorized && name !== "identity_switch") || (refreshCatalog && frame.method === "tools/list" && identities.has(key))) {
      unauthorized = false; refreshCatalog = false; identities.delete(key);
      return new Response(null, { status: 401 });
    }
    if (frame.id === undefined) return new Response(null, { status: 202 });
    const reply = (result: unknown) => {
      const response = new Response(JSON.stringify({ jsonrpc: "2.0", id: frame.id, result }), { headers: { "content-type": "application/json", ...(!options.stateless ? { "mcp-session-id": nextSession ?? session ?? `session-${++sessionSequence}` } : {}) } });
      nextSession = undefined;
      return response;
    };
    if (frame.method === "initialize") return reply({ protocolVersion: "2025-06-18", capabilities: {} });
    if (frame.method === "tools/list") return reply({ tools: tools(identities.get(key) ?? choices.get(key)) });
    if (name === "identity_switch") {
      if (args.profile && refuse) return reply({ isError: true, structuredContent: { error: { code: refuse === "switch_not_consented" ? "policy_denied" : refuse, detail: { reason: refuse } } } });
      if (args.clear && !options.clearFails) identities.delete(key);
      if (args.profile) {
        identities.set(key, args.profile);
        choices.delete(key);
      }
      const changed = args.clear === true || typeof args.profile === "string";
      return reply({ structuredContent: { profiles, lapsed: null, renewed: !!args.profile, ...(changed ? { changed: true } : {}), acting_as: identities.has(key) ? { slug: identities.get(key), name: "Bot attribution", token: { expires_at: new Date(Date.now() + 900_000).toISOString() } } : null } });
    }
    if (name === "profile_use") {
      if (args.profile && refuseProfileRestore) {
        refuseProfileRestore = false;
        return reply({ isError: true, structuredContent: { error: { code: "policy_denied", detail: { reason: "not_held" } } } });
      }
      const changed = args.clear === true || typeof args.profile === "string";
      if (changed) {
        identities.delete(key);
        if (args.clear) choices.delete(key);
        else choices.set(key, args.profile);
      }
      return reply({ structuredContent: { profiles, in_use: choices.get(key) ?? null, ...(changed ? { changed: true } : {}) } });
    }
    if (lapses > 0) {
      lapses -= 1;
      return reply({ isError: true, _meta: { act_as: { code: "act_as_expired" } } });
    }
    return reply({ structuredContent: { acting: identities.get(key) ?? choices.get(key) ?? "default", name } });
  });
  const bot = { id: "bot" };
  const mcp = new PerspicaxMcp({
    issuer: "https://fake.test", version: "test", now: Date.now, fetch: fetcher,
    link: () => ({
      mcpEndpoint: () => "https://fake.test/mcp",
      exchangeToken: async () => ({ ok: true, token: `fake-parent-${++sequence}`, expiresAt: Date.now() + 3_600_000 }),
      revokeExchanged: async () => true,
    }),
    subjectOf: () => ({ iss: "https://fake.test", sub: "alice", disabled: false }),
    subjectToken: async () => ({ ok: true, token: "fake-signin", expiresAt: Date.now() + 3_600_000 }),
    routineSubjectToken: async () => ({ ok: true, token: "fake-delegation", expiresAt: Date.now() + 3_600_000 }),
    botExists: () => true,
    keepWarm: () => options.warm === true,
    routineRetryMs: options.routine ? [0] : [],
    sleep: async () => {},
    ...(options.writeOnce ? { writeOnceScope: () => "routine" } : {}),
    onIdentityWarning: ({ reason }) => warnings.push(identityWarning(reason, "en")), log: () => {},
  });
  const prepare = async (threadId = "thread", identity: string | null = options.defaultIdentity === false ? null : "redacted") => {
    const plan = await mcp.prepareTurn({
      threadId,
      generation: "turn",
      bot,
      speakerPrincipalId: "alice",
      speakerOrigin: options.routine ? "owner-routine" : "person",
      ...(options.routine ? { routine: true } : {}),
    });
    if (identity) await mcp.callTool({ threadId, generation: "turn", botId: "bot", name: "identity_switch", args: { profile: identity } });
    return plan;
  };
  const call = (name = "api_list", threadId = "thread") => mcp.callTool({ threadId, generation: "turn", botId: "bot", name, args: {} });
  return {
    mcp, bot, calls, warnings, prepare, call,
    lapse: (times = 1) => { lapses = times; },
    refuse: (reason: string | undefined) => { refuse = reason; },
    unauthorized: () => { unauthorized = true; },
    refreshCatalog: () => { refreshCatalog = true; },
    rotateSession: () => { nextSession = "replacement-session"; },
    loseSelectedSession: () => { loseSession = true; refuseProfileRestore = true; },
  };
}

afterEach(() => { vi.useRealTimers(); });

describe("Perspicax per-turn identity", () => {
  it("switches on the same session before the first call and re-lists its surface", async () => {
    const f = fixture();
    try {
      await f.prepare();
      expect(await f.call()).toMatchObject({ ok: true, value: { acting: "redacted" } });
      expect(f.calls.map((c) => c.name ?? c.method)).toEqual(["initialize", "notifications/initialized", "identity_switch", "tools/list", "api_list"]);
      expect(new Set(f.calls.slice(1).map((c) => c.session)).size).toBe(1);
      const before = f.calls.length;
      const listing = await f.mcp.relay({ threadId: "thread", generation: "turn", botId: "bot" , frame: { jsonrpc: "2.0", id: 10, method: "tools/list" } });
      expect(JSON.stringify(listing.body)).toContain("bot_write");
      expect(JSON.stringify(listing.body)).not.toContain("person_write");
      // Engine tools/list after Sagax's identity list is served from that
      // cache: no third tools/list round trip on the same session.
      expect(f.calls.slice(before).some((c) => c.method === "tools/list")).toBe(false);
      expect(f.calls).toHaveLength(before);
    } finally { await f.mcp.endAll(); }
    expect(f.calls.at(-1)?.args).toEqual({ clear: true });
  });

  it("drops the tools/list cache when the MCP session id changes", async () => {
    const f = fixture();
    try {
      await f.prepare();
      await f.call();
      // Cache would short-circuit tools/list; a tools/call with a rotated
      // session header clears toolsListBody in send(), then the next list
      // must hit the network again.
      const before = f.calls.filter((c) => c.method === "tools/list").length;
      f.rotateSession();
      expect(await f.call()).toMatchObject({ ok: true });
      const listing = await f.mcp.relay({ threadId: "thread", generation: "turn", botId: "bot" , frame: { jsonrpc: "2.0", id: 11, method: "tools/list" } });
      expect(listing.status).toBe(200);
      expect(f.calls.filter((c) => c.method === "tools/list").length).toBeGreaterThan(before);
    } finally { await f.mcp.endAll(); }
  });

  it("drops the tools/list cache after notifications/tools/list_changed", async () => {
    const f = fixture();
    try {
      await f.prepare();
      await f.call();
      const before = f.calls.filter((c) => c.method === "tools/list").length;
      // Relay treats a tools/list_changed notification as a frame that
      // clears the cache; the next list must go to the network.
      await f.mcp.relay({ threadId: "thread", generation: "turn", botId: "bot" , frame: { jsonrpc: "2.0", method: "notifications/tools/list_changed" } });
      const listing = await f.mcp.relay({ threadId: "thread", generation: "turn", botId: "bot" , frame: { jsonrpc: "2.0", id: 12, method: "tools/list" } });
      expect(listing.status).toBe(200);
      expect(f.calls.filter((c) => c.method === "tools/list").length).toBeGreaterThan(before);
    } finally { await f.mcp.endAll(); }
  });

  it("renews in the background before the 15-minute lease expires and stops the timer at turn end", async () => {
    vi.useFakeTimers();
    const f = fixture();
    await f.prepare(); await f.call();
    await vi.advanceTimersByTimeAsync(840_000);
    expect(f.calls.filter((c) => c.args?.profile === "redacted")).toHaveLength(2);
    await f.mcp.endGeneration("thread", "turn");
    expect(f.calls.at(-1)?.args).toEqual({ clear: true });
    const count = f.calls.length;
    await vi.advanceTimersByTimeAsync(1_800_000);
    expect(f.calls).toHaveLength(count);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("re-switches after an act_as_expired refusal and retries the write once", async () => {
    const f = fixture();
    try {
      await f.prepare(); await f.call(); f.lapse();
      expect(await f.call("bot_write")).toMatchObject({ ok: true, isError: false, value: { acting: "redacted" } });
      expect(f.calls.filter((c) => c.name === "bot_write")).toHaveLength(2);
      expect(f.calls.filter((c) => c.args?.profile)).toHaveLength(2);
    } finally { await f.mcp.endAll(); }
  });

  it("returns a second lapse instead of replaying a write a third time", async () => {
    const f = fixture();
    try {
      await f.prepare(); await f.call(); f.lapse(2);
      expect(await f.call("bot_write")).toMatchObject({ ok: true, isError: true });
      expect(f.calls.filter((c) => c.name === "bot_write")).toHaveLength(2);
    } finally { await f.mcp.endAll(); }
  });

  it("keeps a bot's explicitly selected work block renewed and clears it at the end", async () => {
    vi.useFakeTimers();
    const f = fixture({ defaultIdentity: false });
    try {
      await f.prepare();
      await f.mcp.callTool({ threadId: "thread", generation: "turn", botId: "bot", name: "identity_switch", args: { profile: "redacted" } });
      expect(await f.call()).toMatchObject({ ok: true, value: { acting: "redacted" } });
      await vi.advanceTimersByTimeAsync(840_000);
      expect(f.calls.filter((c) => c.args?.profile === "redacted")).toHaveLength(2);
      await f.mcp.callTool({ threadId: "thread", generation: "turn", botId: "bot", name: "identity_switch", args: { clear: true } });
      expect(await f.call()).toMatchObject({ ok: true, value: { acting: "default" } });
    } finally { await f.mcp.endAll(); }
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not retry a call under the default role when its selected identity cannot survive refresh", async () => {
    const f = fixture();
    try {
      await f.prepare(); await f.call(); f.refuse("switch_not_consented"); f.unauthorized();
      expect(await f.call("bot_write")).toMatchObject({ ok: false, code: "rpc_error" });
      // The first attempt got 401. Refresh could not restore the explicit
      // identity, so no second vendor call was sent on the default surface.
      expect(f.calls.filter((c) => c.name === "bot_write")).toHaveLength(1);
      expect(f.warnings).toHaveLength(1);
    } finally { await f.mcp.endAll(); }
  });

  it("does not let routine backoff retry under the default role when selected identity restoration fails", async () => {
    const f = fixture({ routine: true });
    try {
      await f.prepare(); await f.call(); f.refuse("switch_not_consented"); f.unauthorized();
      expect(await f.call("bot_write")).toMatchObject({ ok: false, code: "rpc_error" });
      // A routine normally retries one unreachable attempt immediately in
      // this fixture. Selection loss is definitive for this operation, so
      // its first 401 must never become a second call on the default role.
      expect(f.calls.filter((c) => c.name === "bot_write")).toHaveLength(1);
      expect(f.warnings).toHaveLength(1);
    } finally { await f.mcp.endAll(); }
  });

  it("reports an explicitly requested block switch refusal in plain words too", async () => {
    const f = fixture({ refuse: "switch_not_consented", defaultIdentity: false });
    try {
      await f.prepare();
      expect(await f.mcp.callTool({ threadId: "thread", generation: "turn", botId: "bot", name: "identity_switch", args: { profile: "redacted" } })).toMatchObject({ ok: true, isError: true });
      expect(f.warnings).toEqual([identityWarning("switch_not_consented", "en")]);
      expect(await f.call()).toMatchObject({ ok: true, isError: false });
    } finally { await f.mcp.endAll(); }
  });

  it.each(["switch_not_consented", "params_invalid"])("shows %s in plain words and keeps the main account permissions", async (reason) => {
    const f = fixture({ refuse: reason });
    try {
      await f.prepare();
      expect(await f.call()).toMatchObject({ ok: true, isError: false });
      expect(f.warnings).toEqual([identityWarning(reason as "params_invalid", "en")]);
      expect(await f.call("person_write")).toMatchObject({ ok: true, isError: false, value: { acting: "default" } });
      expect(f.calls.some((c) => c.name === "person_write")).toBe(true);
    } finally { await f.mcp.endAll(); }
  });

  it("quietly keeps today's behaviour on older servers", async () => {
    const f = fixture({ older: true, defaultIdentity: false });
    try {
      await f.prepare();
      expect(await f.call("person_write")).toMatchObject({ ok: true, isError: false, value: { acting: "default" } });
      expect(f.calls.some((c) => c.name === "identity_switch")).toBe(false);
      expect(f.warnings).toEqual([]);
    } finally { await f.mcp.endAll(); }
  });

  it("does not choose a role on the account connection by default", async () => {
    const f = fixture({ defaultIdentity: false });
    try {
      await f.prepare();
      expect(await f.call()).toMatchObject({ ok: true, value: { acting: "default" } });
      expect(f.calls.some((c) => c.name === "identity_switch")).toBe(false);
    } finally { await f.mcp.endAll(); }
  });

  it("keeps role discovery read-only instead of mistaking it for a switch", async () => {
    const f = fixture();
    try {
      await f.prepare();
      expect(await f.mcp.callTool({ threadId: "thread", generation: "turn", botId: "bot", name: "profile_use", args: {} }))
        .toMatchObject({ ok: true, value: { in_use: null } });
      expect(await f.call()).toMatchObject({ ok: true, value: { acting: "redacted" } });

      expect(await f.mcp.callTool({ threadId: "thread", generation: "turn", botId: "bot", name: "profile_use", args: { profile: "dispatch" } }))
        .toMatchObject({ ok: true, value: { in_use: "dispatch" } });
      expect(await f.mcp.callTool({ threadId: "thread", generation: "turn", botId: "bot", name: "identity_switch", args: {} }))
        .toMatchObject({ ok: true, value: { acting_as: null } });
      expect(await f.call()).toMatchObject({ ok: true, value: { acting: "dispatch" } });
    } finally { await f.mcp.endAll(); }
  });

  it("tracks profile_use in the catalog and write-once key", async () => {
    const f = fixture({ defaultIdentity: false, writeOnce: true });
    try {
      await f.prepare();
      const initial = await f.mcp.relay({ threadId: "thread", generation: "turn", botId: "bot", frame: { jsonrpc: "2.0", id: 60, method: "tools/list" } });
      expect(JSON.stringify(initial.body)).toContain("person_write");
      const initialLists = f.calls.filter((c) => c.method === "tools/list").length;

      expect(await f.mcp.callTool({ threadId: "thread", generation: "turn", botId: "bot", name: "profile_use", args: { profile: "dispatch" } }))
        .toMatchObject({ ok: true, value: { in_use: "dispatch" } });
      const dispatch = await f.mcp.relay({ threadId: "thread", generation: "turn", botId: "bot", frame: { jsonrpc: "2.0", id: 61, method: "tools/list" } });
      expect(JSON.stringify(dispatch.body)).toContain("dispatch_write");
      expect(JSON.stringify(dispatch.body)).not.toContain("person_write");
      expect(f.calls.filter((c) => c.method === "tools/list").length).toBeGreaterThan(initialLists);
      expect(await f.call("shared_write")).toMatchObject({ ok: true, value: { acting: "dispatch" } });

      expect(await f.mcp.callTool({ threadId: "thread", generation: "turn", botId: "bot", name: "profile_use", args: { profile: "billing" } }))
        .toMatchObject({ ok: true, value: { in_use: "billing" } });
      const billing = await f.mcp.relay({ threadId: "thread", generation: "turn", botId: "bot", frame: { jsonrpc: "2.0", id: 62, method: "tools/list" } });
      expect(JSON.stringify(billing.body)).toContain("billing_write");
      expect(await f.call("shared_write")).toMatchObject({ ok: true, value: { acting: "billing" } });
      expect(f.calls.filter((c) => c.name === "shared_write")).toHaveLength(2);
    } finally { await f.mcp.endAll(); }
  });

  it("marks a changed role response so the bridge refreshes the client catalog", async () => {
    const f = fixture({ defaultIdentity: false });
    try {
      await f.prepare();
      const switched = await f.mcp.relay({
        threadId: "thread", generation: "turn", botId: "bot",
        frame: { jsonrpc: "2.0", id: 64, method: "tools/call", params: { name: "profile_use", arguments: { profile: "dispatch" } } },
      });
      expect(switched).toMatchObject({ status: 200, toolsChanged: true });
      expect(await f.mcp.relay({ threadId: "thread", generation: "turn", botId: "bot", frame: { jsonrpc: "2.0", id: 65, method: "tools/list" } }))
        .not.toHaveProperty("toolsChanged");
    } finally { await f.mcp.endAll(); }
  });

  it("does not replay a selected-role call when a replacement session refuses that role", async () => {
    const f = fixture({ defaultIdentity: false });
    try {
      await f.prepare();
      expect(await f.mcp.callTool({ threadId: "thread", generation: "turn", botId: "bot", name: "profile_use", args: { profile: "dispatch" } }))
        .toMatchObject({ ok: true, value: { in_use: "dispatch" } });
      f.loseSelectedSession();
      expect(await f.call("api_list")).toMatchObject({ ok: false, code: "rpc_error" });
      // First call reached only the dead session. Reopen tried profile_use,
      // but never replayed api_list on the new default-role surface.
      expect(f.calls.filter((c) => c.name === "api_list")).toHaveLength(1);
      expect(f.calls.filter((c) => c.name === "profile_use" && c.args?.profile === "dispatch")).toHaveLength(2);
      expect(await f.call("api_list")).toMatchObject({ ok: false, code: "rpc_error" });
      expect(f.calls.filter((c) => c.name === "api_list")).toHaveLength(1);

      // The recovery tools stay reachable and a successful explicit choice
      // releases later vendor calls under that new role.
      expect(await f.mcp.callTool({ threadId: "thread", generation: "turn", botId: "bot", name: "profile_use", args: { profile: "billing" } }))
        .toMatchObject({ ok: true, value: { in_use: "billing" } });
      expect(await f.call("api_list")).toMatchObject({ ok: true, value: { acting: "billing" } });
    } finally { await f.mcp.endAll(); }
  });

  it("does not replay under default when identity_switch cannot restore on a replacement session", async () => {
    const f = fixture();
    try {
      await f.prepare();
      f.refuse("params_invalid");
      f.loseSelectedSession();
      expect(await f.call("api_list")).toMatchObject({ ok: false, code: "rpc_error" });
      expect(f.calls.filter((c) => c.name === "api_list")).toHaveLength(1);
      expect(f.calls.filter((c) => c.name === "identity_switch" && c.args?.profile === "redacted")).toHaveLength(2);

      // Role controls remain reachable, so the caller can recover explicitly.
      f.refuse(undefined);
      expect(await f.mcp.callTool({ threadId: "thread", generation: "turn", botId: "bot", name: "identity_switch", args: { profile: "dispatch" } }))
        .toMatchObject({ ok: true, value: { acting_as: { slug: "dispatch" } } });
      expect(await f.call()).toMatchObject({ ok: true, value: { acting: "dispatch" } });
    } finally { await f.mcp.endAll(); }
  });

  it("keeps a profile_use choice across a parent-token renewal on the same MCP session", async () => {
    const f = fixture({ defaultIdentity: false });
    try {
      await f.prepare();
      await f.mcp.callTool({ threadId: "thread", generation: "turn", botId: "bot", name: "profile_use", args: { profile: "dispatch" } });
      f.unauthorized();
      expect(await f.call("shared_write")).toMatchObject({ ok: true, value: { acting: "dispatch" } });
      const writes = f.calls.filter((c) => c.name === "shared_write");
      expect(writes).toHaveLength(2);
      expect(writes[0]!.token).not.toBe(writes[1]!.token);
      expect(writes[0]!.session).toBe(writes[1]!.session);
      expect(f.calls.filter((c) => c.name === "profile_use" && c.args?.profile === "dispatch")).toHaveLength(2);
    } finally { await f.mcp.endAll(); }
  });

  it("restores profile_use when an engine initialize replaces the MCP session", async () => {
    const f = fixture({ defaultIdentity: false });
    try {
      await f.prepare();
      await f.mcp.callTool({ threadId: "thread", generation: "turn", botId: "bot", name: "profile_use", args: { profile: "dispatch" } });
      f.rotateSession();
      await f.mcp.relay({ threadId: "thread", generation: "turn", botId: "bot", frame: { jsonrpc: "2.0", id: 63, method: "initialize", params: {} } });
      expect(await f.call()).toMatchObject({ ok: true, value: { acting: "dispatch" } });
      expect(f.calls.filter((c) => c.name === "profile_use" && c.args?.profile === "dispatch")).toHaveLength(2);
    } finally { await f.mcp.endAll(); }
  });

  it("switches again after the parent token refreshes within the same session", async () => {
    const f = fixture();
    try {
      await f.prepare(); await f.call(); f.unauthorized();
      expect(await f.call()).toMatchObject({ ok: true, value: { acting: "redacted" } });
      const switches = f.calls.filter((c) => c.args?.profile);
      expect(switches).toHaveLength(2);
      expect(switches[0]!.session).toBe(switches[1]!.session);
      expect(switches[0]!.token).not.toBe(switches[1]!.token);
    } finally { await f.mcp.endAll(); }
  });

  it("uses the same token on stateless connections", async () => {
    const f = fixture({ stateless: true });
    try {
      await f.prepare();
      expect(await f.call()).toMatchObject({ ok: true, value: { acting: "redacted" } });
      expect(new Set(f.calls.map((c) => c.token)).size).toBe(1);
      expect(f.calls.every((c) => c.session === undefined)).toBe(true);
    } finally { await f.mcp.endAll(); }
  });

  it("re-switches before work when the catalogue request itself refreshes the parent", async () => {
    const f = fixture();
    try {
      await f.prepare(); f.refreshCatalog();
      await f.mcp.relay({ threadId: "thread", generation: "turn", botId: "bot", frame: { jsonrpc: "2.0", method: "notifications/tools/list_changed" } });
      await f.mcp.relay({ threadId: "thread", generation: "turn", botId: "bot", frame: { jsonrpc: "2.0", id: 50, method: "tools/list" } });
      expect(await f.call()).toMatchObject({ ok: true, value: { acting: "redacted" } });
      expect(f.calls.filter((c) => c.args?.profile)).toHaveLength(2);
    } finally { await f.mcp.endAll(); }
  });

  it("opens a fresh remote session at every warm generation boundary even when clear fails", async () => {
    const f = fixture({ warm: true, defaultIdentity: false, clearFails: true });
    try {
      await f.prepare("thread", "redacted");
      expect(await f.call()).toMatchObject({ ok: true, value: { acting: "redacted" } });
      const firstSession = f.calls.find((c) => c.args?.profile === "redacted")?.session;
      await f.mcp.endGeneration("thread", "turn");
      expect(f.calls.at(-1)?.args).toEqual({ clear: true });
      await f.prepare("thread", null);
      expect(await f.call()).toMatchObject({ ok: true, value: { acting: "default" } });
      const secondSession = f.calls.findLast((c) => c.method === "tools/call" && c.name === "api_list")?.session;
      expect(secondSession).toBeTruthy();
      expect(secondSession).not.toBe(firstSession);
      expect(f.calls.filter((c) => c.args?.profile)).toHaveLength(1);
    } finally { await f.mcp.endAll(); }
  });

  it("re-switches if an engine initialize replaces a session opened by a native call", async () => {
    const f = fixture();
    try {
      await f.prepare(); await f.call(); f.rotateSession();
      await f.mcp.relay({ threadId: "thread", generation: "turn", botId: "bot" , frame: { jsonrpc: "2.0", id: 9, method: "initialize", params: {} } });
      expect(await f.call()).toMatchObject({ ok: true, value: { acting: "redacted" } });
      expect(f.calls.filter((c) => c.args?.profile)).toHaveLength(2);
    } finally { await f.mcp.endAll(); }
  });

  it("can act as a chosen identity without any bot profile setting", async () => {
    const f = fixture({ defaultIdentity: false });
    try {
      expect(await f.prepare()).toMatchObject({ mounted: [{ name: "Perspicax" }] });
      expect(await f.call()).toMatchObject({ ok: true, value: { acting: "default" } });
      await f.mcp.callTool({ threadId: "thread", generation: "turn", botId: "bot", name: "identity_switch", args: { profile: "redacted" } });
      expect(await f.call()).toMatchObject({ ok: true, value: { acting: "redacted" } });
    } finally { await f.mcp.endAll(); }
  });

  it("isolates overlapping turns and clears each connection", async () => {
    const f = fixture({ defaultIdentity: false });
    try {
      await f.prepare("one", "redacted"); await f.call("api_list", "one");
      await f.prepare("two", "dispatch"); await f.call("api_list", "two");
      expect(await f.call("api_list", "one")).toMatchObject({ ok: true, value: { acting: "redacted" } });
      expect(await f.call("api_list", "two")).toMatchObject({ ok: true, value: { acting: "dispatch" } });
      await f.mcp.endGeneration("one", "turn");
      expect(await f.call("api_list", "two")).toMatchObject({ ok: true, value: { acting: "dispatch" } });
    } finally { await f.mcp.endAll(); }
    expect(f.calls.filter((c) => c.args?.clear)).toHaveLength(2);
  });
});
