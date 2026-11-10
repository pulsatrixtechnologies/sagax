// The connector hub (#3348, connectors across engines L5; design
// docs/design/connectors-across-engines.md, parts P4, P5 and P7).
//
// call_connector reaches a person's connector through the host of its
// provider, whatever engine the calling turn runs on. The hub only routes
// and counts: the route (server/routes/internal-connectors.ts) has already
// opened the held request on the calling turn, and the person's approval
// settings decided it, before the hub asks the host. A provider with no
// host is not callable, and the connectors list says so.
import { connectorCallReads, connectorWriteKind } from "../../shared/engine-connectors.ts";
import type { ConnectorEntry, ConnectorProvider } from "./types.ts";
import type { ConnectorHost, ConnectorHostCall, ConnectorHostResult } from "./hosts/types.ts";

/** Counters of one engine and provider (P7, for the dev panel). */
export interface ConnectorHubStat {
  engine: string;
  provider: ConnectorProvider;
  calls: number;
  ok: number;
  errors: number;
  lastOkAt?: number;
  lastError?: string;
  lastErrorAt?: number;
}

export const CONNECTOR_HUB_ERROR_MAX = 300;

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "connector";
}

/** The rule name of a call when its host names none: a tool id that already
 * names its server keeps it, else the connector's slug and the tool. */
export function defaultConnectorRuleTool(connector: Pick<ConnectorEntry, "id" | "name">, tool: string): string {
  const id = tool.trim();
  if (id.includes("__")) return id;
  return `${slug(connector.id ?? connector.name)}__${id}`;
}

/** A call that reaches outside (a send, a write, anything not plainly a
 * read): the same reading as a native connector call's. */
export function connectorCallOutbound(ruleTool: string): boolean {
  return connectorWriteKind(ruleTool) !== null || !connectorCallReads(ruleTool);
}

export interface ConnectorHub {
  /** A host runs this provider's calls. */
  callable(provider: ConnectorProvider): boolean;
  ruleTool(provider: ConnectorProvider, connector: ConnectorEntry, tool: string): string;
  outbound(ruleTool: string): boolean;
  /** Run one approved call. A provider with no host answers a plain error. */
  call(call: ConnectorHostCall): Promise<ConnectorHostResult>;
  stats(): ConnectorHubStat[];
  close(): Promise<void>;
}

export function createConnectorHub(hosts: readonly ConnectorHost[], now: () => number = Date.now): ConnectorHub {
  const byProvider = new Map<ConnectorProvider, ConnectorHost>();
  for (const host of hosts) if (!byProvider.has(host.provider)) byProvider.set(host.provider, host);
  const counters = new Map<string, ConnectorHubStat>();

  function count(engine: string, provider: ConnectorProvider, result: ConnectorHostResult): void {
    const key = `${engine}\u0000${provider}`;
    const stat = counters.get(key) ?? { engine, provider, calls: 0, ok: 0, errors: 0 };
    stat.calls += 1;
    if (result.isError) {
      stat.errors += 1;
      stat.lastError = result.text.slice(0, CONNECTOR_HUB_ERROR_MAX);
      stat.lastErrorAt = now();
    } else {
      stat.ok += 1;
      stat.lastOkAt = now();
    }
    counters.set(key, stat);
  }

  return {
    callable: (provider) => byProvider.has(provider),
    ruleTool(provider, connector, tool) {
      const named = byProvider.get(provider)?.ruleTool?.(connector, tool);
      return named && named.trim() ? named.trim() : defaultConnectorRuleTool(connector, tool);
    },
    outbound: connectorCallOutbound,
    async call(call) {
      const provider = call.account.provider;
      const host = byProvider.get(provider);
      const engine = call.engine || "unknown";
      if (!host) {
        const result = { text: `${call.connector.name} cannot be called through call_connector yet: its provider has no host on this server.`, isError: true };
        count(engine, provider, result);
        return result;
      }
      let result: ConnectorHostResult;
      try {
        result = await host.call(call);
      } catch (error) {
        result = { text: `${call.connector.name} failed: ${error instanceof Error ? error.message : String(error)}`, isError: true };
      }
      count(engine, provider, result);
      return result;
    },
    stats: () => [...counters.values()].map((stat) => ({ ...stat })).sort((a, b) => `${a.engine} ${a.provider}`.localeCompare(`${b.engine} ${b.provider}`)),
    async close() {
      await Promise.all(hosts.map(async (host) => { try { await host.close?.(); } catch { /* a host that cannot stop is gone with the process */ } }));
    },
  };
}
