// One resolver for a tool name a bot asked for against the catalog a server
// serves now (#4837). A stale or differently qualified name (`cw_psa__query`,
// `server__cw_psa_query`, `mcp__server__cw_psa_query`, a bare `query`) is
// matched to the one served tool it can only mean; anything ambiguous or
// unmatched stays unresolved and the caller names the close served tools.
//
// The resolver only picks a name. Every caller still judges the RESOLVED
// name (permissions, approvals, tool scope) before it sends anything.

/** Close names listed in an error, at most. */
export const CLOSE_NAMES_MAX = 5;

/** Lowercase, every run of non-alphanumerics (`_`, `__`, `-`, `.`, `:`, `/`) one `_`, no edge `_`. */
export function foldToolName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

export type ToolResolution =
  | { kind: "exact" | "folded" | "namespaced" | "suffix"; name: string }
  | { kind: "none"; close: string[] };

/** Resolve `requested` against the served names. Levels, strongest first:
 * exact, equal after folding separators, a namespaced name (the requested
 * name ends with a served name after a separator), a served name that ends
 * with the requested name after a separator. A level needs exactly one
 * match: when a level matches several names the answer is none, never a
 * weaker level. Aliases follow whole separator-delimited words only. */
export function resolveServedTool(requested: string, served: Iterable<string>): ToolResolution {
  const names = [...new Set(served)];
  if (names.includes(requested)) return { kind: "exact", name: requested };
  const none = (): ToolResolution => ({ kind: "none", close: closeServedNames(requested, names) });
  const want = foldToolName(requested);
  if (!want) return none();
  const folded = names.map((name) => ({ name, key: foldToolName(name) })).filter((row) => row.key);
  const same = folded.filter((row) => row.key === want);
  if (same.length) return same.length === 1 ? { kind: "folded", name: same[0]!.name } : none();
  // the longest served tail wins, so `ns_cw_psa_query` is `cw_psa_query`, not `query`
  const inside = folded.filter((row) => want.endsWith(`_${row.key}`));
  if (inside.length) {
    const longest = Math.max(...inside.map((row) => row.key.length));
    const top = inside.filter((row) => row.key.length === longest);
    return top.length === 1 ? { kind: "namespaced", name: top[0]!.name } : none();
  }
  const suffix = folded.filter((row) => row.key.endsWith(`_${want}`));
  if (suffix.length) return suffix.length === 1 ? { kind: "suffix", name: suffix[0]!.name } : none();
  // Different explicit namespaces can share the same operation name.
  const leaf = (name: string) => foldToolName(name.slice(name.lastIndexOf("__") + 2));
  const matches = folded.filter(row => {
    const left = requested.includes("__") ? leaf(requested) : want;
    const right = row.name.includes("__") ? leaf(row.name) : row.key;
    return left === right || (row.name.includes("__") && want.endsWith("_" + right))
      || (requested.includes("__") && row.key.endsWith("_" + left));
  });
  return matches.length === 1 ? { kind: "suffix", name: matches[0]!.name } : none();
}

/** The served names that share the most words with the requested one. */
export function closeServedNames(requested: string, served: Iterable<string>, limit = CLOSE_NAMES_MAX): string[] {
  const words = new Set(foldToolName(requested).split("_").filter((word) => word.length > 1));
  if (!words.size) return [];
  const scored: Array<{ name: string; score: number }> = [];
  for (const name of new Set(served)) {
    const key = foldToolName(name);
    const parts = key.split("_");
    let score = 0;
    for (const word of words) {
      if (parts.includes(word)) score += 2;
      else if (key.includes(word)) score += 1;
    }
    if (score > 0) scored.push({ name, score });
  }
  return scored.sort((a, b) => b.score - a.score || a.name.length - b.name.length || a.name.localeCompare(b.name)).slice(0, limit).map((row) => row.name);
}

/** Whether a server's WHOLE error message says the tool is not served: one
 * short line that starts with the words (an optional `MCP error: ` before)
 * and names the requested tool. A longer text, a later mention or a message
 * about another tool is some other failure, possibly of a call that already
 * ran, and never reads as unknown (nothing is retried on it). */
export function isUnknownToolText(text: string, asked: string): boolean {
  const line = text.trim();
  if (!asked || /[\r\n]/.test(line)) return false;
  const message = line.replace(/^(?:mcp error(?:\s+-?\d+)?|error):\s*/i, "");
  const name = /^(?:unknown tool|no such tool|tool not found|no tool named)[:\s]+["'`]?([a-z0-9_.-]+)/i.exec(message)?.[1]
    ?? /^tool\s+["'`]?([a-z0-9_.-]+)["'`]?\s+(?:not found|does not exist|is not served)\b/i.exec(message)?.[1];
  return name === asked || name === asked + ".";
}

/** The text of a tool result that is only an unknown tool message: an error
 * result with no structured content and one text block. */
export function unknownToolResultText(result: unknown, asked: string): string | undefined {
  if (!result || typeof result !== "object") return undefined;
  const record = result as { isError?: unknown; structuredContent?: unknown; content?: unknown };
  if (record.isError !== true || record.structuredContent !== undefined || !Array.isArray(record.content) || record.content.length !== 1) return undefined;
  const block = record.content[0] as { type?: unknown; text?: unknown } | undefined;
  return block?.type === "text" && typeof block.text === "string" && isUnknownToolText(block.text, asked) ? block.text : undefined;
}

/** One catalog read across every page: `page` gets the cursor of the last
 * answer (none first) and returns its tool names with the next cursor. A
 * repeated cursor, or a failed page rejects: a partial catalog
 * never decides a name. */
export async function readToolPages(page: (cursor: string | undefined) => Promise<{ names: string[]; nextCursor?: unknown }>): Promise<string[]> {
  const names: string[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (;;) {
    const answer = await page(cursor);
    names.push(...answer.names);
    const next = answer.nextCursor;
    if (next === undefined || next === null || next === "") return names;
    if (typeof next !== "string" || seen.has(next)) throw new Error("invalid tools/list cursor");
    seen.add(next);
    cursor = next;
  }
}

/** The sentence added to an unknown tool error. */
export function closeNamesSentence(close: readonly string[]): string {
  return close.length ? ` Close served names: ${close.join(", ")}.` : "";
}

/** Ask the outer stdio gate to pass the resolved call through its normal
 * per-tool selection and approval. The vendor never receives the challenge. */
export function resolutionProposal(challenge: string, name: string, close: string[]) {
  return { isError: true, content: [{ type: "text", text: `Use the served tool ${name}.${closeNamesSentence(close)}` }],
    _meta: { sagaxToolResolution: { challenge, name, close } } };
}
