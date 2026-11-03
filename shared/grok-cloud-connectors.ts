// The cloud connectors a Grok account brings (grok.com/connectors).
// Sagax does not sign the person in and does not store a token. The names
// are what Capabilities and Providers show, so Exchange, X and Microsoft
// Teams are visible beside the servers Sagax itself mounts. A turn still
// asks before a call (server/drivers/acp/grok.ts).

export interface GrokCloudConnector {
  id: string;
  name: string;
  /** A tag categoryFromTags already understands. */
  tag: string;
}

export const GROK_CONNECTORS_URL = "https://grok.com/connectors";

export const GROK_CLOUD_CONNECTORS: readonly GrokCloudConnector[] = [
  { id: "outlook", name: "Outlook (Exchange)", tag: "email" },
  { id: "microsoft-teams", name: "Microsoft Teams", tag: "messaging" },
  { id: "x", name: "X", tag: "social" },
  { id: "gmail", name: "Gmail", tag: "email" },
  { id: "google-drive", name: "Google Drive", tag: "files" },
  { id: "onedrive", name: "OneDrive", tag: "files" },
  { id: "sharepoint", name: "SharePoint", tag: "files" },
  { id: "salesforce", name: "Salesforce", tag: "crm" },
];

/** A connector's name as a person or grok.com writes it ("Teams",
 * "Microsoft Teams", "Outlook (Exchange)", "gmail") to its id here. */
export const GROK_CONNECTOR_ALIASES: ReadonlyArray<readonly [RegExp, string]> = [
  [/^(?:microsoft[\s_-]*teams|ms[\s_-]*teams|teams)$/, "microsoft-teams"],
  [/^(?:outlook|microsoft outlook|outlook \(exchange\)|exchange|outlook mail|hotmail|outlook[\s_-]*calendar)$/, "outlook"],
  [/^(?:gmail|google mail)$/, "gmail"],
  [/^(?:google[\s_-]*drive|gdrive|drive)$/, "google-drive"],
  [/^(?:one[\s_-]*drive)$/, "onedrive"],
  [/^(?:share[\s_-]*point)$/, "sharepoint"],
  [/^salesforce$/, "salesforce"],
  [/^(?:x|twitter|x \(twitter\))$/, "x"],
];

export function grokConnectorIdForName(name: string): string | undefined {
  const key = name.replace(/\s+/g, " ").trim().toLowerCase();
  return GROK_CONNECTOR_ALIASES.find(([pattern]) => pattern.test(key))?.[1];
}

// ── the managed MCP gateway (2026-10-28, measured on grok 1.0.46 and 1.0.70)
//
// With `GROK_MANAGED_MCP_GATEWAY_TOOLS_ENABLED=true` the grok.com connectors
// of the signed-in xAI account reach the CLI as ONE `_x.ai/mcp/list` server,
// `managed_gateway:cursor` (type `managedGateway`, displayName
// "Cursor (user-Teams)"), next to `managed_gateway:tasks` (Automations).
// Every connector is a prefix of the tool names, already qualified for
// use_tool, with `_XX` hex escapes:
//   cursor__user-Teams-list_5fchats___10
//   cursor__user-Outlook-send_5fmail___12
//   cursor__user-Outlook-calendar-create_5fcalendar_5fevent___21
// There is no `microsoft_teams` or `outlook` server, so a connector is read
// from the tool names.

export const GROK_GATEWAY_SERVER_PREFIX = "managed_gateway:";

export function isGrokGatewayServer(name: string, type?: unknown): boolean {
  return type === "managedGateway" || name.startsWith(GROK_GATEWAY_SERVER_PREFIX);
}

/** `list_5fchats` -> `list_chats`; `Google_20Drive` -> `Google Drive`. */
export function decodeGrokGatewayName(raw: string): string {
  return raw.replace(/_([0-9a-f]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

/** A gateway tool id read apart: `cursor__user-<server>-<tool>___<n>`.
 * `server` is the MCP server (connector) its owner named, `tool` that
 * server's own tool name, both decoded (`profile_5fuse` reads `profile_use`).
 * `number` is the gateway's number for the server, shared by all its tools. */
export interface GrokGatewayToolId {
  /** the gateway's own server name (`cursor`) */
  gateway: string;
  scope: string;
  server: string;
  tool: string;
  number?: string;
}

const GATEWAY_TOOL_ID = /^(?:mcp__)?([A-Za-z0-9][A-Za-z0-9_]*?)__(user|team|org|workspace)-(.+?)(?:___(\d+))?$/;

/** The server part of a gateway tool id may hold dashes (`user-pulsatrix-cw-
 * profile_5fuse___23`) and nothing marks where it ends. A known server name
 * (`servers`, as the owner wrote it, or as gatewayServerNames reads it from
 * the catalog) settles it; else the tool is the last dash-separated part:
 * the gateway escapes a tool's `_` (`_5f`), so a tool name rarely holds a
 * raw dash while server names often do. Null for an id of no connector
 * (`tasks__create`) or with no tool after the server. */
export function parseGrokGatewayToolId(id: string, servers?: readonly string[]): GrokGatewayToolId | null {
  const match = GATEWAY_TOOL_ID.exec(id.trim());
  if (!match) return null;
  const [, gateway, scope, rest, number] = match as unknown as [string, string, string, string, string | undefined];
  const decodedRest = decodeGrokGatewayName(rest);
  const lower = decodedRest.toLowerCase();
  const known = [...(servers ?? [])]
    .map((name) => decodeGrokGatewayName(name).trim())
    .filter((name) => name && lower.startsWith(`${name.toLowerCase()}-`) && decodedRest.length > name.length + 1)
    .sort((a, b) => b.length - a.length)[0];
  let server: string;
  let tool: string;
  if (known) {
    server = decodedRest.slice(0, known.length);
    tool = decodedRest.slice(known.length + 1);
  } else {
    const cut = rest.lastIndexOf("-");
    if (cut <= 0 || cut === rest.length - 1) return null;
    server = decodeGrokGatewayName(rest.slice(0, cut));
    tool = decodeGrokGatewayName(rest.slice(cut + 1));
  }
  server = server.trim();
  tool = tool.trim();
  if (!server || !tool) return null;
  return { gateway, scope, server, tool, ...(number ? { number } : {}) };
}

/** The server names a gateway's tool list shows: the tools of one server
 * share its number (`___23`), so the dash-separated parts they all start
 * with are the server. A server with one tool cannot be told apart: it is
 * left to the default reading of parseGrokGatewayToolId. */
export function gatewayServerNames(tools: readonly string[]): string[] {
  const byNumber = new Map<string, string[][]>();
  for (const tool of tools) {
    const match = GATEWAY_TOOL_ID.exec(tool.trim());
    if (!match?.[4]) continue;
    const key = `${match[1]}:${match[2]}:${match[4]}`;
    const list = byNumber.get(key) ?? [];
    list.push(match[3]!.split("-"));
    byNumber.set(key, list);
  }
  const names = new Set<string>();
  for (const parts of byNumber.values()) {
    if (parts.length < 2) continue;
    const shortest = Math.min(...parts.map((p) => p.length)) - 1;
    let common = 0;
    while (common < shortest && parts.every((p) => p[common] === parts[0]![common])) common += 1;
    if (common > 0) names.add(decodeGrokGatewayName(parts[0]!.slice(0, common).join("-")));
  }
  return [...names];
}

/** The connector a gateway tool belongs to: its name as grok.com shows it
 * ("Teams", "Outlook", "Google Drive", a member's own "pulsatrix-cw") and
 * its id here when it is one of GROK_CLOUD_CONNECTORS. Null for a tool that
 * names no connector (`tasks__create`). */
export function grokGatewayToolConnector(toolName: string, servers?: readonly string[]): { name: string; id?: string } | null {
  const parsed = parseGrokGatewayToolId(toolName, servers);
  if (!parsed) return null;
  const name = parsed.server;
  // `Outlook-calendar` is Outlook: a known connector's first word names it
  const id = grokConnectorIdForName(name) ?? grokConnectorIdForName(name.split("-")[0]!);
  return id ? { name, id } : { name };
}

/** The connector a whole gateway server stands for. Since 2026-10-30 a
 * grok.com account may also bring one managed server per connector
 * (`managed_gateway:outlook` "Outlook", `managed_gateway:microsoft_teams`
 * "Microsoft Teams", `managed_gateway:outlook_calendar` "Outlook Calendar"),
 * whose tool names carry no connector (`outlook__send_message`): the server
 * names it. Measured on grok 1.0.46 with a team account. Null for a server
 * that names none of GROK_CLOUD_CONNECTORS (`tasks`, `github`, `cursor`). */
export function grokGatewayServerConnector(serverName: string, displayName?: string): { name: string; id: string } | null {
  if (!serverName.startsWith(GROK_GATEWAY_SERVER_PREFIX)) return null;
  const key = serverName.slice(GROK_GATEWAY_SERVER_PREFIX.length).replace(/_/g, " ").trim();
  for (const candidate of [displayName, key]) {
    if (!candidate) continue;
    const id = grokConnectorIdForName(candidate);
    if (id) return { name: candidate, id };
  }
  return null;
}
