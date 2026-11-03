/** Hidden folders a bot may READ among its own files (2026-10-19, bot
 * quality cause A): skill revisions (skills/.revisions, where the active
 * revision of a skill lives) and plugin manifests (.claude-plugin), even
 * though those names stay refused otherwise. On a member's bot, the hidden
 * names that can hold commands or credentials (.git, .claude, .mcp.json,
 * .env...) wait for an admin and every other one is the owner's
 * (server/engines/engine-access.ts sensitiveHiddenSegment, #1098). */
export const READABLE_HIDDEN_SEGMENTS: ReadonlySet<string> = new Set([".revisions", ".claude-plugin"]);
