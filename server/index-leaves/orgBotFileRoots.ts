// @ts-nocheck
/** orgBotFileRoots (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createOrgBotFileRoots(getHost: () => Host): any {
function orgBotFileRoots(bot: BotRecord) {
  const host = getHost();
  const { ATTACHMENTS_DIR, TASK_WORKSPACES_DIR, existsSync, workspaceDir } = host;

  // A confidential thread's folder is never in the console (server/threads/confidential-threads.ts).
  const confidential = new Set(host.store.tasks(bot.id).filter((task) => task.confidential === true).map((task) => task.threadId));
  const folder = (id: "workspace" | "tasks", dir: string): BotFileRoot => existsSync(dir)
    ? { id, kind: "folder", dir, ...(id === "tasks" && confidential.size ? { hidden: confidential } : {}) }
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
