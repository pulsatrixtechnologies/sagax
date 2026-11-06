// @ts-nocheck
/** recentToolUses (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createRecentToolUses(getHost: () => Host): any {
function recentToolUses(botId: string) {
  const host = getHost();
  const { EVENTS_DIR, store } = host;
  const tasks = [...store.tasks(botId)].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)).slice(0, host.COMPACT_USAGE_THREADS);
  const uses: ToolUse[] = [];
  for (const task of tasks) {
    try {
      for (const run of host.readToolRuns(EVENTS_DIR, task.threadId)) uses.push({ name: run.tool });
    } catch {
      /* an unreadable log adds nothing */
    }
  }
  return uses;

}
  return recentToolUses;
}
