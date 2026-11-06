// @ts-nocheck
/** privateFolderThread (#1388). Pure move from server/index.ts. */
import { join } from "node:path";
import { realpathSync } from "node:fs";
export type Host = Record<string, any>;

export function createPrivateFolderThread(getHost: () => Host): any {
function privateFolderThread(botId: string, threadId: string) {
  const host = getHost();
  const { TASK_WORKSPACES_DIR } = host;

  const task = host.store.taskByThread(botId, threadId);
  if (!task) return false;
  if (task.cwd === undefined) return true;
  if (task.cwd === null) return false;
  const own = join(TASK_WORKSPACES_DIR, botId, threadId);
  const real = (path: string) => { try { return realpathSync(path); } catch { return path; } };
  return task.cwd === own || real(task.cwd) === real(own);

}
  return privateFolderThread;
}
