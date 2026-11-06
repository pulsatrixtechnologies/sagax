// @ts-nocheck
/** botmailConfined (#1388). Pure move from server/index.ts. */
import { botmailRunConfined } from "../mail/bot-inbound-mail.ts";
export type Host = Record<string, any>;

export function createBotmailConfined(getHost: () => Host): any {
function botmailConfined(threadId: string) {
  const host = getHost();
  const { approvalModeFor } = host;

  try {
    // 2026-10-30: a proactive wake an email started is confined the same way
    if (host.activeRoutineRunForThread(threadId)?.proactive?.confined) return true;
    const run = host.activeRoutineRunForThread(threadId);
    const bot = run ? host.botForThread(run.botId, threadId) : null;
    const authorizedFull = Boolean(bot && approvalModeFor(bot) === "full" && !host.orgDeniesFull(bot)
      && host.supportsApprovalMode(bot.modelSelection, "full") && host.routineOwnerAuthorizationFor(bot, threadId));
    return botmailRunConfined(run, (id) => host.webhooks.list().find((hook) => hook.id === id) ?? null, authorizedFull);
  } catch {
    return false;
  }

}
  return botmailConfined;
}
