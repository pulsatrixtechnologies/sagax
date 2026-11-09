// MCP servers that only run on macOS (#3181). The iMessage plugin of Claude
// Code reads the Messages database (~/Library/Messages/chat.db) and sends
// through AppleScript: in a person's Linux server environment, or on a
// desktop that is not a Mac, it exits at every start. Such a server is not
// offered there at all: never mounted and never listed (an option that
// cannot work in this place is hidden, not greyed out).
import type { McpServerSpec } from "../contracts.ts";

/** Servers known by name to need macOS (Claude plugin `imessage`). */
const MAC_ONLY_NAMES = new Set(["imessage"]);
/** What only a Mac has: AppleScript, the Messages database, macOS app bundles. */
const MAC_ONLY_TEXT = /(^|[\s/"'=])osascript(\s|$|["'])|\/Library\/Messages\b|\/Applications\/[^/]+\.app\b|\/System\/Library\//;

/** Whether this command server needs macOS. A URL server runs elsewhere and never does. */
export function macOnlyMcpServer(name: string, spec: McpServerSpec | { command: string; args?: readonly string[]; env?: Record<string, string> }): boolean {
  if ("url" in spec) return false;
  if (MAC_ONLY_NAMES.has(name.trim().toLowerCase())) return true;
  const words = [spec.command, ...(spec.args ?? []), ...Object.values(spec.env ?? {})];
  return words.some((word) => typeof word === "string" && MAC_ONLY_TEXT.test(word));
}

/** Whether `name` can run where its command starts: the person's server
 * environment (`organization`, a Linux machine) or this computer. */
export function mcpServerRunsHere(name: string, spec: Parameters<typeof macOnlyMcpServer>[1], where: { organization: boolean; platform?: NodeJS.Platform }): boolean {
  const platform = where.organization ? "linux" : (where.platform ?? process.platform);
  return platform === "darwin" || !macOnlyMcpServer(name, spec);
}
