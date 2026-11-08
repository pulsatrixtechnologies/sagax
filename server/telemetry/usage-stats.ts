// Usage statistics (#2609): one aggregate for the "Usage statistics" page,
// split by account, model, source and person, read from the usage ledger
// (tokens, cost, turns) and the local span files (tool, MCP and sub-agent
// calls). Pure over its inputs; GET /api/usage/stats and /api/me/usage/stats
// serve it (server/routes/usage.ts).
import { readFileSync } from "node:fs";

import { modelSharesOf, triggerLabel, type UsageRow } from "../usage/usage-ledger.ts";
import { containsUuid, isOpaqueId } from "../../shared/human-id.ts";
import { personOf } from "./agent-spans.ts";
import { spansFileFor } from "./otel.ts";
import type { UsageDay, UsageDayValue, UsageStats, UsageStatsGroup, UsageToolStat } from "../../shared/telemetry.ts";

/** What usage-stats needs of a local span line. */
export interface LocalSpan {
  traceId: string;
  name: string;
  startMs: number;
  endMs: number;
  ok: boolean;
  threadId?: string;
  toolName?: string;
  toolKind?: "subagent" | "mcp" | "builtin";
  mcpServer?: string;
}

export const MAX_SPANS_READ = 200_000;

/** The tool spans of [from, to] from `<data>/usage/spans-YYYY-MM.jsonl`. */
export function readToolSpans(dataDir: string, range: { from: Date; to: Date }): LocalSpan[] {
  const out: LocalSpan[] = [];
  const from = range.from.getTime();
  const to = range.to.getTime();
  const cursor = new Date(Date.UTC(range.from.getUTCFullYear(), range.from.getUTCMonth(), 1));
  while (cursor.getTime() <= to && out.length < MAX_SPANS_READ) {
    let text = "";
    try {
      text = readFileSync(spansFileFor(dataDir, cursor), "utf8");
    } catch {
      text = "";
    }
    for (const line of text.split("\n")) {
      if (!line || out.length >= MAX_SPANS_READ) continue;
      try {
        const row = JSON.parse(line) as { t?: string; n?: string; a?: number; b?: number; st?: number; at?: Record<string, unknown> };
        const kind = row.at?.["sagax.tool.kind"];
        if (typeof row.a !== "number" || row.a < from || row.a > to || typeof kind !== "string") continue;
        const attrs = row.at ?? {};
        out.push({
          traceId: String(row.t ?? ""),
          name: String(row.n ?? ""),
          startMs: row.a,
          endMs: typeof row.b === "number" ? row.b : row.a,
          ok: row.st !== 2,
          ...(typeof attrs["sagax.thread.id"] === "string" ? { threadId: attrs["sagax.thread.id"] } : {}),
          ...(typeof attrs["gen_ai.tool.name"] === "string" ? { toolName: attrs["gen_ai.tool.name"] } : {}),
          toolKind: kind === "subagent" || kind === "mcp" ? kind : "builtin",
          ...(typeof attrs["sagax.mcp.server"] === "string" ? { mcpServer: attrs["sagax.mcp.server"] } : {}),
        });
      } catch {
        /* a torn line */
      }
    }
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return out;
}

export type { UsageStats, UsageStatsGroup, UsageToolStat } from "../../shared/telemetry.ts";

type Acc = UsageStatsGroup & { priced: boolean; threads: Set<string> };

function blank(key: string, label: string): Acc {
  return { key, label, turns: 0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, costUsd: null, priced: false, threads: new Set() };
}

function add(acc: Acc, input: number, output: number, cached: number, cost: number | null, threadId: string | null, turn: boolean) {
  if (turn) acc.turns += 1;
  acc.inputTokens += input;
  acc.outputTokens += output;
  acc.cachedInputTokens += cached;
  if (cost !== null) {
    acc.costUsd = (acc.costUsd ?? 0) + cost;
    acc.priced = true;
  }
  if (threadId) acc.threads.add(threadId);
}

/** A label that is never a raw id: the id stays in `key`, the UI shows a name. */
export function readableLabel(value: string, fallback: string): string {
  return isOpaqueId(value) || containsUuid(value) ? fallback : value;
}

const SOURCE_LABELS: Record<string, string> = { user: "Person", owner: "Owner", routine: "Routine", bot: "Bot", helper: "Helper" };

export function buildUsageStats(rows: readonly UsageRow[], spans: readonly LocalSpan[]): UsageStats {
  const byAccount = new Map<string, Acc>();
  const byModel = new Map<string, Acc>();
  const bySource = new Map<string, Acc>();
  const byPerson = new Map<string, Acc>();
  const totals = blank("", "");
  const get = (map: Map<string, Acc>, key: string, label: string) => {
    let acc = map.get(key);
    if (!acc) map.set(key, (acc = blank(key, label)));
    return acc;
  };
  for (const row of rows) {
    const cached = row.cachedInput ?? 0;
    add(totals, row.input, row.output, cached, row.costUsd, row.threadId, true);
    const accountKey = `${row.instanceId}${row.access ? `:${row.access}` : ""}`;
    const account = get(byAccount, accountKey, readableLabel(row.instanceId, row.driverKind || "Engine"));
    account.engine = row.driverKind;
    if (row.access) account.access = row.access;
    add(account, row.input, row.output, cached, row.costUsd, row.threadId, true);
    add(get(bySource, row.trigger.kind, SOURCE_LABELS[row.trigger.kind] ?? row.trigger.kind), row.input, row.output, cached, row.costUsd, row.threadId, true);
    const person = personOf(row);
    const personLabel = row.trigger.kind === "user" ? triggerLabel(row.trigger) : readableLabel(person ?? "Owner", "Person");
    add(get(byPerson, person ?? "owner", personLabel), row.input, row.output, cached, row.costUsd, row.threadId, true);
    const shares = modelSharesOf(row) ?? [{ model: row.model, inputTokens: row.input - cached, outputTokens: row.output, cachedInputTokens: cached, costUsd: row.costUsd }];
    for (const share of shares) {
      const shareCached = share.cachedInputTokens ?? 0;
      add(get(byModel, share.model, share.model), share.inputTokens + shareCached + (share.cacheWriteTokens ?? 0), share.outputTokens, shareCached, share.costUsd, null, true);
    }
  }
  const tools = new Map<string, UsageToolStat>();
  const callsByThread = new Map<string, { tool: number; mcp: number; subagent: number }>();
  let toolErrors = 0;
  const counted = { tool: 0, mcp: 0, subagent: 0 };
  for (const span of spans) {
    const kind = span.toolKind ?? "builtin";
    const name = span.toolName ?? span.name;
    const stat = tools.get(name) ?? { tool: name, kind, ...(span.mcpServer ? { mcpServer: span.mcpServer } : {}), calls: 0, errors: 0, totalMs: 0 };
    stat.calls += 1;
    stat.totalMs += Math.max(0, span.endMs - span.startMs);
    if (!span.ok) {
      stat.errors += 1;
      toolErrors += 1;
    }
    tools.set(name, stat);
    counted.tool += 1;
    if (kind === "mcp") counted.mcp += 1;
    if (kind === "subagent") counted.subagent += 1;
    if (span.threadId) {
      const thread = callsByThread.get(span.threadId) ?? { tool: 0, mcp: 0, subagent: 0 };
      thread.tool += 1;
      if (kind === "mcp") thread.mcp += 1;
      if (kind === "subagent") thread.subagent += 1;
      callsByThread.set(span.threadId, thread);
    }
  }
  const finish = (map: Map<string, Acc>, withCalls: boolean): UsageStatsGroup[] =>
    [...map.values()]
      .map(({ priced, threads, ...group }) => {
        const out: UsageStatsGroup = { ...group, costUsd: priced ? Math.round((group.costUsd ?? 0) * 1e6) / 1e6 : null };
        if (withCalls) {
          out.toolCalls = 0;
          out.mcpCalls = 0;
          out.subagentCalls = 0;
          for (const threadId of threads) {
            const calls = callsByThread.get(threadId);
            if (!calls) continue;
            out.toolCalls += calls.tool;
            out.mcpCalls += calls.mcp;
            out.subagentCalls += calls.subagent;
          }
        }
        return out;
      })
      .sort((a, b) => (b.costUsd ?? 0) - (a.costUsd ?? 0) || b.turns - a.turns || a.key.localeCompare(b.key));
  return {
    totals: {
      turns: totals.turns,
      inputTokens: totals.inputTokens,
      outputTokens: totals.outputTokens,
      cachedInputTokens: totals.cachedInputTokens,
      costUsd: totals.priced ? Math.round((totals.costUsd ?? 0) * 1e6) / 1e6 : null,
      toolCalls: counted.tool,
      mcpCalls: counted.mcp,
      subagentCalls: counted.subagent,
      toolErrors,
    },
    byAccount: finish(byAccount, true),
    byModel: finish(byModel, false),
    bySource: finish(bySource, true),
    byPerson: finish(byPerson, true),
    tools: [...tools.values()].sort((a, b) => b.calls - a.calls || a.tool.localeCompare(b.tool)).slice(0, 50),
  };
}

/** The usage of each day of a window, split like the group rows (same keys):
 * `dayKeys` are the days the series must carry, `dayOf` cuts an instant in
 * the server zone. Rows outside the days are ignored. */
export function buildUsageDays(rows: readonly UsageRow[], dayKeys: readonly string[], dayOf: (at: number) => string): UsageDay[] {
  const days = new Map<string, UsageDay>(dayKeys.map((day) => [day, { day, total: { costUsd: 0, tokens: 0 }, byAccount: {}, byModel: {}, bySource: {}, byPerson: {} }]));
  const bump = (into: Record<string, UsageDayValue>, key: string, cost: number, tokens: number) => {
    const value = (into[key] ??= { costUsd: 0, tokens: 0 });
    value.costUsd += cost;
    value.tokens += tokens;
  };
  for (const row of rows) {
    const day = days.get(dayOf(Date.parse(row.at)));
    if (!day) continue;
    const tokens = row.input + row.output;
    const cost = row.costUsd ?? 0;
    day.total.costUsd += cost;
    day.total.tokens += tokens;
    bump(day.byAccount, `${row.instanceId}${row.access ? `:${row.access}` : ""}`, cost, tokens);
    bump(day.bySource, row.trigger.kind, cost, tokens);
    bump(day.byPerson, personOf(row) ?? "owner", cost, tokens);
    const shares = modelSharesOf(row) ?? [{ model: row.model, inputTokens: row.input - (row.cachedInput ?? 0), outputTokens: row.output, cachedInputTokens: row.cachedInput ?? 0, costUsd: row.costUsd }];
    for (const share of shares) {
      const cached = share.cachedInputTokens ?? 0;
      bump(day.byModel, share.model, share.costUsd ?? 0, share.inputTokens + cached + (share.cacheWriteTokens ?? 0) + share.outputTokens);
    }
  }
  return dayKeys.map((day) => days.get(day)!);
}
