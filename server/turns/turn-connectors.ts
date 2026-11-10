// The Connectors record of a direct turn (shared/turn-connectors.ts): what
// the server mounted for this turn, sorted by where it comes from, plus what
// the person set up that this turn could not use (to reconnect). Pure: the
// caller hands every list it already holds when it builds the turn.
import { PERSPICAX_MCP_PREFIX as PERSPICAX, reservedMcpName } from "../../shared/mcp-reserved-names.ts";
import { normalizeHubRows, TURN_CONNECTOR_HUB_MAX, TURN_CONNECTORS_MAX, type TurnConnector, type TurnConnectorHubProvider, type TurnConnectorHubRow, type TurnConnectors } from "../../shared/turn-connectors.ts";

export interface TurnConnectorsInput {
  at: number;
  /** Every MCP server name the engine got on this turn (integrations.custom). */
  mounted: readonly string[];
  /** This Sagax server's own MCP servers the bot may mount, with their
   * sign-in state (mcpOAuth.status) when they have one. */
  serverServers: ReadonlyArray<{ name: string; auth?: string }>;
  /** The person's own MCP servers that are on (My connections). */
  personalServers: readonly string[];
  /** Plugins the engine loaded for the bot. */
  plugins: readonly string[];
  /** The person's own Claude account rides this turn. */
  claudeAi: boolean;
  /** Its connectors when the inventory was read; undefined when not yet. */
  claudeConnectors?: ReadonlyArray<{ name: string; status: string }>;
  /** The person's own grok.com connectors ride this turn. */
  grokCloud: boolean;
}

const byName = (a: TurnConnector, b: TurnConnector) => a.name.localeCompare(b.name);

export function turnConnectorsRecord(input: TurnConnectorsInput): TurnConnectors {
  const mounted = new Set(input.mounted);
  const personal = new Set(input.personalServers);
  const rows: TurnConnector[] = [];

  for (const name of input.mounted) {
    if (PERSPICAX.test(name)) {
      rows.push({ name: name.replace(PERSPICAX, "") || name, source: "perspicax", state: "connected" });
      continue;
    }
    // Sagax's own servers (the person's environment, the desktop bridge,
    // the computer, Flow's compute) and every other reserved name
    // (shared/mcp-reserved-names.ts): tools of Sagax, not connectors.
    if (reservedMcpName(name)) continue;
    if (personal.has(name)) {
      rows.push({ name, source: "personal", state: "connected" });
      continue;
    }
    // mounted without a sign-in it still needs: its tools will refuse
    const auth = input.serverServers.find((entry) => entry.name === name)?.auth;
    const needs = auth === "required" || auth === "expired" || auth === "error";
    rows.push({ name, source: "server", state: needs ? "reconnect" : "connected" });
  }
  // set up and on, but not handed to the engine: a sign-in, a token or a
  // check is missing (mountPersonalMcp skips those)
  for (const name of input.personalServers) {
    if (!mounted.has(name)) rows.push({ name, source: "personal", state: "reconnect" });
  }
  for (const name of new Set(input.plugins)) rows.push({ name, source: "plugin", state: "connected" });
  let claudeAccount = false;
  if (input.claudeAi) {
    if (input.claudeConnectors) {
      for (const connector of input.claudeConnectors) {
        if (connector.status === "unknown") continue;
        rows.push({ name: connector.name, source: "claude", state: connector.status === "connected" ? "connected" : "reconnect" });
      }
    } else {
      claudeAccount = true;
    }
  }
  if (input.grokCloud) rows.push({ name: "grok.com", source: "grok", state: "connected" });

  const order = ["claude", "grok", "perspicax", "personal", "server", "plugin"] as const;
  const sorted = order.flatMap((source) => rows.filter((row) => row.source === source).sort(byName));
  return {
    at: input.at,
    connectors: sorted.slice(0, TURN_CONNECTORS_MAX),
    ...(claudeAccount ? { claudeAccount: true as const } : {}),
  };
}

/** #3357: one call_connector call that reached its host. */
export interface TurnConnectorHubCall {
  provider: TurnConnectorHubProvider;
  /** the connector's name, as the person's registry lists it */
  name: string;
  isError: boolean;
  warm: boolean;
  /** the provider's small model round, when one ran and was reported */
  input?: number;
  output?: number;
  at: number;
}

/** A new turn's record keeps the conversation's hub counters: they count the
 * whole conversation, and a call of this turn may land before the turn's own
 * record is written (the deferred patch). */
export function keepHubRows(previous: TurnConnectors | undefined, next: TurnConnectors): TurnConnectors {
  const hub = normalizeHubRows(previous?.hub);
  return hub.length ? { ...next, hub } : next;
}

/** The conversation's record with one more hub call counted (the dev panel's
 * Connectors card). Without a record yet (the call came before the turn's
 * record was written), one is started with no mounted connector. */
export function withHubCall(record: TurnConnectors | undefined, call: TurnConnectorHubCall): TurnConnectors {
  const base: TurnConnectors = record ?? { at: call.at, connectors: [] };
  const rows: TurnConnectorHubRow[] = normalizeHubRows(base.hub);
  const key = call.name.trim().toLowerCase();
  const at = rows.findIndex((row) => row.provider === call.provider && row.name.toLowerCase() === key);
  const clean = (value: number | undefined) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0);
  const prev: TurnConnectorHubRow = at >= 0 ? rows[at]! : { provider: call.provider, name: call.name.trim(), calls: 0, errors: 0, warm: 0, input: 0, output: 0, at: call.at, last: "ok" };
  const next: TurnConnectorHubRow = {
    ...prev,
    calls: prev.calls + 1,
    errors: prev.errors + (call.isError ? 1 : 0),
    warm: prev.warm + (call.warm ? 1 : 0),
    input: prev.input + clean(call.input),
    output: prev.output + clean(call.output),
    at: call.at,
    last: call.isError ? "error" : "ok",
  };
  if (at >= 0) rows[at] = next;
  else rows.push(next);
  const order = (row: TurnConnectorHubRow) => `${row.provider} ${row.name.toLowerCase()}`;
  const hub = rows.sort((a, b) => order(a).localeCompare(order(b))).slice(0, TURN_CONNECTOR_HUB_MAX);
  return { ...base, hub };
}
