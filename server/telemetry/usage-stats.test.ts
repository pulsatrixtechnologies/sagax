// Usage statistics (#2609): split by account, model, source and person, with
// the tool, MCP and sub-agent calls read back from the local span files.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { UsageRow } from "../usage/usage-ledger.ts";
import { createTracer } from "./otel.ts";
import { buildUsageStats, readToolSpans, type LocalSpan } from "./usage-stats.ts";

const row = (extra: Partial<UsageRow>): UsageRow => ({
  at: "2026-11-07T12:00:00.000Z",
  botId: "b",
  botName: "B",
  threadId: "t-ada",
  instanceId: "claude",
  driverKind: "claudeAgent",
  model: "claude-opus",
  input: 100,
  output: 10,
  costUsd: 1,
  trigger: { kind: "user", principalId: "pr_ada", label: "Ada" },
  ...extra,
} as UsageRow);

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("buildUsageStats", () => {
  it("splits by account, model, source and person and joins the calls by thread", () => {
    const rows = [
      row({ cachedInput: 40, access: "speaker-key" as UsageRow["access"], models: [
        { model: "claude-opus", inputTokens: 50, outputTokens: 8, cachedInputTokens: 40, costUsd: 0.8 },
        { model: "claude-haiku", inputTokens: 10, outputTokens: 2, costUsd: 0.2 },
      ] }),
      row({ threadId: "t-routine", instanceId: "codex", driverKind: "codex", model: "gpt", costUsd: null, trigger: { kind: "routine", routineId: "r", label: "Nightly", runAsPrincipalId: "pr_bob" } }),
      row({ threadId: "t-owner", costUsd: 2, trigger: { kind: "owner" } }),
    ];
    const spans: LocalSpan[] = [
      { traceId: "x", name: "execute_tool Bash", startMs: 0, endMs: 10, ok: true, threadId: "t-ada", toolName: "Bash", toolKind: "builtin" },
      { traceId: "x", name: "execute_tool mcp__cw__q", startMs: 0, endMs: 30, ok: false, threadId: "t-ada", toolName: "mcp__cw__q", toolKind: "mcp", mcpServer: "cw" },
      { traceId: "y", name: "invoke_agent Agent", startMs: 0, endMs: 5, ok: true, threadId: "t-routine", toolName: "Agent", toolKind: "subagent" },
    ];
    const stats = buildUsageStats(rows, spans);
    expect(stats.totals).toMatchObject({ turns: 3, inputTokens: 300, cachedInputTokens: 40, costUsd: 3, toolCalls: 3, mcpCalls: 1, subagentCalls: 1, toolErrors: 1 });
    expect(stats.byAccount.map((group) => group.key)).toEqual(["claude", "claude:speaker-key", "codex"]);
    expect(stats.byAccount.find((group) => group.key === "codex")).toMatchObject({ engine: "codex", costUsd: null, subagentCalls: 1 });
    expect(stats.byModel.find((group) => group.key === "claude-opus")).toMatchObject({ turns: 2, inputTokens: 190, cachedInputTokens: 40 });
    expect(stats.byModel.find((group) => group.key === "claude-haiku")).toMatchObject({ turns: 1, costUsd: 0.2 });
    expect(stats.bySource.map((group) => [group.key, group.label])).toEqual([["owner", "Owner"], ["user", "Person"], ["routine", "Routine"]]);
    expect(stats.byPerson.find((group) => group.key === "pr_ada")).toMatchObject({ label: "Ada", toolCalls: 2, mcpCalls: 1 });
    expect(stats.byPerson.find((group) => group.key === "pr_bob")).toMatchObject({ subagentCalls: 1 });
    expect(stats.byPerson.find((group) => group.key === "owner")).toMatchObject({ toolCalls: 0 });
    expect(stats.tools.map((tool) => tool.tool)).toEqual(["Agent", "Bash", "mcp__cw__q"]);
    expect(stats.tools.find((tool) => tool.tool === "mcp__cw__q")).toMatchObject({ kind: "mcp", mcpServer: "cw", errors: 1, totalMs: 30 });
  });

  it("reads back the tool spans the tracer wrote, in range only", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-stats-"));
    dirs.push(dir);
    const tracer = createTracer({ dataDir: dir, target: () => null, manual: true });
    const base = { traceId: "a".repeat(32), kind: 1 as const, status: 1 as const };
    tracer.emit({ ...base, spanId: "1".repeat(16), name: "execute_tool Bash", startMs: Date.UTC(2026, 9, 31, 23), endMs: Date.UTC(2026, 9, 31, 23), attributes: { "sagax.tool.kind": "builtin", "gen_ai.tool.name": "Bash", "sagax.thread.id": "t" } });
    tracer.emit({ ...base, spanId: "2".repeat(16), name: "execute_tool mcp__cw__q", startMs: Date.UTC(2026, 10, 2), endMs: Date.UTC(2026, 10, 2) + 7, status: 2, attributes: { "sagax.tool.kind": "mcp", "gen_ai.tool.name": "mcp__cw__q", "sagax.mcp.server": "cw", "sagax.thread.id": "t" } });
    tracer.emit({ ...base, spanId: "3".repeat(16), name: "invoke_agent B", startMs: Date.UTC(2026, 10, 2), endMs: Date.UTC(2026, 10, 2), attributes: { "gen_ai.operation.name": "invoke_agent" } });
    await tracer.flush();
    const all = readToolSpans(dir, { from: new Date(Date.UTC(2026, 9, 1)), to: new Date(Date.UTC(2026, 10, 30)) });
    expect(all.map((span) => span.toolName)).toEqual(["Bash", "mcp__cw__q"]);
    const november = readToolSpans(dir, { from: new Date(Date.UTC(2026, 10, 1)), to: new Date(Date.UTC(2026, 10, 30)) });
    expect(november).toEqual([{ traceId: "a".repeat(32), name: "execute_tool mcp__cw__q", startMs: Date.UTC(2026, 10, 2), endMs: Date.UTC(2026, 10, 2) + 7, ok: false, threadId: "t", toolName: "mcp__cw__q", toolKind: "mcp", mcpServer: "cw" }]);
  });
});
