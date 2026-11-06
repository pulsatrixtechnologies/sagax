// @ts-nocheck
/** pendingApprovalsFor (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createPendingApprovalsFor(getHost: () => Host): any {
function pendingApprovalsFor(viewer: { principalId: string; orgAdmin: boolean }, scope: "mine" | "org" = "mine") {
  const host = getHost();
  const { isPrincipalId } = host;

  const origin = host.IDENTITY.kind === "perspicax" ? host.IDENTITY.publicOrigin.replace(/\/+$/, "") : "";
  const out: AdminApproval[] = [];
  for (const { bot, threadId, message, card } of host.pendingApprovalCards()) {
    const kind = card.adminApproval ? "admin" as const : "owner" as const;
    const ownerId = host.cardAnswererId(bot, threadId, card);
    // A confidential thread's cards are its owner's alone: never in the
    // organization queue, never someone else's to decide.
    if (host.store.isConfidentialThread(threadId) && (kind === "admin" || ownerId !== viewer.principalId)) continue;
    // "org" (the console's organization queue, admins only): every pending
    // card, decidable only by whoever Sagax lets decide it.
    const mayDecide = kind === "admin" ? viewer.orgAdmin : ownerId === viewer.principalId;
    if (scope === "mine" && !mayDecide) continue;
    const type = host.approvalTypeOf(card);
    const requester = host.cardRequesterKey(threadId, card.requestId!);
    const summary = typeof card.subtitle === "string" && card.subtitle ? host.redactSecretsInText(card.subtitle).slice(0, 500) : undefined;
    out.push({
      botId: bot.id,
      botName: bot.name,
      threadId,
      requestId: card.requestId!,
      kind,
      type,
      ...(card.tool ? { tool: String(card.tool).slice(0, 200) } : {}),
      ...(summary ? { summary } : {}),
      ...(requester && isPrincipalId(requester) && host.principals.byId(requester) ? { requestedBy: host.adminPerson(requester) } : {}),
      owner: host.adminPerson(ownerId),
      at: message.at,
      decidable: mayDecide && type === "tool" && host.approvalHostOf(bot).kind === "fleet",
      link: `${origin}/#thread=${encodeURIComponent(threadId)}&bot=${encodeURIComponent(bot.id)}`
    });
  }
  return out.sort((a, b) => a.at - b.at).slice(0, scope === "org" ? 2_000 : 200);

}
  return pendingApprovalsFor;
}
