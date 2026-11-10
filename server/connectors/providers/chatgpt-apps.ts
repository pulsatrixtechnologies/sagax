// ChatGPT apps in the registry (#3344) and one call of them (#3353,
// connectors across engines L10; design docs/design/connectors-across-engines.md,
// part P4, measure M6 in docs/verification/connectors-hub-measures.md).
//
// The person's own Codex sign-in on ChatGPT carries the ChatGPT apps as one
// MCP server of Codex's app-server, `codex_apps`, whose tools are named
// `<connector>.<tool>` and carry the connector in `_meta` (connector_name),
// a full input schema and annotations. The Codex host
// (server/connectors/hosts/codex-host.ts) reads them with
// `mcpServerStatus/list` and calls one with `mcpServer/tool/call`, with no
// model turn. Here: how that list reads as registry accounts, how a call
// names its tool and its rule key, and how its result reads. Never the
// account's address, never a token.
import type { ConnectorHostResult, ConnectorHostTool } from "../hosts/types.ts";
import { connectorAccountKey, type ConnectorAccount, type ConnectorAccountAuth, type ConnectorAccountRef, type ConnectorEntry, type ConnectorProviderSource, type ConnectorState, type ConnectorTool } from "../types.ts";

/** The app-server's MCP server that carries the ChatGPT apps (M6). */
export const CODEX_APPS_SERVER = "codex_apps";

/** How long a read of a person's ChatGPT apps stays current: a newly
 * connected app shows without a new sign-in (the read takes about a second). */
export const CHATGPT_APPS_MAX_AGE_MS = 5 * 60_000;

/** What one read of a Codex sign-in answered: what the sign-in is
 * (account/read) and, on ChatGPT, the app-server's MCP servers. */
export interface CodexAppsListing {
  auth: ConnectorAccountAuth;
  /** `mcpServerStatus/list` data, as Codex answered it */
  servers: unknown[];
  at: number;
}

/** account/read's `account`: ChatGPT brings the apps, a key brings none. */
export function codexAccountAuth(account: unknown): ConnectorAccountAuth {
  if (account === null) return "none";
  const type = (account as { type?: unknown } | undefined)?.type;
  if (type === "chatgpt") return "subscription";
  if (type === "apiKey") return "key";
  return "unknown";
}

const DESCRIPTION_MAX = 1_000;
const SCHEMA_MAX = 8_000;

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** The server's tools, whether Codex sends a map keyed by name or a list. */
function serverTools(server: Record<string, unknown>): Array<Record<string, unknown>> {
  const tools = server.tools;
  if (Array.isArray(tools)) return tools.flatMap((tool: unknown) => { const value = record(tool); return value ? [value] : []; });
  const map = record(tools);
  if (!map) return [];
  return Object.entries(map).flatMap(([name, tool]) => {
    const value = record(tool);
    return value ? [{ ...value, name: text(value.name) ?? name }] : [];
  });
}

/** The connector a ChatGPT app's tool belongs to: its `_meta.connector_name`,
 * else the name before the first dot of the tool. */
function toolConnector(tool: Record<string, unknown>, name: string): string {
  const meta = record(tool._meta);
  return text(meta?.connector_name) ?? text(meta?.connectorName) ?? (name.includes(".") ? name.slice(0, name.indexOf(".")) : name);
}

function registryTool(tool: Record<string, unknown>, name: string): ConnectorTool {
  const description = text(tool.description);
  const schema = record(tool.inputSchema);
  const schemaFits = schema && JSON.stringify(schema).length <= SCHEMA_MAX;
  return {
    id: name,
    ...(description ? { description: description.slice(0, DESCRIPTION_MAX) } : {}),
    ...(schemaFits ? { inputSchema: schema } : {}),
  };
}

/** The connector's state from the server's own auth status (M6:
 * `bearerToken` on a ChatGPT sign-in; `notLoggedIn` asks for a sign-in). */
function serverState(server: Record<string, unknown>): ConnectorState {
  if (server.authStatus === "notLoggedIn") return "needs-sign-in";
  if (server.toolsError !== undefined && server.toolsError !== null) return "failed";
  return "connected";
}

/** One Codex sign-in's ChatGPT apps as a registry account. */
export function chatgptAppsAccount(ref: ConnectorAccountRef, label: string, listing: CodexAppsListing): ConnectorAccount {
  const connectors: ConnectorEntry[] = [];
  if (listing.auth === "subscription") {
    const byName = new Map<string, ConnectorEntry>();
    for (const raw of listing.servers) {
      const server = record(raw);
      if (!server || server.name !== CODEX_APPS_SERVER) continue;
      const state = serverState(server);
      for (const tool of serverTools(server)) {
        const name = text(tool.name);
        if (!name) continue;
        const connector = toolConnector(tool, name);
        const key = connector.toLowerCase();
        const entry = byName.get(key) ?? { name: connector, state, tools: [] };
        entry.tools.push(registryTool(tool, name));
        byName.set(key, entry);
      }
    }
    connectors.push(...byName.values());
  }
  return { ...ref, key: connectorAccountKey(ref), label, auth: listing.auth, connectors, at: listing.at };
}

export interface ChatgptAppsProviderDeps {
  /** The engine instances of the person's own Codex sign-ins (organization:
   * each signed-in folder; solo: the operator's own Codex). Never another
   * person's. */
  signIns(principalId: string): string[];
  /** Read one sign-in's apps through its own app-server (the Codex host);
   * undefined when it is not signed in or Codex did not answer. */
  list(principalId: string, instanceId: string): Promise<CodexAppsListing | undefined>;
  /** "ChatGPT" */
  label?(instanceId: string): string;
}

export function chatgptAppsProvider(deps?: ChatgptAppsProviderDeps): ConnectorProviderSource {
  const ref = (instanceId: string): ConnectorAccountRef => ({ provider: "chatgpt-apps", driver: "codex", instanceId, slot: "primary" });
  const known = new Map<string, ConnectorAccount>();
  const memo = (principalId: string, instanceId: string) => `${principalId}\u0000${instanceId}`;
  return {
    provider: "chatgpt-apps",
    maxAgeMs: CHATGPT_APPS_MAX_AGE_MS,
    accounts: (principalId) => (deps ? deps.signIns(principalId).map(ref) : []),
    peek: (principalId, wanted) => known.get(memo(principalId, wanted.instanceId)),
    async read(principalId, wanted) {
      if (!deps) return undefined;
      const listing = await deps.list(principalId, wanted.instanceId);
      if (!listing || listing.auth === "unknown") return undefined;
      const account = chatgptAppsAccount(ref(wanted.instanceId), deps.label?.(wanted.instanceId) ?? "ChatGPT", listing);
      known.set(memo(principalId, wanted.instanceId), account);
      return account;
    },
  };
}

// ── one call (#3353, L10) ───────────────────────────────────────────────

/** The app-server's own name of a call's tool, from the listed id, a bare
 * id or the rule key (`codex_apps__<connector>.<tool>`); undefined when the
 * connector lists no such tool. */
export function chatgptAppsToolId(connector: Pick<ConnectorEntry, "tools">, tool: string): string | undefined {
  const bare = tool.trim().replace(/^mcp__/i, "").replace(new RegExp(`^${CODEX_APPS_SERVER}__`, "i"), "");
  const exact = connector.tools.find((entry) => entry.id === bare) ?? connector.tools.find((entry) => entry.id.toLowerCase() === bare.toLowerCase());
  if (exact) return exact.id;
  const suffix = connector.tools.filter((entry) => entry.id.toLowerCase().endsWith(`.${bare.toLowerCase()}`));
  return suffix.length === 1 ? suffix[0]!.id : undefined;
}

/** The rule key of a call: the key a native Codex call of the same tool
 * gets (`<server>__<tool>`, server/drivers/codex/tools.ts), so the person's
 * rules decide both the same. */
export function chatgptAppsRuleTool(connector: Pick<ConnectorEntry, "tools">, tool: string): string {
  return `${CODEX_APPS_SERVER}__${chatgptAppsToolId(connector, tool) ?? tool.trim()}`;
}

/** `mcpServer/tool/call`'s result (`content`, `isError`,
 * `structuredContent`): the tool's own text, the provider's own error. */
export function chatgptAppsResult(result: unknown): ConnectorHostResult {
  const value = record(result) ?? {};
  const parts = Array.isArray(value.content) ? value.content : [];
  const joined = parts
    .map((part) => {
      const entry = record(part);
      if (!entry) return "";
      if (typeof entry.text === "string") return entry.text;
      return JSON.stringify(entry);
    })
    .filter(Boolean)
    .join("\n");
  const body = joined || (value.structuredContent === undefined ? "" : JSON.stringify(value.structuredContent));
  return { text: body, ...(value.isError === true ? { isError: true } : {}) };
}

/** A ChatGPT app's tool as the registry knows it: its description and its
 * full input schema (Codex lists both, M6). */
export function chatgptAppsDescribe(connector: ConnectorEntry, tool: string): ConnectorHostTool | undefined {
  const id = chatgptAppsToolId(connector, tool);
  const listed = id ? connector.tools.find((entry) => entry.id === id) : undefined;
  if (!listed) return undefined;
  return {
    id: listed.id,
    ...(listed.description ? { description: listed.description } : {}),
    ...(listed.inputSchema ? { inputSchema: listed.inputSchema } : {}),
  };
}
