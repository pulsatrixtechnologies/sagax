// @ts-nocheck
/** adminApprovalCheck (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createAdminApprovalCheck(getHost: () => Host): any {
function adminApprovalCheck(auth: RequestAuth, threadId: string, requestId: string) {
  const host = getHost();

  if (host.IDENTITY.kind !== "perspicax") return null;
  const card = host.store.messagesFor(threadId).find((row) => row.card?.requestId === requestId)?.card;
  // Security review 2026-10-19: a holder's server-command card is checked
  // again at the answer: an admin, or someone who still holds host.commands.
  if (card?.serverCommandHolder && !card.answered && !card.dismissed && !card.expired
    && !host.orgAdminCaller(auth) && !host.callerCan(auth, "host.commands")) return "refused";
  // 2026-10-19: or a person an admin gave host.shell in Perspicax
  return host.adminApprovalDecision({ identity: host.IDENTITY.kind, card, callerIsOrgAdmin: host.orgAdminCaller(auth) || host.callerCan(auth, "host.shell") });

}
  return adminApprovalCheck;
}
