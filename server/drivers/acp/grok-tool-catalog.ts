// Grok's own MCP catalog, said to the model once, so it calls tools
// directly instead of searching for them.
//
// Grok defers every MCP tool behind search_tool and use_tool. A bot asked
// "what connector do you have access to (mcp)" searched each server, then
// called tools one by one to see what they did (JC 2026-10-21: 25 calls).
// Each search is a full model round over the whole context (~20k tokens on
// grok 1.0.62). Sagax already asks Grok for its catalog before every prompt
// (`_x.ai/mcp/list`, grok.ts configureSession): it lists every server, its
// status and its tools by the exact name use_tool takes. That list, names
// only, rides the volatile half once per session (and again only when it
// changes), so:
//   - a question about connectors or tools is answered with no call;
//   - a known tool is called with use_tool directly, no search first.
// Measured on the local bench (perf/instant-tool-turns): see the PR.
import { GROK_KNOWN_TOOLS_SECTION } from "./grok-tool-usage.ts";

export interface GrokCatalogServer {
  name: string;
  /** ready, or why not (unavailable, failed, needs sign-in) */
  status: string;
  tools: string[];
}

const NAME = /^[\w .()@:-]{1,80}$/;
const TOOL = /^[A-Za-z0-9][\w.-]{0,63}$/;

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
    const tools = Array.isArray(session.tools)
      ? session.tools
        .filter((tool: { name?: unknown; enabled?: unknown } | null) => tool && typeof tool.name === "string" && tool.enabled !== false && TOOL.test(tool.name))
        .map((tool: { name: string }) => tool.name)
      : [];
    servers.push({ name, status, tools: [...new Set<string>(tools)].sort((a, b) => a.localeCompare(b)) });
  }
  return servers.sort((a, b) => a.name.localeCompare(b.name));
}

// The last catalog per Grok session, so the volatile section (built right
// after configureSession, same turn) can read it. Bounded.
const CATALOGS_MAX = 256;
const catalogs = new Map<string, GrokCatalogServer[]>();

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

/** A server with more tools than this shows only the ones this bot uses
 * (known, pinned) and a count: Sagax's own agents server has ~70. */
export const GROK_CATALOG_SERVER_TOOLS_MAX = 40;
/** The whole section stays under this many characters (~900 tokens). */
export const GROK_CATALOG_CHARS_MAX = 3_600;

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
  return connectable.filter((connector) => !catalog.some((server) => sameConnector(connector.id, server.name)));
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
}): { id: string; text: string } | null {
  const catalog = input.catalog ?? [];
  const favored = new Set([...(input.known ?? []), ...(input.pinned ?? [])]);
  const ready = catalog.filter((server) => server.status === "ready" && server.tools.length > 0);
  const notReady = catalog.filter((server) => server.status !== "ready");
  const pinnedLines = input.lines?.filter(Boolean) ?? [];
  // A connectable connector already in the catalog (ready or needs sign-in)
  // is handled above: keep only the ones the live list does not know at all.
  const connectable = reconcileConnectable(input.connectable ?? [], catalog);
  if (!ready.length && !notReady.length && !favored.size && !pinnedLines.length && !connectable.length) return null;
  const rows: string[] = [];
  let truncated = false;
  for (const server of ready) {
    if (server.tools.length <= GROK_CATALOG_SERVER_TOOLS_MAX) {
      rows.push(`- ${server.name}: ${server.tools.join(", ")}`);
      continue;
    }
    truncated = true;
    const mine = server.tools.filter((tool) => favored.has(`${server.name}__${tool}`));
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
  const connectableLine = connectable.length
    ? `\nConnectable but not connected yet on this xAI account (you have NO tool for these until the person connects them): ${connectable.map((connector) => connector.label).join(", ")}. To use one, call use_tool with tool_name agents__open_connector_setup once (it posts the Connect card for the person's own browser); never say you simply cannot, and never claim it works until a call to it has succeeded.`
    : "";
  const tail =
    (notReady.length ? `\nNot connected now: ${notReady.map((server) => `${server.name} (${server.status})`).join(", ")}.` : "") +
    connectableLine +
    (pinnedLines.length ? `\n${pinnedLines.join("\n")}` : "") +
    (known.length ? `\nAlready used, call directly with use_tool without search_tool first: ${known.join(", ")}.` : "") +
    (pinned.length ? `\nOpen for this conversation, call directly with use_tool: ${pinned.join(", ")}.` : "");
  // A server shown with a count is not listed in full, and a connectable
  // connector means more can still be added: never call the live list
  // complete in either case.
  const header = !ready.length ? ""
    : truncated || connectable.length
      ? "Your MCP tools on this turn, by server (use_tool takes <server>__<tool>); a server shown with a count has more, found with search_tool. Answer what connectors, tools or access you have from this, without calling a tool."
      : "Your MCP tools on this turn, by server (use_tool takes <server>__<tool>). This list is complete: answer what connectors, tools or access you have from it, without calling a tool.";
  let text = `${header}${rows.length ? `\n${rows.join("\n")}` : ""}${tail}`.trim();
  if (text.length > GROK_CATALOG_CHARS_MAX) {
    // Too many servers: the server names with their counts, cut at a whole
    // entry, and the bot's own tools (the tail) kept.
    const intro = "Your MCP servers on this turn, with their tool counts (search_tool finds a tool; use_tool takes <server>__<tool>): ";
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

/** Test seam. */
export function resetGrokCatalogs(): void {
  catalogs.clear();
}
