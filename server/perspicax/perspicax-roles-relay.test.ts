import { describe, expect, it, vi } from "vitest";
import { PerspicaxMcp, type PerspicaxRoleEvent } from "./perspicax-mcp.ts";

// Fake Perspicax for the visible-roles relay: no sockets, credentials or live
// data. "service-desk" is refused (403) on time entries, read and write;
// the person's own surface ("Moi") reads them.
function fixture(options: { routine?: boolean; turnRole?: { slug: string; reason: "person" | "routine" }; fallback?: "fallback" | "rule" | "stay"; meWrite?: "allow" | "deny"; meRefused?: "result" | "rpc" } = {}) {
  const calls: Array<{ name?: string; args?: any; acting?: string }> = [];
  const acting = new Map<string, string>();
  const profiles = [
    { slug: "service-desk", name: "Service Desk", read_only: false, explicit_only: false, reachable: true, can: { read: true, write: true } },
    { slug: "full-access", name: "Full Access", read_only: false, explicit_only: false, reachable: true, can: { read: true, write: true } },
  ];
  const tools = [
    { name: "identity_switch", annotations: { readOnlyHint: true } },
    { name: "profile_use", annotations: { readOnlyHint: true } },
    { name: "cw_psa_find_time_entries", annotations: { readOnlyHint: true } },
    { name: "cw_psa_find_tickets", annotations: { readOnlyHint: true } },
    { name: "cw_psa_log_time", annotations: { readOnlyHint: false } },
  ];
  const fetcher: typeof fetch = vi.fn(async (_url, init) => {
    const headers = init!.headers as Record<string, string>;
    const key = headers["mcp-session-id"] ?? "s1";
    if (init!.method === "DELETE") return new Response(null, { status: 204 });
    const frame = JSON.parse(String(init!.body));
    if (frame.id === undefined) return new Response(null, { status: 202 });
    const name = frame.params?.name;
    const args = frame.params?.arguments ?? {};
    calls.push({ name: name ?? frame.method, args, acting: acting.get(key) ?? "" });
    const reply = (result: unknown) => new Response(JSON.stringify({ jsonrpc: "2.0", id: frame.id, result }), { headers: { "content-type": "application/json", "mcp-session-id": "s1" } });
    if (frame.method === "initialize") return reply({ protocolVersion: "2025-06-18", capabilities: {} });
    if (frame.method === "tools/list") return reply({ tools });
    if (name === "identity_switch") {
      if (args.clear) acting.delete(key);
      if (typeof args.profile === "string") acting.set(key, args.profile);
      const now = acting.get(key);
      return reply({ structuredContent: { profiles, changed: args.clear === true || typeof args.profile === "string", acting_as: now ? { slug: now, name: profiles.find((p) => p.slug === now)?.name, target_identity: "cw_member:nova", token: { scope: `profile:${now}-id`, expires_at: new Date(Date.now() + 900_000).toISOString() } } : null } });
    }
    const role = acting.get(key) ?? "";
    // #2581: the account behind every role lacks Service Tickets (vendor 403)
    if (name === "cw_psa_find_time_entries" && options.meRefused === "rpc") {
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: frame.id, error: { code: -32000, message: "ConnectWise answered 403: You do not have security permission to perform this action", data: { details: { status: 403, reason: "Security" } } } }), { headers: { "content-type": "application/json", "mcp-session-id": "s1" } });
    }
    if (name === "cw_psa_find_time_entries" && options.meRefused === "result") {
      return reply({ isError: true, structuredContent: { code: "upstream_error", message: "ConnectWise answered 403", details: { status: 403 } } });
    }
    if ((name === "cw_psa_find_time_entries" || name === "cw_psa_log_time") && role === "service-desk") {
      return reply({ isError: true, structuredContent: { code: "upstream_error", message: "ConnectWise answered 403", details: { status: 403 } } });
    }
    return reply({ structuredContent: { ok: true, as: role || "me", name } });
  });
  const events: PerspicaxRoleEvent[] = [];
  const asked: string[] = [];
  const mcp = new PerspicaxMcp({
    issuer: "https://fake.test", version: "test", now: Date.now, fetch: fetcher,
    link: () => ({ mcpEndpoint: () => "https://fake.test/mcp", exchangeToken: async () => ({ ok: true, token: "fake-parent", expiresAt: Date.now() + 3_600_000 }), revokeExchanged: async () => true }),
    subjectOf: () => ({ iss: "https://fake.test", sub: "alice", disabled: false }),
    subjectToken: async () => ({ ok: true, token: "fake-signin", expiresAt: Date.now() + 3_600_000 }),
    routineSubjectToken: async () => ({ ok: true, token: "fake-delegation", expiresAt: Date.now() + 3_600_000 }),
    botExists: () => true,
    routineRetryMs: [],
    sleep: async () => {},
    log: () => {},
    onRole: (event) => events.push(event),
    turnRole: () => options.turnRole,
    roleFallback: () => options.fallback ?? "fallback",
    askMeWrite: async ({ tool }) => { asked.push(tool); return options.meWrite ?? "deny"; },
  });
  let id = 0;
  const prepare = () => mcp.prepareTurn({ threadId: "t", generation: "g", bot: { id: "bot" }, speakerPrincipalId: "alice", speakerOrigin: options.routine ? "owner-routine" : "person", ...(options.routine ? { routine: true } : {}) });
  const relay = (name: string, args: Record<string, unknown> = {}) => mcp.relay({ threadId: "t", generation: "g", botId: "bot", frame: { jsonrpc: "2.0", id: `e${++id}`, method: "tools/call", params: { name, arguments: args } } });
  const init = () => mcp.relay({ threadId: "t", generation: "g", botId: "bot", frame: { jsonrpc: "2.0", id: "i", method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {} } } });
  const text = (answer: { body?: unknown }) => JSON.stringify(answer.body);
  return { mcp, calls, events, asked, prepare, relay, init, text };
}

describe("visible roles in the Perspicax relay", () => {
  it("reports the default surface (Moi) for a chat step, with no selection", async () => {
    const f = fixture();
    await f.prepare();
    await f.init();
    await f.relay("cw_psa_find_tickets");
    expect(f.events.at(-1)).toMatchObject({ kind: "step", tool: "cw_psa_find_tickets", role: { slug: "", reason: "default" } });
    expect(f.calls.some((call) => call.name === "identity_switch" && call.args.profile)).toBe(false);
  });

  it("starts a routine under its role, then falls back to Moi once on a read 403 and puts the role back", async () => {
    const f = fixture({ routine: true, turnRole: { slug: "service-desk", reason: "routine" } });
    await f.prepare();
    await f.init();
    const answer = await f.relay("cw_psa_find_time_entries");
    expect(f.text(answer)).toContain('"as":"me"');
    expect(f.text(answer)).toContain("read this once in the person's own name");
    const step = f.events.find((event) => event.kind === "step" && event.tool === "cw_psa_find_time_entries");
    expect(step).toMatchObject({ role: { slug: "", reason: "fallback", refusedTool: "cw_psa_find_time_entries", previous: { slug: "service-desk", name: "Service Desk" } }, permission: { path: "time/entries", operation: "Inquire" } });
    // one clear, one resend as Moi, one restore: the next call is Dispatch again
    const reads = f.calls.filter((call) => call.name === "cw_psa_find_time_entries");
    expect(reads.map((call) => call.acting)).toEqual(["service-desk", ""]);
    await f.relay("cw_psa_find_tickets");
    expect(f.calls.filter((call) => call.name === "cw_psa_find_tickets").at(-1)).toMatchObject({ acting: "service-desk" });
    expect(f.events.at(-1)).toMatchObject({ role: { slug: "service-desk", name: "Service Desk", reason: "routine" } });
  });

  it("stays in the role when the thread said so: no fallback", async () => {
    const f = fixture({ routine: true, turnRole: { slug: "service-desk", reason: "routine" }, fallback: "stay" });
    await f.prepare();
    await f.init();
    const answer = await f.relay("cw_psa_find_time_entries");
    expect(f.text(answer)).toContain("asked to stay in that role");
    expect(f.calls.filter((call) => call.name === "cw_psa_find_time_entries")).toHaveLength(1);
    expect(f.events.at(-1)).toMatchObject({ kind: "read_refused", refusedRole: { slug: "service-desk" } });
  });

  it("stops on a write 403, shows the permission and refuses a switch to get around it", async () => {
    const f = fixture({ routine: true, turnRole: { slug: "service-desk", reason: "routine" } });
    await f.prepare();
    await f.init();
    const answer = await f.relay("cw_psa_log_time", { ticket: 1 });
    expect(f.text(answer)).toContain("STOP: this write was refused (403) under Service Desk");
    expect(f.calls.filter((call) => call.name === "cw_psa_log_time")).toHaveLength(1);
    expect(f.events.at(-1)).toMatchObject({ kind: "write_refused", permission: { path: "time/entries", operation: "Add", module: "Time & Expense" }, target: "cw_member:nova" });
    const escape = await f.relay("identity_switch", { profile: "full-access" });
    expect(f.text(escape)).toContain("switching roles to get around it is not allowed");
  });

  it("keeps the role the person picked for the turn", async () => {
    const f = fixture({ turnRole: { slug: "full-access", reason: "person" } });
    await f.prepare();
    await f.init();
    await f.relay("cw_psa_find_tickets");
    expect(f.calls.filter((call) => call.name === "cw_psa_find_tickets").at(-1)).toMatchObject({ acting: "full-access" });
    expect(f.events.at(-1)).toMatchObject({ role: { slug: "full-access", name: "Full Access", reason: "person" } });
    const away = await f.relay("identity_switch", { profile: "service-desk" });
    expect(f.text(away)).toContain("the person fixed the role for this turn");
  });

  it("learns a role's profile id from its act-as token when the listing serves none (Roles tab)", async () => {
    const f = fixture();
    await f.prepare();
    await f.init();
    await f.relay("identity_switch", { profile: "full-access" });
    await f.relay("cw_psa_find_tickets");
    const held = f.events.at(-1)?.held ?? [];
    expect(held.find((role) => role.slug === "full-access")).toMatchObject({ id: "full-access-id" });
    expect(held.find((role) => role.slug === "service-desk")?.id).toBeUndefined();
  });

  it("asks the person before a routine under a role writes as Moi", async () => {
    const f = fixture({ routine: true, turnRole: { slug: "service-desk", reason: "routine" }, meWrite: "deny" });
    await f.prepare();
    await f.init();
    await f.relay("identity_switch", { clear: true });
    const answer = await f.relay("cw_psa_log_time", { ticket: 1 });
    expect(f.asked).toEqual(["cw_psa_log_time"]);
    expect(f.text(answer)).toContain("did not approve it");
    expect(f.calls.some((call) => call.name === "cw_psa_log_time")).toBe(false);
  });

  it("names a bot switch as a switch with the previous role", async () => {
    const f = fixture();
    await f.prepare();
    await f.init();
    await f.relay("identity_switch", { profile: "service-desk" });
    expect(f.events.at(-1)).toMatchObject({ kind: "step", tool: "identity_switch", role: { slug: "service-desk", reason: "switch", previous: { slug: "" } } });
    await f.relay("cw_psa_find_tickets");
    expect(f.events.at(-1)).toMatchObject({ role: { slug: "service-desk", reason: "switch" } });
  });

  // #2258: Grok's gateway catalog reads this slug for the active connector.
  it("activeProfileFor exposes the turn's act-as / switched role", async () => {
    const chat = fixture();
    await chat.prepare();
    expect(chat.mcp.activeProfileFor("t", "bot")).toBeUndefined();
    const routine = fixture({ routine: true, turnRole: { slug: "service-desk", reason: "routine" } });
    await routine.prepare();
    expect(routine.mcp.activeProfileFor("t", "bot")).toBe("service-desk");
    const switched = fixture();
    await switched.prepare();
    await switched.init();
    await switched.relay("identity_switch", { profile: "full-access" });
    expect(switched.mcp.activeProfileFor("t", "bot")).toBe("full-access");
  });
  // #2577 / #2581: a 403 is a clean block, never a detour.
  it("marks a refused read under the default surface as a STOP block and refuses a switch after it", async () => {
    const f = fixture({ meRefused: "result" });
    await f.prepare();
    await f.init();
    const answer = await f.relay("cw_psa_find_time_entries");
    expect(f.text(answer)).toContain("STOP: this read was refused (403)");
    expect(f.text(answer)).toContain("Time & Expense");
    expect(f.text(answer)).toContain("not missing data");
    const escape = await f.relay("identity_switch", { profile: "full-access" });
    expect(f.text(escape)).toContain("a read was refused (403) in this turn");
    expect(f.calls.some((call) => call.name === "identity_switch" && call.args.profile === "full-access")).toBe(false);
  });

  it("turns a JSON-RPC 403 error into a STOP block the model reads", async () => {
    const f = fixture({ meRefused: "rpc" });
    await f.prepare();
    await f.init();
    const answer = await f.relay("cw_psa_find_time_entries");
    const body = answer.body as { result?: { isError?: boolean } };
    expect(body.result?.isError).toBe(true);
    expect(f.text(answer)).toContain("STOP: this read was refused (403)");
    expect(f.text(answer)).toContain("You do not have security permission");
  });

  it("marks a read still refused after the one fallback as a STOP block", async () => {
    const f = fixture({ routine: true, turnRole: { slug: "service-desk", reason: "routine" }, meRefused: "result" });
    await f.prepare();
    await f.init();
    const answer = await f.relay("cw_psa_find_time_entries");
    expect(f.text(answer)).toContain("STOP: this read was refused (403)");
    expect(f.calls.filter((call) => call.name === "cw_psa_find_time_entries")).toHaveLength(2);
  });

  it("allows one identity switch per turn, then blocks the loop", async () => {
    const f = fixture();
    await f.prepare();
    await f.init();
    await f.relay("identity_switch", { profile: "service-desk" });
    const again = await f.relay("identity_switch", { profile: "full-access" });
    expect(f.text(again)).toContain("one role switch per turn");
    expect(f.calls.filter((call) => call.name === "identity_switch" && call.args.profile === "full-access")).toHaveLength(0);
    // a new turn starts fresh
    await f.prepare();
    await f.init();
    const next = await f.relay("identity_switch", { profile: "full-access" });
    expect(f.text(next)).not.toContain("Refused by Sagax");
  });
});
