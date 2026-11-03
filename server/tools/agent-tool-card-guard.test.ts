import { describe, expect, it } from "vitest";

import { createAgentCardGuard, targetAgentId, type CardGuardRow } from "./agent-tool-card-guard.ts";
import { ToolGrantStore } from "./tool-grants.ts";
import type { ToolGuardMode } from "./tool-guard.ts";

function setup(mode: ToolGuardMode = "shadow") {
  const grants = new ToolGrantStore(null);
  const rows: CardGuardRow[] = [];
  const guard = createAgentCardGuard({ grants, mode: () => mode, audit: (row) => rows.push(row) });
  return { grants, rows, guard };
}
const bot = { id: "bot-1", name: "Quasar" };

describe("agent tool guard before the card (B2.1)", () => {
  it("ignores non-agent tools", () => {
    const { guard, rows } = setup();
    expect(guard.opened({ requestId: "r", mcpTool: "github__create_issue", bot })).toBeNull();
    expect(guard.opened({ requestId: "r", mcpTool: "agents__nope", bot })).toBeNull();
    expect(rows).toHaveLength(0);
  });

  it("recognizes Claude's mcp__agents__ name", () => {
    const { guard } = setup();
    expect(guard.opened({ requestId: "r", mcpTool: "mcp__agents__send_prompt", bot })).toMatchObject({ deny: false });
  });

  it("shadow: a default write shows the card, and a decline is audited with the speaker", () => {
    const { guard, rows } = setup();
    expect(guard.opened({ requestId: "r1", mcpTool: "agents__send_prompt", bot, speakerPrincipalId: "pr_owner" })).toMatchObject({ deny: false });
    guard.resolved("r1", "deny", "user");
    expect(rows.map((r) => r.outcome)).toEqual(["card", "declined"]);
    expect(rows[1]!.detail).toMatchObject({ phase: "card_answer", guard: "default", guardAllow: true, guardMode: "shadow", speakerPrincipalId: "pr_owner", scope: "agents:write" });
    expect(guard.pendingCount()).toBe(0);
  });

  it("an allowed card leaves only the open row (the call audits itself); a timeout is expired", () => {
    const { guard, rows } = setup();
    guard.opened({ requestId: "a", mcpTool: "agents__send_prompt", bot });
    guard.resolved("a", "allow");
    guard.opened({ requestId: "b", mcpTool: "agents__send_prompt", bot });
    guard.resolved("b", "deny", "timeout");
    expect(rows.map((r) => r.outcome)).toEqual(["card", "card", "expired"]);
  });

  it("shadow records a would-be refusal but still shows the card", () => {
    const { guard, rows } = setup("shadow");
    expect(guard.opened({ requestId: "c", mcpTool: "agents__create_agent", bot })).toMatchObject({ deny: false, decision: { allow: false, reason: "not_granted" } });
    expect(rows[0]).toMatchObject({ outcome: "card", detail: { guardAllow: false, guard: "not_granted" } });
  });

  it("enforce: grant check, then speaker check, before any card", () => {
    const { guard, rows, grants } = setup("enforce");
    expect(guard.opened({ requestId: "d", mcpTool: "agents__create_agent", bot, speakerPrincipalId: "pr_owner" })).toMatchObject({ deny: true, decision: { reason: "not_granted" } });
    grants.grant({ kind: "bot", id: "bot-1" }, "agents:admin", "test");
    expect(guard.opened({ requestId: "e", mcpTool: "agents__create_agent", bot, speakerPrincipalId: "pr_owner" })).toMatchObject({ deny: true, decision: { reason: "speaker_not_granted" } });
    grants.grant({ kind: "user", id: "pr_owner" }, "agents:admin", "test");
    expect(guard.opened({ requestId: "f", mcpTool: "agents__create_agent", bot, speakerPrincipalId: "pr_owner" })).toMatchObject({ deny: false, decision: { reason: "grant" } });
    expect(rows.map((r) => r.outcome)).toEqual(["refused", "refused", "card"]);
    guard.resolved("d", "deny");
    expect(rows).toHaveLength(3);
  });

  it("off: nothing", () => {
    const { guard, rows } = setup("off");
    expect(guard.opened({ requestId: "g", mcpTool: "agents__send_prompt", bot })).toBeNull();
    expect(rows).toHaveLength(0);
  });
});

describe("the card row's target (the agent called, not the caller)", () => {
  it("reads agent_id from the input or the ACP summary", () => {
    expect(targetAgentId({ agent_id: "a-1" })).toBe("a-1");
    expect(targetAgentId(undefined, 'agents__send_prompt {"agent_id":"9c37-b","mode":"fire_and_forget"}')).toBe("9c37-b");
    expect(targetAgentId(undefined, 'agents__send_prompt {"agent_id":"9c37-b","prompt":"cut off')).toBe("9c37-b");
    expect(targetAgentId(undefined, "agents__list_agents")).toBeUndefined();
  });
  it("carries it on both rows", () => {
    const { guard, rows } = setup();
    guard.opened({ requestId: "t", mcpTool: "agents__send_prompt", bot, summary: 'agents__send_prompt {"agent_id":"dispatch"}' });
    guard.resolved("t", "deny", "user");
    expect(rows.map((r) => r.agentId)).toEqual(["dispatch", "dispatch"]);
  });
});
