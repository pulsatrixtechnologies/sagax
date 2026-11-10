// POST /api/internal/connectors: the `connectors` tool of the agents server
// (#3347, connectors across engines L4).
//
// The person is the turn's connector principal, read from the capability the
// internal block already checked (bot, thread, generation) through
// connectorPrincipalFor in index.ts: never from the tool's arguments, which
// carry only `connector` and `query`. It lists that person's own sign-ins
// (registry.accounts), and with a connector named it finds that connector's
// tools. It only reads: no card, no approval, no call.
//
// POST /api/internal/call-connector: the `call_connector` tool (#3348, L5).
// Same person, same reading of the capability. The route never runs the
// call itself first: it opens a held request on the calling turn (the
// provider's own tool id, the exact arguments, read or send), the person's
// approval settings decide it as they decide a native connector call, and
// only an allowed call reaches the provider's host (server/connectors/hub.ts).
// A declined call reaches no host.
import { z } from "zod";
import type { ConnectorHub } from "../connectors/hub.ts";
import type { ConnectorAccount, ConnectorEntry } from "../connectors/types.ts";
import type { HeldDecision } from "../harness/held-requests.ts";
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
  /** A host runs this provider's calls (call_connector can reach it). */
  callable?(provider: ConnectorAccount["provider"]): boolean;
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
            tools: entry.tools.length,
            ...(deps.callable ? { callable: deps.callable(account.provider) } : {})
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
          ...(deps.callable ? { callable: deps.callable(account.provider) } : {}),
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

export const CALL_CONNECTOR_INTERNAL_PATH = "/api/internal/call-connector";

/** One held request on the calling turn. */
export interface CallConnectorHold {
  botId: string;
  threadId: string;
  /** the rule name of the call (the provider's own tool id, server__tool) */
  mcpTool: string;
  summary: string;
  /** the exact arguments, as JSON */
  input: string;
  outbound: boolean;
}

export interface CallConnectorRouteDeps extends Omit<ConnectorsRouteDeps, "callable"> {
  /** The hub (read at call time: index.ts builds it after the routes). */
  hub(): ConnectorHub;
  /** Open the held request on the turn running this thread; undefined when
   * no turn runs there (nothing to hold the request on). `engine` is that
   * turn's driver kind. */
  hold(input: CallConnectorHold): { engine: string; decision: Promise<HeldDecision> } | undefined;
}

const callBody = z.object({
  connector: z.string().trim().min(1).max(200),
  tool: z.string().trim().min(1).max(300),
  arguments: z.record(z.string(), z.unknown()).optional()
}).strict();

function connectorRank(hub: ConnectorHub, account: ConnectorAccount, entry: ConnectorEntry): number {
  return (hub.callable(account.provider) ? 0 : 2) + (entry.state === "connected" ? 0 : 1);
}

export function createCallConnectorInternalRoute(deps: CallConnectorRouteDeps): InternalRouteHandler {
  return async ({ res, path, method, json, capability, readBody }) => {
    if (path !== CALL_CONNECTOR_INTERNAL_PATH) return PASS;
    if (method !== "POST") return json(res, 405, { error: "method not allowed" });
    if (!deps.ownsThread(capability.botId, capability.threadId)) {
      return json(res, 403, { error: "source conversation does not belong to sender" });
    }
    const parsed = callBody.safeParse((await readBody()) ?? {});
    if (!parsed.success) return json(res, 400, { error: "call_connector takes connector (a name from connectors), tool (one of its tools) and arguments (an object)." });
    const { connector, tool } = parsed.data;
    const args = parsed.data.arguments ?? {};
    const input = JSON.stringify(args);
    const principalId = deps.confined(capability.threadId) ? "" : deps.principal(capability.botId, capability.threadId).trim().toLowerCase();
    if (!principalId) {
      return json(res, 200, { ok: false, error: "No person of this server speaks in this turn, so there is no connector to call. Answer in words." });
    }
    const hub = deps.hub();
    const candidates = deps.accounts(principalId).flatMap((account) => account.connectors
      .filter((entry) => entryMatches(entry, connector))
      .map((entry) => ({ account, entry })))
      .sort((a, b) => connectorRank(hub, a.account, a.entry) - connectorRank(hub, b.account, b.entry));
    const found = candidates[0];
    if (!found) {
      return json(res, 200, { ok: false, error: `No connector named ${connector} on this person's accounts. Call connectors with no argument for the list.` });
    }
    const { account, entry } = found;
    if (!hub.callable(account.provider)) {
      return json(res, 200, { ok: false, error: `${entry.name} (${account.label}) is not callable through call_connector yet. Use it on its own engine, or answer in words.` });
    }
    // Only a sign-in Sagax knows is missing answers here (the bot can post
    // the card); "unknown" and "failed" go to the host, so the provider's
    // own error comes back (P7).
    if (entry.state === "needs-sign-in") {
      return json(res, 200, { ok: false, error: `${entry.name} (${account.label}) is waiting for a new sign-in: open_connector_setup posts the card.` });
    }
    const listed = entry.tools.find((candidate) => candidate.id === tool) ?? entry.tools.find((candidate) => candidate.id.toLowerCase() === tool.toLowerCase());
    if (entry.tools.length && !listed) {
      const names = entry.tools.slice(0, CONNECTOR_TOOLS_MAX).map((candidate) => candidate.id).join(", ");
      return json(res, 200, { ok: false, error: `${entry.name} has no tool named ${tool}. Its tools: ${names}.` });
    }
    const toolId = listed?.id ?? tool;
    const mcpTool = hub.ruleTool(account.provider, entry, toolId);
    const held = deps.hold({
      botId: capability.botId,
      threadId: capability.threadId,
      mcpTool,
      summary: `${entry.name}: ${toolId} (${account.label})`,
      input,
      outbound: hub.outbound(mcpTool)
    });
    if (!held) return json(res, 200, { ok: false, error: "No turn is running in this conversation, so the call cannot be approved." });
    const decision = await held.decision;
    if (decision.behavior !== "allow") {
      return json(res, 200, { ok: false, declined: true, error: decision.message?.trim() || `The call to ${entry.name} (${toolId}) was declined, so it was not run.` });
    }
    const result = await hub.call({ principalId, account, connector: entry, tool: toolId, arguments: args, engine: held.engine });
    return json(res, 200, {
      ok: !result.isError,
      connector: entry.name,
      account: account.label,
      tool: toolId,
      ...(result.isError ? { error: result.text } : { result: result.text })
    });
  };
}
