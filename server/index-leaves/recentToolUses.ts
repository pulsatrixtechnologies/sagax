// @ts-nocheck
/** recentToolUses (#1388, #3679). The MCP tool calls of a bot's newest
 * conversations, from the counts the event log's writer keeps
 * (server/activity/tool-use-counts.ts): memory only, never a log read on the
 * turn's path. A conversation not counted yet is loaded or counted in the
 * background; `complete` is false until every one is known. */
import { toolUsesOf } from "../activity/tool-use-counts.ts";
import type { ToolUse } from "../context/compact-prompt.ts";
export type Host = Record<string, any>;

export function createRecentToolUses(getHost: () => Host): any {
function recentToolUses(botId: string): { uses: ToolUse[]; complete: boolean } {
  const host = getHost();
  const { store } = host;
  const tasks = [...store.tasks(botId)].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)).slice(0, host.COMPACT_USAGE_THREADS);
  const uses: ToolUse[] = [];
  let complete = true;
  for (const task of tasks) {
    const counts = toolUsesOf(task.threadId);
    if (!counts) {
      complete = false;
      continue;
    }
    for (const [name, count] of Object.entries(counts)) uses.push({ name, count });
  }
  return { uses, complete };

}
  return recentToolUses;
}
