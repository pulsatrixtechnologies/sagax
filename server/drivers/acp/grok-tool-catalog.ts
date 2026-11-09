// Grok's own MCP catalog, said to the model once, so it calls tools
// directly instead of searching for them.
//
// Grok defers every MCP tool behind search_tool and use_tool. A bot asked
// "what connector do you have access to (mcp)" searched each server, then
// called tools one by one to see what they did (2026-10-21: 25 calls).
// Each search is a full model round over the whole context (~20k tokens on
// grok 1.0.62). Sagax already asks Grok for its catalog before every prompt
// (`_x.ai/mcp/list`, grok.ts configureSession): it lists every server, its
// status and its tools by the exact name use_tool takes. That list, names
// only, rides the volatile half once per session (and again only when it
// changes), so:
//   - a question about connectors or tools is answered with no call;
//   - a known tool is called with use_tool directly, no search first.
// Measured on the local bench (perf/instant-tool-turns): see the PR.
import { isAgentToolName } from "../../agent-api.ts";
import {
  decodeGrokGatewayName,
  gatewayServerNames,
  GROK_CLOUD_CONNECTORS,
  grokGatewayServerConnector,
  grokGatewayToolConnector,
  isGrokGatewayServer,
  parseGrokGatewayToolId,
} from "../../../shared/grok-cloud-connectors.ts";
import { GROK_KNOWN_TOOLS_SECTION } from "./grok-tool-usage.ts";

export interface GrokCatalogServer {
  name: string;
  /** ready, or why not (unavailable, failed, needs sign-in) */
  status: string;
  tools: string[];
  /** grok's managed MCP gateway (`managed_gateway:cursor`): the grok.com
   * connectors of the xAI account, each tool name already qualified for
   * use_tool (shared/grok-cloud-connectors.ts). */
  gateway?: true;
  /** what Grok calls it ("Automations") */
  displayName?: string;
}

const NAME = /^[\w .()@:-]{1,80}$/;
const TOOL = /^[A-Za-z0-9][\w.-]{0,63}$/;
/** Grok's catalog keys run to 256 characters (its docs: the 64 cap is only
 * for search_tool/use_tool as function names); gateway names are long
 * (`cursor__user-Outlook-calendar-respond_5fto_5fcalendar_5fevent___21`). */
const GATEWAY_TOOL = /^[A-Za-z0-9][\w.-]{0,255}$/;

/** The servers of an `_x.ai/mcp/list` answer (the request's `result`),
 * enabled ones only; undefined when the answer is unreadable. */
export function readGrokCatalog(result: unknown): GrokCatalogServer[] | undefined {
  const value = result as { servers?: unknown } | null | undefined;
  if (!value || !Array.isArray(value.servers)) return undefined;
  const servers: GrokCatalogServer[] = [];
  for (const raw of value.servers as Array<Record<string, any> | null>) {
    const name = typeof raw?.name === "string" ? raw.name.trim() : "";
    if (!name || !NAME.test(name)) continue;
    const session = raw?.session && typeof raw.session === "object" ? raw.session : {};
    if (session.enabled === false) continue;
    const status = session.authRequired === true && session.status !== "ready"
      ? "needs sign-in"
      : typeof session.status === "string" ? session.status.toLowerCase() : "unknown";
    const gateway = isGrokGatewayServer(name, raw?.type);
    const shape = gateway ? GATEWAY_TOOL : TOOL;
    const tools = Array.isArray(session.tools)
      ? session.tools
        .filter((tool: { name?: unknown; enabled?: unknown } | null) => tool && typeof tool.name === "string" && tool.enabled !== false && shape.test(tool.name))
        .map((tool: { name: string }) => tool.name)
      : [];
    const displayName = typeof raw?.displayName === "string" && NAME.test(raw.displayName.trim()) ? raw.displayName.trim() : undefined;
    servers.push({
      name, status, tools: [...new Set<string>(tools)].sort((a, b) => a.localeCompare(b)),
      ...(gateway ? { gateway: true as const } : {}), ...(gateway && displayName ? { displayName } : {}),
    });
  }
  return servers.sort((a, b) => a.name.localeCompare(b.name));
}

// The last catalog per Grok session, so the volatile section (built right
// after configureSession, same turn) can read it. Bounded.
const CATALOGS_MAX = 256;
const catalogs = new Map<string, GrokCatalogServer[]>();
/** Sessions whose `_x.ai/mcp/list` already reported every MCP server settled.
 * A later prompt on the same live session skips GROK_MCP_SETTLE_MS. Cleared
 * when the session is forgotten (resetGrokCatalogs) or explicitly forgotten
 * before session/new or session/load re-handshake the servers. */
const settledSessions = new Set<string>();

export function rememberGrokCatalog(sessionId: string, result: unknown): void {
  const servers = readGrokCatalog(result);
  if (!sessionId || !servers) return;
  catalogs.delete(sessionId);
  catalogs.set(sessionId, servers);
  while (catalogs.size > CATALOGS_MAX) catalogs.delete(catalogs.keys().next().value!);
}

export function grokCatalogFor(sessionId: string | undefined): GrokCatalogServer[] | undefined {
  return sessionId ? catalogs.get(sessionId) : undefined;
}

/** Mark this live Grok session as having finished its MCP handshake. */
export function rememberGrokMcpSettled(sessionId: string): void {
  if (!sessionId) return;
  settledSessions.add(sessionId);
  while (settledSessions.size > CATALOGS_MAX) settledSessions.delete(settledSessions.keys().next().value!);
}

/** Whether configureSession already confirmed MCP settle for this session. */
export function grokMcpAlreadySettled(sessionId: string | undefined): boolean {
  return Boolean(sessionId && settledSessions.has(sessionId));
}

/** Drop settle state before session/new or session/load reconnects MCP. */
export function forgetGrokMcpSettled(sessionId: string | undefined): void {
  if (sessionId) settledSessions.delete(sessionId);
}

/** A server with more tools than this shows only the ones this bot uses
 * (known, pinned) and a count: Sagax's own agents server has ~70. */
export const GROK_CATALOG_SERVER_TOOLS_MAX = 40;
/** The whole section stays under this many characters (~900 tokens). */
export const GROK_CATALOG_CHARS_MAX = 3_600;

/** Sagax's own agents server is truncated (~70 tools), so a tool the bot has
 * not used yet is unnamed: Remote Access took five calls to reach
 * remote_support_hosts (#3222) and the Today box 26 steps through act and
 * run_command (#3221). These are always named, with their arguments, so one
 * use_tool call answers the request. The arguments are given because a
 * direct-call rule without them made the model deliberate (+4 to 6 s). */
export const GROK_AGENT_SHORTCUTS: readonly { tool: string; args: string; when: string }[] = [
  { tool: "sagax_approvals", args: `{"action":"list"}`, when: "the Today box or what waits for the person (approvals, questions, needs-you cards, offers)" },
  { tool: "remote_support_hosts", args: "{}", when: "Sagax Remote Access or Pulsatrix Assist, the person's own computers (install, status, open)" },
];
const AGENTS_SERVER = "agents";

/** A connector id ("outlook", "microsoft-teams") and a live catalog server
 * name ("outlook", "Microsoft Teams") name the same connector: compared with
 * separators and case removed, one normalized form contains the other (an
 * exact match for a very short id like "x", so a server name is not matched
 * by a stray letter). */
function sameConnector(connectorId: string, serverName: string): boolean {
  const id = connectorId.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const server = serverName.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (!id || !server) return false;
  if (id === server) return true;
  return (id.length >= 4 && server.includes(id)) || (server.length >= 4 && id.includes(server));
}

/** The connectable connectors the live catalog does not already carry (in
 * any status): a connector grok.com already knows is handled by the catalog
 * rows and the "Not connected now" tail, never offered as connectable too. */
export function reconcileConnectable(
  connectable: readonly { id: string; label: string }[],
  catalog: readonly GrokCatalogServer[],
): { id: string; label: string }[] {
  const carried = grokGatewayConnectors(catalog);
  return connectable.filter((connector) =>
    !carried.some((group) => group.id === connector.id) && !catalog.some((server) => !server.gateway && sameConnector(connector.id, server.name)));
}

export interface GrokGatewayConnector {
  /** GROK_CLOUD_CONNECTORS id, when it is one */
  id?: string;
  /** "Microsoft Teams" for a known one, else grok.com's own name */
  label: string;
  /** use_tool names, sorted */
  tools: string[];
  /** When Sagax agent tools were folded onto this connector from others
   * (Perspicax #1050): said in the catalog section so the model sees them once. */
  sagaxAgentToolsNote?: string;
}

export interface GrokGatewayConnectorsOptions {
  /** Prefer the Perspicax / connector profile whose label matches this slug
   * when the same Sagax agent tool appears on several gateway connectors.
   * When omitted, the first connector (sorted) keeps them. */
  activeProfile?: string;
}

/** Bare tool name when this gateway use_tool name is a Sagax agent tool
 * (send_prompt, await_turn, list_agents, sagax_*, ...). Undefined otherwise. */
export function sagaxAgentToolBareName(toolName: string, servers?: readonly string[]): string | undefined {
  const parsed = parseGrokGatewayToolId(toolName, servers);
  if (parsed) return isSagaxAgentBareName(parsed.tool) ? parsed.tool : undefined;
  const cut = toolName.indexOf("__");
  if (cut > 0) {
    const bare = decodeGrokGatewayName(toolName.slice(cut + 2));
    if (isSagaxAgentBareName(bare)) return bare;
  }
  return isSagaxAgentBareName(toolName) ? toolName : undefined;
}

function isSagaxAgentBareName(name: string): boolean {
  return isAgentToolName(name) || name.startsWith("sagax_");
}

function matchesActiveProfile(label: string, activeProfile: string | undefined): boolean {
  if (!activeProfile?.trim()) return false;
  const want = activeProfile.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const have = label.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (!want || !have) return false;
  return want === have || have.includes(want) || want.includes(have);
}

/** Keep each Sagax agent tool on one gateway connector only (Perspicax #1050):
 * the active profile's connection when known, else the first. Other connectors
 * lose those names; the keeper carries a note for the catalog section. */
function collapseDuplicateSagaxAgentTools(
  groups: readonly GrokGatewayConnector[],
  activeProfile?: string,
): GrokGatewayConnector[] {
  const byBare = new Map<string, Array<{ groupIndex: number; tool: string }>>();
  for (let i = 0; i < groups.length; i += 1) {
    const group = groups[i]!;
    const names = gatewayServerNames(group.tools);
    for (const tool of group.tools) {
      const bare = sagaxAgentToolBareName(tool, names);
      if (!bare) continue;
      const list = byBare.get(bare) ?? [];
      list.push({ groupIndex: i, tool });
      byBare.set(bare, list);
    }
  }
  const drop = new Map<number, Set<string>>();
  const keptBares = new Map<number, string[]>();
  for (const [bare, occurrences] of byBare) {
    const groupIndexes = [...new Set(occurrences.map((entry) => entry.groupIndex))];
    if (groupIndexes.length < 2) continue;
    const preferred = groupIndexes.find((index) => matchesActiveProfile(groups[index]!.label, activeProfile));
    const keeper = preferred ?? groupIndexes[0]!;
    for (const entry of occurrences) {
      if (entry.groupIndex === keeper) continue;
      const set = drop.get(entry.groupIndex) ?? new Set<string>();
      set.add(entry.tool);
      drop.set(entry.groupIndex, set);
    }
    const folded = keptBares.get(keeper) ?? [];
    folded.push(bare);
    keptBares.set(keeper, folded);
  }
  if (!drop.size) return [...groups];
  return groups.flatMap((group, index) => {
    const remove = drop.get(index);
    const tools = remove ? group.tools.filter((tool) => !remove.has(tool)) : [...group.tools];
    if (!tools.length) return [];
    const folded = keptBares.get(index);
    const sagaxAgentToolsNote = folded?.length
      ? `Sagax agent tools (${[...folded].sort((a, b) => a.localeCompare(b)).join(", ")}) kept once on this connector; the same names on other Perspicax connectors were folded.`
      : undefined;
    return [{ ...group, tools, ...(sagaxAgentToolsNote ? { sagaxAgentToolsNote } : {}) }];
  });
}

/** The grok.com connectors a ready gateway server carries, by connector
 * (Teams, Outlook...), then the gateway's other tools under its own name
 * (Automations). Empty when the catalog has no gateway. Sagax agent tools
 * that several Perspicax connectors share are kept once (active profile, or
 * the first connector). */
export function grokGatewayConnectors(
  catalog: readonly GrokCatalogServer[],
  options?: GrokGatewayConnectorsOptions,
): GrokGatewayConnector[] {
  const groups = new Map<string, GrokGatewayConnector>();
  for (const server of catalog) {
    if (!server.gateway || server.status !== "ready") continue;
    // a server of one connector (`managed_gateway:outlook`) names it itself
    const serverConnector = grokGatewayServerConnector(server.name, server.displayName);
    // a member's server named with dashes reads whole (#1931)
    const names = gatewayServerNames(server.tools);
    for (const tool of server.tools) {
      const connector = grokGatewayToolConnector(tool, names) ?? serverConnector;
      const known = connector?.id ? GROK_CLOUD_CONNECTORS.find((entry) => entry.id === connector.id) : undefined;
      const label = known?.name ?? connector?.name ?? server.displayName ?? server.name;
      const key = known?.id ?? label.toLowerCase();
      const group = groups.get(key) ?? { ...(known ? { id: known.id } : {}), label, tools: [] };
      group.tools.push(tool);
      groups.set(key, group);
    }
  }
  const sorted = [...groups.values()]
    .map((group) => ({ ...group, tools: [...new Set(group.tools)].sort((a, b) => a.localeCompare(b)) }))
    .sort((a, b) => Number(!a.id) - Number(!b.id) || a.label.localeCompare(b.label));
  return collapseDuplicateSagaxAgentTools(sorted, options?.activeProfile);
}

/** What the xAI account of a Grok sign-in brought on its last turn, by its
 * engine home (the person's subscription folder), so Sagax knows a Grok
 * engine's reach (index.ts engineReachFor, the connector switch and the
 * setup card) instead of guessing. In memory, bounded. */
export interface GrokAccountReach {
  /** any managed gateway server at all in the catalog */
  gateway: boolean;
  /** GROK_CLOUD_CONNECTORS ids the gateway carries */
  connectors: string[];
  /** every connector the gateway carries, known or not, with its tool
   * count: what Providers shows under each account (2026-10-29) */
  groups: Array<{ id?: string; label: string; tools: number }>;
  at: number;
}
const REACH_MAX = 512;
const reachByHome = new Map<string, GrokAccountReach>();

export function noteGrokAccountReach(home: string | undefined, result: unknown, at = Date.now()): void {
  const catalog = readGrokCatalog(result);
  if (!home || !catalog) return;
  const gatewayGroups = grokGatewayConnectors(catalog);
  const connectors = gatewayGroups.flatMap((group) => (group.id ? [group.id] : []));
  const groups = gatewayGroups.map((group) => ({ ...(group.id ? { id: group.id } : {}), label: group.label, tools: group.tools.length }));
  reachByHome.delete(home);
  reachByHome.set(home, { gateway: catalog.some((server) => server.gateway), connectors, groups, at });
  while (reachByHome.size > REACH_MAX) reachByHome.delete(reachByHome.keys().next().value!);
}

/** The connector names a sign-in's reach carries, as the switch and the
 * prompts name them ("Microsoft Teams", "Outlook (Exchange)"): the catalog
 * name for a known connector, grok.com's own for the rest. */
export function grokReachConnectorNames(reach: Pick<GrokAccountReach, "groups"> | undefined): string[] {
  if (!reach) return [];
  return reach.groups.map((group) => GROK_CLOUD_CONNECTORS.find((entry) => entry.id === group.id)?.name ?? group.label);
}

export function grokAccountReach(home: string | undefined): GrokAccountReach | undefined {
  return home ? reachByHome.get(home) : undefined;
}

/** The section naming the catalog (and the bot's known and pinned tools),
 * or null when there is nothing to say. Same id as the known-tools section
 * it replaces, so prompt-split sends one or the other. Stable text for a
 * stable catalog: alphabetical, no counts that drift. */
export function grokCatalogSection(input: {
  catalog: readonly GrokCatalogServer[] | undefined;
  /** `<server>__<tool>` this bot used before (grok-tool-usage.ts) */
  known?: readonly string[];
  /** `<server>__<tool>` a feature opened for this conversation (turn-reach.ts) */
  pinned?: readonly string[];
  /** provider lines (turn-reach.ts) */
  lines?: readonly string[];
  /** The xAI cloud connectors this turn could load (an own-account
   * organization turn, server/drivers/acp/grok.ts grokConnectableConnectors)
   * but that are absent from the live `_x.ai/mcp/list` catalog because the
   * person never connected them on grok.com. They are on the Connect-apps
   * card yet bring no tool this turn: the model is told it has none and must
   * offer open_connector_setup rather than dead-end or claim it can. */
  connectable?: readonly { id: string; label: string }[];
  /** Prefer this Perspicax / connector profile when folding duplicate Sagax
   * agent tools across gateway connectors (Perspicax #1050). */
  activeProfile?: string;
}): { id: string; text: string } | null {
  const catalog = input.catalog ?? [];
  const favored = new Set([...(input.known ?? []), ...(input.pinned ?? [])]);
  const ready = catalog.filter((server) => !server.gateway && server.status === "ready" && server.tools.length > 0);
  const gatewayGroups = grokGatewayConnectors(catalog, { activeProfile: input.activeProfile });
  const notReady = catalog.filter((server) => server.status !== "ready");
  const pinnedLines = input.lines?.filter(Boolean) ?? [];
  // A connectable connector already in the catalog (ready or needs sign-in)
  // is handled above: keep only the ones the live list does not know at all.
  const connectable = reconcileConnectable(input.connectable ?? [], catalog);
  if (!ready.length && !notReady.length && !favored.size && !pinnedLines.length && !connectable.length && !gatewayGroups.length) return null;
  const rows: string[] = [];
  let truncated = false;
  for (const server of ready) {
    if (server.tools.length <= GROK_CATALOG_SERVER_TOOLS_MAX) {
      rows.push(`- ${server.name}: ${server.tools.join(", ")}`);
      continue;
    }
    truncated = true;
    const shortcut = server.name === AGENTS_SERVER ? new Set(GROK_AGENT_SHORTCUTS.map((entry) => entry.tool)) : undefined;
    const mine = server.tools.filter((tool) => favored.has(`${server.name}__${tool}`) || shortcut?.has(tool));
    rows.push(`- ${server.name} (${server.tools.length} tools; search_tool for the others)${mine.length ? `: ${mine.join(", ")}` : ""}`);
  }
  // Names only, and no "call it directly" rule for a tool the model has not
  // seen: measured on the bench, that rule saved a round but made the model
  // deliberate over arguments it had no schema for (+4 to 6 s per turn).
  // Tools this bot already used keep the direct-call rule (grok-tool-usage).
  const known = [...new Set(input.known ?? [])].sort((a, b) => a.localeCompare(b));
  const pinned = [...new Set(input.pinned ?? [])].filter((name) => !known.includes(name)).sort((a, b) => a.localeCompare(b));
  // Connectors on the Connect-apps card that bring no tool until the person
  // connects them: say so plainly and point at the one-step connect card, so
  // the model neither claims it can read/send nor dead-ends with "no tool".
  // A catalog that holds no gateway server at all: Grok brought no grok.com
  // connector for this sign-in, whatever grok.com shows in the browser (a
  // connector added under another xAI account or team is not this one's).
  const noGateway = input.catalog !== undefined && !catalog.some((server) => server.gateway);
  const connectableLine = connectable.length
    ? `\nConnectable but not connected yet on this xAI account (you have NO tool for these until the person connects them): ${connectable.map((connector) => connector.label).join(", ")}.${noGateway ? " Grok returned no grok.com connector at all for this sign-in: a connector added on grok.com under another xAI account or team workspace is not visible to it." : ""} To use one, call use_tool with tool_name agents__open_connector_setup once (it posts the Connect card for the person's own browser); never say you simply cannot, and never claim it works until a call to it has succeeded.`
    : "";
  // 2026-10-28: grok.com's connectors come through ONE gateway server whose
  // tool names already carry the connector; said by connector, with one
  // exact name to call, never as `<server>__<tool>`.
  const gatewayLine = gatewayGroups.length
    ? `\nConnected on this xAI account through grok.com (these ARE your tools for them; call use_tool with the full tool name, exactly as written, never prefixed with a server name; search_tool with the connector's name lists the others): ${gatewayGroups.map((group) => {
      const base = `${group.label} (${group.tools.length} tool${group.tools.length === 1 ? "" : "s"}, e.g. ${exampleTool(group.tools)})`;
      return group.sagaxAgentToolsNote ? `${base}. ${group.sagaxAgentToolsNote}` : base;
    }).join("; ")}.`
    : "";
  const agents = ready.find((server) => server.name === AGENTS_SERVER && server.tools.length > GROK_CATALOG_SERVER_TOOLS_MAX);
  const shortcuts = agents ? GROK_AGENT_SHORTCUTS.filter((entry) => agents.tools.includes(entry.tool)) : [];
  const shortcutLine = shortcuts.length
    ? `\nOne call answers each of these, no search_tool, no act, no shell; independent calls go out together: ${shortcuts.map((entry) => `${entry.when}: use_tool ${AGENTS_SERVER}__${entry.tool} with ${entry.args}`).join("; ")}.`
    : "";
  const tail =
    gatewayLine +
    shortcutLine +
    (notReady.length ? `\nNot connected now: ${notReady.map((server) => `${server.name} (${server.status})`).join(", ")}.` : "") +
    connectableLine +
    (pinnedLines.length ? `\n${pinnedLines.join("\n")}` : "") +
    (known.length ? `\nAlready used, call directly with use_tool without search_tool first: ${known.join(", ")}.` : "") +
    (pinned.length ? `\nOpen for this conversation, call directly with use_tool: ${pinned.join(", ")}.` : "");
  // A server shown with a count is not listed in full, and a connectable
  // connector means more can still be added: never call the live list
  // complete in either case.
  const header = !ready.length ? (gatewayGroups.length ? "Your MCP tools on this turn. Answer what connectors, tools or access you have from this, without calling a tool." : "")
    : truncated || connectable.length
      ? "Your MCP tools on this turn, by server (use_tool takes <server>__<tool>); a server shown with a count has more, found by calling search_tool directly (your own tool, never a use_tool target). Answer what connectors, tools or access you have from this, without calling a tool."
      : "Your MCP tools on this turn, by server (use_tool takes <server>__<tool>). This list is complete: answer what connectors, tools or access you have from it, without calling a tool.";
  let text = `${header}${rows.length ? `\n${rows.join("\n")}` : ""}${tail}`.trim();
  if (text.length > GROK_CATALOG_CHARS_MAX) {
    // Too many servers: the server names with their counts, cut at a whole
    // entry, and the bot's own tools (the tail) kept.
    const intro = "Your MCP servers on this turn, with their tool counts (search_tool, called directly and never through use_tool, finds a tool; use_tool takes <server>__<tool>): ";
    const outro = ". Answer what connectors or access you have from this without calling a tool.";
    const keptTail = tail.length <= GROK_CATALOG_CHARS_MAX / 2 ? tail : "";
    const room = GROK_CATALOG_CHARS_MAX - intro.length - outro.length - keptTail.length - " and N more".length - 8;
    const entries = ready.map((server) => `${server.name} (${server.tools.length})`);
    let listed = "";
    let shown = 0;
    for (const entry of entries) {
      const next = listed ? `${listed}, ${entry}` : entry;
      if (next.length > room) break;
      listed = next;
      shown += 1;
    }
    const more = entries.length - shown;
    text = `${intro}${listed}${more ? ` and ${more} more` : ""}${outro}${keptTail}`.trim();
  }
  return { id: GROK_KNOWN_TOOLS_SECTION, text };
}

/** A read-only tool to name as the example: the model's first call is a safe one. */
function exampleTool(tools: readonly string[]): string {
  return tools.find((tool) => /(?:^|[-_])(?:list|get|search)(?:_5f|_|$)/i.test(tool.replace(/^[^_]+__/, ""))) ?? tools[0]!;
}

/** Test seam. */
export function resetGrokCatalogs(): void {
  catalogs.clear();
  settledSessions.clear();
  reachByHome.clear();
}
