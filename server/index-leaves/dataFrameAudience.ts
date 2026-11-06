// @ts-nocheck
/** dataFrameAudience (#1388). Pure move from server/index.ts. */
import { dataScopeAudience, dataScopeKind, dataScopeThread } from "../data/scope.ts";
export type Host = Record<string, any>;

export function createDataFrameAudience(getHost: () => Host): any {
function dataFrameAudience(scopeKey: string): { audience?: string; dataScope?: DataScopeKind; threadId?: string } {
  const host = getHost();

  const kind = dataScopeKind(scopeKey);
  if (kind === "bot") {
    if (host.IDENTITY.kind !== "perspicax") return {};
    const bot = host.store.bot(scopeKey);
    return { audience: bot ? host.effectiveBotOwner(bot) : "", dataScope: "bot" };
  }
  // A key this process never computed reaches nobody. A confidential
  // thread's frame names its thread (its owner's client keeps that sheet
  // apart from the bot's, shared/data-surface.ts dataSheetKey).
  const thread = kind === "thread" ? dataScopeThread(scopeKey) : undefined;
  return { audience: dataScopeAudience(scopeKey) ?? "", dataScope: kind, ...(thread ? { threadId: thread } : {}) };

}
  return dataFrameAudience;
}
