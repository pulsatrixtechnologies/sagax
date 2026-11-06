// @ts-nocheck
/** memberFolderRoots (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createMemberFolderRoots(getHost: () => Host): any {
function memberFolderRoots(principalId: string) {
  const host = getHost();
  const { DATA_DIR, TASK_WORKSPACES_DIR, workspaceDir } = host;

  const person = principalId.trim().toLowerCase();
  const roots = [personFolder(DATA_DIR, person)];
  for (const bot of host.store.bots) {
    if (host.effectiveBotOwner(bot).trim().toLowerCase() === person) roots.push(workspaceDir(bot.id), join(TASK_WORKSPACES_DIR, bot.id));
  }
  return [...roots, ...openedMemberFolders(host.cfg.organization?.memberFolders, person)];

}
  return memberFolderRoots;
}
