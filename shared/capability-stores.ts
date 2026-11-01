// Capabilities lot 5: inventory of the eleven config files that become
// three stores (bot, person, installation), plus the deprecation window
// for legacy routes. Document schemas live in server/*-capability-store.ts.
/** Deprecation window for legacy capability routes (one year from lot 5). */
export const CAPABILITY_ROUTE_DEPRECATION = {
  since: "2026-11-01",
  until: "2027-11-01",
  header: "Deprecation",
  /** RFC 8594 style value: date the alias is planned to go. */
  headerValue: "Sun, 01 Nov 2027 00:00:00 GMT",
  linkRel: "successor-version",
} as const;

/** One row of the inventory RESULT.md and the migration markers share. */
export type CapabilityStoreSource = {
  id: string;
  path: string;
  kind: "json" | "enc";
  target: "bot" | "person" | "installation";
  notes: string;
};

/**
 * The eleven capability config stores (C-18 / lot 5 design). Paths are
 * relative to DATA_DIR; `<bot>` and `<pid>` are placeholders.
 */
export const CAPABILITY_STORE_INVENTORY: readonly CapabilityStoreSource[] = [
  { id: "bot-plugins-state", path: "bot-plugins/<bot>/state.json", kind: "json", target: "bot", notes: "Installed plugins and enable flags for one bot." },
  { id: "bot-plugins-config", path: "bot-plugins/<bot>/plugins/config.json", kind: "json", target: "bot", notes: "Plugin config values for one bot." },
  { id: "person-capabilities", path: "principals/<pid>/capabilities.enc", kind: "enc", target: "person", notes: "Person MCP, GitHub, plugins, skill refs, org choices (lot 2)." },
  { id: "person-connections-legacy", path: "principals/<pid>/connections.enc", kind: "enc", target: "person", notes: "Legacy person connections; first read already writes capabilities.enc." },
  { id: "marketplaces-state", path: "marketplaces/state.json", kind: "json", target: "installation", notes: "Installation marketplace list and Everyone installs." },
  { id: "skills-library-index", path: "skills-library/index.json", kind: "json", target: "installation", notes: "Organization skills library index." },
  { id: "org-flow-state", path: "org-flow-plugins/state.json", kind: "json", target: "installation", notes: "Signed Flow pack load state." },
  { id: "org-capabilities-state", path: "org-capabilities/state.json", kind: "json", target: "installation", notes: "Organization declaration install state (lot 4)." },
  { id: "config-mcp-servers", path: "config.json#mcpServers", kind: "json", target: "installation", notes: "Installation MCP servers kept in config.json." },
  { id: "org-github-tokens", path: "org-github-tokens.enc", kind: "enc", target: "installation", notes: "Legacy org GitHub tokens; migrateGithubCredentials already folds them." },
  { id: "marketplace-tokens", path: "marketplace-tokens.enc", kind: "enc", target: "installation", notes: "Legacy per-marketplace tokens; migrateGithubCredentials already folds them." },
] as const;

export const BOT_CAPABILITIES_DIR = "bot-capabilities";
export const BOT_CAPABILITIES_FILE = "capabilities.json";
export const INSTALLATION_CAPABILITIES_FILE = "installation-capabilities.enc";
export const INSTALLATION_CAPABILITIES_AAD = "sagax installation-capabilities v1";
