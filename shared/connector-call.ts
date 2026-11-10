// One connector call, read the same way wherever it comes from (#3349,
// connectors across engines L6; design docs/design/connectors-across-engines.md,
// part P5).
//
// A person's connector act can reach Sagax three ways: a native ask of the
// engine that mounts the connector (Claude's `mcp__claude_ai_<Name>__<tool>`,
// Grok's gateway tool), or `call_connector` through the hub, from any engine.
// The person's approval settings decide each one on the same facts: the
// provider's own id of the call (the rule key), and whether it reads or acts.
// The hub and the bus both read them here, so the same act gets the same
// verdict and the same rule key everywhere.
import { connectorCallReads, connectorWriteKind } from "./engine-connectors.ts";

export type ConnectorCallProvider = "claude-ai" | "grok-com" | "chatgpt-apps";

/** The agents tool that reaches a connector through the hub. */
export const CALL_CONNECTOR_TOOL = "call_connector";

/** `call_connector` as each engine names it (bare, the agents server's
 * `agents__call_connector`, Claude's `mcp__agents__call_connector`). */
export function isCallConnectorTool(name: unknown): boolean {
  return typeof name === "string" && /^(?:mcp__)?(?:agents__)?call_connector$/i.test(name.trim());
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "connector";
}

/** The MCP server name Claude Code gives a claude.ai connector
 * ("claude.ai Microsoft 365" reads `claude_ai_Microsoft_365`). */
export function claudeAiServerName(connectorName: string): string {
  return `claude_ai_${connectorName.trim().replace(/[^A-Za-z0-9_-]/g, "_")}`;
}

/** The provider's own id of one call (`server__tool`): the name a native
 * call of that provider carries, so the person's rules give both one key
 * (owner-approval.ts normalizeRuleTool). A tool id that already names its
 * server keeps it (Grok's gateway names); a claude.ai connector is Claude's
 * own `claude_ai_<Name>`; another provider's is the connector's slug. */
export function connectorCallId(provider: ConnectorCallProvider, connector: { id?: string; name: string }, tool: string): string {
  const id = tool.trim().replace(/^mcp__/i, "");
  if (id.includes("__")) return id;
  if (provider === "claude-ai") return `${claudeAiServerName(connector.name)}__${id}`;
  return `${slug(connector.id ?? connector.name)}__${id}`;
}

/** A call that reaches outside (a send, a write, anything not plainly a
 * read or a draft): it keeps its card's outward-facing rules. Fails closed. */
export function connectorCallActs(id: string): boolean {
  return connectorWriteKind(id) !== null || !connectorCallReads(id);
}

/** A native call of a claude.ai connector, read apart. Null for any other
 * tool. `connector` is the server's name with its underscores read as
 * spaces, as the labels show it. */
export function claudeAiConnectorCall(name: unknown): { server: string; connector: string; tool: string; id: string } | null {
  if (typeof name !== "string") return null;
  const match = /^(?:mcp__)?(claude_ai_[A-Za-z0-9-]+(?:_[A-Za-z0-9-]+)*?)__([A-Za-z0-9][\w.-]*)$/.exec(name.trim());
  if (!match) return null;
  const server = match[1]!;
  return { server, connector: server.slice("claude_ai_".length).replace(/_/g, " "), tool: match[2]!, id: `${server}__${match[2]!}` };
}

/** What a `call_connector` row says it called: its connector, its tool, and
 * the account the route answered with (from the result, never guessed). */
export interface ConnectorCallReading {
  connector: string;
  tool: string;
  account?: string;
}

function record(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    const text = value.trim();
    const start = text.indexOf("{");
    if (start < 0) return null;
    try { return record(JSON.parse(text.slice(start))); } catch { return null; }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

const text = (value: unknown, max = 120): string => typeof value === "string" ? value.trim().slice(0, max) : "";

/** A `call_connector` call read apart, or null for any other tool. */
export function readConnectorCall(name: unknown, input: unknown, output?: unknown): ConnectorCallReading | null {
  if (!isCallConnectorTool(name)) return null;
  const args = record(input);
  const connector = text(args?.connector);
  const tool = text(args?.tool);
  if (!connector || !tool) return null;
  const answer = output === undefined ? null : record(output);
  const account = text(answer?.account);
  return { connector, tool, ...(account ? { account } : {}) };
}
