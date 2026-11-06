// @ts-nocheck
/** refreshWidens (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createRefreshWidens(getHost: () => Host): any {
function refreshWidens(botId: string, threadId: string): { from: string; to: string; widensAllow: boolean } | null {
  const host = getHost();
  const { approvalModeFor } = host;

  const bot = host.store.bot(botId);
  const current = host.store.projectBotForTask(botId, threadId);
  if (!bot || !current) return null;
  const to = approvalModeFor({ ...bot, approvalGrant: undefined });
  const widensAllow = (bot.alwaysAllow ?? []).some((key) => !(current.alwaysAllow ?? []).includes(key));
  return { from: approvalModeFor(current), to, widensAllow };

}
  return refreshWidens;
}
