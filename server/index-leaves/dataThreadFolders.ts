// @ts-nocheck
/** dataThreadFolders (#1388). Pure move from server/index.ts. */
import { join } from "node:path";
export type Host = Record<string, any>;

export function createDataThreadFolders(getHost: () => Host): any {
function dataThreadFolders(bot: BotRecord, person: string) {
  const host = getHost();
  const { TASK_WORKSPACES_DIR, privateThreadOwner } = host;
  const who = person.trim().toLowerCase();
  if (!who) return [];
  const owner = host.effectiveBotOwner(bot);
  return (bot.tasks ?? [])
    .filter((task) => task.confidential !== true && /^[A-Za-z0-9_-]{1,128}$/.test(task.threadId) && privateThreadOwner(task, owner) === who)
    .map((task) => join(TASK_WORKSPACES_DIR, bot.id, task.threadId));

}
  return dataThreadFolders;
}
