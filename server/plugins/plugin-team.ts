/** "Import as a team" for a marketplace plugin (I1, 2026-11-07): the model a
 * plugin agent asks for (`model:` in its frontmatter), matched to this
 * server's engines. A Claude Code alias (sonnet, opus, haiku, fable) takes
 * the newest model of that family the Claude engine offers; an exact id
 * (claude-fable-5-2) must be in that engine's catalog. `inherit`, an empty
 * value or a model no engine offers keeps the team's default model. */
import type { ModelSelection } from "../../shared/wire.ts";
import { readyToRun, type SelectableInstance } from "../models/default-model-selection.ts";
import type { PluginTeamAgent } from "../../shared/plugin-team.ts";
import { pluginAgentToolScope } from "../../shared/plugin-team-tools.ts";
import type { ToolScope } from "../../shared/tool-scope.ts";

const CLAUDE_DRIVER = "claudeAgent";
const ALIASES = new Set(["sonnet", "opus", "haiku", "fable"]);

export function resolvePluginAgentModel(
  raw: string | undefined,
  instances: readonly SelectableInstance[],
  refusal?: (instance: SelectableInstance) => string | undefined,
): ModelSelection | null {
  const wanted = (raw ?? "").trim().toLowerCase();
  if (!wanted || wanted === "inherit") return null;
  const claude = instances.filter((instance) => instance.driverKind === CLAUDE_DRIVER && instance.enabled !== false && refusal?.(instance) === undefined);
  // An engine that can run a turn now first, then any enabled one.
  const ordered = [...claude.filter((instance) => readyToRun(instance, { refusal })), ...claude.filter((instance) => !readyToRun(instance, { refusal }))];
  for (const instance of ordered) {
    const ids = instance.models.options.map((model) => model.id);
    if (ids.includes(wanted)) return { instanceId: instance.instanceId, model: wanted };
    if (ALIASES.has(wanted)) {
      // The catalog lists newest first (claude-sonnet-5-5 before claude-sonnet-5).
      const match = ids.find((id) => id.startsWith(`claude-${wanted}-`));
      if (match) return { instanceId: instance.instanceId, model: match };
    }
  }
  return null;
}

/** Each agent key's model, plus the agents whose model no engine offers. */
export function resolvePluginTeamModels(
  agents: ReadonlyArray<{ key: string; name: string; model?: string }>,
  instances: readonly SelectableInstance[],
  refusal?: (instance: SelectableInstance) => string | undefined,
): { models: Record<string, ModelSelection>; unmatched: string[] } {
  const models: Record<string, ModelSelection> = {};
  const unmatched: string[] = [];
  for (const agent of agents) {
    const selection = resolvePluginAgentModel(agent.model, instances, refusal);
    if (selection) models[agent.key] = selection;
    else if (agent.model && agent.model.trim().toLowerCase() !== "inherit") unmatched.push(`model ${agent.model} of ${agent.name} (no engine offers it; the team's model is used)`);
  }
  return { models, unmatched };
}

/** One bot of a plugin team as the import preview shows it (#2669). */
export interface PluginTeamPreviewBot {
  name: string;
  description?: string;
  /** The frontmatter `model`, as written. */
  modelAsked?: string;
  /** The model id the bot will run on (the team default when the frontmatter names none). */
  model?: string;
  tools: string[];
  /** True when the tool list is a real restriction on the bot's engine. */
  toolsEnforced: boolean;
  notes: string[];
}

/** #2669: each agent's model and tool selection, and the preview rows. The
 * engine of an agent is its resolved model's, else the default model's. */
export function planPluginTeam(
  agents: ReadonlyArray<PluginTeamAgent>,
  instances: readonly SelectableInstance[],
  refusal: ((instance: SelectableInstance) => string | undefined) | undefined,
  fallback: ModelSelection | null | undefined,
): { models: Record<string, ModelSelection>; toolScopes: Record<string, ToolScope>; unmatched: string[]; bots: PluginTeamPreviewBot[] } {
  const { models, unmatched } = resolvePluginTeamModels(agents, instances, refusal);
  const toolScopes: Record<string, ToolScope> = {};
  const driverOf = (selection: ModelSelection | null | undefined) =>
    selection ? instances.find((instance) => instance.instanceId === selection.instanceId)?.driverKind : undefined;
  const bots = agents.map((agent): PluginTeamPreviewBot => {
    const selection = models[agent.key] ?? fallback ?? undefined;
    const mapped = pluginAgentToolScope(agent.tools, driverOf(selection));
    if (mapped.scope) toolScopes[agent.key] = mapped.scope;
    const native = mapped.scope?.allow?.some((selector) => selector.startsWith("native:") && selector !== "native:*") ?? false;
    return {
      name: agent.name,
      ...(agent.description ? { description: agent.description } : {}),
      ...(agent.model ? { modelAsked: agent.model } : {}),
      ...(selection ? { model: selection.model } : {}),
      tools: agent.tools,
      toolsEnforced: Boolean(mapped.scope) && (native || agent.tools.every((tool) => tool.startsWith("mcp__"))),
      notes: mapped.notes,
    };
  });
  for (const note of bots.flatMap((bot) => bot.notes.map((line) => `tools of ${bot.name}: ${line}`))) unmatched.push(note);
  return { models, toolScopes, unmatched, bots };
}
