// Port of OpenMausBot #5105: when a step on one of the person's MCP servers
// fails, the step row says which server and why (needs a sign-in, refused,
// not found, timed out, can't connect). Only failures worded by an MCP client
// or by this app's own proxies are recognised. A tool's own error ("thread
// not found") is that tool's answer, not the server failing, so it gets no
// line and its output speaks for itself.

export type McpFailureKind = "sign-in" | "refused" | "not-found" | "timeout" | "cant-connect";

/** A failed step on a configured MCP server, as the row says it. */
export interface McpStepProblem {
  kind: McpFailureKind;
  server: string;
}

const NAMED = String.raw`(?:The )?MCP server "[^"]+"`;
const FAILURES: ReadonlyArray<readonly [RegExp, McpFailureKind]> = [
  // Claude Code's words for a server it can't use.
  [new RegExp(`^${NAMED} needs (?:authentication|additional permissions|a sign-in)\\b`), "sign-in"],
  [new RegExp(`^${NAMED} (?:rejected|refused the sign-in or key)\\b`), "refused"],
  [new RegExp(`^${NAMED} (?:is not connected|session expired)\\b`), "cant-connect"],
  [/^Dynamic Client Registration rejected\b/, "sign-in"],
  [/^HTTP 401 dialing /, "sign-in"],
  [/^HTTP 403 dialing /, "refused"],
  [/^HTTP 404 dialing /, "not-found"],
  [/^HTTP (?:408|504) dialing /, "timeout"],
  // Any other "<cause> dialing <address>": Claude Code hides the cause when the address holds a token.
  [/^\S+(?: \d{3})? dialing /, "cant-connect"],
  [/^(?:ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH)\b/, "cant-connect"],
  [/^ETIMEDOUT\b/, "timeout"],
  // The remote proxy's words (shared/connector-refusal.ts and its siblings) and the MCP SDK's.
  [/^This MCP server refused (?:its credentials|the request)\b/, "refused"],
  [/^This MCP server's address was not found\b/, "not-found"],
  [/^Could not reach this MCP server\b/, "cant-connect"],
  [/^Request timed out\b/, "timeout"],
  [/^Connection closed\b/, "cant-connect"],
  // The chat runtime's MCP client (server/drivers/chat-mcp-tools.ts).
  [/^MCP (?:request|startup) timed out\b/, "timeout"],
  [/^MCP (?:server could not start|server exited|server input closed|session closed)\b/, "cant-connect"],
];

/** What the engine said, out of the JSON a step's output may be: the chat
 * runtime's `{ ok, result }`, or MCP's own content list. */
function reportedText(output: string): string {
  try {
    const parsed = JSON.parse(output) as { result?: unknown } | Array<{ text?: unknown }>;
    const text = Array.isArray(parsed) ? parsed[0]?.text : parsed?.result;
    return typeof text === "string" ? text : output;
  } catch {
    return output;
  }
}

/** Why an MCP step failed, from the first line of what the engine reported;
 * null when it is the tool's own error. */
export function mcpFailureKind(output: string): McpFailureKind | null {
  const first = reportedText(output).replace(/^\s*<tool_use_error>\s*/, "").split("\n", 1)[0]!.trim().replace(/^(?:Error: )?(?:MCP error -?\d+: )/, "");
  return FAILURES.find(([pattern]) => pattern.test(first))?.[1] ?? null;
}

/** The configured MCP server a step's tool belongs to, as each engine spells
 * it: Claude Code's `mcp` prefix, a server name followed by its tool after
 * one or two underscores, or a dot. The longest name that fits wins. */
export function mcpServerOfTool(tool: string, servers: readonly string[]): string | undefined {
  const name = tool.toLowerCase();
  const twice = "_".repeat(2);
  return [...servers].sort((a, b) => b.length - a.length).find((server) => {
    const own = server.toLowerCase(), flat = own.replace(/[^a-z0-9_]+/g, "_");
    return name.startsWith(`mcp${twice}${own}${twice}`) || name.startsWith(`${own}${twice}`) || name.startsWith(`${own}.`) || name.startsWith(`${flat}_`);
  });
}

/** The problem of a finished step: only a failed step on a configured MCP
 * server whose failure is recognised has one. */
export function mcpStepProblem(tool: string, ok: boolean | undefined, output: string | undefined, servers: readonly string[]): McpStepProblem | undefined {
  if (ok !== false || !output) return undefined;
  const server = mcpServerOfTool(tool, servers);
  const kind = server ? mcpFailureKind(output) : null;
  return server && kind ? { kind, server } : undefined;
}
