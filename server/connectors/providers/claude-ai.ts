// claude.ai connectors in the registry (#3344): what the person's own
// Claude sign-in lists (`claude mcp list`, read by ClaudeAiConnectorInventory
// in server/harness-connectors.ts), by name and state. claude.ai lists no
// tools before a call, so an entry carries none.
import type { ClaudeAiConnectorInventory, ClaudeAiConnectorStatus, ClaudeAiInventory } from "../../harness-connectors.ts";
import { connectorAccountKey, type ConnectorAccount, type ConnectorAccountRef, type ConnectorProviderSource, type ConnectorState } from "../types.ts";

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
