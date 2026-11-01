import { describe, expect, it } from "vitest";
import { availableTools } from "./drivers/agents-catalog.ts";
import {
  MCP_PERMISSIONS,
  MCP_ROLES,
  decide,
  guardToolCall,
  learnCreatedBot,
  deniedResourcesFromEnv,
  mcpAuditRow,
  auditSampleFromEnv,
  mcpIdentityEnv,
  mcpPolicyEnv,
  profileToolCall,
  resourceDenied,
  resourceKeyForCall,
  permissionForTool,
  permissionModeFromEnv,
  principalFromEnv,
  scopeForCall,
  scopeOwnersFromEnv,
  type McpAuditRecord,
} from "./mcp-permissions.ts";

/** A tool name each permission stands for (a per-profile one by example). */
const SAMPLE: Record<string, string> = { query: "cw_psa__query", write: "cw_psa__write", action: "cw_psa__action", read_action: "edr__read_action", operation: "cw_psa__find_tickets" };
const toolOf = (x: (typeof MCP_PERMISSIONS)[number]) => (x.profileKind ? SAMPLE[x.profileKind]! : x.tool);

const FULL = { externalRuntime: false, coordinating: true, ownThreadCreation: true, skillAuthoring: true, sharedComputers: true, voiceNotes: true, voiceCall: true, cloudHome: false, memoryEnabled: true, groupMemory: true, chief: true, botId: "b", agentApi: true };

describe("mcp permission registry", () => {
  it("names every permission resource:verb, once", () => {
    const keys = MCP_PERMISSIONS.map((x) => x.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) expect(key).toMatch(/^[a-z]+:[a-z]+(\.[a-z]+)?$/);
  });

  it("covers every tool the catalog can show, so nothing is denied by omission", () => {
    // every switch that adds a tool (2026-10-28: phone_tool and connect_github were missed)
    const widest = { ...FULL, phoneTools: ["location" as const], githubConnect: true, webSearch: true, vaultHttp: true, agentApi: true, perspicax: true, claims: true, meetings: true, singleStream: true, routeMessages: true, createBots: true };
    const shown = new Set([...availableTools(FULL), ...availableTools(widest), ...availableTools({ ...widest, coordinating: true }), ...availableTools({ ...FULL, externalRuntime: true, coordinating: false })].map((t) => t.name));
    for (const name of shown) expect(permissionForTool(name), name).toBeDefined();
  });

  it("maps a tool to one permission", () => {
    const tools = MCP_PERMISSIONS.flatMap((x) => [x.tool, ...(x.aliases ?? [])]).filter(Boolean);
    expect(new Set(tools).size).toBe(tools.length);
  });

  it("covers every tool Perspicax 1.8.28 serves, so enforce never refuses one by omission", () => {
    const served = [
      // connector mcp/meta_tools.rs CORE_META_NAMES
      "api_list", "api_search", "api_describe", "api_reload", "api_result_query", "api_lookup", "api_plan", "identity", "api_upload", "review_write", "flow", "flow_action",
      // mcp/memory_tools.rs NAMES
      "memory_recall", "memory_search", "work_search", "memory_write", "memory_propose", "memory_promote", "memory_review", "memory_forget", "memory", "ask_person", "work_check", "work_open", "memory_feedback",
      // mcp/remote_support_tools.rs (1.8.43)
      "remote_support_open", "remote_support_status", "remote_support_close",
      // mcp/sagax_tools.rs
      "list_agents", "find_agents", "create_agent", "send_prompt", "await_turn", "read_transcript", "read_transcript_page", "read_latest_page", "read_latest_page_with_threads", "read_transcript_cold",
      "sagax_bots", "sagax_send", "sagax_thread", "sagax_routine_run", "sagax_routine_update", "sagax_approve", "sagax_nudge",
      // per-profile tools, both separators
      "cw_psa__query", "cw_psa__write", "cw_psa__action", "edr__read_action", "cw_psa__find_tickets", "twilio_lookups__Bucket_write", "cw_psa-query",
      // memory v2 draft behind a switch (Perspicax #326)
      "memory_find", "memory_save", "memory_remove", "memory_suggestions",
    ];
    for (const name of served) expect(permissionForTool(name), name).toBeDefined();
    for (const invented of ["api_query", "api_write", "api_action", "api_resultquery", "identity_search"]) expect(permissionForTool(invented), invented).toBeUndefined();
  });

  it("maps a per-profile tool by its pattern", () => {
    expect(profileToolCall("cw_psa__query")).toEqual({ profile: "cw_psa", kind: "query", name: "query" });
    expect(profileToolCall("cw_psa-write")).toEqual({ profile: "cw_psa", kind: "write", name: "write" });
    expect(profileToolCall("twilio_lookups__Bucket_write")).toMatchObject({ profile: "twilio_lookups", kind: "write" });
    expect(profileToolCall("edr__read_action")).toMatchObject({ kind: "read_action" });
    expect(profileToolCall("cw_psa__find_tickets")).toMatchObject({ kind: "operation" });
    expect(profileToolCall("api_list")).toBeNull();
    expect(permissionForTool("cw_psa__query")?.key).toBe("api:query");
    expect(permissionForTool("cw_psa__write")?.key).toBe("api:write");
    expect(permissionForTool("cw_psa__action")?.key).toBe("api:action");
    expect(permissionForTool("edr__read_action")?.tier).toBe("read");
    expect(permissionForTool("cw_psa__find_tickets")?.tier).toBe("dispatch");
  });
});

describe("decide", () => {
  const who = (role: string) => ({ id: "p", role });

  it("denies an unknown tool and an unknown role", () => {
    expect(decide(who("admin"), "no_such_tool").reason).toBe("unknown_tool");
    expect(decide(who("member"), "openapi_createnote")).toMatchObject({ allowed: true, permission: "openapi:call", reason: "ok" });
    expect(decide(who("viewer"), "openapi_createnote").reason).toBe("not_granted");
    expect(decide(who("root"), "list_bots").reason).toBe("unknown_role");
  });

  // 2026-10-28: the person's own phone, GitHub, key request and lent computers
  it("lets a member use their own phone, GitHub, key request and computers", () => {
    for (const tool of ["phone_tool", "connect_github", "request_credential", "shared_computer"]) {
      expect(decide(who("member"), tool), tool).toMatchObject({ allowed: true, reason: "ok" });
    }
  });

  // 2026-10-28: add_mcp_server adds to the member's own servers on an
  // organization server; a service turn and a viewer still cannot
  it("lets a member add a server to their own list, at their own scope only", () => {
    expect(decide(who("member"), "add_mcp_server")).toMatchObject({ allowed: true, permission: "mcp:add" });
    expect(decide(who("member"), "add_mcp_server", "org").allowed).toBe(false);
    expect(decide(who("viewer"), "add_mcp_server").allowed).toBe(false);
  });

  it("gives a viewer reads and nothing else", () => {
    expect(decide(who("viewer"), "list_bots", "team").allowed).toBe(true);
    expect(decide(who("viewer"), "memory_update").reason).toBe("not_granted");
    expect(decide(who("viewer"), "ask_bot").allowed).toBe(false);
  });

  it("keeps a member to their own scope", () => {
    expect(decide(who("member"), "memory_update").allowed).toBe(true);
    expect(decide(who("member"), "ask_bot", "self").allowed).toBe(true);
    expect(decide(who("member"), "ask_bot", "team")).toMatchObject({ allowed: false, reason: "scope_too_narrow" });
    expect(decide(who("member"), "api_reload").allowed).toBe(false);
  });

  it("lets an operator dispatch for a team but not administer", () => {
    expect(decide(who("operator"), "delegate_bot", "team").allowed).toBe(true);
    expect(decide(who("operator"), "delegate_bot", "org").allowed).toBe(false);
    expect(decide(who("operator"), "api_reload").allowed).toBe(false);
  });

  it("lets an admin do everything at every scope", () => {
    for (const x of MCP_PERMISSIONS) if (x.tool) expect(decide(who("admin"), toolOf(x)!, "org").allowed, x.tool).toBe(true);
  });

  it("keeps a service to scoped automation", () => {
    expect(decide(who("service"), "send_prompt", "self").allowed).toBe(true);
    expect(decide(who("service"), "send_prompt", "team").allowed).toBe(false);
    expect(decide(who("service"), "vm_exec").allowed).toBe(false);
    expect(decide(who("service"), "act").allowed).toBe(false);
  });

  it("grants no role more than an admin", () => {
    for (const role of MCP_ROLES) for (const x of MCP_PERMISSIONS) {
      if (!x.tool) continue;
      if (decide(who(role), toolOf(x)!, "org").allowed) expect(decide(who("admin"), toolOf(x)!, "org").allowed).toBe(true);
    }
  });
});

describe("scopeForCall", () => {
  it("widens on another bot, a room or an org flag", () => {
    expect(scopeForCall({}, "b")).toBe("self");
    expect(scopeForCall({ bot_id: "b" }, "b")).toBe("self");
    expect(scopeForCall({ for_bot_id: "c" }, "b")).toBe("team");
    expect(scopeForCall({ room_id: "r" }, "b")).toBe("team");
    expect(scopeForCall({ scope: "org" }, "b")).toBe("org");
  });

  // 2026-10-26: a person's own bots and rooms are their own scope
  const owners = { principalId: "pr_alice", botOwner: (id: string) => ({ b2: "pr_alice", b3: "PR_ALICE", bob1: "pr_bob" } as Record<string, string>)[id], roomOwner: (id: string) => ({ r1: "pr_alice", rb: "pr_bob" } as Record<string, string>)[id] };
  it("is self for another bot or a room of the same person", () => {
    for (const key of ["bot_id", "for_bot_id", "agent_id", "to_bot_id", "target_bot_id"]) {
      expect(scopeForCall({ [key]: "b2" }, "b", owners)).toBe("self");
      expect(scopeForCall({ [key]: "b3" }, "b", owners)).toBe("self");
    }
    expect(scopeForCall({ room_id: "r1" }, "b", owners)).toBe("self");
    expect(scopeForCall({ room_id: "r1", to_bot_id: "b2" }, "b", owners)).toBe("self");
    // post_to_room names its room group_id
    expect(scopeForCall({ group_id: "r1" }, "b", owners)).toBe("self");
    expect(scopeForCall({ group_id: "rb" }, "b", owners)).toBe("team");
  });
  it("stays team for someone else's bot or room, an unknown one, a group or a team", () => {
    expect(scopeForCall({ bot_id: "bob1" }, "b", owners)).toBe("team");
    expect(scopeForCall({ bot_id: "unknown" }, "b", owners)).toBe("team");
    expect(scopeForCall({ room_id: "rb" }, "b", owners)).toBe("team");
    expect(scopeForCall({ room_id: "r1", to_bot_id: "bob1" }, "b", owners)).toBe("team");
    expect(scopeForCall({ group_id: "g", room_id: "r1" }, "b", owners)).toBe("team");
    expect(scopeForCall({ team_id: "t" }, "b", owners)).toBe("team");
    expect(scopeForCall({ bot_id: "b2", scope: "org" }, "b", owners)).toBe("org");
    expect(scopeForCall({ bot_id: "b2" }, "b", { ...owners, principalId: "" })).toBe("team");
  });
  it("reads the person's own bots and rooms from the harness environment", () => {
    const fromEnv = scopeOwnersFromEnv({ SAGAX_MCP_OWN_BOTS: "b2, b3", SAGAX_MCP_OWN_ROOMS: "r1" }, "pr_alice");
    expect(scopeForCall({ bot_id: "b2" }, "b", fromEnv)).toBe("self");
    expect(scopeForCall({ room_id: "r1" }, "b", fromEnv)).toBe("self");
    expect(scopeForCall({ bot_id: "bob1" }, "b", fromEnv)).toBe("team");
    expect(scopeForCall({ bot_id: "b2" }, "b", scopeOwnersFromEnv({}, "pr_alice"))).toBe("team");
    expect(mcpIdentityEnv({ botId: "b", principalId: "pr_alice", ownBotIds: ["b2", "bad id!"], ownRoomIds: ["r1"] })).toMatchObject({ SAGAX_MCP_OWN_BOTS: "b2", SAGAX_MCP_OWN_ROOMS: "r1" });
    // no person speaks (a service turn): nothing is listed as anyone's own
    expect(mcpIdentityEnv({ botId: "b", ownBotIds: ["b2"] })).not.toHaveProperty("SAGAX_MCP_OWN_BOTS");
  });
});

describe("a member's own bots (2026-10-26)", () => {
  const member = { id: "pr_alice", role: "member" };
  it("asks, delegates, sends to and coordinates their own other bot, and posts in their own room, under enforce", async () => {
    const owners = { principalId: "pr_alice", botOwner: (id: string) => (id === "b2" ? "pr_alice" : id === "bob1" ? "pr_bob" : undefined), roomOwner: (id: string) => (id === "r1" ? "pr_alice" : undefined) };
    const options = { principal: member, mode: "enforce" as const, ownBotId: "b", audit: () => {}, owners };
    const run = async () => ({ text: "ok" });
    for (const tool of ["ask_bot", "delegate_bot", "send_to_bot", "coordinate_bots"]) {
      expect(await guardToolCall(options, tool, { bot_id: "b2" }, run), tool).toEqual({ text: "ok" });
      expect(await guardToolCall(options, tool, { bot_id: "bob1" }, run), tool).toMatchObject({ isError: true });
    }
    expect(await guardToolCall(options, "post_to_room", { room_id: "r1" }, run)).toEqual({ text: "ok" });
    expect(await guardToolCall(options, "manage_room", { room_id: "r1" }, run)).toEqual({ text: "ok" });
    expect(await guardToolCall(options, "post_to_room", { room_id: "r9" }, run)).toMatchObject({ isError: true });
  });
  it("archives their own bot and creates or archives their own temporary agent; never someone else's", () => {
    for (const tool of ["archive_bot", "create_agent", "delete_agent"]) {
      expect(decide(member, tool, "self").allowed, tool).toBe(true);
      expect(decide(member, tool, "team").allowed, tool).toBe(false);
      expect(decide({ id: "bot", role: "service" }, tool, "self").allowed, tool).toBe(false);
    }
  });
  it("creates a pairing code for themselves, never for a turn no person speaks in", () => {
    expect(decide(member, "manage_pairing", "self").allowed).toBe(true);
    expect(decide(member, "manage_pairing", "team").allowed).toBe(false);
    expect(decide({ id: "bot", role: "service" }, "manage_pairing", "self").allowed).toBe(false);
  });
});

describe("environment", () => {
  it("defaults to shadow and member", () => {
    expect(permissionModeFromEnv({})).toBe("shadow");
    expect(permissionModeFromEnv({ SAGAX_MCP_PERMISSIONS: "enforce" })).toBe("enforce");
    expect(permissionModeFromEnv({ SAGAX_MCP_PERMISSIONS: "junk" })).toBe("shadow");
    expect(principalFromEnv({ SAGAX_BOT_ID: "b" })).toMatchObject({ id: "b", role: "member" });
    expect(auditSampleFromEnv({})).toBe(0);
    expect(auditSampleFromEnv({ SAGAX_MCP_AUDIT_SAMPLE: "0.25" })).toBe(0.25);
    expect(auditSampleFromEnv({ SAGAX_MCP_AUDIT_SAMPLE: "2" })).toBe(0);
    expect(mcpPolicyEnv({})).toEqual({ SAGAX_MCP_PERMISSIONS: "shadow" });
    expect(mcpPolicyEnv({ SAGAX_MCP_PERMISSIONS: "enforce", SAGAX_MCP_DENY: "CW_PSA:tickets.*", SAGAX_MCP_AUDIT_SAMPLE: "0.1" })).toEqual({ SAGAX_MCP_PERMISSIONS: "enforce", SAGAX_MCP_DENY: "cw_psa:tickets.*", SAGAX_MCP_AUDIT_SAMPLE: "0.1" });
  });
});

describe("guardToolCall", () => {
  const setup = (mode: "off" | "shadow" | "enforce", role = "viewer") => {
    const records: McpAuditRecord[] = [];
    let ran = 0;
    const options = { principal: { id: "p", role }, mode, ownBotId: "b", audit: (r: McpAuditRecord) => records.push(r), now: () => new Date("2026-01-01T00:00:00Z") };
    const run = async () => { ran++; return { text: "ok" }; };
    return { records, options, run, ran: () => ran };
  };

  it("refuses and audits a denied call in enforce mode", async () => {
    const t = setup("enforce");
    const out = await guardToolCall(t.options, "memory_update", { text: "secret" }, t.run);
    expect(out).toMatchObject({ isError: true });
    expect(t.ran()).toBe(0);
    expect(t.records).toEqual([{ at: "2026-01-01T00:00:00.000Z", principal: "p", role: "viewer", tool: "memory_update", permission: "memory:save", scope: "self", decision: "denied", reason: "not_granted", enforced: true }]);
    expect(JSON.stringify(t.records)).not.toContain("secret");
  });

  it("audits an allowed call and runs it", async () => {
    const t = setup("enforce", "member");
    expect(await guardToolCall(t.options, "memory_update", {}, t.run)).toEqual({ text: "ok" });
    expect(t.records[0]).toMatchObject({ decision: "allowed", enforced: false });
  });

  it("only records a denial in shadow mode", async () => {
    const t = setup("shadow");
    expect(await guardToolCall(t.options, "memory_update", {}, t.run)).toEqual({ text: "ok" });
    expect(t.records[0]).toMatchObject({ decision: "denied", enforced: false });
  });

  it("audits in shadow only the denials, and the sampled share of allowed calls", async () => {
    const t = setup("shadow", "member");
    await guardToolCall(t.options, "memory_update", {}, t.run);
    await guardToolCall(t.options, "api_reload", {}, t.run);
    expect(t.records.map((r) => [r.tool, r.decision])).toEqual([["api_reload", "denied"]]);
    expect(t.ran()).toBe(2);
    const draws = [0.05, 0.5];
    const sampled = { ...t.options, allowedSample: 0.1, random: () => draws.shift()! };
    await guardToolCall(sampled, "memory_update", {}, t.run);
    await guardToolCall(sampled, "memory_update", {}, t.run);
    expect(t.records.map((r) => r.decision)).toEqual(["denied", "allowed"]);
  });

  it("audits every call in enforce mode", async () => {
    const t = setup("enforce", "member");
    await guardToolCall(t.options, "memory_update", {}, t.run);
    await guardToolCall(t.options, "api_reload", {}, t.run);
    expect(t.records.map((r) => r.decision)).toEqual(["allowed", "denied"]);
  });

  it("denies an unregistered tool by default and skips everything when off", async () => {
    const e = setup("enforce", "admin");
    expect(await guardToolCall(e.options, "brand_new_tool", {}, e.run)).toMatchObject({ isError: true });
    const o = setup("off", "viewer");
    await guardToolCall(o.options, "memory_update", {}, o.run);
    expect(o.records).toEqual([]);
    expect(o.ran()).toBe(1);
  });

  it("holds a denial even if the audit sink throws", async () => {
    const t = setup("enforce");
    t.options.audit = () => { throw new Error("disk full"); };
    expect(await guardToolCall(t.options, "memory_update", {}, t.run)).toMatchObject({ isError: true });
    expect(t.ran()).toBe(0);
  });
});

describe("coverage doc", () => {
  it("states the registry's totals", async () => {
    const { readFileSync } = await import("node:fs");
    const doc = readFileSync(new URL("../docs/mcp/coverage.md", import.meta.url), "utf8");
    const covered = MCP_PERMISSIONS.filter((x) => x.tool).length;
    const gaps = MCP_PERMISSIONS.length - covered;
    expect(doc).toContain(`Totals: capabilities ${MCP_PERMISSIONS.length}, covered ${covered}, gaps ${gaps}.`);
    expect((doc.match(/\| MISSING \|/g) ?? []).length).toBe(gaps);
  });
});

describe("per-resource permissions", () => {
  it("derives <profile>:<resource>.<verb> from the per-profile tools", () => {
    expect(resourceKeyForCall("cw_psa__query", { resource: "Tickets" })).toBe("cw_psa:tickets.read");
    expect(resourceKeyForCall("cw_psa__write", { resource: "tickets", action: "update" })).toBe("cw_psa:tickets.update");
    expect(resourceKeyForCall("cw_psa-write", { resource: "tickets", action: "delete" })).toBe("cw_psa:tickets.delete");
    expect(resourceKeyForCall("twilio_lookups__Bucket_write", { action: "create" })).toBe("twilio_lookups:bucket.create");
    expect(resourceKeyForCall("cw_psa__action", { action: "merge_companies" })).toBe("cw_psa:merge_companies.run");
    expect(resourceKeyForCall("edr__read_action", { action: "agents_count" })).toBe("edr:agents_count.read");
    expect(resourceKeyForCall("cw_psa__find_tickets", {})).toBe("cw_psa:find_tickets.run");
    expect(resourceKeyForCall("api_list", { resource: "x" })).toBeNull();
    expect(resourceKeyForCall("cw_psa__write", { resource: "../x", action: "update" })).toBeNull();
    expect(resourceKeyForCall("cw_psa__write", { resource: "tickets" })).toBeNull();
    expect(resourceKeyForCall("cw_psa__query", undefined)).toBeNull();
  });

  it("vets names against the Perspicax catalog when one is given", () => {
    const catalog = new Map([["cw_psa", new Set(["tickets"])]]);
    expect(resourceKeyForCall("cw_psa__write", { resource: "tickets", action: "update" }, catalog)).toBe("cw_psa:tickets.update");
    expect(resourceKeyForCall("cw_psa__write", { resource: "invented", action: "update" }, catalog)).toBeNull();
    expect(resourceKeyForCall("other__write", { resource: "tickets", action: "update" }, catalog)).toBeNull();
  });

  it("matches exact, resource-wide and api-wide deny rules", () => {
    expect(resourceDenied("cw:ticket.update", ["cw:ticket.update"])).toBe(true);
    expect(resourceDenied("cw:ticket.update", ["cw:ticket.*"])).toBe(true);
    expect(resourceDenied("cw:ticket.update", ["cw:*"])).toBe(true);
    expect(resourceDenied("cw:contact.update", ["cw:ticket.*"])).toBe(false);
    expect(resourceDenied("cwx:ticket.update", ["cw:*"])).toBe(false);
    expect(deniedResourcesFromEnv({ SAGAX_MCP_DENY: " CW:ticket.* , ,a:b.c" })).toEqual(["cw:ticket.*", "a:b.c"]);
  });

  it("refuses a denied resource in enforce mode, names it, and still audits it", async () => {
    const rows: McpAuditRecord[] = [];
    const options = { principal: { id: "p", role: "operator" }, mode: "enforce" as const, ownBotId: "b", audit: (r: McpAuditRecord) => rows.push(r), deniedResources: ["cw_psa:tickets.*"] };
    let ran = 0;
    const run = async () => { ran++; return { text: "ok" }; };
    const refused = await guardToolCall(options, "cw_psa__write", { resource: "tickets", action: "update" }, run);
    expect(refused).toMatchObject({ isError: true });
    expect(refused.text).toContain("cw_psa:tickets.update");
    expect(ran).toBe(0);
    expect(await guardToolCall(options, "cw_psa__write", { resource: "contacts", action: "update" }, run)).toEqual({ text: "ok" });
    expect(rows.map((r) => [r.decision, r.reason, r.resource])).toEqual([["denied", "resource_denied", "cw_psa:tickets.update"], ["allowed", "ok", "cw_psa:contacts.update"]]);
  });
});

describe("harness identity and audit rows", () => {
  it("maps the Perspicax role and the lack of a speaker", () => {
    expect(mcpIdentityEnv({ botId: "b", principalId: "pr_a", perspicaxRole: "admin", teamIds: ["t1", "bad id!", "t2"] })).toEqual({ SAGAX_MCP_ROLE: "admin", SAGAX_MCP_PRINCIPAL: "pr_a", SAGAX_MCP_TEAMS: "t1,t2" });
    expect(mcpIdentityEnv({ botId: "b", principalId: "pr_a", perspicaxRole: "manager" }).SAGAX_MCP_ROLE).toBe("operator");
    expect(mcpIdentityEnv({ botId: "b", principalId: "pr_a", perspicaxRole: "employee" }).SAGAX_MCP_ROLE).toBe("member");
    expect(mcpIdentityEnv({ botId: "b" })).toEqual({ SAGAX_MCP_ROLE: "service", SAGAX_MCP_PRINCIPAL: "b", SAGAX_MCP_TEAMS: "" });
    expect(principalFromEnv(mcpIdentityEnv({ botId: "b", principalId: "pr_a", teamIds: ["t1"] }))).toEqual({ id: "pr_a", role: "member", teamIds: ["t1"] });
  });

  it("copies only whitelisted fields into the activity-log row", () => {
    const record = { at: "2026-10-14T00:00:00.000Z", principal: "p", role: "viewer", tool: "cw_psa__write", permission: "api:write", scope: "self", decision: "denied", reason: "not_granted", enforced: true, secret: "x", args: { a: 1 } } as unknown as McpAuditRecord;
    const row = mcpAuditRow(record, "bot1");
    expect(row).toMatchObject({ category: "security", action: "mcp.deny", target: { kind: "bot", id: "bot1" }, after: { tool: "cw_psa__write", permission: "api:write", enforced: true } });
    expect(JSON.stringify(row)).not.toMatch(/secret|args/);
    expect(mcpAuditRow({ ...record, enforced: false }, "b").action).toBe("mcp.shadow");
    expect(mcpAuditRow({ ...record, decision: "allowed", enforced: false }, "b").action).toBe("mcp.call");
  });
});

// 2026-10-27 (#1098, point 33): the shadow denials of a person's own work
describe("false denials in shadow (#1098)", () => {
  const as = (role: string) => ({ id: "pr_alice", role });

  it("gives an operator at least what a member holds in their own environment", () => {
    for (const tool of ["create_bot", "propose_bot_deletion", "archive_bot", "create_room", "propose_team_memory", "vm_exec", "act"]) {
      expect(decide(as("operator"), tool, "self").allowed, tool).toBe(true);
    }
    // the operator's own wider tiers stay, and admin-only tools stay refused
    expect(decide(as("operator"), "delegate_bot", "team").allowed).toBe(true);
    expect(decide(as("operator"), "api_reload").allowed).toBe(false);
  });

  it("lets a member run their own Local VM, act as themselves and propose team memory, never a service", () => {
    for (const tool of ["vm_exec", "act", "propose_team_memory"]) {
      expect(decide(as("member"), tool, "self").allowed, tool).toBe(true);
      expect(decide(as("member"), tool, "team").allowed, tool).toBe(false);
    }
    expect(decide(as("service"), "vm_exec").allowed).toBe(false);
    expect(decide(as("service"), "act").allowed).toBe(false);
  });

  it("lets every role read at the org scope: the source shows only what the person may read", () => {
    for (const role of ["viewer", "member", "operator", "service"]) {
      expect(decide(as(role), "memory_search", "org").allowed, role).toBe(true);
    }
    expect(decide(as("member"), "memory_write", "org").allowed).toBe(false);
  });

  it("judges a tool the Perspicax relay serves and Sagax does not list as mcp:external", async () => {
    expect(decide(as("member"), "list_pending_approvals", "self", { external: true })).toMatchObject({ allowed: true, permission: "mcp:external" });
    // the agents proxy, Sagax's own catalog, still refuses an unknown name
    expect(decide(as("member"), "list_pending_approvals").reason).toBe("unknown_tool");
    const records: McpAuditRecord[] = [];
    const options = { principal: as("member"), mode: "enforce" as const, ownBotId: "b", audit: (r: McpAuditRecord) => records.push(r), external: true };
    expect(await guardToolCall(options, "list_pending_approvals", {}, async () => ({ text: "ok" }))).toEqual({ text: "ok" });
    expect(records.map((r) => [r.permission, r.decision])).toEqual([["mcp:external", "allowed"]]);
  });

  // 2026-10-28: a bot shared with the member at run takes their ask_bot and
  // delegate_bot in enforce mode; nothing else about it is theirs
  it("lets a member ask or delegate to a bot shared with them at run, nothing more", async () => {
    const env = mcpIdentityEnv({ botId: "b", principalId: "pr_alice", runBotIds: ["shared1", "bad id!"] });
    expect(env).toMatchObject({ SAGAX_MCP_RUN_BOTS: "shared1" });
    expect(mcpIdentityEnv({ botId: "b", runBotIds: ["shared1"] })).not.toHaveProperty("SAGAX_MCP_RUN_BOTS");
    const owners = scopeOwnersFromEnv(env, "pr_alice");
    for (const tool of ["ask_bot", "delegate_bot"]) {
      expect(scopeForCall({ bot_id: "shared1" }, "b", owners, tool), tool).toBe("self");
      const records: McpAuditRecord[] = [];
      const options = { principal: as("member"), owners, mode: "enforce" as const, ownBotId: "b", audit: (r: McpAuditRecord) => records.push(r) };
      expect(await guardToolCall(options, tool, { bot_id: "shared1", message: "hi" }, async () => ({ text: "ok" }))).toEqual({ text: "ok" });
      // a bot not shared with them at run stays the team scope, refused
      expect(await guardToolCall(options, tool, { bot_id: "other9", message: "hi" }, async () => ({ text: "ok" }))).toMatchObject({ isError: true });
    }
    // archiving or changing the shared bot is not dispatch: still team
    expect(scopeForCall({ bot_id: "shared1" }, "b", owners, "archive_bot")).toBe("team");
    expect(scopeForCall({ for_bot_id: "shared1" }, "b", owners, "propose_profile")).toBe("team");
    expect(scopeForCall({ bot_id: "shared1" }, "b", owners)).toBe("team");
  });

  it("counts a bot the person created in this process as theirs", () => {
    const owners = scopeOwnersFromEnv({ SAGAX_MCP_OWN_BOTS: "b2" }, "pr_alice");
    expect(scopeForCall({ bot_id: "b9" }, "b", owners)).toBe("team");
    learnCreatedBot(owners, "Created @Helper in General [id: b9]. Assign work with delegate_bot.");
    expect(scopeForCall({ bot_id: "b9" }, "b", owners)).toBe("self");
    expect(decide(as("member"), "propose_bot_deletion", scopeForCall({ bot_id: "b9" }, "b", owners)).allowed).toBe(true);
    // someone else's bot stays team
    expect(scopeForCall({ bot_id: "bob1" }, "b", owners)).toBe("team");
  });
});
