// @ts-nocheck
/** commandRememberRefusal (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createCommandRememberRefusal(getHost: () => Host): any {
function commandRememberRefusal(auth: RequestAuth, threadId: string, requestId: string, behavior: string) {
  const host = getHost();

  // 2026-10-27 (#1098): a command in the person's own sandbox is saved by
  // whoever answers its card (approvalAnswerRefusal ran first: the owner);
  // on the shared host it stays an admin's or a host.shell holder's.
  const sandboxCard = host.store.messagesFor(threadId).find((row) => row.card?.requestId === requestId)?.card?.ownSandbox === true;
  if (!cardStandingGrants({ memberOwned: true, ownSandbox: sandboxCard, callerManagesHostCommands: host.canManageCommandAllowlist(auth) }).ownerSavesCommand) return host.COMMAND_ALLOWLIST_ADD_REFUSAL;
  if (behavior !== "allow" || !host.pendingCommandRules.has(`${threadId}:${requestId}`)) {
    return "This live request does not contain a command that can be saved. Allow it once instead.";
  }
  return null;

}
  return commandRememberRefusal;
}
