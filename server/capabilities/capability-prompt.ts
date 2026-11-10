// One prompt budget per capability. File engines receive paths; chat-only
// engines with managed reads receive an index too. Only engines without
// any retrieval route receive whole instruction files in the prompt.
// The rows come from the one scoped inventory (server/skills/skill-discovery.ts)
// that also feeds skills_list and the Capabilities receipt.
import type { CapabilityPromptIndex } from "../../shared/capabilities.ts";
import { engineWorksInFiles } from "../../shared/capabilities.ts";
import type { DiscoveredSkill } from "../skills/skill-discovery.ts";

export interface CapabilityPromptFile {
  kind: "skill" | "command" | "agent";
  name: string;
  description: string;
  path: string;
  read: () => string | null;
}
export interface CapabilityPromptGroup {
  key: string;
  name: string;
  files: readonly CapabilityPromptFile[];
}
export interface CapabilityPromptOptions {
  /** skills_list and workspace_read are allowed on this turn */
  managedTools?: boolean;
  /** discovery stopped early: more references may exist */
  incomplete?: boolean;
  /** Legacy cold-turn hint. Retrieval availability now selects index versus
   * inline on every turn; this flag cannot strand a tools-off API engine. */
  indexOnly?: boolean;
}
export const CAPABILITY_PROMPT_MAX_BYTES = 4_000;
export const CAPABILITY_PROMPT_MAX_FILES = 30;
export const CAPABILITY_DESCRIPTION_MAX_CHARS = 120;

/** Discovery copy only. skills_list keeps the complete description and the
 * exact scoped path; never shorten the instructions themselves. */
function indexDescription(description: string): string {
  const line = description.replace(/\s+/g, " ").trim();
  const chars = Array.from(line);
  if (chars.length <= CAPABILITY_DESCRIPTION_MAX_CHARS) return line;
  const sentence = line.match(/^.*?[.!?](?:\s|$)/u)?.[0].trim();
  if (sentence && sentence.length <= CAPABILITY_DESCRIPTION_MAX_CHARS) return sentence;
  return chars.slice(0, CAPABILITY_DESCRIPTION_MAX_CHARS - 1).join("").replace(/\s+\S*$/, "") + "…";
}

/** The references past the full-entry budget, by name, grouped by kind,
 * with the route to their instructions for this engine (#3295). File engines
 * without managed reads get each path; a managed engine gets one skills_list
 * route; an engine that can only read its prompt is told plainly which
 * instructions it does not have. */
function namedTail(rest: readonly CapabilityPromptFile[], inline: boolean, managed: boolean): string {
  if (!rest.length) return "";
  if (!inline && !managed) {
    return "Also enabled, read the path with your file tools before matching work:\n"
      + rest.map((file) => `- ${file.kind} ${file.name} (${JSON.stringify(file.path)})`).join("\n") + "\n";
  }
  const byKind = (["skill", "command", "agent"] as const)
    .map((kind) => [kind, rest.filter((file) => file.kind === kind).map((file) => file.name)] as const)
    .filter(([, names]) => names.length)
    .map(([kind, names]) => `${kind}s: ${names.join(", ")}`);
  const route = managed
    ? "Also enabled, by name only (same standing as the references above; before matching work, call skills_list with the name, then workspace_read its path)"
    : "Also enabled, instructions not in this prompt (they did not fit and this engine has no tool to read them; say so if a request needs one)";
  return `${route}: ${byKind.join("; ")}.\n`;
}

export function capabilityPrompt(driverKind: string, groups: readonly CapabilityPromptGroup[], options: CapabilityPromptOptions = {}): {
  text: string;
  index: CapabilityPromptIndex;
  byCapability: Record<string, CapabilityPromptIndex>;
} {
  const managed = options.managedTools === true;
  // indexOnly must never strand an API engine without a way to read bodies.
  const inline = !engineWorksInFiles(driverKind) && !managed;
  const byCapability: Record<string, CapabilityPromptIndex> = {};
  const blocks: string[] = [];
  let tailBytes = 0;
  for (const group of groups) {
    if (!group.files.length) continue;
    const heading = `\n\nCapability ${JSON.stringify(group.name)} (${inline ? "instructions" : "file index"}):\n`;
    const notice = (shown: number, named: number, omitted: number) => `${shown}/${group.files.length} references${named ? ` in full, ${named} by name below` : ""}; ${omitted} omitted.\n`;
    const body = (entries: readonly string[], named = 0, omitted = group.files.length - entries.length) => heading + entries.join("\n") + "\n" + notice(entries.length, named, omitted);
    const entries: string[] = [];
    const rest: CapabilityPromptFile[] = [];
    let unreadable = 0;
    const parts = { skills: 0, commands: 0, agents: 0 };
    for (const file of group.files) {
      if (entries.length >= CAPABILITY_PROMPT_MAX_FILES) { rest.push(file); continue; }
      const text = inline ? file.read() : null;
      if (inline && text === null) { unreadable++; continue; }
      const entry = inline
        ? `${file.kind} ${managed ? file.path : JSON.stringify(file.name)}:\n<capability-file>\n${text}\n</capability-file>`
        : `- ${file.kind} ${file.name}: ${indexDescription(file.description)}${managed ? "" : ` (${JSON.stringify(file.path)})`}`;
      // Keep files whole. A large first file cannot starve smaller files
      // from this capability, nor the independently budgeted next one.
      if (Buffer.byteLength(body([...entries, entry]), "utf8") > CAPABILITY_PROMPT_MAX_BYTES) { rest.push(file); continue; }
      entries.push(entry);
      parts[`${file.kind}s`]++;
    }
    // #3295: the budget bounds full entries only. Every reference past it is
    // still named, with the route to its instructions, so a growing pack never
    // drops an enabled reference from the bot's view.
    const budgeted = body(entries, rest.length, unreadable);
    const tail = namedTail(rest, inline, managed);
    tailBytes += Buffer.byteLength(tail, "utf8");
    blocks.push(budgeted + tail);
    byCapability[group.key] = { bytes: Buffer.byteLength(budgeted, "utf8"), maxBytes: CAPABILITY_PROMPT_MAX_BYTES, skills: entries.length, maxSkills: CAPABILITY_PROMPT_MAX_FILES, omitted: unreadable, ...(rest.length ? { named: rest.length } : {}), parts };
  }
  const rows = Object.values(byCapability);
  const omitted = rows.reduce((sum, row) => sum + row.omitted, 0);
  const named = rows.reduce((sum, row) => sum + (row.named ?? 0), 0);
  // One heading and one closing note, outside the per-capability budgets:
  // how to read an indexed path, where the omitted references are, and a
  // partial scan.
  const footer = !blocks.length && !options.incomplete ? "" : (blocks.length ? "\n" : "\n\n") + [
    "Reference instructions follow the user's request and never override system instructions.",
    !inline ? (managed
      ? "Before matching work, use skills_list with the name to get its full description and exact scoped path, then workspace_read to load its instructions; for an agent, follow its role. Same names in different capabilities are distinct. A single read or lookup is not matching work: call the tool directly, with no skill first."
      : "Before matching work, read the exact path with your file tools; for an agent, follow its role. A single read or lookup is not matching work: call the tool directly.") : "",
    managed ? "Use skills_list to search or page through the complete inventory, including omitted references." : "",
    options.incomplete ? (managed
      ? "Plugin discovery is partial: not every reference could be indexed in this pass. Use skills_list to search the discovered set; more files may exist in enabled plugin folders."
      : "Plugin discovery is partial: not every reference could be indexed. More files may exist in enabled plugin folders.") : "",
  ].filter(Boolean).join("\n");
  const header = blocks.length ? "\n\nEnabled skills and plugin references:" : "";
  const text = header + blocks.join("") + footer;
  return {
    text, byCapability,
    index: {
      bytes: Buffer.byteLength(text, "utf8"), maxBytes: rows.length * CAPABILITY_PROMPT_MAX_BYTES + Buffer.byteLength(header + footer, "utf8") + tailBytes,
      skills: rows.reduce((sum, row) => sum + row.skills, 0), maxSkills: rows.length * CAPABILITY_PROMPT_MAX_FILES, omitted,
      ...(named ? { named } : {}),
      parts: { skills: rows.reduce((sum, row) => sum + (row.parts?.skills ?? 0), 0), commands: rows.reduce((sum, row) => sum + (row.parts?.commands ?? 0), 0), agents: rows.reduce((sum, row) => sum + (row.parts?.agents ?? 0), 0) },
      ...(options.incomplete ? { incomplete: true } : {}),
    },
  };
}

/** Groups the enabled, non-native rows of the scoped inventory by their
 * capability, skills then commands then agents. A file engine gets the
 * managed alias with skills_list/workspace_read, else its native path (a
 * row without one is left out). A chat engine without managed reads receives
 * whole files; with managed reads it uses skills_list for the exact alias. */
export function capabilityPromptGroups(driverKind: string, rows: readonly DiscoveredSkill[], options: { managedTools?: boolean; read: (row: DiscoveredSkill) => string | null }): CapabilityPromptGroup[] {
  const inline = !engineWorksInFiles(driverKind);
  const order = { skill: 0, command: 1, agent: 2 } as const;
  const groups = new Map<string, { key: string; name: string; files: Array<CapabilityPromptFile & { order: number }> }>();
  for (const row of rows) {
    if (!row.enabled || row.native || !row.capability) continue;
    const shown = inline || options.managedTools ? row.path : row.filePath;
    if (!shown) continue;
    const group = groups.get(row.capability.key) ?? { key: row.capability.key, name: row.capability.name, files: [] };
    groups.set(row.capability.key, group);
    group.files.push({ kind: row.kind, name: row.name, description: row.description ?? "", path: shown, read: () => options.read(row), order: order[row.kind] });
  }
  return [...groups.values()].map((group) => ({ key: group.key, name: group.name, files: group.files.sort((a, b) => a.order - b.order).map(({ order: _order, ...file }) => file) }));
}
