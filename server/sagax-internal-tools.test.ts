import { describe, expect, it } from "vitest";

import { autoVerdict } from "./approvals/auto-approve.ts";
import { memberBotAdminApproval } from "./engines/engine-access.ts";
import { gateReadOnlyTools } from "./drivers/acp/grok-approval-gate.ts";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { toolChangesRules } from "../shared/step-up.ts";
import { dataPublicHttps, dataToolName, foreignToolSpelling, sagaxInternalSelfAnswers, sagaxInternalTool } from "./sagax-internal-tools.ts";

// Owner, 2026-10-16: a member's bot (Moss, Grok Build) asked an approval for
// data__data_load, and the card went to the organization admins.
describe("Sagax's own person-scoped tools", () => {
  it("names the Data tools exactly, in every engine's spelling", () => {
    for (const name of ["data__data_load", "mcp__data__data_sql", "data.data_show", "data:data_export", "data__data_describe"]) {
      expect(dataToolName(name)).not.toBeNull();
    }
    for (const name of ["data__data_drop", "mydata__data_load", "data__load", "datadata_load", "perspicax_data__data_load", "data__data_load extra", "Bash"]) {
      expect(dataToolName(name)).toBeNull();
    }
  });

  it("counts Data and the agents tools of the bot's own scope, never a host-level agents tool", () => {
    expect(sagaxInternalTool("data__data_load")).toBe("data");
    expect(sagaxInternalTool("agents__send_to_bot")).toBe("agents");
    expect(sagaxInternalTool("mcp__agents__memory_update")).toBe("agents");
    expect(sagaxInternalTool("agents__act")).toBe("agents");
    for (const name of ["agents__add_mcp_server", "agents__vm_exec", "agents__attach_file", "sagax-environment__run_command", "browser__navigate", "other"]) {
      expect(sagaxInternalTool(name)).toBeNull();
    }
  });

  // 2026-10-28: the person's own key, device or account: no admin, but their
  // own card at their own level, never answered by Sagax itself
  it("leaves the own-account tools to the person's own card, never an admin's", () => {
    for (const name of ["agents__vault_http_request", "agents__phone_tool", "agents__connect_github", "agents__send_prompt", "agents__launch_cloud_agent", "agents__openapi_getnote"]) {
      expect(sagaxInternalTool(name), name).toBeNull();
      expect(memberBotAdminApproval({ tool: name, workspaceRoot: "/nowhere" }), name).toBe(false);
    }
    expect(sagaxInternalTool("agents__task_list")).toBe("agents");
    expect(sagaxInternalTool("agents__make_video")).toBe("agents");
    expect(sagaxInternalTool("agents__sagax_web_search")).toBe("agents");
  });

  it("never sends a member's Data call to an admin", () => {
    expect(memberBotAdminApproval({ tool: "data__data_load", workspaceRoot: "/nowhere" })).toBe(false);
    expect(memberBotAdminApproval({ tool: "mcp__data__data_sql", workspaceRoot: "/nowhere" })).toBe(false);
    // a look-alike server still needs an admin
    expect(memberBotAdminApproval({ tool: "files__data_load", workspaceRoot: "/nowhere" })).toBe(true);
  });

  it("approves without a card at every level, a gate card included", () => {
    for (const mode of ["ask", "edits", "auto", "custom", "full"] as const) {
      expect(autoVerdict(mode, "other", { sagaxInternal: true })).toEqual({ approve: "approved other (Sagax tool)", source: "sagax-internal" });
    }
    expect(autoVerdict("auto", "other", { sagaxInternal: true, sagaxGate: true }).source).toBe("sagax-internal");
  });

  it("still lets a safety hold, the person's own deny or ask, and a sandbox widening win", () => {
    expect(autoVerdict("ask", "other", { sagaxInternal: true, safetyHold: true }).approve).toBeNull();
    expect(autoVerdict("ask", "other", { sagaxInternal: true, customRule: { behavior: "deny", id: "r" } }).source).toBe("custom-rule-deny");
    expect(autoVerdict("ask", "other", { sagaxInternal: true, customRule: { behavior: "ask", id: "r" } }).source).toBe("custom-rule-ask");
    expect(autoVerdict("ask", "other", { sagaxInternal: true, requiresExplicitApproval: true }).approve).toBeNull();
    expect(autoVerdict("ask", "AskUserQuestion", { sagaxInternal: true }).approve).toBeNull();
  });

  it("the Grok gate holds the Data tools: the approval path decides (security review 2026-10-16)", () => {
    expect(gateReadOnlyTools({ name: "data", builtin: true })).toEqual([]);
    expect(gateReadOnlyTools({ name: "data", builtin: false })).toEqual([]);
  });
});

describe("Sagax's own tools, security review 2026-10-16", () => {
  it("never answers a send by itself: send_to_bot, post_to_room and send_voice_note keep the outbound guard", () => {
    for (const name of ["agents__send_to_bot", "mcp__agents__post_to_room", "agents__send_voice_note"]) {
      expect(sagaxInternalTool(name)).toBe("agents");
      expect(autoVerdict("auto", "other", { sagaxInternal: true, toolName: name })).toEqual({ approve: null, source: "outbound-guard" });
      expect(autoVerdict("auto", name, { sagaxInternal: true })).toEqual({ approve: null, source: "outbound-guard" });
      // a gate card of a send stays a card too
      expect(autoVerdict("auto", "other", { sagaxInternal: true, sagaxGate: true, toolName: name }).approve).toBeNull();
    }
    expect(autoVerdict("auto", "other", { sagaxInternal: true, toolName: "agents__delegate_bot" }).source).toBe("sagax-internal");
  });

  it("never lets rules_update approve itself (rule-change class)", () => {
    expect(toolChangesRules("agents__rules_update")).toBe(true);
    expect(toolChangesRules("mcp__agents__rules_update")).toBe(true);
    expect(toolChangesRules("agents__list_rules")).toBe(false);
    expect(autoVerdict("auto", "other", { sagaxInternal: true, toolName: "agents__rules_update", ruleChange: true }).approve).toBeNull();
  });

  it("keeps the card when the person protects one of the call's classes with a security key", () => {
    expect(autoVerdict("auto", "other", { sagaxInternal: true, stepUpRequired: ["destructive"] }).approve).toBeNull();
  });

  it("on a confined engine (organization) answers a Data call only while it stays in the bot's workspace", () => {
    const root = mkdtempSync(join(tmpdir(), "sagax-data-self-"));
    try {
      writeFileSync(join(root, "sales.csv"), "a\n1\n");
      const load = (args: Record<string, unknown>) => sagaxInternalSelfAnswers("data__data_load", JSON.stringify(args), [root], true);
      expect(load({ source: join(root, "sales.csv") })).toBe(true);
      expect(load({ source: join(root, "later", "new.csv") })).toBe(true);
      expect(load({ source: "/etc/passwd", kind: "csv" })).toBe(false);
      expect(load({ source: join(root, "..", "x.csv") })).toBe(false);
      expect(load({ source: "~/.ssh/id_rsa" })).toBe(false);
      expect(load({ source: "relative.csv" })).toBe(false);
      expect(load({ source: "postgres://u:p@db.example.com/x" })).toBe(false);
      expect(load({ source: "x", kind: "postgres" })).toBe(false);
      expect(load({ source: "mysql://db.example.com/x" })).toBe(false);
      expect(load({ source: "http://example.com/a.csv" })).toBe(false);
      expect(load({ source: "https://169.254.169.254/latest/meta-data" })).toBe(false);
      expect(load({ source: "https://10.0.0.5/a.csv" })).toBe(false);
      expect(load({ source: "https://[::1]/a.csv" })).toBe(false);
      expect(load({ source: "https://localhost/a.csv" })).toBe(false);
      expect(load({ source: "https://kubernetes.default.svc/a.csv" })).toBe(false);
      expect(load({ source: "https://intranet/a.csv" })).toBe(false);
      expect(load({ source: "s3://bucket/a.csv" })).toBe(false);
      expect(load({ source: "https://example.com/a.csv" })).toBe(true);
      expect(load({ source: "https://docs.google.com/spreadsheets/d/abc/edit" })).toBe(true);
      expect(sagaxInternalSelfAnswers("data__data_load", "not json", [root], true)).toBe(false);
      const sql = (text: string) => sagaxInternalSelfAnswers("mcp__data__data_sql", JSON.stringify({ sql: text }), [root], true);
      expect(sql("SELECT region, sum(total) FROM sales GROUP BY 1")).toBe(true);
      expect(sql("SELECT * FROM read_csv('/etc/passwd')")).toBe(false);
      expect(sql("SELECT * FROM '/etc/hosts'")).toBe(false);
      expect(sql("SELECT * FROM read_csv('https://example.com/a.csv')")).toBe(false);
      expect(sql("SELECT * FROM \"~/secret.csv\"")).toBe(false);
      expect(sql("ATTACH 'x.db' AS x")).toBe(false);
      expect(sql("SELECT getenv('HOME')")).toBe(false);
      // re-review 2026-10-17: places built out of sight keep their card too
      expect(sql("select * from read_csv($$https://10.0.0.1/x.csv$$)")).toBe(false);
      expect(sql("select * from read_csv($q$/etc/hosts$q$)")).toBe(false);
      expect(sql("select * from read_csv('https:'||chr(47)||chr(47)||'kubernetes.default.svc/x')")).toBe(false);
      expect(sql("select * from read_csv(E'\\x2fetc\\x2fhosts')")).toBe(false);
      expect(sql("SELECT a || b AS ab, price * 2 FROM sales")).toBe(true);
      expect(sagaxInternalSelfAnswers("data__data_export", JSON.stringify({ table: "sales", format: "csv", path: "/Users/x/Downloads/sales.csv" }), [root], true)).toBe(true);
      expect(sagaxInternalSelfAnswers("data__data_show", JSON.stringify({ sql: "SELECT 1", kind: "table", title: "Load by region" }), [root], true)).toBe(true);
      // the agents tools keep answering, Data or not
      expect(sagaxInternalSelfAnswers("agents__delegate_bot", "{}", [root], true)).toBe(true);
      expect(sagaxInternalSelfAnswers("sagax-environment__run_command", "{}", [root], true)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("in solo the same rule as an organization server answers: no forced card, a visible reach keeps its card (#1098)", () => {
    const root = mkdtempSync(join(tmpdir(), "sagax-data-solo-"));
    try {
      writeFileSync(join(root, "sales.csv"), "a\n1\n");
      const solo = (tool: string, args: Record<string, unknown> | string) => sagaxInternalSelfAnswers(tool, typeof args === "string" ? args : JSON.stringify(args), [root], false);
      // the person's own SQL, describe, show and export on their own tables answer themselves
      for (const tool of ["data__data_sql", "mcp__data__data_show", "data__data_export", "data__data_describe"]) {
        expect(solo(tool, { sql: "SELECT region, sum(amount) FROM sales GROUP BY 1", table: "sales", format: "csv" }), tool).toBe(true);
      }
      expect(solo("data__data_sql", "{}")).toBe(true);
      // what visibly reaches out still gets a card
      for (const text of [
        "SELECT * FROM read_csv(chr(47)||'etc'||chr(47)||'hosts')",
        "SELECT * FROM read_csv($$/etc/hosts$$)",
        "SELECT * FROM read_csv('../../etc/hosts')",
        "SELECT * FROM read_csv(concat('/et', 'c/hosts'))",
        "SELECT * FROM read_csv('https://example.com/a.csv')",
        "ATTACH 'x.db' AS x",
      ]) {
        expect(solo("data__data_sql", { sql: text }), text).toBe(false);
      }
      expect(solo("data__data_load", { source: join(root, "sales.csv") })).toBe(true);
      // a public https load answers itself; a private one, a relative or an escaping path does not
      expect(solo("data__data_load", { source: "https://example.com/a.csv" })).toBe(true);
      expect(solo("data__data_load", { source: "https://10.0.0.5/a.csv" })).toBe(false);
      expect(solo("data__data_load", { source: "../../etc/hosts" })).toBe(false);
      expect(solo("data__data_load", { source: `${root}/../../etc/hosts` })).toBe(false);
      expect(solo("data__data_load", { source: "/etc/hosts", kind: "csv" })).toBe(false);
      expect(solo("agents__delegate_bot", "{}")).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("a public https address is one whose literal host is public and whose name is not local", () => {
    expect(dataPublicHttps("https://example.com/x.csv")).toBe(true);
    expect(dataPublicHttps("https://8.8.8.8/x.csv")).toBe(true);
    expect(dataPublicHttps("https://192.168.1.10/x.csv")).toBe(false);
    expect(dataPublicHttps("https://100.64.0.1/x.csv")).toBe(false);
    expect(dataPublicHttps("https://user:pw@example.com/x.csv")).toBe(false);
    expect(dataPublicHttps("http://example.com/x.csv")).toBe(false);
  });
});

describe("2026-10-17: a built-in tool is Sagax's by identity", () => {
  it("a name another server of the turn could have spelled is never a built-in", () => {
    // a chat engine names server `mcp`'s tool `data__data_sql` mcp__data__data_sql
    expect(sagaxInternalTool("mcp__data__data_sql", ["mcp"])).toBeNull();
    expect(sagaxInternalTool("mcp__agents__list_bots", ["mcp"])).toBeNull();
    expect(sagaxInternalTool("mcp.data.data_sql", ["mcp"])).toBeNull();
    // a server that was somehow named like a built-in
    expect(sagaxInternalTool("data__data_sql", ["data"])).toBeNull();
    expect(sagaxInternalTool("mcp__data__data_sql", ["Data"])).toBeNull();
    // other servers leave the built-in alone
    expect(sagaxInternalTool("mcp__data__data_sql", ["github", "notes"])).toBe("data");
    expect(sagaxInternalTool("agents__list_bots", ["github"])).toBe("agents");
    expect(sagaxInternalTool("mcp__data__data_sql")).toBe("data");
    expect(foreignToolSpelling("github__create_issue", ["github"])).toBe(true);
    expect(foreignToolSpelling("mcp__github__create_issue", ["github"])).toBe(true);
    expect(foreignToolSpelling("mcp__data__data_sql", ["dat"])).toBe(false);
  });

  it("a member's bot keeps the admin card for a spoofed built-in", () => {
    const root = mkdtempSync(join(tmpdir(), "sagax-foreign-"));
    try {
      expect(memberBotAdminApproval({ tool: "mcp__data__data_sql", workspaceRoot: root })).toBe(false);
      expect(memberBotAdminApproval({ tool: "mcp__data__data_sql", workspaceRoot: root, foreignMcpServers: ["mcp"] })).toBe(true);
      expect(memberBotAdminApproval({ tool: "mcp__agents__list_bots", workspaceRoot: root, foreignMcpServers: ["mcp"] })).toBe(true);
      expect(memberBotAdminApproval({ tool: "agents__list_bots", workspaceRoot: root, foreignMcpServers: ["github"] })).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
