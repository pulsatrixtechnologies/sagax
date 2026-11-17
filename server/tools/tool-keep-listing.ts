// #4527 lot C: the agents catalog a turn lists, from its session's verdict
// (server/tools/tool-keep.ts). One place for every engine:
// - Claude Code keeps its own tool search (claude/turn-prepare-mcp.ts reads
//   the session's compact pins), and a compact prompt (a local model on Pi)
//   keeps its compact listing: neither is touched here;
// - every other engine (Codex, the ACP engines, Muse Code, Pi on a cloud
//   model, the chat-completions engines) lists the agents tools but the ones
//   the session leaves out; those stay behind search_tools / call_tool on the
//   same server (agents-proxy.ts), through the same checks and approvals;
// - the external runtime's fixed profile is never pruned.
// The tools a session really lists are recorded (toolKeepOffered), so a tool
// the bot never calls is counted as unused.
import { availableTools, catalogProfileFromEnv, keptToolsEnv } from "../drivers/agents-catalog.ts";
import { toolIdParts } from "../../shared/searched-tool-call.ts";
import { toolKeepOffered } from "./tool-keep.ts";

type AgentsMount = { env: Record<string, string> };

/** The agents mount of a turn with its session's kept listing, or the mount
 * as it was when nothing is left out or the engine searches by itself. */
export function withKeptAgentsListing<T extends AgentsMount>(agents: T | undefined, leftOut: readonly string[], engine: { driverKind: string; compactPrompt: boolean }): T | undefined {
  if (!agents?.env || engine.driverKind === "claudeAgent" || engine.compactPrompt || agents.env.SAGAX_EXTERNAL_RUNTIME === "1") return agents;
  const names = leftOut.flatMap((id) => {
    const parts = toolIdParts(id);
    return parts?.server === "agents" ? [parts.tool] : [];
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
