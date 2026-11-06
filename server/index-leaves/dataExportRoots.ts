// @ts-nocheck
/** dataExportRoots (#1388). Pure move from server/index.ts. */
import { join } from "node:path";
import { dataExportRootsFor, dataScopeKind, dataScopeThread } from "../data/scope.ts";
import { existsSync } from "node:fs";
export type Host = Record<string, any>;

export function createDataExportRoots(getHost: () => Host): any {
function dataExportRoots(bot: { id: string; cwd?: string }, scopeKey: string = bot.id) {
  const host = getHost();
  const { TASK_WORKSPACES_DIR, dataScopeFolder, workspaceDir } = host;
  // 2026-10-17 (follow-up of #696): on an organization server a person's
  // export lands in their own scope folder only; a confidential thread's,
  // on any server, in its own folder only (2026-10-18, never the bot's
  // workspace, which every workspace backup holds)
  const kind = dataScopeKind(scopeKey);
  const thread = kind === "thread" ? dataScopeThread(scopeKey) : undefined;
  const downloads = join(host.homedir(), "Downloads");
  return dataExportRootsFor({
    organization: host.IDENTITY.kind === "perspicax",
    kind,
    workspace: workspaceDir(bot.id),
    scopeFolder: dataScopeFolder(scopeKey),
    threadFolder: thread ? join(TASK_WORKSPACES_DIR, bot.id, thread) : null,
    downloads: existsSync(downloads) ? downloads : null,
    ...(bot.cwd ? { cwd: bot.cwd } : {})
  });

}
  return dataExportRoots;
}
