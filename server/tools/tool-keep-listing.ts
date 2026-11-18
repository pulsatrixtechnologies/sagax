// #4527 lot C: the agents catalog a turn lists, from its session's verdict
// (server/tools/tool-keep.ts). One place for every engine:
// - Claude Code keeps its own tool search (claude/turn-prepare-mcp.ts reads
//   the session's compact pins), and a compact prompt (a local model on Pi)
//   keeps its compact listing: neither is touched here;
// - every other engine (Codex, the ACP engines, Muse Code, Pi on a cloud
//   model, the chat-completions engines) lists the agents tools but the ones
//   the session leaves out; those stay behind search_tools / call_tool on the
//   same server (agents-proxy.ts), through the same checks and approvals;
// - the external runtime's fixed profile is never pruned;
// - lot D, a connector (a server the person added, the Perspicax account):
//   on the same engines its gate lists every tool but the ones the session
//   leaves out (mcp-gate-search.ts keptGateSearch), the rest behind its own
//   search_tools / call_tool, read as the tool it runs. Grok keeps its own
//   tool search (search_tool, use_tool) and its gate's admissible names.
// The tools a session really lists are recorded (toolKeepOffered), so a tool
// the bot never calls is counted as unused.
import { readFileSync } from "node:fs";
import { availableTools, catalogProfileFromEnv, keptToolsEnv } from "../drivers/agents-catalog.ts";
import { toolIdParts } from "../../shared/searched-tool-call.ts";
import { connectorOfferedFile, toolKeepOffered } from "./tool-keep.ts";

type AgentsMount = { env: Record<string, string> };

/** The engine of a bot's turn, as far as its listing goes. */
export type ListingEngine = { driverKind: string; compactPrompt: boolean };

/** Whether this engine's up-front list really leaves out a tool its session
 * leaves out: Claude Code (its own tool search) and a compact prompt leave
 * out any server's tool; every other engine the agents server's (lot C) and
 * a connector's (lot D), but Grok's connectors, which its own tool search
 * and admissible names serve. The one answer for what a turn lists and what
 * the tool selection card says is left out. */
export function engineLeavesOut(id: string, engine: ListingEngine): boolean {
  const parts = toolIdParts(id);
  if (!parts) return false;
  return engine.driverKind === "claudeAgent" || engine.compactPrompt || parts.server === "agents" || engine.driverKind !== GROK_ACP;
}

const GROK_ACP = "grokAgent";

/** Whether this engine's connectors are listed by their gate's kept listing
 * (lot D), rather than by the engine's own search or the compact pins. */
function gateKeepsConnectors(engine: ListingEngine): boolean {
  return engine.driverKind !== "claudeAgent" && !engine.compactPrompt && engine.driverKind !== GROK_ACP;
}

/** #4527 lot D: one connector of a turn, as its gate gets it: the session's
 * left out tools of that server (ids), and the file the gate notes what it
 * offered into. Empty `leftOut` where the engine's own search or a compact
 * prompt decides what is listed (Claude Code, a local model, Grok). */
export interface KeptConnector { leftOut: string[]; offered: string }

/** The kept listing of each connector of a turn (`integrations.connectorsKept`). */
export function keptConnectors(botId: string, person: string, servers: Iterable<string>, leftOut: readonly string[], engine: ListingEngine): Record<string, KeptConnector> {
  const kept: Record<string, KeptConnector> = {};
  const gate = gateKeepsConnectors(engine);
  for (const server of servers) {
    if (server === "agents" || Object.hasOwn(kept, server)) continue;
    const prefix = `${server}/`;
    kept[server] = { leftOut: gate ? leftOut.filter((id) => id.startsWith(prefix) && toolIdParts(id) !== null).sort() : [], offered: connectorOfferedFile(botId, person, server) };
  }
  return kept;
}

/** Records what each connector's gate last offered this bot and person (the
 * names it noted, mcp-gate.ts SAGAX_GATE_OFFERED) in the session: a
 * connector tool the bot never calls then counts as unused, as an agents
 * tool does. The last list noted stands for this session's: a connector's
 * catalog seldom changes between two conversations. */
export function offerConnectorCatalogs(botId: string, person: string, threadId: string, kept: Readonly<Record<string, KeptConnector>> | undefined): void {
  const offered: string[] = [];
  for (const [server, connector] of Object.entries(kept ?? {})) {
    let names: unknown;
    try { names = (JSON.parse(readFileSync(connector.offered, "utf8")) as { tools?: unknown }).tools; } catch { continue; }
    if (!Array.isArray(names)) continue;
    for (const name of names.slice(0, 2_000)) {
      const id = typeof name === "string" ? `${server}/${name}` : "";
      if (toolIdParts(id)) offered.push(id);
    }
  }
  if (offered.length) toolKeepOffered(botId, person, threadId, offered);
}

/** The agents mount of a turn with its session's kept listing, or the mount
 * as it was when nothing is left out or the engine searches by itself. */
export function withKeptAgentsListing<T extends AgentsMount>(agents: T | undefined, leftOut: readonly string[], engine: ListingEngine): T | undefined {
  if (!agents?.env || engine.driverKind === "claudeAgent" || engine.compactPrompt || agents.env.SAGAX_EXTERNAL_RUNTIME === "1") return agents;
  const names = leftOut.flatMap((id) => {
    const parts = toolIdParts(id);
    return parts?.server === "agents" && engineLeavesOut(id, engine) ? [parts.tool] : [];
  });
  if (!names.length) return agents;
  return { ...agents, env: { ...agents.env, SAGAX_COMPACT_TOOLS: keptToolsEnv(names) } };
}

/** The agents tools a turn's mount offers (listed or one search away), as
 * ids: what the session was offered. */
export function agentsOffered(env: Record<string, string> | undefined): string[] {
  if (!env) return [];
  return availableTools(catalogProfileFromEnv(env)).map((tool) => `agents/${tool.name}`);
}

/** Records what a turn's agents mount offers in the session of its bot and
 * person. */
export function offerAgentsCatalog(botId: string, person: string, threadId: string, agents: AgentsMount | undefined): void {
  const offered = agentsOffered(agents?.env);
  if (offered.length) toolKeepOffered(botId, person, threadId, offered);
}
