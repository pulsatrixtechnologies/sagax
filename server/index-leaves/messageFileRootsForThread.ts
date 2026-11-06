// @ts-nocheck
/** messageFileRootsForThread (#1388). Pure move from server/index.ts. */
import { messageFileRoots } from "../messages/message-file.ts";
export type Host = Record<string, any>;

export function createMessageFileRootsForThread(getHost: () => Host): any {
function messageFileRootsForThread(senderId: string, threadId: string) {
  const host = getHost();
  const { ATTACHMENTS_DIR, workspaceDir } = host;

  const directBot = host.store.botByThread(threadId);
  const group = directBot ? undefined : host.store.groupByThread(threadId);
  let pinnedCwd: string | null | undefined;
  let configuredCwd: string | undefined;
  if (directBot) {
    pinnedCwd = host.store.taskByThread(directBot.id, threadId)?.cwd;
    configuredCwd = directBot.cwd;
  } else if (group) {
    const task = host.store.groupTaskByThread(group.id, threadId);
    pinnedCwd = task ? task.pinnedCwd : group.threadId === threadId ? group.pinnedCwd : undefined;
    configuredCwd = group.cwd;
  }
  return messageFileRoots({
    senderWorkspace: workspaceDir(senderId),
    attachments: ATTACHMENTS_DIR,
    pinnedCwd,
    configuredCwd
  });

}
  return messageFileRootsForThread;
}
