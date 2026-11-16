// #4408: the connectors a person's own provider accounts carry, one answer
// shape for every provider (GET /api/me/harness-connectors `providers`):
// Claude's claude.ai connectors, the ChatGPT apps of their Codex sign-in and
// what their xAI sign-ins carry, each as one entry of the same kind. The
// server builds it (server/harness-connectors.ts); Settings > Providers >
// Advanced draws one section per entry (src/components/HarnessConnectorsSection.tsx).
// Never an address, an instance id or a token: names and states only.
import { CLAUDE_AI_CONNECTORS_URL } from "./connector-setup.ts";
import { claudeAiConnectorCapabilities, grokConnectorCapabilities, type ConnectorCapability } from "./engine-connectors.ts";
import { GROK_CONNECTORS_URL } from "./grok-cloud-connectors.ts";

/** Where a person manages their ChatGPT apps. */
export const CHATGPT_APPS_URL = "https://chatgpt.com/#settings/Connectors";

export type AccountConnectorStatus = "connected" | "needs_auth" | "failed" | "unknown";

/** Why an account lists no connector. */
export type AccountConnectorsUnavailable =
  | "managed_policy" // the organization restricts MCP servers here
  | "no_engine"      // no engine of this provider on this server
  | "not_signed_in"  // no sign-in of the person's own (or it was refused)
  | "not_operator"   // solo: the machine's sign-in is the operator's
  | "key"            // an API key, which carries no connectors
  | "unknown";       // the read did not answer

/** The registry's providers of account connectors (server/connectors/types.ts). */
export type AccountConnectorProviderId = "claude-ai" | "chatgpt-apps" | "grok-com";

export interface AccountConnector {
  /** a provider's own id of the connector, when it has one */
  id?: string;
  name: string;
  status: AccountConnectorStatus;
}

/** One provider's account connectors, the same shape for each. */
export interface AccountConnectorProvider {
  provider: AccountConnectorProviderId;
  /** The Providers page's group of that provider (shared/model-provider.ts):
   * its name is `vendorLabel(vendor)`. */
  vendor: "anthropic" | "openai" | "xai";
  /** The provider's own place to manage them. */
  manageUrl: string;
  available: boolean;
  reason?: AccountConnectorsUnavailable;
  connectors: AccountConnector[];
}

/** Each provider's group, engine and place, in the Providers page's order
 * (shared/model-provider.ts ACCOUNT_HEAD: Claude, OpenAI, then xAI). */
export const ACCOUNT_CONNECTOR_PROVIDERS: ReadonlyArray<{ provider: AccountConnectorProviderId; vendor: AccountConnectorProvider["vendor"]; driver: string; manageUrl: string }> = [
  { provider: "claude-ai", vendor: "anthropic", driver: "claudeAgent", manageUrl: CLAUDE_AI_CONNECTORS_URL },
  { provider: "chatgpt-apps", vendor: "openai", driver: "codex", manageUrl: CHATGPT_APPS_URL },
  { provider: "grok-com", vendor: "xai", driver: "grokAgent", manageUrl: GROK_CONNECTORS_URL },
];

/** What a connector reaches (mail, calendar, Teams, files): an xAI connector
 * by its catalog id, any other by its name. */
export function accountConnectorCapabilities(provider: AccountConnectorProviderId, connector: { id?: string; name: string }): ConnectorCapability[] {
  return provider === "grok-com" ? grokConnectorCapabilities(connector.id ?? "") : claudeAiConnectorCapabilities(connector.name);
}

const STATUS_RANK: Readonly<Record<AccountConnectorStatus, number>> = { connected: 3, needs_auth: 2, failed: 1, unknown: 0 };

/** The connectors of several sign-ins of one provider, each once (by id,
 * else name): the same connector on two sign-ins keeps its best state. */
export function mergeAccountConnectors(lists: ReadonlyArray<ReadonlyArray<AccountConnector>>): AccountConnector[] {
  const byKey = new Map<string, AccountConnector>();
  for (const list of lists) {
    for (const connector of list) {
      if (connector.name.trim() === "") continue;
      const key = (connector.id ?? connector.name).trim().toLowerCase();
      const known = byKey.get(key);
      if (known && STATUS_RANK[known.status] >= STATUS_RANK[connector.status]) continue;
      byKey.set(key, { ...(connector.id ? { id: connector.id } : {}), name: connector.name, status: connector.status });
    }
  }
  return [...byKey.values()];
}

/** The sign-ins of one provider as its entry: their connectors when one is a
 * subscription, else why there are none. */
export function accountConnectorEntry(
  provider: AccountConnectorProviderId,
  accounts: ReadonlyArray<{ auth: "subscription" | "key" | "none" | "unknown"; connectors: ReadonlyArray<AccountConnector> }>,
): AccountConnectorProvider {
  const head = ACCOUNT_CONNECTOR_PROVIDERS.find((entry) => entry.provider === provider)!;
  const base = { provider, vendor: head.vendor, manageUrl: head.manageUrl };
  const signedIn = accounts.filter((account) => account.auth === "subscription");
  if (signedIn.length) return { ...base, available: true, connectors: mergeAccountConnectors(signedIn.map((account) => account.connectors)) };
  const auths = new Set(accounts.map((account) => account.auth));
  const reason: AccountConnectorsUnavailable = auths.has("unknown") ? "unknown" : auths.has("key") ? "key" : "not_signed_in";
  return { ...base, available: false, reason, connectors: [] };
}

/** The answer's providers: the `providers` list, or for a server that sends
 * only the older fields (claude, codex, grok) the same list built from them. */
export function accountConnectorProviders(answer: {
  providers?: readonly AccountConnectorProvider[];
  manageUrl?: string;
  claude?: { available: boolean; reason?: AccountConnectorsUnavailable; connectors?: readonly AccountConnector[] } | null;
  codex?: { available: boolean; connectors?: readonly AccountConnector[] } | null;
  grok?: { accounts?: ReadonlyArray<{ auth: "subscription" | "key" | "none" | "unknown"; connectors: ReadonlyArray<AccountConnector> }> } | null;
} | null | undefined): AccountConnectorProvider[] {
  if (!answer) return [];
  if (Array.isArray(answer.providers)) return [...answer.providers];
  const out: AccountConnectorProvider[] = [];
  if (answer.claude) {
    out.push({ provider: "claude-ai", vendor: "anthropic", manageUrl: answer.manageUrl ?? CLAUDE_AI_CONNECTORS_URL, available: answer.claude.available,
      ...(answer.claude.available ? {} : { reason: answer.claude.reason ?? "unknown" }), connectors: answer.claude.available ? [...(answer.claude.connectors ?? [])] : [] });
  }
  if (answer.codex?.available) out.push(accountConnectorEntry("chatgpt-apps", [{ auth: "subscription", connectors: answer.codex.connectors ?? [] }]));
  if (answer.grok?.accounts) out.push(accountConnectorEntry("grok-com", answer.grok.accounts));
  return out;
}
