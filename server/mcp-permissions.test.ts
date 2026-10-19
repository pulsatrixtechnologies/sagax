import { describe, expect, it } from "vitest";
import { availableTools } from "./drivers/agents-catalog.ts";
import {
  MCP_PERMISSIONS,
  MCP_ROLES,
  decide,
  guardToolCall,
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
  type McpAuditRecord,
} from "./mcp-permissions.ts";

/** A tool name each permission stands for (a per-profile one by example). */
const SAMPLE: Record<string, string> = { query: "cw_psa__query", write: "cw_psa__write", action: "cw_psa__action", read_action: "sentinelone__read_action", operation: "cw_psa__find_tickets" };
const toolOf = (x: (typeof MCP_PERMISSIONS)[number]) => (x.profileKind ? SAMPLE[x.profileKind]! : x.tool);

const FULL = { externalRuntime: false, skillAuthoring: true, sharedComputers: true, voiceNotes: true, voiceCall: true, cloudHome: false, memoryEnabled: true, groupMemory: true, chief: true, botId: "b", agentApi: true };

describe("mcp permission registry", () => {
  it("names every permission resource:verb, once", () => {
    const keys = MCP_PERMISSIONS.map((x) => x.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) expect(key).toMatch(/^[a-z]+:[a-z]+(\.[a-z]+)?$/);
  });

  it("covers every tool the catalog can show, so nothing is denied by omission", () => {
    const shown = new Set([...availableTools(FULL), ...availableTools({ ...FULL, externalRuntime: true })].map((t) => t.name));
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
      // mcp/sagax_tools.rs
      "list_agents", "find_agents", "create_agent", "send_prompt", "await_turn", "read_transcript", "read_transcript_page", "read_latest_page", "read_latest_page_with_threads", "read_transcript_cold",
      "sagax_bots", "sagax_send", "sagax_thread", "sagax_routine_run", "sagax_approve", "sagax_nudge",
      // per-profile tools, both separators
      "cw_psa__query", "cw_psa__write", "cw_psa__action", "sentinelone__read_action", "cw_psa__find_tickets", "twilio_lookups__Bucket_write", "cw_psa-query",
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
    expect(profileToolCall("sentinelone__read_action")).toMatchObject({ kind: "read_action" });
    expect(profileToolCall("cw_psa__find_tickets")).toMatchObject({ kind: "operation" });
    expect(profileToolCall("api_list")).toBeNull();
    expect(permissionForTool("cw_psa__query")?.key).toBe("api:query");
    expect(permissionForTool("cw_psa__write")?.key).toBe("api:write");
    expect(permissionForTool("cw_psa__action")?.key).toBe("api:action");
    expect(permissionForTool("sentinelone__read_action")?.tier).toBe("read");
    expect(permissionForTool("cw_psa__find_tickets")?.tier).toBe("dispatch");
  });
});

describe("decide", () => {
  const who = (role: string) => ({ id: "p", role });

  it("denies an unknown tool and an unknown role", () => {
    expect(decide(who("admin"), "no_such_tool").reason).toBe("unknown_tool");
    expect(decide(who("root"), "list_bots").reason).toBe("unknown_role");
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
    expect(decide(who("member"), "vm_exec").allowed).toBe(false);
  });

  it("lets an operator dispatch for a team but not administer", () => {
    expect(decide(who("operator"), "delegate_bot", "team").allowed).toBe(true);
    expect(decide(who("operator"), "delegate_bot", "org").allowed).toBe(false);
    expect(decide(who("operator"), "add_mcp_server").allowed).toBe(false);
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
    await guardToolCall(t.options, "vm_exec", {}, t.run);
    expect(t.records.map((r) => [r.tool, r.decision])).toEqual([["vm_exec", "denied"]]);
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
    await guardToolCall(t.options, "vm_exec", {}, t.run);
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
    expect(resourceKeyForCall("sentinelone__read_action", { action: "agents_count" })).toBe("sentinelone:agents_count.read");
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
