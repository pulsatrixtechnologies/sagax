// POST /api/internal/connectors: the `connectors` tool of the agents server
// (#3347, connectors across engines L4).
//
// The person is the turn's connector principal, read from the capability the
// internal block already checked (bot, thread, generation) through
// connectorPrincipalFor in index.ts: never from the tool's arguments, which
// carry only `connector` and `query`. It lists that person's own sign-ins
// (registry.accounts), and with a connector named it finds that connector's
// tools. It only reads: no card, no approval, no call (call_connector is L5).
import { z } from "zod";
import type { ConnectorAccount, ConnectorEntry } from "../connectors/types.ts";
import type { InternalRouteHandler } from "./internal-route.ts";
import { PASS } from "./table.ts";

export const CONNECTORS_INTERNAL_PATH = "/api/internal/connectors";

/** Tools returned for one search, at most. */
export const CONNECTOR_TOOLS_MAX = 25;

export interface ConnectorsRouteDeps {
  ownsThread(botId: string, threadId: string): boolean;
  /** The turn's connector principal (connectorPrincipalFor), "" for nobody. */
  principal(botId: string, threadId: string): string;
  /** A guest's confined turn: no connectors, as on every other path. */
  confined(threadId: string): boolean;
  /** That person's own accounts and their connectors (registry.accounts). */
  accounts(principalId: string): readonly ConnectorAccount[];
}

const body = z.object({
  connector: z.string().trim().min(1).max(200).optional(),
  query: z.string().trim().max(200).optional()
}).strict();

/** A provider may describe a tool (L10 and later); the registry keeps ids today. */
interface DescribedTool { id: string; description?: unknown; inputSchema?: unknown }

function norm(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function entryMatches(entry: ConnectorEntry, wanted: string): boolean {
  const target = norm(wanted);
  return Boolean(target) && (norm(entry.name) === target || (entry.id ? norm(entry.id) === target : false));
}

function toolMatches(tool: DescribedTool, words: string[]): boolean {
  if (!words.length) return true;
  const hay = norm(`${tool.id} ${typeof tool.description === "string" ? tool.description : ""}`);
  return words.every((word) => hay.includes(word));
}

function toolView(tool: DescribedTool): Record<string, unknown> {
  return {
    name: tool.id,
    ...(typeof tool.description === "string" && tool.description ? { description: tool.description } : {}),
    ...(tool.inputSchema && typeof tool.inputSchema === "object" ? { inputSchema: tool.inputSchema } : {})
  };
}

export function createConnectorsInternalRoutes(deps: ConnectorsRouteDeps): InternalRouteHandler {
  return async ({ res, path, method, json, capability, readBody }) => {
    if (path !== CONNECTORS_INTERNAL_PATH) return PASS;
    if (method !== "POST") return json(res, 405, { error: "method not allowed" });
    if (!deps.ownsThread(capability.botId, capability.threadId)) {
      return json(res, 403, { error: "source conversation does not belong to sender" });
    }
    const parsed = body.safeParse((await readBody()) ?? {});
    if (!parsed.success) return json(res, 400, { error: "connectors takes no argument, or connector (a name from the list) and query (words to find its tools)." });
    const principalId = deps.confined(capability.threadId) ? "" : deps.principal(capability.botId, capability.threadId).trim().toLowerCase();
    if (!principalId) {
      return json(res, 200, { ok: true, accounts: [], note: "No person of this server speaks in this turn, so there are no connectors to list. Answer in words." });
    }
    const accounts = deps.accounts(principalId);
    const { connector, query } = parsed.data;
    if (!connector) {
      return json(res, 200, {
        ok: true,
        accounts: accounts.map((account) => ({
          label: account.label,
          provider: account.provider,
          ...(account.kind ? { kind: account.kind } : {}),
          auth: account.auth,
          connectors: account.connectors.map((entry) => ({
            name: entry.name,
            ...(entry.id ? { id: entry.id } : {}),
            state: entry.state,
            tools: entry.tools.length
          }))
        })),
        ...(accounts.length ? {} : { note: "This person has no connector on any account of theirs yet. open_connector_setup adds one." })
      });
    }
    const words = norm(query ?? "").split(" ").filter(Boolean);
    const found = accounts.flatMap((account) => account.connectors
      .filter((entry) => entryMatches(entry, connector))
      .map((entry) => {
        const tools = (entry.tools as readonly DescribedTool[]).filter((tool) => toolMatches(tool, words));
        return {
          connector: entry.name,
          ...(entry.id ? { id: entry.id } : {}),
          account: account.label,
          provider: account.provider,
          state: entry.state,
          tools: tools.slice(0, CONNECTOR_TOOLS_MAX).map(toolView),
          ...(tools.length > CONNECTOR_TOOLS_MAX ? { more: tools.length - CONNECTOR_TOOLS_MAX } : {}),
          ...(entry.tools.length ? {} : { note: "This provider lists this connector's tools only when it is called." })
        };
      }));
    if (!found.length) {
      return json(res, 200, { ok: true, matches: [], note: `No connector named ${connector} on this person's accounts. Call connectors with no argument for the list.` });
    }
    return json(res, 200, { ok: true, matches: found });
  };
}
