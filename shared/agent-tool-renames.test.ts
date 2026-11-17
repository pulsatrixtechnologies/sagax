// #4439: propose_team_memory became save_team_memory. The old name is a
// hidden alias: it still runs the tool, and a Refuse or Ask first rule
// written on either name still covers the call.
import { describe, expect, it } from "vitest";

import { RENAMED_AGENT_TOOLS, currentAgentToolName, currentRuleToolId } from "./agent-tool-renames.ts";
import { callFacts, evaluateCustomRules, type CustomRule } from "./custom-rules.ts";
import { autoVerdict } from "../server/approvals/auto-approve.ts";
import { normalizeRuleTool } from "../server/approvals/owner-approval.ts";
import { availableTools, catalogProfileFromEnv, knownAgentToolName } from "../server/drivers/agents-catalog.ts";
import { memberOwnScopeTool } from "../server/people/member-tool-scope.ts";
import { MCP_PERMISSIONS } from "../server/mcp/mcp-permissions.ts";

const orgRule = (when: string, behavior: CustomRule["behavior"]): CustomRule =>
  ({ id: `orule_${behavior}`, ownerId: "org", botId: null, when, behavior, riskScope: [], enabled: true, createdAt: 1, updatedAt: 1, org: true } as CustomRule);

const TOOL = "mcp__agents__save_team_memory";
const save = callFacts({ tool: TOOL, input: JSON.stringify({ kind: "term", name: "VPN", detail: "corp" }) });
const oldCall = callFacts({ tool: "mcp__agents__propose_team_memory", input: JSON.stringify({ kind: "term", name: "VPN", detail: "corp" }) });

describe("renamed agents tools (#4439)", () => {
  it("maps the old team memory tool to save_team_memory, with no double underscore in any name", () => {
    expect(currentAgentToolName("propose_team_memory")).toBe("save_team_memory");
    expect(currentAgentToolName("save_team_memory")).toBe("save_team_memory");
    expect(currentAgentToolName("list_bots")).toBe("list_bots");
    expect(currentRuleToolId("agents__propose_team_memory")).toBe("agents__save_team_memory");
    expect(currentRuleToolId("propose_team_memory")).toBe("save_team_memory");
    expect(currentRuleToolId("other__propose_team_memory")).toBe("other__propose_team_memory");
    for (const [from, to] of Object.entries(RENAMED_AGENT_TOOLS)) {
      expect(from).not.toContain("__");
      expect(to).not.toContain("__");
    }
  });

  it("keeps the old name callable but never listed", () => {
    expect(knownAgentToolName("save_team_memory")).toBe(true);
    expect(knownAgentToolName("propose_team_memory")).toBe(true);
    const names = availableTools(catalogProfileFromEnv({ SAGAX_BOT_ID: "bot-a", SAGAX_CHIEF_OF_STAFF: "1" })).map((tool) => tool.name);
    expect(names).toContain("save_team_memory");
    expect(names).not.toContain("propose_team_memory");
  });

  it("stays the member's own tool and keeps its permission under either name", () => {
    expect(memberOwnScopeTool("mcp__agents__save_team_memory")).toBe("own-setup");
    expect(memberOwnScopeTool("mcp__agents__propose_team_memory")).toBe("own-setup");
    const permission = MCP_PERMISSIONS.find((entry) => entry.tool === "save_team_memory");
    expect(permission?.aliases).toContain("propose_team_memory");
  });

  it("an owner rule saved on the old name covers the new tool", () => {
    expect(normalizeRuleTool("mcp__agents__propose_team_memory")).toBe(normalizeRuleTool(TOOL));
    expect(normalizeRuleTool("mcp__agents__propose_team_memory")).toBe("agents__save_team_memory");
  });

  it.each([
    ["deny", "`agents__save_team_memory`"],
    ["deny", "`agents__propose_team_memory`"],
    ["ask", "`agents__save_team_memory`"],
    ["ask", "tool agents__propose_team_memory"],
  ] as const)("an organization %s rule naming %s still holds the save", (behavior, when) => {
    const decision = evaluateCustomRules([orgRule(when, behavior)], save);
    expect(decision).toMatchObject({ kind: behavior });
    expect(evaluateCustomRules([orgRule(when, behavior)], oldCall)).toMatchObject({ kind: behavior });
    // and the card is still shown, even at Full access: the bot never saves past it
    expect(autoVerdict("full", TOOL, { customRule: { behavior, id: `orule_${behavior}` } }).approve).toBeNull();
  });
});
