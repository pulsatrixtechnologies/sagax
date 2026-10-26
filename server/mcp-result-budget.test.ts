import { describe, expect, it } from "vitest";

import { customMcpServers, type AppConfig } from "./config.ts";
import { attachCustomMcp, customMcpResultBudgets } from "./mcp-result-budget.ts";

const cfg = {
  mcpServers: {
    fx: { command: "npx", args: ["fx"], enabled: true, resultBudget: 40_000 },
    off: { command: "npx", enabled: true, resultBudget: 0 },
    plain: { command: "npx", enabled: true },
  },
} as unknown as AppConfig;

describe("customMcpResultBudgets", () => {
  it("lists only the servers that set a limit, 0 included", () => {
    expect(customMcpResultBudgets(cfg, ["fx", "off", "plain", "missing"])).toEqual({ fx: 40_000, off: 0 });
  });

  it("never lets the limit reach the mounted server spec", () => {
    const specs = customMcpServers(cfg);
    expect(specs.fx).toEqual({ command: "npx", args: ["fx"], env: {} });
    expect(JSON.stringify(specs)).not.toContain("resultBudget");
  });
});

describe("attachCustomMcp", () => {
  it("hands the specs and the limits apart, and nothing when there are no servers", () => {
    const integrations: Parameters<typeof attachCustomMcp>[0] = {};
    attachCustomMcp(integrations, {}, cfg);
    expect(integrations).toEqual({});
    attachCustomMcp(integrations, customMcpServers(cfg), cfg);
    expect(Object.keys(integrations.custom ?? {}).sort()).toEqual(["fx", "off", "plain"]);
    expect(integrations.customResultBudgets).toEqual({ fx: 40_000, off: 0 });
  });

  it("leaves customResultBudgets absent when no server sets one", () => {
    const integrations: Parameters<typeof attachCustomMcp>[0] = {};
    attachCustomMcp(integrations, customMcpServers(cfg, ["plain"]), cfg);
    expect(integrations.customResultBudgets).toBeUndefined();
  });
});
