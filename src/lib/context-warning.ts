// When a bot's context is nearly full, say so where the bot is (its 1:1
// header, its avatar in a room) and offer "Compact now". The readings are the
// ones the app already has: a thread's last measured prompt (task usage, the
// figure the usage chip shows) and a room member's last turn in that room
// (WireGroup.memberContext). Nothing here measures or compacts anything.
import type { Bot, Group, Message, TaskUsage } from "@/state/store";
import { contextShare } from "./usage";

/** At or above this share of the window the bot shows a warning: the same
 * 80% where the usage chip turns red and a direct thread compacts itself
 * before its next turn (server/context-budget.ts). */
export const CONTEXT_WARNING_PERCENT = 80;

/** Whether the thread was compacted after its last reading: a compaction
 * record newer than the last reply. Until the next turn reports a new
 * figure, the old one describes the context before the summary. */
export function compactedSinceReading(messages: readonly Pick<Message, "role" | "kind">[]): boolean {
  const compaction = messages.findLastIndex((message) => message.kind === "compaction");
  if (compaction < 0) return false;
  const reply = messages.findLastIndex((message) => message.role === "bot" && message.kind === "text");
  return compaction > reply;
}

/** A 1:1 thread's warning, or null below the threshold or once compacted. */
export function threadContextWarning(usage: TaskUsage | undefined, messages: readonly Pick<Message, "role" | "kind">[]): { percent: number } | null {
  const share = usage ? contextShare(usage) : null;
  if (share?.percent === undefined || share.percent < CONTEXT_WARNING_PERCENT) return null;
  if (compactedSinceReading(messages)) return null;
  return { percent: share.percent };
}

/** Room members at or above the threshold in the room's active thread, in
 * roster order. `requested`: Compact now was pressed and their next turn
 * there starts fresh. */
export function roomContextWarnings(group: Pick<Group, "memberContext">, members: readonly Bot[]):
  Array<{ bot: Bot; percent: number; requested: boolean }> {
  return members.flatMap((bot) => {
    const reading = group.memberContext?.[bot.id];
    if (!reading || !(reading.window > 0)) return [];
    const percent = Math.min(999, Math.round((reading.tokens / reading.window) * 100));
    return percent >= CONTEXT_WARNING_PERCENT ? [{ bot, percent, requested: reading.compactRequested === true }] : [];
  });
}
