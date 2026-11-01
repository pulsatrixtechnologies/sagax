// One inventory feeds the turn, its Capabilities receipt and skills_list.
// Paths are workspace_read references, never authority supplied by a caller.
// The prompt renders it per capability (server/capability-prompt.ts).
import { allowsTool } from "../shared/tool-scope.ts";

export interface DiscoveredSkill {
  id: string;
  name: string;
  kind: "skill" | "command" | "agent";
  scope: "organization" | "person" | "bot" | "library";
  source: string;
  enabled: boolean;
  description?: string;
  path?: string;
  /** Native file-tools path, kept separate from workspace_read aliases. */
  filePath?: string;
  editable?: boolean;
  native?: boolean;
  /** The capability this reference belongs to (its key in the resolved
   * list, never shown) and its readable name: the prompt budgets per
   * capability (server/capability-prompt.ts). */
  capability?: { key: string; name: string };
}

export const DISCOVERY_PAGE_SIZE = 20;

export function skillDiscoveryAvailable(agentsMcp: boolean, scope: unknown): boolean {
  return agentsMcp && ["skills_list", "workspace_read"].every((name) => allowsTool(scope, { kind: "mcp", server: "agents", name }));
}

/** Names in different plugins are distinct. Scope precedence is resolved by
 * the source stores before this stable sort, never by a bare-name dedupe. */
export function orderedSkillDiscovery(rows: readonly DiscoveredSkill[]): DiscoveredSkill[] {
  return [...rows].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** Disabled metadata is never provider-visible. Filter before pagination,
 * and return a next offset so a large install cannot silently lose skills. */
export function skillDiscoveryPage(rows: readonly DiscoveredSkill[], query = "", offset = 0) {
  const needle = query.trim().toLowerCase();
  const matches = orderedSkillDiscovery(rows).filter((row) =>
    [row.name, row.source, row.scope, row.kind, row.enabled ? row.description ?? "" : ""].some((value) => value.toLowerCase().includes(needle)));
  const skills: DiscoveredSkill[] = matches.slice(offset, offset + DISCOVERY_PAGE_SIZE).map((row) => {
    if (row.enabled) { const { filePath: _filePath, capability: _capability, ...entry } = row; return entry; }
    const { description: _description, path: _path, filePath: _filePath, capability: _capability, ...summary } = row;
    return summary;
  });
  return { skills, total: matches.length, offset, nextOffset: offset + skills.length < matches.length ? offset + skills.length : null };
}
