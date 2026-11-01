import { describe, expect, it } from "vitest";

import { ENGINES_WITHOUT_FILES, engineReceipt, engineWorksInFiles, servedCapabilities, type Capability } from "./capabilities";
import { reservedMcpName } from "./mcp-reserved-names";

const plugin = { skills: true, commands: true, agents: true };

describe("engineReceipt: what each engine receives", () => {
  it("Claude loads a plugin whole with --plugin-dir (skills, commands, agents native)", () => {
    expect(engineReceipt("claudeAgent", "plugin", { customMcp: true, ...plugin })).toEqual({ skills: "native", commands: "native", agents: "native", nothing: false });
  });

  it("another engine with files reads a plugin's skills, commands and agents from the prompt (server/plugin-turn.ts)", () => {
    for (const kind of ["codex", "piAgent", "grokAgent"]) {
      expect(engineReceipt(kind, "plugin", { customMcp: true, ...plugin }), kind).toEqual({ skills: "prompt", commands: "prompt", agents: "prompt", nothing: false });
    }
  });

  it("engines without files receive a plugin's and a skill's files in the prompt, tools on or off (Q8 C)", () => {
    for (const kind of ["grok", "openai-compat", "minimax", "mistral", "cerebras", "groq"]) {
      expect(engineWorksInFiles(kind), kind).toBe(false);
      expect(engineReceipt(kind, "plugin", { customMcp: true, ...plugin }), kind).toEqual({ skills: "prompt", commands: "prompt", agents: "prompt", nothing: false });
      expect(engineReceipt(kind, "skill", { customMcp: true, skills: true }).skills, kind).toBe("prompt");
    }
    expect([...ENGINES_WITHOUT_FILES].sort()).toEqual(["cerebras", "grok", "groq", "minimax", "mistral", "openai-compat"]);
  });

  it("API engines receive skills, plugin files and the organization's Flow with or without retrieval tools", () => {
    for (const kind of ENGINES_WITHOUT_FILES) {
      for (const skillDiscovery of [true, false]) {
        expect(engineReceipt(kind, "skill", { customMcp: skillDiscovery, skillDiscovery, skills: true }).skills).toBe("prompt");
        expect(engineReceipt(kind, "plugin", { customMcp: true, skillDiscovery, ...plugin }), kind).toEqual({
          skills: "prompt", commands: "prompt", agents: "prompt", nothing: false,
        });
        expect(engineReceipt(kind, "flow", { customMcp: true, skillDiscovery, skills: true }).skills).toBe("prompt");
      }
    }
  });

  it("MCP follows customMcp: mounted by an engine with files, proxied by Sagax for one without", () => {
    expect(engineReceipt("claudeAgent", "mcp", { customMcp: true, mcp: true })).toEqual({ mcp: "mounted", nothing: false });
    expect(engineReceipt("codex", "mcp", { customMcp: true, mcp: true })).toEqual({ mcp: "mounted", nothing: false });
    expect(engineReceipt("grok", "mcp", { customMcp: true, mcp: true })).toEqual({ mcp: "proxied", nothing: false });
    expect(engineReceipt("grok", "mcp", { customMcp: false, mcp: true })).toEqual({ mcp: "none", nothing: true });
    expect(engineReceipt("grok", "role", { customMcp: true, mcp: true })).toEqual({ mcp: "proxied", tools: "proxied", nothing: false });
  });

  it("the organization's Flow reaches every engine (lot 3, Q8 C)", () => {
    expect(engineReceipt("claudeAgent", "flow", { customMcp: true, ...plugin }).skills).toBe("native");
    expect(engineReceipt("codex", "flow", { customMcp: true, ...plugin }).skills).toBe("prompt");
    expect(engineReceipt("grok", "flow", { customMcp: true, ...plugin }).skills).toBe("prompt");
    expect(engineReceipt("grok", "flow", { customMcp: true, skillDiscovery: true, ...plugin }).skills).toBe("prompt");
  });

  it("a skill: native on Claude, from the prompt elsewhere; a library skill from the prompt everywhere", () => {
    expect(engineReceipt("claudeAgent", "skill", { customMcp: true, skills: true }).skills).toBe("native");
    expect(engineReceipt("codex", "skill", { customMcp: true, skills: true }).skills).toBe("prompt");
    expect(engineReceipt("claudeAgent", "skill", { customMcp: true, skills: true, indexOnly: true }).skills).toBe("prompt");
  });

  it("an account's connectors come with the engine of that account only", () => {
    expect(engineReceipt("claudeAgent", "connector", { customMcp: true, account: "claude" })).toEqual({ tools: "native", nothing: false });
    expect(engineReceipt("codex", "connector", { customMcp: true, account: "claude" })).toEqual({ tools: "none", nothing: true });
    expect(engineReceipt("grokAgent", "connector", { customMcp: true, account: "grok" }).tools).toBe("native");
    expect(engineReceipt("grok", "connector", { customMcp: true, account: "grok" }).tools).toBe("native");
  });

  it("servedCapabilities keeps what is on (or imposed) and received", () => {
    const row = (state: Capability["state"], nothing: boolean): Capability => ({
      key: `k:${state}:${nothing}`, form: "mcp", name: "x", source: { kind: "installation", label: "Sagax" }, scope: "installation",
      state, enabled: true, canToggle: false, engine: { nothing },
    });
    expect(servedCapabilities([row("on", false), row("imposed", false), row("on", true), row("off", false), row("not_held", false)]).map((item) => item.key))
      .toEqual(["k:on:false", "k:imposed:false"]);
  });
});

describe("reservedMcpName: one rule for every server (C-18)", () => {
  it("refuses the built-in names, the families with or without a separator, and __", () => {
    for (const name of ["mcp", "computer", "data", "browser", "sagax-environment", "sagax-desktop", "sagax-flow", "sagax_x", "sagaxy",
      "perspicax_cw", "perspicaxx", "claude_ai_github", "claude-ai-x", "openmausbot_phone", "openmausbotx", "mcp-github", "mcpx", "a__b"]) {
      expect(reservedMcpName(name), name).toBe(true);
    }
  });

  it("accepts ordinary names", () => {
    for (const name of ["github", "notes", "my_data", "github-mcp", "claude-ai", "x-sagax"]) expect(reservedMcpName(name), name).toBe(false);
  });
});
