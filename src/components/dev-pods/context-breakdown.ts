// The Context card's breakdown in tokens. The server measures sizes in bytes
// (server/context/context-buckets.ts): the prompt it assembled (memory and skills are
// parts of it), the tool definitions it mounted and the messages it handed
// over. A byte size reads as tokens at about 4 bytes a token: every share
// derived this way is shown as an estimate (≈). The total stays the model's
// own reading; what the measured parts do not cover (the engine's own prompt
// and tools, MCP tool definitions) is its own line, never spread over the
// others.

export const BYTES_PER_TOKEN = 4;

export const BREAKDOWN_KEYS = ["prompt", "tools", "memory", "skills", "agents", "messages", "engine"] as const;
export type BreakdownKey = typeof BREAKDOWN_KEYS[number];

export interface BreakdownPart {
  key: BreakdownKey;
  /** Estimated tokens. */
  tokens: number;
  /** Share of the tokens used, 0 to 100, rounded. */
  percent: number;
}

export interface ContextBucketsInput {
  messages?: number;
  messageBytes?: number;
  tools?: number;
  memory?: number;
  skills?: number;
  agents?: number;
  prompt?: number;
}

const tokensOf = (bytes: number | undefined) => (bytes && bytes > 0 ? Math.round(bytes / BYTES_PER_TOKEN) : 0);

/** The parts of the used context, largest first, from the measured byte
 * sizes and the model's own total (`used`, when it reported one). Parts
 * with nothing measured are left out. */
export function contextBreakdown(buckets: ContextBucketsInput | undefined, used: number | undefined): BreakdownPart[] {
  if (!buckets) return [];
  const memory = buckets.memory ?? 0;
  const skills = buckets.skills ?? 0;
  // memory and skills are sections of the prompt: counted once, apart
  const promptOther = Math.max(0, (buckets.prompt ?? 0) - memory - skills);
  const raw: Array<[BreakdownKey, number]> = [
    ["prompt", tokensOf(promptOther)],
    ["tools", tokensOf(buckets.tools)],
    ["memory", tokensOf(memory)],
    ["skills", tokensOf(skills)],
    ["agents", tokensOf(buckets.agents)],
    ["messages", tokensOf(buckets.messageBytes)],
  ];
  let parts = raw.filter(([, tokens]) => tokens > 0);
  const measured = parts.reduce((sum, [, tokens]) => sum + tokens, 0);
  const total = used && used > 0 ? used : measured;
  if (!total) return [];
  if (used && used > 0) {
    if (measured > used) {
      // the estimate overshoots the real reading: scale it down to fit
      parts = parts.map(([key, tokens]) => [key, Math.round((tokens * used) / measured)]);
    } else if (used - measured > 0) {
      parts.push(["engine", used - measured]);
    }
  }
  return parts
    .map(([key, tokens]) => ({ key, tokens, percent: Math.round((tokens / total) * 100) }))
    .sort((a, b) => b.tokens - a.tokens);
}
