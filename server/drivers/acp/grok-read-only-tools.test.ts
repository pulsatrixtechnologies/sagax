import { describe, expect, it } from "vitest";
import { READ_ONLY_AGENT_TOOL_NAMES } from "../../agent-tool-policy.ts";
import { SPAWNED_PROXIES } from "../../proxy-paths.ts";
import { grokReadOnlyAllowRules, isPerspicaxBridge, PERSPICAX_FLOW_COMPUTE_TOOLS, PERSPICAX_READ_ONLY_TOOLS } from "./grok-read-only-tools.ts";

const BRIDGE = SPAWNED_PROXIES.perspicax;
const bridge = (profile = "pr_1") => ({
  command: process.execPath,
  args: [BRIDGE],
  env: { SAGAX_PERSPICAX_PROFILE: profile, SAGAX_PERSPICAX_TOKEN: "t" },
});
const agents = { command: "node", args: ["/fixture/agents-proxy.mjs"], env: {} };

const WRITES = [
  "cw_psa__write", "cw_psa__action", "cw_psa__update_ticket", "cw_psa__log_time",
  "memory_write", "memory_forget", "memory_promote", "memory_propose", "memory_feedback",
  "memory_save", "memory_remove", "memory_suggestions",
  "sagax_send", "sagax_approve", "sagax_nudge", "sagax_routine_run",
  "flow_action", "ask_person", "api_upload", "run_command", "write_file",
];

describe("grokReadOnlyAllowRules", () => {
  it("allows the reviewed read-only agents tools, by exact name", () => {
    const rules = grokReadOnlyAllowRules({ agents });
    expect(rules).toEqual([...READ_ONLY_AGENT_TOOL_NAMES].map((n) => `MCPTool(agents__${n})`).sort());
    expect(rules).toContain("MCPTool(agents__list_bots)");
    for (const rule of rules) expect(rule).not.toMatch(/[*?[\]]/);
  });

  it("allows only the reviewed read tools on a Perspicax bridge", () => {
    const rules = grokReadOnlyAllowRules({ custom: { perspicax_owner: bridge() } });
    expect(rules).toEqual([...PERSPICAX_READ_ONLY_TOOLS, "cw_psa_query"].map((n) => `MCPTool(perspicax_owner__${n})`).sort());
    expect(rules).toContain("MCPTool(perspicax_owner__cw_psa__query)");
    expect(rules).toContain("MCPTool(perspicax_owner__memory_search)");
    for (const tool of PERSPICAX_FLOW_COMPUTE_TOOLS) expect(rules).toContain(`MCPTool(perspicax_owner__${tool})`);
  });

  it("never allows a write, action, send, approval or command tool", () => {
    const rules = grokReadOnlyAllowRules({ agents, custom: { perspicax_owner: bridge(), "sagax-environment": bridge() } });
    for (const tool of WRITES) {
      expect(rules.some((rule) => rule.endsWith(`__${tool})`))).toBe(false);
    }
    expect(rules.some((rule) => rule.includes("sagax-environment__run_command"))).toBe(false);
    // nor their gate aliases (cw_psa__write -> cw_psa_write)
    for (const alias of ["cw_psa_write", "cw_psa_action"]) {
      expect(rules.some((rule) => rule.endsWith(`__${alias})`))).toBe(false);
    }
    // agents write tools stay gated too
    for (const tool of ["create_bot", "send_message", "delegate", "workspace_write", "create_routine"]) {
      expect(rules).not.toContain(`MCPTool(agents__${tool})`);
    }
  });

  it("gives unknown and third-party servers no rule, even when named or shaped like Perspicax", () => {
    expect(grokReadOnlyAllowRules({
      custom: {
        perspicax_fake: { command: "node", args: ["/tmp/evil.mjs"], env: { SAGAX_PERSPICAX_PROFILE: "pr_1" } },
        perspicax_noprofile: { command: process.execPath, args: [BRIDGE], env: {} },
        perspicax_emptyprofile: bridge(""),
        perspicax_trailing: { command: process.execPath, args: ["--inspect", BRIDGE], env: { SAGAX_PERSPICAX_PROFILE: "pr_1" } },
        github: { command: "npx", args: ["github-mcp"], env: {} },
        remote: { url: "https://example.com/mcp" } as never,
        "sagax-flow": { command: process.execPath, args: [SPAWNED_PROXIES.userSandbox], env: { SAGAX_TOOL_SERVER: "sagax-flow" } },
      },
    })).toEqual([]);
    expect(grokReadOnlyAllowRules(undefined)).toEqual([]);
    expect(grokReadOnlyAllowRules({})).toEqual([]);
  });

  it("refuses rule-syntax server names and a custom entry shadowing agents", () => {
    expect(grokReadOnlyAllowRules({ custom: { "evil*": bridge(), "a)b": bridge(), "": bridge(), agents: bridge() } })).toEqual([]);
  });

  it("isPerspicaxBridge matches only the harness bridge script with a profile", () => {
    expect(isPerspicaxBridge(bridge())).toBe(true);
    expect(isPerspicaxBridge(bridge(), "/other/path.mjs")).toBe(false);
    expect(isPerspicaxBridge(undefined)).toBe(false);
  });
});
