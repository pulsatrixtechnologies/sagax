// @ts-nocheck
/** pendingAdminApprovals (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

/** #4451: the waiting admin cards with their messages, in the list's order:
 * Settings > Organization reads the rows, the admins' Primary Bot views
 * (server/approvals/admin-approval-views.ts) read the messages. One list. */
export function createAdminApprovalEntries(getHost: () => Host): any {
function adminApprovalEntries() {
  const host = getHost();
  const { isPrincipalId } = host;

  return host.pendingApprovalCards()
    .filter((entry) => entry.card.adminApproval)
    .map(({ bot, threadId, message, card }) => {
      const ownerPrincipalId = host.effectiveBotOwner(bot);
      const requester = host.cardRequesterKey(threadId, card.requestId!);
      const requestedBy = requester && isPrincipalId(requester) && host.principals.byId(requester) ? host.adminPerson(requester).name : undefined;
      const summary = typeof card.subtitle === "string" && card.subtitle ? host.redactSecretsInText(card.subtitle).slice(0, 500) : undefined;
      return {
        message,
        row: {
          botId: bot.id, botName: bot.name, threadId, requestId: card.requestId!,
          ownerPrincipalId, ownerName: host.adminPerson(ownerPrincipalId).name,
          ...(requestedBy ? { requestedBy } : {}),
          ...(card.tool ? { tool: String(card.tool).slice(0, 200) } : {}),
          ...(summary ? { summary } : {}),
          at: message.at
        }
      };
    })
    .sort((a, b) => a.row.at - b.row.at).slice(0, 200);

}
  return adminApprovalEntries;
}

export function createPendingAdminApprovals(getHost: () => Host): any {
function pendingAdminApprovals() {
  return getHost().adminApprovalEntries().map((entry) => entry.row);
}
  return pendingAdminApprovals;
}
