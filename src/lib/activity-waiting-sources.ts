import type { BotActivityDetail } from "./bot-activity";
import type { WaitingSource } from "./use-waiting-cards";
/** The threads whose open cards the head shows: the task's own while it
 * waits, and each waiting sub-agent's. */
export function waitingSources(detail: BotActivityDetail | null): WaitingSource[] {
  if (!detail) return [];
  const sources: WaitingSource[] = [];
  if (detail.status === "waiting" && detail.threadId) sources.push({ threadId: detail.threadId, botId: detail.botId });
  for (const child of detail.children) {
    if (child.status === "waiting" && child.threadId) sources.push({ threadId: child.threadId, botId: child.botId, from: child.title });
  }
  return sources;
}
