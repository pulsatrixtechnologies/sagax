// Agent spans (#2609): one trace per bot turn, GenAI semantic conventions.
import { describe, expect, it } from "vitest";

import type { RuntimeEvent } from "../../shared/runtime-events.ts";
import type { UsageRow } from "../usage/usage-ledger.ts";
import { createAgentSpans, genAiProvider, mcpServerOf, personOf, STALE_TURN_MS, toolKindOf, UNSETTLED_GRACE_MS } from "./agent-spans.ts";
import type { SpanRecord } from "./otel.ts";

const THREAD = "th-1";

function setup() {
  const spans: SpanRecord[] = [];
  let clock = 1_000_000;
  const spansApi = createAgentSpans({ emit: (span) => spans.push(span), botFor: () => ({ id: "bot-1", name: "Ember" }), now: () => clock });
  const ev = (event: Record<string, unknown>) => spansApi.onEvent({ eventId: "e", provider: "claudeAgent", providerInstanceId: "claude", threadId: THREAD, createdAt: "", turnId: "turn-1", ...event } as unknown as RuntimeEvent);
  return { spans, spansApi, ev, tick: (ms: number) => { clock += ms; } };
}

const row = (extra: Partial<UsageRow> = {}): UsageRow => ({
  at: "2026-11-07T12:00:00.000Z",
  botId: "bot-1",
  botName: "Ember",
  threadId: THREAD,
  instanceId: "claude",
  driverKind: "claudeAgent",
  model: "claude-opus",
  input: 1500,
  output: 200,
  cachedInput: 1000,
  costUsd: 0.12,
  costSource: "reported",
  access: "owner-key",
  trigger: { kind: "user", principalId: "pr_ada", email: "ada@example.test" },
  ...extra,
} as UsageRow);

describe("helpers", () => {
  it("maps engines, MCP tool names and tool kinds", () => {
    expect(genAiProvider("claudeAgent")).toBe("anthropic");
    expect(genAiProvider("codex")).toBe("openai");
    expect(genAiProvider("grok")).toBe("x_ai");
    expect(mcpServerOf("mcp__perspicax__cw_psa_query")).toBe("perspicax");
    expect(mcpServerOf("github__create_issue")).toBe("github");
    expect(mcpServerOf("Bash")).toBeNull();
    expect(toolKindOf("Agent")).toBe("subagent");
    expect(toolKindOf("Task")).toBe("subagent");
    expect(toolKindOf("mcp__x__y")).toBe("mcp");
    expect(toolKindOf("Read")).toBe("builtin");
  });

  it("names the person: the speaker, a routine's run-as person, else the payer", () => {
    expect(personOf({ trigger: { kind: "user", principalId: "pr_a" } })).toBe("pr_a");
    expect(personOf({ trigger: { kind: "routine", runAsPrincipalId: "pr_b" } })).toBe("pr_b");
    expect(personOf({ trigger: { kind: "owner" }, payerPrincipalId: "pr_c" })).toBe("pr_c");
    expect(personOf({ trigger: { kind: "owner" } })).toBeNull();
  });
});

describe("createAgentSpans", () => {
  it("nests tool, MCP and sub-agent spans under the turn, and closes the turn with chat spans on settle", () => {
    const { spans, spansApi, ev, tick } = setup();
    ev({ type: "turn.started" });
    tick(10);
    ev({ type: "item.started", itemType: "tool", itemId: "i-agent", title: "Agent" });
    ev({ type: "item.started", itemType: "tool", itemId: "i-mcp", title: "mcp__perspicax__cw_psa_query", parentItemId: "i-agent" });
    tick(5);
    ev({ type: "item.completed", itemType: "tool", itemId: "i-mcp", ok: false });
    ev({ type: "item.completed", itemType: "tool", itemId: "i-agent", ok: true });
    ev({ type: "item.started", itemType: "tool", itemId: "i-bash", title: "Bash" });
    tick(5);
    ev({ type: "turn.completed", ok: true });
    spansApi.settleTurn(row({ models: [
      { model: "claude-opus", inputTokens: 400, outputTokens: 150, cachedInputTokens: 1000, cacheWriteTokens: 50, costUsd: 0.1 },
      { model: "claude-haiku", inputTokens: 50, outputTokens: 50, costUsd: 0.02 },
    ] }));

    const byName = Object.fromEntries(spans.map((span) => [span.name, span]));
    const turn = byName["invoke_agent Ember"]!;
    const agent = byName["invoke_agent Agent"]!;
    const mcp = byName["execute_tool mcp__perspicax__cw_psa_query"]!;
    const bash = byName["execute_tool Bash"]!;
    expect(new Set(spans.map((span) => span.traceId)).size).toBe(1);
    expect(agent.parentSpanId).toBe(turn.spanId);
    expect(mcp.parentSpanId).toBe(agent.spanId);
    expect(bash.parentSpanId).toBe(turn.spanId);
    expect(mcp.status).toBe(2);
    expect(mcp.attributes).toMatchObject({ "gen_ai.operation.name": "execute_tool", "sagax.tool.kind": "mcp", "sagax.mcp.server": "perspicax", "gen_ai.tool.type": "extension", "sagax.bot.name": "Ember", "sagax.thread.id": THREAD });
    expect(agent.attributes).toMatchObject({ "gen_ai.operation.name": "invoke_agent", "sagax.subagent": true, "sagax.tool.kind": "subagent" });
    // The open Bash closed at turn.completed, status unset.
    expect(bash.status).toBe(0);
    expect(turn.attributes).toMatchObject({
      "gen_ai.operation.name": "invoke_agent",
      "gen_ai.provider.name": "anthropic",
      "gen_ai.agent.name": "Ember",
      "gen_ai.request.model": "claude-opus",
      "gen_ai.usage.input_tokens": 1500,
      "gen_ai.usage.output_tokens": 200,
      "gen_ai.usage.cache_read.input_tokens": 1000,
      "gen_ai.conversation.id": THREAD,
      "sagax.cost.usd": 0.12,
      "sagax.account.instance": "claude",
      "sagax.account.access": "owner-key",
      "sagax.source": "user",
      "enduser.id": "pr_ada",
      "sagax.turn.id": "turn-1",
    });
    expect(turn.status).toBe(1);
    expect(turn.endMs - turn.startMs).toBe(20);
    const opus = byName["chat claude-opus"]!;
    expect(opus.kind).toBe(3);
    expect(opus.parentSpanId).toBe(turn.spanId);
    expect(opus.attributes).toMatchObject({ "gen_ai.operation.name": "chat", "gen_ai.usage.input_tokens": 400, "gen_ai.usage.cache_read.input_tokens": 1000, "gen_ai.usage.cache_creation.input_tokens": 50, "sagax.cost.usd": 0.1 });
    expect(byName["chat claude-haiku"]!.attributes["gen_ai.usage.output_tokens"]).toBe(50);
    expect(spansApi.openTurns()).toBe(0);
  });

  it("carries the routine's name and id; a booking before turn.completed still closes the turn", () => {
    const { spans, spansApi, ev } = setup();
    ev({ type: "turn.started" });
    spansApi.settleTurn(row({ trigger: { kind: "routine", routineId: "r-7", label: "Morning dispatch", runAsPrincipalId: "pr_bob" } }));
    ev({ type: "turn.completed", ok: true });
    const turn = spans.find((span) => span.name === "invoke_agent Ember")!;
    expect(turn.attributes).toMatchObject({ "sagax.source": "routine", "sagax.routine.id": "r-7", "sagax.routine.name": "Morning dispatch", "enduser.id": "pr_bob" });
    expect(spans.filter((span) => span.name.startsWith("invoke_agent"))).toHaveLength(1);
    expect(spansApi.openTurns()).toBe(0);
  });

  it("gives a booking with no turn (keep-warm, helper) its own trace", () => {
    const { spans, spansApi } = setup();
    spansApi.settleTurn(row({ durationMs: 300, trigger: { kind: "helper", job: "title" } }));
    const turn = spans.find((span) => span.name === "invoke_agent Ember")!;
    expect(turn.endMs - turn.startMs).toBe(300);
    expect(turn.attributes["sagax.helper.job"]).toBe("title");
    expect(spans.find((span) => span.name === "chat claude-opus")!.traceId).toBe(turn.traceId);
  });

  it("closes a turn that never booked after the grace period, as an error when it failed", () => {
    const { spans, spansApi, ev, tick } = setup();
    ev({ type: "turn.started" });
    ev({ type: "turn.completed", ok: false, stopReason: "provider error" });
    spansApi.sweep();
    expect(spans).toHaveLength(0);
    tick(UNSETTLED_GRACE_MS);
    spansApi.sweep();
    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({ name: "invoke_agent Ember", status: 2, statusMessage: "provider error" });
    expect(spansApi.openTurns()).toBe(0);
  });

  it("drops a turn that went silent, without a span", () => {
    const { spans, spansApi, ev, tick } = setup();
    ev({ type: "turn.started" });
    tick(STALE_TURN_MS);
    spansApi.sweep();
    expect(spansApi.openTurns()).toBe(0);
    expect(spans).toHaveLength(0);
  });
});
