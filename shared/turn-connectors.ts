// What a conversation's last turn could reach, by source, as the server
// mounted it (server/turns/turn-connectors.ts). The dev panel's Connectors card
// reads it (src/components/dev-pods/pods/connectors.tsx): never a guess from
// the app-wide server list. Names and states only, never an address, a
// token or an account.

/** Where a connector comes from.
 * - claude: a connector of the person's own Claude account (claude.ai)
 * - grok: the person's own grok.com connectors (a catalog managed there)
 * - perspicax: the speaking person's Perspicax account connection
 * - personal: the person's own MCP server (Settings, My connections)
 * - server: an MCP server of this Sagax server (the organization's on an
 *   organization server, Capabilities > Installed on a personal one)
 * - plugin: an installed plugin of the bot */
export type TurnConnectorSource = "claude" | "grok" | "perspicax" | "personal" | "server" | "plugin";

/** connected: on this turn. reconnect: set up but not usable on this turn
 * (a sign-in, a token or a setting is missing or expired). */
export type TurnConnectorState = "connected" | "reconnect";

export interface TurnConnector {
  name: string;
  source: TurnConnectorSource;
  state: TurnConnectorState;
}

export interface TurnConnectors {
  /** When the turn was built (epoch ms). */
  at: number;
  connectors: TurnConnector[];
  /** The person's own Claude account rode this turn, but its connector list
   * was not read yet (the card says the account, not names). */
  claudeAccount?: true;
  /** #3357: the connectors this conversation called through call_connector,
   * one row per provider and connector (kept from turn to turn). */
  hub?: TurnConnectorHubRow[];
}

/** Providers whose connectors the connector hub calls. */
export type TurnConnectorHubProvider = "claude-ai" | "grok-com" | "chatgpt-apps";
export const TURN_CONNECTOR_HUB_PROVIDERS: readonly TurnConnectorHubProvider[] = ["claude-ai", "grok-com", "chatgpt-apps"];

/** #3357: the dev panel's counters of one connector called through the hub:
 * how many calls, how many failed, how many ran on a warm process, and the
 * tokens of the provider's small model rounds they spent. Counts only,
 * never the call's input, result or error text. */
export interface TurnConnectorHubRow {
  provider: TurnConnectorHubProvider;
  name: string;
  calls: number;
  errors: number;
  warm: number;
  input: number;
  output: number;
  /** When the last call ended (epoch ms), and how. */
  at: number;
  last: "ok" | "error";
}

export const TURN_CONNECTOR_HUB_MAX = 40;

export const TURN_CONNECTOR_SOURCES: readonly TurnConnectorSource[] = ["claude", "grok", "perspicax", "personal", "server", "plugin"];
export const TURN_CONNECTORS_MAX = 80;
const NAME_MAX = 80;

/** A record read back from the wire or a file: only known sources and
 * states, short printable names, one row per source and name. */
export function normalizeTurnConnectors(value: unknown): TurnConnectors | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as { at?: unknown; connectors?: unknown; claudeAccount?: unknown };
  if (typeof raw.at !== "number" || !Number.isFinite(raw.at) || !Array.isArray(raw.connectors)) return undefined;
  const seen = new Set<string>();
  const connectors: TurnConnector[] = [];
  for (const entry of raw.connectors) {
    if (connectors.length >= TURN_CONNECTORS_MAX) break;
    const row = entry as Partial<TurnConnector> | null;
    if (!row || typeof row.name !== "string") continue;
    const name = row.name.trim();
    if (!name || name.length > NAME_MAX || /\p{Cc}/u.test(name)) continue;
    if (!TURN_CONNECTOR_SOURCES.includes(row.source as TurnConnectorSource)) continue;
    const state: TurnConnectorState = row.state === "reconnect" ? "reconnect" : "connected";
    const key = `${row.source}:${name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    connectors.push({ name, source: row.source as TurnConnectorSource, state });
  }
  const hub = normalizeHubRows((value as { hub?: unknown }).hub);
  return { at: raw.at, connectors, ...(raw.claudeAccount === true ? { claudeAccount: true } : {}), ...(hub.length ? { hub } : {}) };
}

const count = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 0);

/** #3357: hub rows read back from the wire or a file: known providers,
 * short printable names, whole counts, one row per provider and name. */
export function normalizeHubRows(value: unknown): TurnConnectorHubRow[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const rows: TurnConnectorHubRow[] = [];
  for (const entry of value) {
    if (rows.length >= TURN_CONNECTOR_HUB_MAX) break;
    const row = entry as Partial<TurnConnectorHubRow> | null;
    if (!row || typeof row.name !== "string" || !TURN_CONNECTOR_HUB_PROVIDERS.includes(row.provider as TurnConnectorHubProvider)) continue;
    const name = row.name.trim();
    if (!name || name.length > NAME_MAX || /\p{Cc}/u.test(name)) continue;
    const key = `${row.provider}:${name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      provider: row.provider as TurnConnectorHubProvider,
      name,
      calls: count(row.calls),
      errors: count(row.errors),
      warm: count(row.warm),
      input: count(row.input),
      output: count(row.output),
      at: count(row.at),
      last: row.last === "error" ? "error" : "ok",
    });
  }
  return rows;
}
