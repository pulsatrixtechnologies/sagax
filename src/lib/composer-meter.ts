// The context and usage meter under the message box (owner 2026-11-25,
// M-20261125-070, M-20261125-072 to M-20261125-074, #5372): what its
// context measure reads. Pure rules; the component is
// src/components/ComposerMeter.tsx. The reading is one the app already has: a
// thread's last measured prompt against its model's window (task usage,
// lib/usage.ts). A measure with no data is absent, never greyed and never at
// zero. The usage measures (every account that can serve the bot, summed) are
// src/lib/usage-pill.ts (#5406).
import type { Message, TaskUsage } from "@/state/store";
import { compactedSinceReading } from "./context-warning";
import { contextShare } from "./usage";

export interface ContextHalf {
  /** The share of the model's window this conversation uses, 0 to 999. */
  percent: number;
  tokens: number;
  window: number;
}

/** Null when the engine gives no window, when nothing was measured yet, and
 * once the thread was compacted after its last reading (the old figure then
 * describes the context before the summary). */
export function contextHalf(usage: TaskUsage | undefined, messages: readonly Pick<Message, "role" | "kind">[]): ContextHalf | null {
  const share = usage ? contextShare(usage) : null;
  if (!share || share.window === undefined || share.percent === undefined) return null;
  if (compactedSinceReading(messages)) return null;
  return { percent: share.percent, tokens: share.tokens, window: share.window };
}
