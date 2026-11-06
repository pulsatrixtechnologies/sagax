// @ts-nocheck
/** dataConfinedRoots (#1388). Pure move from server/index.ts. */
import { join } from "node:path";
import { dataScopeAudience, dataScopeBotId, dataScopeKind, dataScopeThread } from "../data/scope.ts";
export type Host = Record<string, any>;

export function createDataConfinedRoots(getHost: () => Host): any {
function dataConfinedRoots(scopeKey: string) {
  const host = getHost();
  const { TASK_WORKSPACES_DIR, workspaceDir } = host;

  if (host.IDENTITY.kind !== "perspicax") return null;
  const botId = dataScopeBotId(scopeKey);
  if (dataScopeKind(scopeKey) === "thread") {
    const thread = dataScopeThread(scopeKey);
    return thread ? [join(TASK_WORKSPACES_DIR, botId, thread)] : [];
  }
  // The bot's scope and a person's: the bot's workspace, plus the task
  // folder of each ordinary thread of that scope's person (the bot's owner
  // for the bot scope). Never the whole task-workspaces/<bot> folder: it
  // holds every person's threads, confidential ones included. The engine
  // reopens a database when this list changes (engine.ts BotDb.open).
  const bot = host.store.bot(botId);
  const person = bot ? (dataScopeKind(scopeKey) === "bot" ? host.effectiveBotOwner(bot) : dataScopeAudience(scopeKey)) : undefined;
  const threads = bot && person ? host.dataThreadFolders(bot, person) : [];
  return [workspaceDir(botId), ...threads];

}
  return dataConfinedRoots;
}
