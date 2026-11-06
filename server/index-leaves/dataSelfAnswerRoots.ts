// @ts-nocheck
/** dataSelfAnswerRoots (#1388). Pure move from server/index.ts. */
import { join } from "node:path";
export type Host = Record<string, any>;

export function createDataSelfAnswerRoots(getHost: () => Host): any {
function dataSelfAnswerRoots(bot: BotRecord, threadId: string) {
  const host = getHost();
  const { TASK_WORKSPACES_DIR, workspaceDir } = host;

  // On an organization server: exactly the folders the turn's own Data
  // scope is confined to (data/scope.ts), never another person's or a
  // confidential thread's.
  if (host.IDENTITY.kind === "perspicax") {
    const scopeKey = host.dataScopeForTurn(bot, threadId);
    return scopeKey === null ? [] : host.dataConfinedRoots(scopeKey) ?? [];
  }
  return [workspaceDir(bot.id), join(TASK_WORKSPACES_DIR, bot.id)];

}
  return dataSelfAnswerRoots;
}
