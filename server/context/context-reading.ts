// What the Context pod may say about the last turn. Only numbers the server
// already measured are kept: the model's own context reading, the byte
// size of the system prompt, and the buckets measured from what the turn
// already held. Nothing is estimated.

import { contextBuckets, type ContextBuckets } from "./context-buckets.ts";

export interface ContextReading {
  tokens: number;
  window?: number;
  /** Bytes of the assembled system prompt (stable and volatile together). */
  promptBytes?: number;
  /** Measured buckets (messages, tools, memory, skills, agents, prompt). */
  buckets?: ContextBuckets;
}

const clean = (n: number | undefined) => (typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0);

/** The next stored reading. A turn that reported no context keeps the
 * previous one. A prompt size is attached only to a real reading: it never
 * stands in for a token total the model did not report. */
export function nextContext(
  prev: ContextReading | undefined,
  turn: { tokens?: number; window?: number; promptBytes?: number; buckets?: ContextBuckets },
): ContextReading | undefined {
  const tokens = clean(turn.tokens);
  const window = clean(turn.window);
  const promptBytes = clean(turn.promptBytes);
  const buckets = contextBuckets(turn.buckets);
  const kept: ContextReading | undefined = tokens > 0
    ? {
        tokens,
        ...(window > 0 ? { window } : {}),
        ...(prev?.promptBytes ? { promptBytes: prev.promptBytes } : {}),
        ...(prev?.buckets ? { buckets: prev.buckets } : {}),
      }
    : prev ? { ...prev } : undefined;
  if (!kept) return undefined;
  if (promptBytes > 0) kept.promptBytes = promptBytes;
  if (buckets) kept.buckets = buckets;
  return kept;
}
