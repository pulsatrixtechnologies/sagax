/** Hidden folders a bot may READ among its own files (2026-10-19, bot
 * quality cause A): skill revisions (skills/.revisions, where the active
 * revision of a skill lives) and plugin manifests (.claude-plugin). Every
 * other hidden name stays refused (.git, .claude, .mcp.json, .env... can
 * hold commands or credentials), and nothing hidden is ever writable. */
export const READABLE_HIDDEN_SEGMENTS: ReadonlySet<string> = new Set([".revisions", ".claude-plugin"]);
