// Connector hosts (#3348, connectors across engines L5; design
// docs/design/connectors-across-engines.md, part P4).
//
// A host runs one call of a person's connector for a provider (claude.ai,
// grok.com, ChatGPT apps), on that person's own sign-in. The hub
// (server/connectors/hub.ts) asks it only after the person's approval
// settings decided the call (a held request, P5): a host never asks, never
// decides and never keeps a token of the provider.
import type { ConnectorHostPoolStats } from "../host-pool.ts";
import type { ConnectorAccount, ConnectorEntry, ConnectorProvider } from "../types.ts";

/** One approved call, exactly as the person's settings decided it. */
export interface ConnectorHostCall {
  /** the turn's connector principal (connectorPrincipalFor), never an argument */
  principalId: string;
  /** the person's own sign-in that carries the connector */
  account: ConnectorAccount;
  connector: ConnectorEntry;
  /** the provider's own tool id, as the connector lists it */
  tool: string;
  /** the exact arguments that were approved */
  arguments: Record<string, unknown>;
  /** the engine of the calling turn (its driver kind), for the counters */
  engine: string;
}

/** The tool's own result. `isError`: the provider's own error, shown as is. */
export interface ConnectorHostResult {
  text: string;
  isError?: boolean;
  /** #3350: the person's sign-in of this provider is missing or expired;
   * the route posts the Connect card for that person (nothing was run). */
  needsSignIn?: boolean;
  /** #3357: the provider's small model round that made the call, as its CLI
   * reported it; recorded as usage on the calling thread. Absent when no
   * model ran (Codex) or the CLI reported none. */
  usage?: ConnectorHostUsage;
  /** #3357: the call ran on a process the pool already kept warm. */
  warm?: boolean;
}

/** One model round of a host, in the usage ledger's terms: `input` is the
 * whole prompt, `cachedInput` its cached part. */
export interface ConnectorHostUsage {
  model: string;
  input: number;
  output: number;
  cachedInput?: number;
  /** As the CLI reported it; null when it gave none (then estimated). */
  costUsd: number | null;
}

/** A connector's tool as a host describes it (L7 and later). */
export interface ConnectorHostTool {
  id: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface ConnectorHost {
  provider: ConnectorProvider;
  /** Run one approved call. A host that cannot reach the provider answers
   * an error result; it never throws for a provider's refusal. */
  call(call: ConnectorHostCall): Promise<ConnectorHostResult>;
  /** The name the person's rules give this call (`server__tool`), the same
   * key a native call of this provider gets through normalizeRuleTool.
   * Default: the hub's (connector slug, two underscores, tool). */
  ruleTool?(connector: ConnectorEntry, tool: string): string;
  /** The connector's tools, when the provider lists them on request. */
  list?(principalId: string, account: ConnectorAccount, connector: ConnectorEntry): Promise<ConnectorHostTool[]>;
  /** One tool's description and input schema. */
  describe?(principalId: string, account: ConnectorAccount, connector: ConnectorEntry, tool: string): Promise<ConnectorHostTool | undefined>;
  /** #3357: retire this person's warm processes on one account (its
   * sign-out, a new sign-in on it), or on all of them without a key (a
   * reset). A call in progress finishes with its real result. */
  stopPrincipal?(principalId: string, accountKey?: string): Promise<void> | void;
  /** #3357: its warm pool's counters, when it keeps one. */
  poolStats?(): ConnectorHostPoolStats;
  /** Stop what the host keeps running (idle, sign-out, shutdown). */
  close?(): Promise<void> | void;
}
