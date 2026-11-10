// The connector registry's vocabulary (#3344, part of #3286; design:
// docs/design/connectors-across-engines.md, part P1).
//
// A person's connectors belong to the person, not to the engine of a turn.
// Each provider (claude.ai, grok.com, ChatGPT apps) brings them through one
// of the person's own sign-ins in Sagax; the registry lists them all, per
// person, and keeps names and states on disk so they are known right after
// a restart. Never a token, an address or an email: an account is named by
// its engine, its slot and what it is (personal or team), nothing else.

/** Who brings a connector. */
export type ConnectorProvider = "claude-ai" | "grok-com" | "chatgpt-apps";
export const CONNECTOR_PROVIDERS: readonly ConnectorProvider[] = ["claude-ai", "grok-com", "chatgpt-apps"];

/** The engine whose sign-in carries a provider's connectors. */
export type ConnectorAccountDriver = "claudeAgent" | "grokAgent" | "codex";
export const PROVIDER_DRIVER: Readonly<Record<ConnectorProvider, ConnectorAccountDriver>> = {
  "claude-ai": "claudeAgent",
  "grok-com": "grokAgent",
  "chatgpt-apps": "codex",
};

/** Which of the person's sign-ins on that engine (Grok keeps two). */
export type ConnectorAccountSlot = "primary" | "second";

/** One sign-in of the person's: a provider, the engine instance it belongs
 * to (an added account has its own) and its slot. */
export interface ConnectorAccountRef {
  provider: ConnectorProvider;
  driver: ConnectorAccountDriver;
  instanceId: string;
  slot: ConnectorAccountSlot;
}

/** What a sign-in is, as far as connectors go: a subscription brings
 * them, a key or a missing sign-in brings none, unknown is not read yet. */
export type ConnectorAccountAuth = "subscription" | "key" | "none" | "unknown";

/** A connector's state on its account. */
export type ConnectorState = "connected" | "needs-sign-in" | "failed" | "unknown";

export interface ConnectorTool {
  /** the provider's own tool id (Grok: the full gateway name use_tool takes) */
  id: string;
}

export interface ConnectorEntry {
  /** the catalog id when the connector is a known one ("outlook") */
  id?: string;
  /** what the provider and the prompts call it ("Microsoft Teams") */
  name: string;
  state: ConnectorState;
  /** empty when the provider does not list them before a call (claude.ai) */
  tools: ConnectorTool[];
}

/** One sign-in's connectors, as last read. */
export interface ConnectorAccount extends ConnectorAccountRef {
  /** stable within a person: `<provider>:<instanceId>:<slot>` */
  key: string;
  /** "Claude", "Grok", "Grok (personal account)": how the person and the
   * relay name this sign-in */
  label: string;
  /** a Grok sign-in: a personal account or a team one, when known */
  kind?: "personal" | "team";
  auth: ConnectorAccountAuth;
  /** grok.com: a managed gateway server was in the catalog at all */
  gateway?: boolean;
  connectors: ConnectorEntry[];
  /** when it was read (epoch ms); 0: never read */
  at: number;
}

export function connectorAccountKey(ref: Pick<ConnectorAccountRef, "provider" | "instanceId" | "slot">): string {
  return `${ref.provider}:${ref.instanceId}:${ref.slot}`;
}

/** One provider behind the registry (server/connectors/providers/). */
export interface ConnectorProviderSource {
  provider: ConnectorProvider;
  /** Past this age a known sign-in is read again in the background (never
   * waited on); none: read only when never read, at sign-in and on request. */
  maxAgeMs?: number;
  /** The person's own sign-ins of this provider, read from Sagax's own
   * sign-in markers: no CLI, never another person's. */
  accounts(principalId: string): ConnectorAccountRef[];
  /** What this process already knows of one sign-in, without waiting on a
   * CLI; undefined when nothing is known in memory. */
  peek(principalId: string, ref: ConnectorAccountRef): ConnectorAccount | undefined;
  /** Read one sign-in again through its own CLI. Undefined when it could
   * not be read (the registry keeps what it had). */
  read(principalId: string, ref: ConnectorAccountRef, force?: boolean): Promise<ConnectorAccount | undefined>;
}
