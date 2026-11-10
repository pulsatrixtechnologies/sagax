// claude.ai connectors in the registry (#3344): what the person's own
// Claude sign-in lists (`claude mcp list`, read by ClaudeAiConnectorInventory
// in server/harness-connectors.ts), by name and state. claude.ai lists no
// tools before a call, so an entry carries none.
import type { ClaudeAiConnectorInventory, ClaudeAiConnectorStatus, ClaudeAiInventory } from "../../harness-connectors.ts";
import { claudeAiServerName, connectorCallId } from "../../../shared/connector-call.ts";
import { readPinnedToolCall, type PinnedToolCallReading } from "../../claude-artifacts/pinned-call.ts";
import type { ConnectorHostResult } from "../hosts/types.ts";
import { connectorAccountKey, type ConnectorAccount, type ConnectorAccountRef, type ConnectorEntry, type ConnectorProviderSource, type ConnectorState } from "../types.ts";
import { canonicalJson } from "./grok-com.ts";

export interface ClaudeAiProviderDeps {
  /** The engine instances of the person's own Claude sign-ins (organization:
   * each signed-in account; solo: the operator's machine login). */
  instances(principalId: string): string[];
  /** The CLI, environment and inventory key of that sign-in, or why none. */
  account(principalId: string, instanceId: string): { cli: string; env: NodeJS.ProcessEnv; key: string } | { unavailable: string };
  inventory: Pick<ClaudeAiConnectorInventory, "peek" | "read">;
  /** "Claude", or the account's own name for an added account */
  label(instanceId: string): string;
}

/** How long a read of a person's claude.ai connectors stays current. */
export const CLAUDE_AI_MAX_AGE_MS = 5 * 60_000;

const STATE: Readonly<Record<ClaudeAiConnectorStatus, ConnectorState>> = {
  connected: "connected",
  needs_auth: "needs-sign-in",
  failed: "failed",
  unknown: "unknown",
};

/** One Claude sign-in's inventory as a registry account. */
export function claudeAiAccount(ref: ConnectorAccountRef, label: string, inventory: ClaudeAiInventory): ConnectorAccount {
  return {
    ...ref,
    key: connectorAccountKey(ref),
    label,
    auth: inventory.auth,
    connectors: inventory.auth === "subscription"
      ? inventory.connectors.map((connector) => ({ name: connector.name, state: STATE[connector.status] ?? "unknown", tools: [] }))
      : [],
    at: inventory.at,
  };
}

export function claudeAiProvider(deps: ClaudeAiProviderDeps): ConnectorProviderSource {
  const ref = (instanceId: string): ConnectorAccountRef => ({ provider: "claude-ai", driver: "claudeAgent", instanceId, slot: "primary" });
  return {
    provider: "claude-ai",
    // as the inventory's own cache: the health check opens every connector
    maxAgeMs: CLAUDE_AI_MAX_AGE_MS,
    accounts: (principalId) => deps.instances(principalId).map(ref),
    peek(principalId, wanted) {
      const account = deps.account(principalId, wanted.instanceId);
      if ("unavailable" in account) return undefined;
      // memory only: the registry reads a stale one again (maxAgeMs)
      const inventory = deps.inventory.peek(account.key);
      return inventory ? claudeAiAccount(ref(wanted.instanceId), deps.label(wanted.instanceId), inventory) : undefined;
    },
    async read(principalId, wanted, force = false) {
      const account = deps.account(principalId, wanted.instanceId);
      if ("unavailable" in account) return undefined;
      const inventory = await deps.inventory.read(account.key, { cli: account.cli, env: account.env }, force);
      // the CLI did not answer: keep what was known
      if (inventory.auth === "unknown") return undefined;
      return claudeAiAccount(ref(wanted.instanceId), deps.label(wanted.instanceId), inventory);
    },
  };
}

// ── one call (#3352, connectors across engines L9) ─────────────────────
// The Claude host (server/connectors/hosts/claude-host.ts) runs one approved
// call as a pinned `claude -p` on the person's own sign-in. What the call
// is, how the model is told to make it, and how its result is read, live
// here (measure M1, docs/verification/connectors-hub-measures.md).

/** Claude's own tool id of a call (`mcp__claude_ai_<Name>__<tool>`), or
 * undefined when the tool names another connector than this one. A tool
 * given bare or as the rule key (`claude_ai_<Name>__<tool>`) reads the same. */
export function claudeAiToolId(connector: Pick<ConnectorEntry, "id" | "name">, tool: string): string | undefined {
  const id = connectorCallId("claude-ai", connector, tool);
  const server = claudeAiServerName(connector.name);
  if (!id.startsWith(`${server}__`) || id.length <= server.length + 2) return undefined;
  return `mcp__${id}`;
}

/** The one user message of a pinned call, as the artifact runner words it. */
export function claudeAiPinnedPrompt(toolId: string, input: Record<string, unknown>): string {
  return `Call the tool ${toolId} exactly once with this input JSON, then stop:\n${JSON.stringify(input)}`;
}

/** The ask runs only when it is the approved call: the same tool and an
 * input equal to the approved arguments (key order aside). */
export function claudeAiCallIsApproved(askedTool: unknown, askedInput: unknown, toolId: string, input: Record<string, unknown>): boolean {
  return askedTool === toolId && canonicalJson(askedInput ?? {}) === canonicalJson(input);
}

/** The connector's own state in the launch's init frame
 * (`claude.ai <Name>`: connected, pending, needs-auth, failed). */
export function claudeAiServerStatus(servers: ReadonlyArray<{ name?: unknown; status?: unknown }>, connectorName: string): string | undefined {
  const wanted = `claude.ai ${connectorName.trim()}`.toLowerCase();
  const found = servers.find((server) => typeof server.name === "string" && server.name.trim().toLowerCase() === wanted);
  return typeof found?.status === "string" ? found.status : undefined;
}

/** The approved tool's own result in a pinned call's stream, or what kept
 * it from running. */
export function claudeAiCallResult(stdout: string, toolId: string): { ran: true; result: ConnectorHostResult } | { ran: false; reading: PinnedToolCallReading } {
  const reading = readPinnedToolCall(stdout, (use) => use.name === toolId);
  if (!reading.result) return { ran: false, reading };
  const text = reading.result.text || (reading.result.structured === undefined ? "" : JSON.stringify(reading.result.structured));
  return { ran: true, result: { text, ...(reading.result.isError ? { isError: true } : {}) } };
}
