// One rule for the MCP server names Sagax reserves (C-18, lot 1a of the
// Capabilities migration). Before it, three rules disagreed: the
// installation's servers (server/mcp/mcp-registry.ts), a person's own servers
// (server/index.ts PERSONAL_MCP_RESERVED_PREFIX) and the turn's Connectors
// record (server/turns/turn-connectors.ts). A name one refused is now refused by
// all three, the strictest rule kept:
//   - the built-in names below;
//   - the families sagax*, perspicax*, openmausbot*, claude_ai*, claude-ai-*,
//     claude-ai_* and mcp* (a person's servers already refused the families
//     with no separator: `sagaxfoo`, `mcp-github`; since 2026-10-30 the
//     installation's servers do too);
//   - a double underscore anywhere, the separator of `<server>__<tool>`
//     (a person's server saved before #695 under such a name is no longer
//     mounted either).
// A server an older build saved under a reserved name is never mounted and
// is listed apart with a rename (docs: AGENTS.md "Reserved MCP server names").

/** Names Sagax mounts itself or that collide with a built-in tool. */
export const RESERVED_MCP_NAMES: ReadonlySet<string> = new Set([
  "ogb",
  "computer",
  "agents",
  "data",
  "browser",
  "phone",
  "dweb",
  "openmausbot_connectors",
  "openmausbot_phone",
  // 2026-10-16 security review: the person's own environment servers Sagax
  // mounts itself (user-sandbox-routing.ts USER_SANDBOX_MCP_NAME,
  // shared/bot-workplace.ts DESKTOP_BRIDGE_MCP_NAME). Their tools may run
  // without a card in the bot owner's environment (member-environment.ts),
  // so no person's server may take these names.
  "sagax-environment",
  "sagax-desktop",
  // 2026-10-17 (leftovers of #690): a server named `mcp` spells its tool
  // `data__data_sql` as `mcp__data__data_sql` on a chat engine, the name of
  // the built-in Data tool on Claude (sagax-internal-tools.ts).
  "mcp",
]);

/** Name families Sagax mounts itself or reads as a separator: Sagax's own
 * servers (`sagax-computer`, `sagax-flow`...), the main Perspicax connection
 * (`perspicax`), claude.ai connectors (`claude_ai_<Service>`), the
 * legacy app's servers, and `mcp...`. */
export const RESERVED_MCP_PREFIX = /^(?:sagax|perspicax|openmausbot|claude_ai|claude-ai[-_]|mcp)/;

/** The one rule: true when no server, of the installation or of a person,
 * may be mounted under this name. */
export function reservedMcpName(name: string): boolean {
  return RESERVED_MCP_NAMES.has(name) || RESERVED_MCP_PREFIX.test(name) || name.includes("__");
}

/** The main Perspicax server (legacy profile mounts also remain recognized). */
export const PERSPICAX_MCP_PREFIX = /^perspicax(?:_|$)/;
