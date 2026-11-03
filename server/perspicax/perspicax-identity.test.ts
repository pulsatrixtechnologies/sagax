import { afterEach, describe, expect, it, vi } from "vitest";
import { PerspicaxMcp } from "./perspicax-mcp.ts";
import { identityWarning } from "./perspicax-identity.ts";

// Fake Perspicax MCP transport: no sockets, credentials or live data. Its
// connection-scoped identity is bound to the session (or token when stateless).
function fixture(options: { older?: boolean; stateless?: boolean; refuse?: string; noMounts?: boolean; warm?: boolean } = {}) {
  let sequence = 0;
  let lapses = 0;
  let refuse = options.refuse;
  let unauthorized = false;
  let refreshCatalog = false;
  let nextSession: string | undefined;
  const calls: Array<{ method: string; name?: string; args?: any; session?: string; token: string }> = [];
  const warnings: string[] = [];
  const identities = new Map<string, string>();
  const catalog = [
    { id: "P1", slug: "dispatch", name: "Service desk", description: "" },
    { id: "P2", slug: "redacted", name: "Bot attribution", description: "" },
  ];
  const profiles = catalog.map((p) => ({ slug: p.slug, name: p.name, explicit_only: p.slug === "redacted", reachable: true }));
  const tools = (acting?: string) => [
    ...(!options.older ? [{ name: "identity_switch", annotations: { readOnlyHint: true } }] : []),
    { name: "api_list", annotations: { readOnlyHint: true } },
    { name: acting === "redacted" ? "bot_write" : "person_write", annotations: { readOnlyHint: false } },
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
    if ((unauthorized && name !== "identity_switch") || (refreshCatalog && frame.method === "tools/list" && identities.has(key))) {
      unauthorized = false; refreshCatalog = false; identities.delete(key);
      return new Response(null, { status: 401 });
    }
    if (frame.id === undefined) return new Response(null, { status: 202 });
    const reply = (result: unknown) => {
      const response = new Response(JSON.stringify({ jsonrpc: "2.0", id: frame.id, result }), { headers: { "content-type": "application/json", ...(!options.stateless ? { "mcp-session-id": nextSession ?? session ?? `session-${sequence}` } : {}) } });
      nextSession = undefined;
      return response;
    };
    if (frame.method === "initialize") return reply({ protocolVersion: "2025-06-18", capabilities: {} });
    if (frame.method === "tools/list") return reply({ tools: tools(identities.get(key)) });
    if (name === "identity_switch") {
      if (args.profile && refuse) return reply({ isError: true, structuredContent: { error: { code: refuse === "switch_not_consented" ? "policy_denied" : refuse, detail: { reason: refuse } } } });
      if (args.clear) identities.delete(key);
      if (args.profile) identities.set(key, args.profile);
      return reply({ structuredContent: { profiles, lapsed: null, renewed: !!args.profile, acting_as: identities.has(key) ? { slug: identities.get(key), name: "Bot attribution", token: { expires_at: new Date(Date.now() + 900_000).toISOString() } } : null } });
    }
    if (lapses > 0) {
      lapses -= 1;
      return reply({ isError: true, _meta: { act_as: { code: "act_as_expired" } } });
    }
    return reply({ structuredContent: { acting: identities.get(key) ?? "default", name } });
  });
  const bot = { id: "bot", perspicax: { profiles: options.noMounts ? [] : ["P1"] }, perspicaxActAs: { slug: "redacted", name: "Bot attribution" } as { slug: string; name: string } | undefined };
  const mcp = new PerspicaxMcp({
    issuer: "https://fake.test", version: "test", now: Date.now, fetch: fetcher,
    link: () => ({
      mcpEndpoint: () => "https://fake.test/mcp", profileCatalog: () => catalog,
      exchangeToken: async () => ({ ok: true, token: `fake-parent-${++sequence}`, expiresAt: Date.now() + 3_600_000 }),
      revokeExchanged: async () => true,
    }),
    subjectOf: () => ({ iss: "https://fake.test", sub: "alice", disabled: false }),
    subjectToken: async () => ({ ok: true, token: "fake-signin", expiresAt: Date.now() + 3_600_000 }),
    botProfiles: () => bot.perspicax.profiles,
    botActAs: () => bot.perspicaxActAs,
    heldProfiles: () => ["P1"],
    keepWarm: () => options.warm === true,
    onIdentityWarning: ({ reason }) => warnings.push(identityWarning(reason, "en")), log: () => {},
  });
  const prepare = (threadId = "thread") => mcp.prepareTurn({ threadId, generation: "turn", bot, speakerPrincipalId: "alice", speakerOrigin: "person" });
  const call = (name = "api_list", threadId = "thread") => mcp.callTool({ threadId, generation: "turn", botId: "bot", name, args: {} });
  return { mcp, bot, calls, warnings, prepare, call, lapse: (times = 1) => { lapses = times; }, refuse: (reason: string | undefined) => { refuse = reason; }, unauthorized: () => { unauthorized = true; }, refreshCatalog: () => { refreshCatalog = true; }, rotateSession: () => { nextSession = "replacement-session"; } };
}

afterEach(() => { vi.useRealTimers(); });

describe("Perspicax per-turn identity", () => {
  it("switches on the same session before the first call and re-lists its surface", async () => {
    const f = fixture();
    try {
      await f.prepare();
      expect(await f.call()).toMatchObject({ ok: true, value: { acting: "redacted" } });
      expect(f.calls.map((c) => c.name ?? c.method)).toEqual(["initialize", "notifications/initialized", "tools/list", "identity_switch", "tools/list", "api_list"]);
      expect(new Set(f.calls.slice(1).map((c) => c.session)).size).toBe(1);
      const listing = await f.mcp.relay({ threadId: "thread", generation: "turn", botId: "bot", profileId: "P1", frame: { jsonrpc: "2.0", id: 10, method: "tools/list" } });
      expect(JSON.stringify(listing.body)).toContain("bot_write");
      expect(JSON.stringify(listing.body)).not.toContain("person_write");
    } finally { await f.mcp.endAll(); }
    expect(f.calls.at(-1)?.args).toEqual({ clear: true });
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
    const f = fixture();
    f.bot.perspicaxActAs = undefined;
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

  it("never sends a write on the default surface when re-switching after a parent refresh fails", async () => {
    const f = fixture();
    try {
      await f.prepare(); await f.call(); f.refuse("switch_not_consented"); f.unauthorized();
      expect(await f.call("bot_write")).toMatchObject({ ok: true, isError: true });
      expect(f.calls.filter((c) => c.name === "bot_write")).toHaveLength(1); // only the refused 401
      expect(f.warnings).toHaveLength(1);
    } finally { await f.mcp.endAll(); }
  });

  it("reports an explicitly requested block switch refusal in plain words too", async () => {
    const f = fixture({ refuse: "switch_not_consented" });
    f.bot.perspicaxActAs = undefined;
    try {
      await f.prepare();
      expect(await f.mcp.callTool({ threadId: "thread", generation: "turn", botId: "bot", name: "identity_switch", args: { profile: "redacted" } })).toMatchObject({ ok: true, isError: true });
      expect(f.warnings).toEqual([identityWarning("switch_not_consented", "en")]);
      expect(await f.call()).toMatchObject({ ok: true, isError: false });
    } finally { await f.mcp.endAll(); }
  });

  it.each(["switch_not_consented", "params_invalid"])("shows %s in plain words and continues on the read plane", async (reason) => {
    const f = fixture({ refuse: reason });
    try {
      await f.prepare();
      expect(await f.call()).toMatchObject({ ok: true, isError: false });
      expect(f.warnings).toEqual([identityWarning(reason as "params_invalid", "en")]);
      expect(f.warnings[0]).toContain("This turn can only read");
      expect(await f.call("person_write")).toMatchObject({ ok: true, isError: true });
      expect(f.calls.some((c) => c.name === "person_write")).toBe(false);
    } finally { await f.mcp.endAll(); }
  });

  it("quietly keeps today's behaviour on older servers", async () => {
    const f = fixture({ older: true });
    try {
      await f.prepare();
      expect(await f.call("person_write")).toMatchObject({ ok: true, isError: false, value: { acting: "default" } });
      expect(f.calls.some((c) => c.name === "identity_switch")).toBe(false);
      expect(f.warnings).toEqual([]);
    } finally { await f.mcp.endAll(); }
  });

  it("lists human names and explicit-only profiles without selecting any by default", async () => {
    const f = fixture();
    try {
      const listing = await f.mcp.listIdentities("alice", "P1");
      expect(listing).toMatchObject({ supported: true, profiles: [{ name: "Service desk" }, { name: "Bot attribution", explicit_only: true }] });
      f.bot.perspicaxActAs = undefined;
      await f.prepare();
      expect(await f.call()).toMatchObject({ ok: true, value: { acting: "default" } });
      expect(f.calls.filter((c) => c.name === "identity_switch").map((c) => c.args)).toEqual([{}]);
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
      expect(await f.call()).toMatchObject({ ok: true, value: { acting: "redacted" } });
      expect(f.calls.filter((c) => c.args?.profile)).toHaveLength(2);
    } finally { await f.mcp.endAll(); }
  });

  it("clears at every turn boundary even when a voice call keeps the MCP session warm", async () => {
    const f = fixture({ warm: true });
    try {
      await f.prepare(); await f.call();
      await f.mcp.endGeneration("thread", "turn");
      expect(f.calls.at(-1)?.args).toEqual({ clear: true });
      f.bot.perspicaxActAs = undefined;
      await f.prepare();
      expect(await f.call()).toMatchObject({ ok: true, value: { acting: "default" } });
      expect(f.calls.filter((c) => c.args?.profile)).toHaveLength(1);
    } finally { await f.mcp.endAll(); }
  });

  it("re-switches if an engine initialize replaces a session opened by a native call", async () => {
    const f = fixture();
    try {
      await f.prepare(); await f.call(); f.rotateSession();
      await f.mcp.relay({ threadId: "thread", generation: "turn", botId: "bot", profileId: "P1", frame: { jsonrpc: "2.0", id: 9, method: "initialize", params: {} } });
      expect(await f.call()).toMatchObject({ ok: true, value: { acting: "redacted" } });
      expect(f.calls.filter((c) => c.args?.profile)).toHaveLength(2);
    } finally { await f.mcp.endAll(); }
  });

  it("can act as a chosen identity when the bot has no legacy profile mounts", async () => {
    const f = fixture({ noMounts: true });
    try {
      expect(await f.prepare()).toMatchObject({ mounted: [{ profileId: "P1" }] });
      expect(await f.call()).toMatchObject({ ok: true, value: { acting: "redacted" } });
    } finally { await f.mcp.endAll(); }
  });

  it("isolates overlapping turns and clears each connection", async () => {
    const f = fixture();
    try {
      await f.prepare("one"); await f.call("api_list", "one");
      f.bot.perspicaxActAs = { slug: "dispatch", name: "Service desk" };
      await f.prepare("two"); await f.call("api_list", "two");
      expect(await f.call("api_list", "one")).toMatchObject({ ok: true, value: { acting: "redacted" } });
      expect(await f.call("api_list", "two")).toMatchObject({ ok: true, value: { acting: "dispatch" } });
      await f.mcp.endGeneration("one", "turn");
      expect(await f.call("api_list", "two")).toMatchObject({ ok: true, value: { acting: "dispatch" } });
    } finally { await f.mcp.endAll(); }
    expect(f.calls.filter((c) => c.args?.clear)).toHaveLength(2);
  });
});
