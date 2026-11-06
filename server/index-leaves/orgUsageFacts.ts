// @ts-nocheck
/** orgUsageFacts (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createOrgUsageFacts(getHost: () => Host): any {
function orgUsageFacts(row: Omit<UsageRow, "at" | "costSource">) {
  const host = getHost();

  if (host.IDENTITY.kind !== "perspicax") return {};
  const bot = host.store.bot(row.botId);
  const ran = host.turnAccessByThread.get(row.threadId);
  const access = row.access ?? ran?.via;
  const payerPrincipalId = row.payerPrincipalId ?? (ran && ran.payer !== "organization" ? ran.payerPrincipalId : undefined);
  let trigger = row.trigger;
  if (trigger.kind === "user" && !trigger.principalId) {
    const speaker = host.turnSpeakerPrincipals.get(row.threadId);
    if (speaker) trigger = { ...trigger, principalId: speaker };
  }
  return {
    trigger,
    ...(row.ownerPrincipalId ? {} : bot ? { ownerPrincipalId: host.effectiveBotOwner(bot) } : {}),
    ...(access ? { access } : {}),
    ...(payerPrincipalId ? { payerPrincipalId } : {})
  };

}
  return orgUsageFacts;
}
