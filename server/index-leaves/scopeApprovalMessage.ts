// @ts-nocheck
/** scopeApprovalMessage (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createScopeApprovalMessage(getHost: () => Host): any {
function scopeApprovalMessage<T>(threadId: string, message: T, viewer: ApprovalViewer): T{
  const host = getHost();

  if (!message || typeof message !== "object") return message;
  const row = message as { kind?: unknown; card?: unknown; from?: { botId?: string }; access?: { ownerPrincipalId: string; detail?: string } };
  // An access card's provider words go to the owner and admins only.
  if (row.kind === "access" && row.access?.detail && viewer.userId) {
    const person = host.principals.byId(viewer.userId);
    return host.accessCardForViewer(row, { principalId: viewer.userId, admin: person?.local === true || person?.orgRole === "admin" }) as T;
  }
  if (!host.isApprovalCardMessage(row)) return message;
  // A team-memory card is the team's (cardAnswerRefusal): a person who can
  // use a bot of that section gets the card itself, not "waiting on owner".
  const bot = host.botForApproval(threadId, row);
  if (host.teamMemoryMemberMayAnswer(threadId, row.card as { teamMemoryRequest?: { section?: unknown } } | undefined, viewer.userId, bot?.id)) return message;
  const audience = bot
    ? approvalAudience({ ownerUserId: host.cardAnswererId(bot, threadId, row.card as { destinationAnswerer?: unknown } | undefined), host: host.approvalHostOf(bot) })
    : { userId: "\0", deviceId: null as string | null };
  const ownerName = bot ? host.approvalOwnerName(audience.userId) : "the owner";
  return approvalDelivery({
    audience,
    viewer,
    message: message as { card?: unknown },
    ownerName
  }) as T;

}
  return scopeApprovalMessage;
}
