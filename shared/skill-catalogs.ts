// Official skill and plugin catalogs offered in one click in Plugins >
// Marketplaces (#2613), and the ClawHub registry searched by the bot's
// `skills_find` tool. A catalog without a `.claude-plugin/marketplace.json`
// (Hermes Agent, OpenClaw) is read as a folder of skills: each skill becomes
// a one-skill plugin (server/plugins/skills-catalog.ts). The Cursor catalog
// is converted from its `.cursor-plugin/` format (server/plugins/cursor-catalog.ts).

export interface OfficialCatalog {
  /** Name the marketplace is stored under. */
  id: string;
  /** Shown in Plugins. */
  label: string;
  /** owner/repo on GitHub, as the Add field takes it. */
  source: string;
  /** The project's site, for provenance. */
  site: string;
  description: string;
  /** Folders cloned (sparse) and read for skills; absent = the whole
   * repository, a Claude Code marketplace. */
  skillDirs?: readonly string[];
  /** "cursor": a Cursor plugin marketplace (`.cursor-plugin/`), converted to
   * the Claude Code layout (server/plugins/cursor-catalog.ts, #2759). */
  format?: "cursor";
}

export const OFFICIAL_CATALOGS: readonly OfficialCatalog[] = [
  {
    id: "hermes-agent",
    label: "Hermes Agent",
    source: "NousResearch/hermes-agent",
    site: "https://github.com/NousResearch/hermes-agent",
    description: "Nous Research: the skills bundled with Hermes Agent and its optional skills.",
    skillDirs: ["skills", "optional-skills"],
  },
  {
    id: "openclaw",
    label: "OpenClaw (clawdbot)",
    source: "openclaw/openclaw",
    site: "https://github.com/openclaw/openclaw",
    description: "OpenClaw, formerly clawdbot: the skills bundled with the agent. More on ClawHub.",
    skillDirs: ["skills"],
  },
  {
    id: "claude-plugins-official",
    label: "Claude plugins (Anthropic)",
    source: "anthropics/claude-plugins-official",
    site: "https://github.com/anthropics/claude-plugins-official",
    description: "Anthropic's official Claude Code plugin directory.",
  },
  {
    id: "anthropic-agent-skills",
    label: "Agent Skills (Anthropic)",
    source: "anthropics/skills",
    site: "https://github.com/anthropics/skills",
    description: "Anthropic's public Agent Skills.",
  },
  {
    id: "cursor-plugins",
    label: "Cursor plugins",
    source: "cursor/plugins",
    site: "https://github.com/cursor/plugins",
    description: "Cursor's official plugins: skills, rules, agents and MCP integrations, converted for Sagax.",
    format: "cursor",
  },
];

/** ClawHub, the public OpenClaw skill registry: search API and page links. */
export const CLAWHUB_SITE = "https://clawhub.ai";
export const CLAWHUB_SEARCH = `${CLAWHUB_SITE}/api/v1/search`;

/** The official catalog an Add source names (owner/repo or its GitHub address). */
export function officialCatalogFor(source: string): OfficialCatalog | undefined {
  const key = source.trim().toLowerCase()
    .replace(/^https?:\/\/github\.com\//, "")
    .replace(/^github\.com\//, "")
    .replace(/\.git$/, "")
    .replace(/\/+$/, "");
  return OFFICIAL_CATALOGS.find((catalog) => catalog.source.toLowerCase() === key);
}
