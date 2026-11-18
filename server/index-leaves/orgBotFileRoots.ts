// @ts-nocheck
/** orgBotFileRoots (#1388). Pure move from server/index.ts. */
import { join } from "node:path";
import { existsSync } from "node:fs";
export type Host = Record<string, any>;

export function createOrgBotFileRoots(getHost: () => Host): any {
/** `viewerId` (#4625, the member API): the conversation folders shown are
 * only those of the conversations this person may read (botThreadReadable,
 * the private threads rule), never a confidential one. */
function orgBotFileRoots(bot: BotRecord, viewerId?: string) {
  const host = getHost();
  const { ATTACHMENTS_DIR, TASK_WORKSPACES_DIR, workspaceDir } = host;

  // A confidential thread's folder is never in the console (server/threads/confidential-threads.ts).
  const confidential = new Set(host.store.tasks(bot.id).filter((task) => task.confidential === true).map((task) => task.threadId));
  const shown = viewerId === undefined ? null : new Set([bot.threadId, ...host.store.tasks(bot.id).map((task) => task.threadId)]
    .filter((threadId) => typeof threadId === "string" && threadId !== "" && !confidential.has(threadId) && host.botThreadReadable(bot, threadId, viewerId, "thread.read")));
  const folder = (id: "workspace" | "tasks", dir: string): BotFileRoot => existsSync(dir)
    ? { id, kind: "folder", dir, ...(id === "tasks" && confidential.size ? { hidden: confidential } : {}), ...(id === "tasks" && shown ? { shown } : {}) }
    : { id, kind: "unavailable", reason: "not_created" };
  const project: BotFileRoot = !bot.cwd
    ? { id: "project", kind: "unavailable", reason: "not_set" }
    : !existsSync(bot.cwd)
      ? { id: "project", kind: "unavailable", reason: "not_created" }
      : host.insideDataDir(bot.cwd) ? { id: "project", kind: "folder", dir: bot.cwd } : { id: "project", kind: "unavailable", reason: "outside_server_data" };
  return [
    folder("workspace", workspaceDir(bot.id)),
    folder("tasks", join(TASK_WORKSPACES_DIR, bot.id)),
    project,
    { id: "attachments", kind: "attachments", dir: ATTACHMENTS_DIR },
    { id: "sandbox", kind: "unavailable", reason: "person_environment" },
    { id: "desktop", kind: "unavailable", reason: "own_computer" },
  ];

}
  return orgBotFileRoots;
}
