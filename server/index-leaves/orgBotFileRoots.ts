// @ts-nocheck
/** orgBotFileRoots (#1388). Pure move from server/index.ts. */
import { join, relative, sep, isAbsolute } from "node:path";
import { existsSync, realpathSync } from "node:fs";
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
  /** The member view (#4627): a working folder is browsed only when its real
   * path (symlinks resolved) is inside this bot's own folders. Under the
   * conversation folders, the same `shown` and confidential rules apply: the
   * folder itself carries them, a conversation's folder must be one shown. A
   * working folder set to the data folder or another bot's folder is never
   * browsed from the member API. */
  function memberProject(cwd: string): BotFileRoot {
    const out: BotFileRoot = { id: "project", kind: "unavailable", reason: "outside_bot_folders" };
    const real = (path: string): string | null => {
      try { return realpathSync(path); } catch { return null; }
    };
    const cwdReal = real(cwd);
    if (!cwdReal) return out;
    const under = (root: string | null): string[] | null => {
      if (!root) return null;
      const rel = relative(root, cwdReal);
      if (rel === "") return [];
      if (rel.startsWith("..") || isAbsolute(rel)) return null;
      return rel.split(sep);
    };
    if (under(real(workspaceDir(bot.id))) !== null) return { id: "project", kind: "folder", dir: cwdReal };
    const inTasks = under(real(join(TASK_WORKSPACES_DIR, bot.id)));
    if (inTasks === null) return out;
    if (inTasks.length === 0) {
      return { id: "project", kind: "folder", dir: cwdReal, ...(confidential.size ? { hidden: confidential } : {}), ...(shown ? { shown } : {}) };
    }
    return shown?.has(inTasks[0]) && !confidential.has(inTasks[0]) ? { id: "project", kind: "folder", dir: cwdReal } : out;
  }
  const project: BotFileRoot = !bot.cwd
    ? { id: "project", kind: "unavailable", reason: "not_set" }
    : !existsSync(bot.cwd)
      ? { id: "project", kind: "unavailable", reason: "not_created" }
      : !host.insideDataDir(bot.cwd)
        ? { id: "project", kind: "unavailable", reason: "outside_server_data" }
        : viewerId === undefined ? { id: "project", kind: "folder", dir: bot.cwd } : memberProject(bot.cwd);
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
