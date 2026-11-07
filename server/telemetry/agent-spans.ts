// Agent spans (#2609): turns the runtime-event bus and the usage ledger's
// settled rows into OpenTelemetry spans, GenAI semantic conventions
// (gen_ai.*), plus `sagax.*` attributes for what the conventions lack.
//
// One trace per bot turn:
//   invoke_agent <bot>          the turn: bot, person, source, routine, thread,
//   |                           account, tokens (input/output/cache), cost
//   +- chat <model>             one per model the turn used (main + sub-agents)
//   +- execute_tool <tool>      every tool call; MCP calls carry sagax.mcp.server
//   +- invoke_agent <subagent>  a sub-agent (Agent/Task tool)
//      +- execute_tool <tool>   a call that sub-agent made (parentItemId)
//
// Tool spans close at item.completed. The turn span closes when the turn's
// usage row is booked (server/index-leaves/bookTurnUsage.ts calls settleTurn),
// since that row holds the cost, the trigger and the person; a turn that
// never books (an error before any usage) closes from turn.completed after a
// grace period. Everything here is O(1) map work: no I/O, no await.
import type { RuntimeEvent } from "../../shared/runtime-events.ts";
import type { UsageRow } from "../usage/usage-ledger.ts";
import { newSpanId, newTraceId, type SpanAttributes, type SpanRecord, type SpanStatusCode } from "./otel.ts";

export const SUBAGENT_TOOL_NAMES = new Set(["Agent", "Task"]);
/** A turn whose usage never booked closes this long after turn.completed. */
export const UNSETTLED_GRACE_MS = 30_000;
/** A turn with no event for this long is dropped (a lost turn.completed). */
export const STALE_TURN_MS = 30 * 60_000;
export const MAX_OPEN_TURNS = 1_000;
export const MAX_OPEN_TOOLS = 500;

/** The GenAI provider name for a Sagax engine (driver kind). */
export function genAiProvider(driverKind: string): string {
  const kind = driverKind.toLowerCase();
  if (kind.startsWith("claude") || kind.startsWith("anthropic")) return "anthropic";
  if (kind.startsWith("codex") || kind.startsWith("openai") || kind.startsWith("chatgpt")) return "openai";
  if (kind.startsWith("grok") || kind.startsWith("xai")) return "x_ai";
  if (kind.startsWith("gemini") || kind.startsWith("google")) return "gcp.gemini";
  if (kind.startsWith("mistral")) return "mistral_ai";
  if (kind.startsWith("deepseek")) return "deepseek";
  if (kind.startsWith("groq")) return "groq";
  if (kind.startsWith("openrouter")) return "openrouter";
  return kind || "unknown";
}

/** An MCP call: `mcp__server__tool`, or `server__tool` once an engine
 * flattened the prefix. Returns the server, or null for a built-in tool. */
export function mcpServerOf(tool: string): string | null {
  const full = /^mcp__([^_].*?)__(.+)$/.exec(tool);
  if (full) return full[1]!;
  const flat = /^([A-Za-z0-9][\w-]*?)__([\w-].*)$/.exec(tool);
  return flat ? flat[1]! : null;
}

export type ToolKind = "subagent" | "mcp" | "builtin";

export function toolKindOf(tool: string): ToolKind {
  if (SUBAGENT_TOOL_NAMES.has(tool)) return "subagent";
  return mcpServerOf(tool) ? "mcp" : "builtin";
}

/** Who the turn ran for: the person who spoke, the routine's run-as person,
 * else whoever paid or owns the bot. Null on a solo server's own turns. */
export function personOf(row: Pick<UsageRow, "trigger" | "payerPrincipalId" | "ownerPrincipalId">): string | null {
  const trigger = row.trigger;
  if (trigger.kind === "user") return trigger.principalId || trigger.email || trigger.label || null;
  if (trigger.kind === "routine" && trigger.runAsPrincipalId) return trigger.runAsPrincipalId;
  return row.payerPrincipalId || row.ownerPrincipalId || null;
}

interface OpenTool {
  spanId: string;
  parentSpanId: string;
  name: string;
  kind: ToolKind;
  startMs: number;
}

interface OpenTurn {
  traceId: string;
  spanId: string;
  turnId?: string;
  provider: string;
  instanceId?: string;
  startMs: number;
  lastMs: number;
  tools: Map<string, OpenTool>;
  /** turn.completed seen: when, and whether the turn succeeded. */
  completedAt?: number;
  ok?: boolean;
  stopReason?: string;
}

export interface AgentSpanDeps {
  emit(span: SpanRecord): void;
  /** The bot a thread belongs to, for the tool spans' attributes. */
  botFor?(threadId: string): { id: string; name: string } | null;
  now?(): number;
}

export interface AgentSpans {
  /** Feed every runtime event (bus.subscribe). */
  onEvent(event: RuntimeEvent): void;
  /** The turn's usage row, as booked: closes the turn span and its chat spans. */
  settleTurn(row: UsageRow): void;
  /** Close turns whose usage never booked; drop stale ones. */
  sweep(): void;
  openTurns(): number;
}

function clip(text: string, max = 200): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

export function createAgentSpans(deps: AgentSpanDeps): AgentSpans {
  const now = deps.now ?? Date.now;
  const turns = new Map<string, OpenTurn>();

  const openTurn = (threadId: string, provider: string, instanceId: string | undefined, turnId: string | undefined, at: number): OpenTurn => {
    if (turns.size >= MAX_OPEN_TURNS) {
      const oldest = turns.keys().next().value;
      if (oldest !== undefined) turns.delete(oldest);
    }
    const turn: OpenTurn = { traceId: newTraceId(), spanId: newSpanId(), provider, startMs: at, lastMs: at, tools: new Map(), ...(instanceId ? { instanceId } : {}), ...(turnId ? { turnId } : {}) };
    turns.set(threadId, turn);
    return turn;
  };

  const botAttributes = (threadId: string): SpanAttributes => {
    const bot = deps.botFor?.(threadId);
    return bot ? { "gen_ai.agent.id": bot.id, "gen_ai.agent.name": bot.name, "sagax.bot.id": bot.id, "sagax.bot.name": bot.name } : {};
  };

  const closeTool = (threadId: string, turn: OpenTurn, itemId: string, tool: OpenTool, at: number, status: SpanStatusCode) => {
    turn.tools.delete(itemId);
    const server = tool.kind === "mcp" ? mcpServerOf(tool.name) : null;
    deps.emit({
      traceId: turn.traceId,
      spanId: tool.spanId,
      parentSpanId: tool.parentSpanId,
      name: tool.kind === "subagent" ? `invoke_agent ${tool.name}` : `execute_tool ${tool.name}`,
      kind: 1,
      startMs: tool.startMs,
      endMs: at,
      attributes: {
        "gen_ai.operation.name": tool.kind === "subagent" ? "invoke_agent" : "execute_tool",
        "gen_ai.provider.name": genAiProvider(turn.provider),
        "gen_ai.tool.name": tool.name,
        "gen_ai.tool.call.id": itemId,
        "gen_ai.tool.type": tool.kind === "mcp" ? "extension" : "function",
        "gen_ai.conversation.id": threadId,
        "sagax.thread.id": threadId,
        "sagax.tool.kind": tool.kind,
        ...(server ? { "sagax.mcp.server": server } : {}),
        ...(tool.kind === "subagent" ? { "sagax.subagent": true } : {}),
        ...(turn.turnId ? { "sagax.turn.id": turn.turnId } : {}),
        ...(turn.instanceId ? { "sagax.account.instance": turn.instanceId } : {}),
        ...botAttributes(threadId),
      },
      status,
    });
  };

  const closeOpenTools = (threadId: string, turn: OpenTurn, at: number) => {
    for (const [itemId, tool] of turn.tools) closeTool(threadId, turn, itemId, tool, at, 0);
  };

  const emitTurn = (threadId: string, turn: OpenTurn, row: UsageRow | null, at: number) => {
    const attributes: SpanAttributes = {
      "gen_ai.operation.name": "invoke_agent",
      "gen_ai.provider.name": genAiProvider(row?.driverKind ?? turn.provider),
      "gen_ai.conversation.id": threadId,
      "sagax.thread.id": threadId,
      ...(turn.turnId ? { "sagax.turn.id": turn.turnId } : {}),
      ...botAttributes(threadId),
    };
    let name = "invoke_agent";
    if (row) {
      const person = personOf(row);
      const trigger = row.trigger;
      Object.assign(attributes, {
        "gen_ai.agent.id": row.botId,
        "gen_ai.agent.name": row.botName,
        "sagax.bot.id": row.botId,
        "sagax.bot.name": row.botName,
        "gen_ai.request.model": row.model,
        "gen_ai.response.model": row.model,
        "gen_ai.usage.input_tokens": row.input,
        "gen_ai.usage.output_tokens": row.output,
        "sagax.engine": row.driverKind,
        "sagax.account.instance": row.instanceId,
        "sagax.source": trigger.kind,
      });
      if (row.cachedInput) attributes["gen_ai.usage.cache_read.input_tokens"] = row.cachedInput;
      if (row.costUsd !== null) attributes["sagax.cost.usd"] = row.costUsd;
      if (row.costSource) attributes["sagax.cost.source"] = row.costSource;
      if (row.access) attributes["sagax.account.access"] = row.access;
      if (row.payerPrincipalId) attributes["sagax.account.payer"] = row.payerPrincipalId;
      if (row.ownerPrincipalId) attributes["sagax.bot.owner"] = row.ownerPrincipalId;
      if (person) attributes["enduser.id"] = person;
      if (trigger.kind === "routine") {
        if (trigger.routineId) attributes["sagax.routine.id"] = trigger.routineId;
        if (trigger.label) attributes["sagax.routine.name"] = clip(trigger.label);
      }
      if (trigger.kind === "helper" && trigger.job) attributes["sagax.helper.job"] = trigger.job;
      name = `invoke_agent ${row.botName}`;
    } else if (typeof attributes["gen_ai.agent.name"] === "string") {
      name = `invoke_agent ${attributes["gen_ai.agent.name"]}`;
    }
    const status: SpanStatusCode = turn.ok === false ? 2 : turn.ok === true || row ? 1 : 0;
    const endMs = Math.max(turn.completedAt ?? at, turn.startMs);
    deps.emit({ traceId: turn.traceId, spanId: turn.spanId, name, kind: 1, startMs: turn.startMs, endMs, attributes, status, ...(turn.ok === false && turn.stopReason ? { statusMessage: clip(turn.stopReason) } : {}) });
    if (!row) return;
    // One chat span per model the turn used: the conventions' model call.
    const shares = row.models?.length ? row.models : [{ model: row.model, inputTokens: row.input - (row.cachedInput ?? 0), outputTokens: row.output, cachedInputTokens: row.cachedInput, costUsd: row.costUsd }];
    for (const share of shares) {
      const chat: SpanAttributes = {
        "gen_ai.operation.name": "chat",
        "gen_ai.provider.name": genAiProvider(row.driverKind),
        "gen_ai.request.model": share.model,
        "gen_ai.response.model": share.model,
        "gen_ai.usage.input_tokens": Math.max(0, share.inputTokens),
        "gen_ai.usage.output_tokens": share.outputTokens,
        "gen_ai.conversation.id": threadId,
        "sagax.thread.id": threadId,
        "sagax.account.instance": row.instanceId,
        "sagax.bot.id": row.botId,
        "sagax.source": row.trigger.kind,
      };
      if (share.cachedInputTokens) chat["gen_ai.usage.cache_read.input_tokens"] = share.cachedInputTokens;
      if ("cacheWriteTokens" in share && share.cacheWriteTokens) chat["gen_ai.usage.cache_creation.input_tokens"] = share.cacheWriteTokens;
      if (share.costUsd !== null && share.costUsd !== undefined) chat["sagax.cost.usd"] = share.costUsd;
      if (attributes["enduser.id"]) chat["enduser.id"] = attributes["enduser.id"];
      deps.emit({ traceId: turn.traceId, spanId: newSpanId(), parentSpanId: turn.spanId, name: `chat ${share.model}`, kind: 3, startMs: turn.startMs, endMs, attributes: chat, status: 1 });
    }
  };

  const sweep = () => {
    const at = now();
    for (const [threadId, turn] of turns) {
      if (turn.completedAt !== undefined && at - turn.completedAt >= UNSETTLED_GRACE_MS) {
        turns.delete(threadId);
        closeOpenTools(threadId, turn, turn.completedAt);
        emitTurn(threadId, turn, null, at);
      } else if (at - turn.lastMs >= STALE_TURN_MS) {
        turns.delete(threadId);
      }
    }
  };

  return {
    onEvent(event) {
      const at = now();
      if (event.type === "turn.started") {
        const previous = turns.get(event.threadId);
        // The previous turn never booked: close it before the next opens.
        if (previous) {
          turns.delete(event.threadId);
          closeOpenTools(event.threadId, previous, at);
          emitTurn(event.threadId, previous, null, at);
        }
        openTurn(event.threadId, event.provider, event.providerInstanceId, event.turnId, at);
        return;
      }
      if (event.type === "item.started" && event.itemType === "tool" && event.itemId) {
        const turn = turns.get(event.threadId) ?? openTurn(event.threadId, event.provider, event.providerInstanceId, event.turnId, at);
        turn.lastMs = at;
        if (turn.tools.size >= MAX_OPEN_TOOLS) return;
        const name = (event.title ?? "").trim() || "tool";
        const parent = event.parentItemId ? turn.tools.get(event.parentItemId) : undefined;
        turn.tools.set(event.itemId, { spanId: newSpanId(), parentSpanId: parent?.spanId ?? turn.spanId, name, kind: toolKindOf(name), startMs: at });
        return;
      }
      if (event.type === "item.completed" && event.itemType === "tool" && event.itemId) {
        const turn = turns.get(event.threadId);
        const tool = turn?.tools.get(event.itemId);
        if (!turn || !tool) return;
        turn.lastMs = at;
        closeTool(event.threadId, turn, event.itemId, tool, at, event.ok ? 1 : 2);
        return;
      }
      if (event.type === "turn.completed") {
        const turn = turns.get(event.threadId);
        if (!turn) return;
        turn.lastMs = at;
        turn.completedAt = at;
        turn.ok = event.ok;
        if (event.stopReason) turn.stopReason = event.stopReason;
        closeOpenTools(event.threadId, turn, at);
      }
    },
    settleTurn(row) {
      const at = now();
      let turn = turns.get(row.threadId);
      if (turn) {
        turns.delete(row.threadId);
        closeOpenTools(row.threadId, turn, at);
      } else {
        // A booking with no turn seen (keep-warm, a helper job): its own trace.
        const start = row.durationMs ? at - row.durationMs : at;
        turn = { traceId: newTraceId(), spanId: newSpanId(), provider: row.driverKind, instanceId: row.instanceId, startMs: start, lastMs: at, tools: new Map(), completedAt: at, ok: true };
      }
      emitTurn(row.threadId, turn, row, at);
    },
    sweep,
    openTurns: () => turns.size,
  };
}
