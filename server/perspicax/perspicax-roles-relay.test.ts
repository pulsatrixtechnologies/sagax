import { describe, expect, it, vi } from "vitest";
import { PerspicaxMcp, boardListRead, type PerspicaxRoleEvent } from "./perspicax-mcp.ts";

// Fake Perspicax for the visible-roles relay: no sockets, credentials or live
// data. "service-desk" is refused (403) on time entries, read and write;
// the person's own surface ("Moi") reads them.
function fixture(options: { routine?: boolean; turnRole?: { slug: string; reason: "person" | "routine" }; fallback?: "fallback" | "rule" | "stay"; meWrite?: "allow" | "deny"; meRefused?: "result" | "rpc"; readableBy?: string; explicitFull?: boolean; roleSwitch?: "allow" | "deny"; knownRefused?: boolean; projectReadableBy?: string; writableBy?: string; ruleTo?: string; switchFails?: string; ticketReadableBy?: string; ticketCounts?: Record<string, number>; pauseSwitchedList?: { reached: () => void; release: Promise<void> }; scheduleWritableBy?: string } = {}) {
  const calls: Array<{ name?: string; args?: any; acting?: string }> = [];
  const acting = new Map<string, string>();
  const profiles = [
    { slug: "service-desk", name: "Service Desk", read_only: false, explicit_only: false, reachable: true, can: { read: true, write: true } },
    { slug: "full-access", name: "Full Access", read_only: false, explicit_only: options.explicitFull === true, reachable: true, can: { read: true, write: true } },
  ];
  const tools = [
    { name: "identity_switch", annotations: { readOnlyHint: true } },
    { name: "profile_use", annotations: { readOnlyHint: true } },
    { name: "cw_psa_find_time_entries", annotations: { readOnlyHint: true } },
    { name: "cw_psa_find_tickets", annotations: { readOnlyHint: true } },
    { name: "cw_psa_get_ticket", annotations: { readOnlyHint: true } },
    { name: "cw_psa_query", annotations: { readOnlyHint: true } },
    { name: "cw_psa_find_project_tickets", annotations: { readOnlyHint: true } },
    { name: "cw_psa_log_time", annotations: { readOnlyHint: false } },
    { name: "cw_psa_write", annotations: { readOnlyHint: false } },
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
      // a switch Perspicax refuses: the role stays as it was
      if (options.switchFails !== undefined && args.profile === options.switchFails) return reply({ isError: true, structuredContent: { code: "profile_unavailable", message: "profile not available" } });
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
    // #2581: time entries readable only under one role (the bot's is limited on purpose)
    if (name === "cw_psa_find_time_entries" && options.readableBy !== undefined && role !== options.readableBy) {
      return reply({ isError: true, structuredContent: { code: "upstream_error", message: "ConnectWise answered 403", details: { status: 403 } } });
    }
    // QA 0.8.67 G3: project tickets readable only under one role (titles)
    if (name === "cw_psa_find_project_tickets" && options.projectReadableBy !== undefined && role !== options.projectReadableBy) {
      return reply({ isError: true, structuredContent: { code: "upstream_error", message: "ConnectWise answered 403", details: { status: 403 } } });
    }
    // #2988: the generic query refused on project tickets only
    if (name === "cw_psa_query" && String(args.resource ?? "").startsWith("project") && options.projectReadableBy !== undefined && role !== options.projectReadableBy) {
      return reply({ isError: true, structuredContent: { code: "upstream_error", message: "ConnectWise answered 403", details: { status: 403 } } });
    }
    // QA 0.8.69 (#3062): one ticket readable only under one role
    if (name === "cw_psa_get_ticket" && options.ticketReadableBy !== undefined && role !== options.ticketReadableBy) {
      return reply({ isError: true, structuredContent: { code: "upstream_error", message: "ConnectWise answered 403", details: { status: 403 } } });
    }
    // #3062: the list Sagax sends under another role stays on the wire
    // until the test lets it go
    if (name === "cw_psa_find_tickets" && role && options.pauseSwitchedList) {
      options.pauseSwitchedList.reached();
      await options.pauseSwitchedList.release;
    }
    // QA 0.8.69 (#3062): each role sees its own boards, so its own count
    if (name === "cw_psa_find_tickets" && options.ticketCounts !== undefined) {
      const total = options.ticketCounts[role || "me"] ?? 0;
      const items = Array.from({ length: total }, (_, index) => ({ id: index + 1 }));
      return reply({ content: [{ type: "text", text: JSON.stringify({ total, items }) }], structuredContent: { total, items, as: role || "me" } });
    }
    if (name === "cw_psa_find_time_entries" && options.meRefused === "result") {
      return reply({ isError: true, structuredContent: { code: "upstream_error", message: "ConnectWise answered 403", details: { status: 403 } } });
    }
    // d7-403-switch-role: time entries writable only under one role
    if (name === "cw_psa_log_time" && options.writableBy !== undefined && role !== options.writableBy) {
      return reply({ isError: true, structuredContent: { code: "upstream_error", message: "ConnectWise answered 403", details: { status: 403 } } });
    }
    // #3694: the organization's connector refuses a call it cannot map to an
    // operation (a mistyped resource) at its Flow guard, under any role and
    // dry run or not: nothing reaches the vendor
    if (name === "cw_psa_write" && !/^[a-z]+\.[a-z]+$/.test(String(args.resource ?? ""))) {
      return reply({ isError: true, content: [{ type: "text", text: `Pulsatrix Flow guard: ${args.resource} cannot be mapped to an operation, so no guard can check it` }], structuredContent: { code: "policy_denied", message: `Pulsatrix Flow guard: ${args.resource} cannot be mapped to an operation, so no guard can check it`, hint: "nothing was sent; a person does it, or the operator lifts the stop", details: { flow_guard: "flow_guard_denied", reason: "flow_guard_denied", status: 403 } } });
    }
    // #3694: a schedule entry is written only under one role (the vendor's 403)
    if (name === "cw_psa_write" && String(args.resource).startsWith("schedule") && options.scheduleWritableBy !== undefined && role !== options.scheduleWritableBy) {
      return reply({ isError: true, structuredContent: { code: "upstream_error", message: "ConnectWise answered 403", details: { status: 403 } } });
    }
    if ((name === "cw_psa_find_time_entries" || name === "cw_psa_log_time") && role === "service-desk") {
      return reply({ isError: true, structuredContent: { code: "upstream_error", message: "ConnectWise answered 403", details: { status: 403 } } });
    }
    return reply({ structuredContent: { ok: true, as: role || "me", name } });
  });
  const events: PerspicaxRoleEvent[] = [];
  const asked: string[] = [];
  const switchAsked: string[] = [];
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
    roleFallback: ({ to }) => options.ruleTo !== undefined ? (to === options.ruleTo ? "rule" : "fallback") : options.fallback ?? "fallback",
    askMeWrite: async ({ tool }) => { asked.push(tool); return options.meWrite ?? "deny"; },
    askRoleSwitch: async ({ from, to, tool }) => { switchAsked.push(`${from.slug || "me"}>${to.slug}:${tool}`); return options.roleSwitch ?? "deny"; },
    knownReadRefusal: () => options.knownRefused === true,
  });
  let id = 0;
  const prepare = () => mcp.prepareTurn({ threadId: "t", generation: "g", bot: { id: "bot" }, speakerPrincipalId: "alice", speakerOrigin: options.routine ? "owner-routine" : "person", ...(options.routine ? { routine: true } : {}) });
  const relay = (name: string, args: Record<string, unknown> = {}) => mcp.relay({ threadId: "t", generation: "g", botId: "bot", frame: { jsonrpc: "2.0", id: `e${++id}`, method: "tools/call", params: { name, arguments: args } } });
  const init = () => mcp.relay({ threadId: "t", generation: "g", botId: "bot", frame: { jsonrpc: "2.0", id: "i", method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {} } } });
  const text = (answer: { body?: unknown }) => JSON.stringify(answer.body);
  return { mcp, calls, events, asked, switchAsked, prepare, relay, init, text };
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

  // rule d7-403-switch-role (2026-11-07): a write 403 under a limited role
  // looks for a held role that may write, by a rule or a card, sent once
  const writes = (f: ReturnType<typeof fixture>) => f.calls.filter((call) => call.name === "cw_psa_log_time").map((call) => call.acting);

  it("asks a card on a write 403 under a limited role, and stops with the permission when the person declines", async () => {
    const f = fixture({ routine: true, turnRole: { slug: "service-desk", reason: "routine" } });
    await f.prepare();
    await f.init();
    const answer = await f.relay("cw_psa_log_time", { ticket: 1 });
    expect(f.switchAsked).toEqual(["service-desk>:cw_psa_log_time"]);
    expect(f.text(answer)).toContain("STOP: not written");
    expect(f.text(answer)).toContain("did not approve writing it once as the person's own account");
    expect(writes(f)).toEqual(["service-desk"]);
    expect(f.events.at(-1)).toMatchObject({ kind: "write_refused", permission: { path: "time/entries", operation: "Add", module: "Time & Expense" }, target: "cw_member:nova" });
    // #3694: the STOP holds for that write only: the turn goes on, roles
    // switch for other work and the default role comes back
    const other = await f.relay("identity_switch", { profile: "full-access" });
    expect(f.text(other)).not.toContain("Refused by Sagax");
    await f.relay("cw_psa_find_tickets");
    expect(lastTickets(f)).toBe("full-access");
    const back = await f.relay("identity_switch", { clear: true });
    expect(f.text(back)).not.toContain("Refused by Sagax");
    await f.relay("cw_psa_find_tickets");
    expect(lastTickets(f)).toBe("");
  });

  it("sends a write refused under a limited role once as the role the person approved, then puts the role back", async () => {
    const f = fixture({ routine: true, turnRole: { slug: "service-desk", reason: "routine" }, roleSwitch: "allow" });
    await f.prepare();
    await f.init();
    const answer = await f.relay("cw_psa_log_time", { ticket: 1 });
    expect(f.text(answer)).toContain("sent this write once as the person's own account (with the person's approval)");
    expect(f.text(answer)).toContain('"as":"me"');
    expect(writes(f)).toEqual(["service-desk", ""]);
    expect(f.events.find((event) => event.kind === "step" && event.tool === "cw_psa_log_time")).toMatchObject({ role: { slug: "", reason: "fallback", refusedTool: "cw_psa_log_time", previous: { slug: "service-desk" } } });
    await f.relay("cw_psa_find_tickets");
    expect(lastTickets(f)).toBe("service-desk");
  });

  it("switches a refused write by the role a saved rule names, with no card", async () => {
    const f = fixture({ routine: true, turnRole: { slug: "service-desk", reason: "routine" }, writableBy: "full-access", ruleTo: "full-access" });
    await f.prepare();
    await f.init();
    const answer = await f.relay("cw_psa_log_time", { ticket: 1 });
    expect(f.switchAsked).toEqual([]);
    expect(f.text(answer)).toContain("sent this write once as Full Access (the person's saved rule)");
    expect(writes(f)).toEqual(["service-desk", "full-access"]);
    await f.relay("cw_psa_find_tickets");
    expect(lastTickets(f)).toBe("service-desk");
  });

  it("sends a refused write again exactly once: refused again, it stops naming both roles", async () => {
    const f = fixture({ routine: true, turnRole: { slug: "service-desk", reason: "routine" }, writableBy: "nobody", roleSwitch: "allow" });
    await f.prepare();
    await f.init();
    const answer = await f.relay("cw_psa_log_time", { ticket: 1 });
    expect(f.text(answer)).toContain("STOP: this write was refused (403) under Service Desk");
    expect(writes(f)).toEqual(["service-desk", ""]);
    expect(f.switchAsked).toHaveLength(1);
    expect(f.events.at(-1)).toMatchObject({ kind: "write_refused" });
  });

  it("never switches a refused write away from the role the person picked for the turn", async () => {
    const f = fixture({ turnRole: { slug: "service-desk", reason: "person" }, roleSwitch: "allow" });
    await f.prepare();
    await f.init();
    const answer = await f.relay("cw_psa_log_time", { ticket: 1 });
    expect(f.switchAsked).toEqual([]);
    expect(f.text(answer)).toContain("STOP: this write was refused (403) under Service Desk");
    expect(writes(f)).toEqual(["service-desk"]);
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
  // #2577 / #2581: a 403 is never "no data"; decided 2026-11-07: the bot's role is
  // limited on purpose, so a refused read offers one held role for one call.
  const reads = (f: ReturnType<typeof fixture>) => f.calls.filter((call) => call.name === "cw_psa_find_time_entries").map((call) => call.acting);
  const lastTickets = (f: ReturnType<typeof fixture>) => f.calls.filter((call) => call.name === "cw_psa_find_tickets").at(-1)?.acting;

  it("reads a refused read under the next held role by itself, with no card (#3062)", async () => {
    const f = fixture({ readableBy: "full-access", explicitFull: true });
    await f.prepare();
    await f.init();
    const answer = await f.relay("cw_psa_find_time_entries");
    expect(f.text(answer)).toContain('"as":"full-access"');
    expect(f.text(answer)).toContain("read this once as Full Access");
    expect(f.text(answer)).not.toContain("approval card");
    expect(reads(f)).toEqual(["", "full-access"]);
    expect(f.switchAsked).toEqual([]);
    await f.relay("cw_psa_find_tickets");
    expect(lastTickets(f)).toBe("");
  });

  it("lets the bot switch roles itself for a read, with no card", async () => {
    const f = fixture({ readableBy: "full-access", explicitFull: true });
    await f.prepare();
    await f.init();
    const go = await f.relay("identity_switch", { profile: "full-access" });
    expect(f.text(go)).not.toContain("Refused by Sagax");
    const answer = await f.relay("cw_psa_find_time_entries");
    expect(f.text(answer)).toContain('"as":"full-access"');
    expect(reads(f)).toEqual(["full-access"]);
    expect(f.switchAsked).toEqual([]);
  });



  it("switches by itself for one call when a rule allows it: no card", async () => {
    const f = fixture({ readableBy: "full-access", explicitFull: true, fallback: "rule" });
    await f.prepare();
    await f.init();
    const answer = await f.relay("cw_psa_find_time_entries");
    expect(f.text(answer)).toContain("read this once as Full Access");
    expect(reads(f)).toEqual(["", "full-access"]);
    expect(f.switchAsked).toEqual([]);
    await f.relay("cw_psa_find_tickets");
    expect(lastTickets(f)).toBe("");
  });

  it("tries every held role once, then stops naming every role refused, with no card", async () => {
    const f = fixture({ readableBy: "nobody", explicitFull: true, roleSwitch: "allow" });
    await f.prepare();
    await f.init();
    const first = await f.relay("cw_psa_find_time_entries");
    expect(f.text(first)).toContain("STOP: this read was refused (403)");
    expect(f.text(first)).toContain("Full Access (API member nova)");
    expect(f.text(first)).toContain("Service Desk (API member nova)");
    expect(f.text(first)).toContain("which API member and role refused it");
    expect(reads(f)).toEqual(["", "full-access", "service-desk"]);
    // sent again: every role was tried in this turn, STOP, no more reads
    const again = await f.relay("cw_psa_find_time_entries");
    expect(f.text(again)).toContain("STOP");
    expect(reads(f)).toHaveLength(4);
    expect(f.switchAsked).toEqual([]);
  });

  // QA 0.8.67 G3 (#2960): the week's time (time.entries) reads fine; a 403 on
  // project tickets (titles) offers to skip them, and never chains cards.
  it("answers a week's time when project tickets are refused under every role: STOP, give the rest, no card", async () => {
    const f = fixture({ projectReadableBy: "nobody", explicitFull: true, roleSwitch: "allow" });
    await f.prepare();
    await f.init();
    const hours = await f.relay("cw_psa_find_time_entries", { conditions: "member/id=168 and timeStart>=[2026-11-01]" });
    expect(f.text(hours)).toContain('"ok":true');
    expect(f.text(hours)).not.toContain("this list was read under");
    const titles = await f.relay("cw_psa_find_project_tickets", { conditions: "id in (1,2,3)" });
    expect(f.text(titles)).toContain("STOP");
    expect(f.text(titles)).toContain("give the rest of the answer and say in one line what could not be read");
    const more = await f.relay("cw_psa_find_project_tickets", { conditions: "id in (4)" });
    expect(f.text(more)).toContain("STOP");
    expect(f.switchAsked).toEqual([]);
    // the hours still read under the person's own access
    expect(f.text(await f.relay("cw_psa_find_time_entries", { conditions: "member/id=168" }))).toContain('"ok":true');
  });

  // #2988: the offer is for one read path; the same generic tool on another
  // path (the bot skipped the refused detail) is a plain read, not the card
  it("reads a refused path of the generic tool under the role that reads it, and leaves other paths under Moi", async () => {
    const f = fixture({ projectReadableBy: "full-access", explicitFull: true, roleSwitch: "allow" });
    await f.prepare();
    await f.init();
    const titles = await f.relay("cw_psa_query", { resource: "project.tickets" });
    expect(f.text(titles)).toContain('"as":"full-access"');
    const companies = await f.relay("cw_psa_query", { resource: "company.companies" });
    expect(f.text(companies)).toContain('"as":"me"');
    expect(f.calls.filter((call) => call.name === "cw_psa_query").map((call) => call.acting)).toEqual(["", "full-access", ""]);
    expect(f.switchAsked).toEqual([]);
  });

  it("blocks with the permission when no other held role can be tried", async () => {
    const f = fixture({ meRefused: "result", knownRefused: true });
    await f.prepare();
    await f.init();
    const answer = await f.relay("cw_psa_find_time_entries");
    expect(f.text(answer)).toContain("STOP: this read was refused (403)");
    expect(f.text(answer)).toContain("no other role you hold can be tried");
    expect(f.text(answer)).toContain("not missing data");
    // #2912: the clause #2905 added to readStop, in its negative form.
    expect(f.text(answer)).toContain("Tell the person the read is blocked, which API member and role refused it and which permission the account needs; never say it needs an admin or that nothing can be done.");
  });

  it("turns a JSON-RPC 403 error into a STOP block the model reads", async () => {
    const f = fixture({ meRefused: "rpc" });
    await f.prepare();
    await f.init();
    const answer = await f.relay("cw_psa_find_time_entries");
    const body = answer.body as { result?: { isError?: boolean } };
    expect(body.result?.isError).toBe(true);
    expect(f.text(answer)).toContain("this read was refused (403)");
    expect(f.text(answer)).toContain("You do not have security permission");
  });

  it("after Moi is refused too under a role, reads it under the next held role instead of stopping", async () => {
    const f = fixture({ routine: true, turnRole: { slug: "service-desk", reason: "routine" }, readableBy: "full-access" });
    await f.prepare();
    await f.init();
    const answer = await f.relay("cw_psa_find_time_entries");
    expect(f.text(answer)).toContain('"as":"full-access"');
    expect(f.text(answer)).toContain("Service Desk (API member nova), the person's own account was refused (403)");
    expect(reads(f)).toEqual(["service-desk", "", "full-access"]);
    expect(f.switchAsked).toEqual([]);
  });

  it("marks a read refused under every held role as a STOP block", async () => {
    const f = fixture({ routine: true, turnRole: { slug: "service-desk", reason: "routine" }, meRefused: "result", fallback: "rule" });
    await f.prepare();
    await f.init();
    const answer = await f.relay("cw_psa_find_time_entries");
    expect(f.text(answer)).toContain("STOP: this read was refused (403)");
    expect(reads(f)).toEqual(["service-desk", "", "full-access"]);
  });

  // QA 0.8.67 G6 (#2960): switches go back and forth in a turn.
  it("allows several identity switches back and forth in one turn", async () => {
    const f = fixture();
    await f.prepare();
    await f.init();
    await f.relay("identity_switch", { profile: "service-desk" });
    const again = await f.relay("identity_switch", { profile: "full-access" });
    expect(f.text(again)).not.toContain("Refused by Sagax");
    const back = await f.relay("identity_switch", { clear: true });
    expect(f.text(back)).not.toContain("Refused by Sagax");
    await f.relay("cw_psa_find_time_entries");
    expect(reads(f)).toEqual([""]);
    await f.relay("identity_switch", { profile: "full-access" });
    await f.relay("cw_psa_find_time_entries");
    expect(reads(f)).toEqual(["", "full-access"]);
  });

  // QA 0.8.67 G1 (#2960): a ticket list under one role is not the whole picture.
  it("notes once per turn that a ticket list read under one role may miss boards", async () => {
    const f = fixture();
    await f.prepare();
    await f.init();
    await f.relay("identity_switch", { profile: "service-desk" });
    const first = await f.relay("cw_psa_find_tickets");
    expect(f.text(first)).toContain("this list was read under Service Desk (API member nova)");
    expect(f.text(first)).toContain("Full Access (profile \\\"full-access\\\")");
    expect(f.text(first)).toContain("never present this as complete");
    const second = await f.relay("cw_psa_find_tickets");
    expect(f.text(second)).not.toContain("this list was read under");
  });

  it("names every other held role under the person's own access, explicit-only ones first", async () => {
    const plain = fixture();
    await plain.prepare();
    await plain.init();
    const listed = plain.text(await plain.relay("cw_psa_find_tickets"));
    expect(listed).toContain("this list was read under the person's own account");
    expect(listed).toContain("Service Desk");
    expect(listed).toContain("Full Access");
    const wider = fixture({ explicitFull: true });
    await wider.prepare();
    await wider.init();
    const answer = wider.text(await wider.relay("cw_psa_find_tickets"));
    expect(answer).toContain("this list was read under the person's own account");
    expect(answer.indexOf("Full Access")).toBeLessThan(answer.indexOf("Service Desk"));
  });

  // #2960: "service.tickets" (the conventions' dotted form) is the K1 read
  it("notes a dotted service.tickets query, once per turn, and never a single ticket", async () => {
    const f = fixture();
    await f.prepare();
    await f.init();
    await f.relay("identity_switch", { profile: "service-desk" });
    expect(f.text(await f.relay("cw_psa_get_ticket", { id: 297048 }))).not.toContain("this list was read under");
    expect(f.text(await f.relay("cw_psa_query", { resource: "service.tickets/297048" }))).not.toContain("this list was read under");
    const k1 = await f.relay("cw_psa_query", { resource: "service.tickets", conditions: "owner/id=168 and closedFlag=false" });
    expect(f.text(k1)).toContain("this list was read under Service Desk");
    expect(f.text(await f.relay("cw_psa_query", { resource: "service/boards" }))).not.toContain("this list was read under");
    expect(f.text(await f.relay("cw_psa_find_tickets"))).not.toContain("this list was read under");
  });

  // #2960: a declined card holds even when the bot resends under the same role
  it("stays in the role when the person said so: STOP, no other role, no card", async () => {
    const f = fixture({ readableBy: "full-access", explicitFull: true, fallback: "stay" });
    await f.prepare();
    await f.init();
    const answer = await f.relay("cw_psa_find_time_entries");
    expect(f.text(answer)).toContain("the person asked to stay in that role");
    expect(reads(f)).toEqual([""]);
    expect(f.switchAsked).toEqual([]);
  });


  // #2960 (verifier, G1): the note never fires where it only pushes a switch
  it("adds no board note in a routine or under the role the person picked", async () => {
    const routine = fixture({ turnRole: { slug: "service-desk", reason: "routine" }, routine: true });
    await routine.prepare();
    await routine.init();
    expect(routine.text(await routine.relay("cw_psa_find_tickets"))).not.toContain("this list was read under");
    const picked = fixture({ turnRole: { slug: "service-desk", reason: "person" } });
    await picked.prepare();
    await picked.init();
    expect(picked.text(await picked.relay("cw_psa_find_tickets"))).not.toContain("this list was read under");
  });

  it("keeps the board note for a cross-board list, not for sub-resources or one board", async () => {
    const f = fixture();
    await f.prepare();
    await f.init();
    await f.relay("identity_switch", { profile: "service-desk" });
    expect(f.text(await f.relay("cw_psa_query", { resource: "service.tickets.notes", parent: 297048 }))).not.toContain("this list was read under");
    expect(f.text(await f.relay("cw_psa_query", { resource: "service/boards/12/statuses" }))).not.toContain("this list was read under");
    expect(f.text(await f.relay("cw_psa_query", { resource: "service.tickets", conditions: "board/id=12 and closedFlag=false" }))).not.toContain("this list was read under");
    expect(f.text(await f.relay("cw_psa_query", { resource: "service.tickets", conditions: "owner/id=168 and closedFlag=false" }))).toContain("this list was read under");
  });

  it("tells a cross-board list from one record, a sub-resource and a one-board list", () => {
    expect(boardListRead("cw_psa_find_tickets", {})).toBe(true);
    expect(boardListRead("cw_psa_find_project_tickets", { conditions: "closedFlag=false" })).toBe(true);
    expect(boardListRead("cw_psa_query", { resource: "service.tickets" })).toBe(true);
    expect(boardListRead("cw_psa_query", { resource: "/service/boards/" })).toBe(true);
    expect(boardListRead("cw_psa_query", { resource: "project/tickets" })).toBe(true);
    expect(boardListRead("cw_psa_get_ticket", { id: 1 })).toBe(false);
    expect(boardListRead("cw_psa_query", { resource: "service/tickets", id: 5 })).toBe(false);
    expect(boardListRead("cw_psa_query", { resource: "service.tickets.297048" })).toBe(false);
    expect(boardListRead("cw_psa_query", { resource: "service/tickets/297048/notes" })).toBe(false);
    expect(boardListRead("cw_psa_query", { resource: "service.tickets.notes", parent: 297048 })).toBe(false);
    expect(boardListRead("cw_psa_query", { resource: "service/boards/12/statuses" })).toBe(false);
    expect(boardListRead("cw_psa_find_tickets", { boardId: 12 })).toBe(false);
    expect(boardListRead("cw_psa_query", { resource: "service/tickets", conditions: "board/id in (1,2)" })).toBe(false);
    expect(boardListRead("cw_psa_query", { resource: "time/entries" })).toBe(false);
    expect(boardListRead("cw_psa_find_time_entries", {})).toBe(false);
  });

  // QA 0.8.67 G2 (#2960): a STOP holds for its own turn; the person's later GO
  // naming the role is tried
  it("scopes the roles tried to their turn: the next turn tries them again", async () => {
    const f = fixture({ readableBy: "nobody", explicitFull: true });
    await f.prepare();
    await f.init();
    expect(f.text(await f.relay("cw_psa_find_time_entries"))).toContain("STOP");
    const tried = reads(f).length;
    await f.prepare();
    await f.relay("cw_psa_find_time_entries");
    expect(reads(f).length - tried).toBe(3);
  });
  // readAs: a switch Perspicax refused sent the call again under the refused role
  it("never sends the call again when the switch to the other role is refused", async () => {
    const f = fixture({ readableBy: "full-access", explicitFull: true, fallback: "rule", switchFails: "full-access" });
    await f.prepare();
    await f.init();
    const answer = await f.relay("cw_psa_find_time_entries");
    // never twice under the role that refused it; the other held role is still tried
    expect(reads(f)).toEqual(["", "service-desk"]);
    expect(f.text(answer)).not.toContain('"as":"full-access"');
  });

  // oneCall: a lease left open after the bot moved on put back a later deliberate switch
  it("keeps a role the bot switched to itself after a refused read was read under another", async () => {
    const f = fixture({ readableBy: "full-access", explicitFull: true });
    await f.prepare();
    await f.init();
    await f.relay("cw_psa_find_time_entries");
    await f.relay("identity_switch", { profile: "full-access" });
    await f.relay("cw_psa_find_time_entries");
    expect(reads(f).at(-1)).toBe("full-access");
  });
});

// QA prod 0.8.69 (#3062, rule d7-403-switch-role): a limited role is not a
// block for a read; Sagax tries the held roles itself, never with a card.
describe("read role fallback without a card (#3062)", () => {
  const ticketReads = (f: ReturnType<typeof fixture>) => f.calls.filter((call) => call.name === "cw_psa_get_ticket").map((call) => call.acting);

  it("reads a ticket refused under Moi and Dispatch Agent under the next held role, with no card", async () => {
    const f = fixture({ ticketReadableBy: "full-access", roleSwitch: "deny" });
    await f.prepare();
    await f.init();
    const answer = await f.relay("cw_psa_get_ticket", { id: 297048 });
    expect(ticketReads(f)).toEqual(["", "service-desk", "full-access"]);
    expect(f.switchAsked).toEqual([]);
    expect(f.text(answer)).toContain('"as":"full-access"');
    expect(f.text(answer)).toContain("read this once as Full Access");
    expect(f.text(answer)).not.toContain("STOP");
    // the role is put back for the next call
    await f.relay("cw_psa_get_ticket", { id: 1 });
    expect(ticketReads(f).at(3)).toBe("");
  });

  it("never asks a card for a read, even when the refused read is sent again", async () => {
    const f = fixture({ ticketReadableBy: "nobody", roleSwitch: "allow" });
    await f.prepare();
    await f.init();
    const first = await f.relay("cw_psa_get_ticket", { id: 297048 });
    expect(f.text(first)).toContain("STOP: this read was refused (403)");
    const again = await f.relay("cw_psa_get_ticket", { id: 297048 });
    expect(f.text(again)).toContain("STOP");
    expect(f.switchAsked).toEqual([]);
  });

  it("counts open tickets under the held role that sees the most boards, never the default role's partial count", async () => {
    const f = fixture({ ticketCounts: { me: 4, "service-desk": 2, "full-access": 15 } });
    await f.prepare();
    await f.init();
    const answer = await f.relay("cw_psa_find_tickets", { conditions: "owner/id=168 and closedFlag=false" });
    expect(f.text(answer)).toContain('"total":15');
    expect(f.text(answer)).not.toContain('"total":4');
    expect(f.text(answer)).toContain("Full Access");
    expect(f.switchAsked).toEqual([]);
    // the next list in the turn goes straight to the widest role
    const second = await f.relay("cw_psa_find_tickets", { conditions: "owner/id=168 and closedFlag=false" });
    expect(f.text(second)).toContain('"total":15');
    // and a plain call after it runs under the turn's role again
    await f.relay("cw_psa_get_ticket", { id: 1 });
    expect(ticketReads(f)).toEqual([""]);
  });

  it("never sends a concurrent write of the turn under a role Sagax switched to for a wider list (#3062)", async () => {
    let reached!: () => void;
    const switched = new Promise<void>((resolve) => { reached = resolve; });
    let release!: () => void;
    const pauseSwitchedList = { reached, release: new Promise<void>((resolve) => { release = resolve; }) };
    const f = fixture({ ticketCounts: { me: 4, "service-desk": 2, "full-access": 15 }, pauseSwitchedList });
    await f.prepare();
    await f.init();
    const list = f.relay("cw_psa_find_tickets", { conditions: "closedFlag=false" });
    // the session is now under another role, mid-read
    await switched;
    const write = f.relay("cw_psa_log_time", { ticketId: 1, hours: 1 });
    for (let tick = 0; tick < 20; tick++) await new Promise((resolve) => setImmediate(resolve));
    // the write waits for the role to come back: nothing sent yet
    expect(f.calls.filter((call) => call.name === "cw_psa_log_time")).toEqual([]);
    release();
    const [listed, written] = await Promise.all([list, write]);
    expect(f.text(listed)).toContain('"total":15');
    expect(f.calls.filter((call) => call.name === "cw_psa_log_time").map((call) => call.acting)).toEqual([""]);
    expect(f.text(written)).toContain('"as":"me"');
    // and every role switch Sagax made was put back before the next call
    const last = f.calls.filter((call) => call.name === "identity_switch" && (call.args.clear || call.args.profile)).at(-1);
    expect(last?.args).toEqual({ clear: true });
  });

  it("keeps the turn's own answer when no other held role sees more", async () => {
    const f = fixture({ ticketCounts: { me: 15, "service-desk": 2, "full-access": 15 } });
    await f.prepare();
    await f.init();
    const answer = await f.relay("cw_psa_find_tickets", { conditions: "closedFlag=false" });
    expect(f.text(answer)).toContain('"as":"me"');
    expect(f.text(answer)).toContain('"total":15');
  });
});

// #3694: a guard or policy refusal of the organization's connector is not a
// role refusal, a dry run arms nothing, and a refused write never locks the
// role switches of the rest of the turn (rule d7-403-switch-role).
describe("a refused write never locks the turn's roles (#3694)", () => {
  const writesOf = (f: ReturnType<typeof fixture>) => f.calls.filter((call) => call.name === "cw_psa_write").map((call) => call.acting);
  const ticketsAs = (f: ReturnType<typeof fixture>) => f.calls.filter((call) => call.name === "cw_psa_find_tickets").at(-1)?.acting;

  it("passes a guard refusal of a mistyped dry run as it is, then switches, goes back and writes", async () => {
    const f = fixture({ roleSwitch: "allow" });
    await f.prepare();
    await f.init();
    const typo = await f.relay("cw_psa_write", { resource: "service_tickets_notes", action: "create", parent: 7, set: { text: "x" }, _dry_run: true });
    expect(f.text(typo)).toContain("flow_guard_denied");
    expect(f.text(typo)).not.toContain("STOP");
    expect(f.text(typo)).not.toContain("Missing permission");
    expect(f.text(typo)).not.toContain("service_tickets_notes (Add)");
    expect(f.switchAsked).toEqual([]);
    expect(writesOf(f)).toEqual([""]);
    expect(f.events.some((event) => event.kind === "write_refused")).toBe(false);
    const toRole = await f.relay("identity_switch", { profile: "service-desk" });
    expect(f.text(toRole)).not.toContain("Refused by Sagax");
    await f.relay("cw_psa_find_tickets");
    expect(ticketsAs(f)).toBe("service-desk");
    const back = await f.relay("identity_switch", { clear: true });
    expect(f.text(back)).not.toContain("Refused by Sagax");
    const fixed = await f.relay("cw_psa_write", { resource: "service.notes", action: "create", parent: 7, set: { text: "x" } });
    expect(f.text(fixed)).toContain('"ok":true');
    expect(writesOf(f)).toEqual(["", ""]);
    expect(f.events.some((event) => event.kind === "write_refused")).toBe(false);
  });

  it("never treats a guard refusal of a real write as a role refusal either", async () => {
    const f = fixture({ routine: true, turnRole: { slug: "service-desk", reason: "routine" }, roleSwitch: "allow" });
    await f.prepare();
    await f.init();
    const typo = await f.relay("cw_psa_write", { resource: "schedule_entries", action: "create", set: {} });
    expect(f.text(typo)).toContain("flow_guard_denied");
    expect(f.text(typo)).not.toContain("STOP");
    expect(f.switchAsked).toEqual([]);
    expect(writesOf(f)).toEqual(["service-desk"]);
  });

  it("arms nothing on a refused dry run, even a vendor 403", async () => {
    const f = fixture({ scheduleWritableBy: "full-access", roleSwitch: "allow" });
    await f.prepare();
    await f.init();
    const dry = await f.relay("cw_psa_write", { resource: "schedule.entries", action: "create", set: {}, dry_run: true });
    expect(f.text(dry)).not.toContain("STOP");
    expect(f.switchAsked).toEqual([]);
    expect(writesOf(f)).toEqual([""]);
    expect(f.events.some((event) => event.kind === "write_refused")).toBe(false);
  });

  it("decides a vendor 403 on a write by the card, sends it once, and goes back", async () => {
    const f = fixture({ scheduleWritableBy: "full-access", roleSwitch: "allow" });
    await f.prepare();
    await f.init();
    const answer = await f.relay("cw_psa_write", { resource: "schedule.entries", action: "create", set: {} });
    expect(f.switchAsked).toEqual(["me>service-desk:cw_psa_write"]);
    // the first held role asked for is refused by the vendor too: a STOP for this write only
    expect(f.text(answer)).toContain("STOP");
    expect(writesOf(f)).toEqual(["", "service-desk"]);
    // the same write again: the next held role, once (no loop over the tried ones)
    const again = await f.relay("cw_psa_write", { resource: "schedule.entries", action: "create", set: {} });
    expect(f.switchAsked).toEqual(["me>service-desk:cw_psa_write", "me>full-access:cw_psa_write"]);
    expect(f.text(again)).toContain('"as":"full-access"');
    expect(writesOf(f)).toEqual(["", "service-desk", "", "full-access"]);
    await f.relay("cw_psa_find_tickets");
    expect(ticketsAs(f)).toBe("");
  });

  it("blocks only the write the person refused; a later switch and the default role still work", async () => {
    const f = fixture({ scheduleWritableBy: "full-access", roleSwitch: "deny" });
    await f.prepare();
    await f.init();
    const answer = await f.relay("cw_psa_write", { resource: "schedule.entries", action: "create", set: {} });
    expect(f.text(answer)).toContain("STOP: not written");
    expect(f.text(answer)).toContain("Missing permission: Time & Expense > Schedule Entries (schedule/entries), Add");
    expect(f.text(answer)).not.toMatch(/do not retry it under another role|switching roles .* not allowed/i);
    expect(f.events.at(-1)).toMatchObject({ kind: "write_refused" });
    expect(writesOf(f)).toEqual([""]);
    const toRole = await f.relay("identity_switch", { profile: "full-access" });
    expect(f.text(toRole)).not.toContain("Refused by Sagax");
    const written = await f.relay("cw_psa_write", { resource: "schedule.entries", action: "create", set: {} });
    expect(f.text(written)).toContain('"as":"full-access"');
    const back = await f.relay("profile_use", { clear: true });
    expect(f.text(back)).not.toContain("Refused by Sagax");
  });

  it("never names a permission built from a resource the permission table does not know", async () => {
    const f = fixture({ roleSwitch: "deny", scheduleWritableBy: "nobody" });
    await f.prepare();
    await f.init();
    const answer = await f.relay("cw_psa_write", { resource: "schedulex.things", action: "create", set: {} });
    expect(f.text(answer)).toContain("STOP: not written");
    expect(f.text(answer)).toContain("The resource schedulex/things is not known");
    expect(f.text(answer)).not.toContain("Missing permission");
  });
});
