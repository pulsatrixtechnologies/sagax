// @ts-nocheck
/** routineScopeFacts (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createRoutineScopeFacts(getHost: () => Host): any {
function routineScopeFacts(value: { botId: string; runAs?: string }) {
  const host = getHost();
  const { isPrincipalId, personAvatarUrl } = host;

  const bot = host.store.bot(value.botId);
  const ownerId = bot ? host.effectiveBotOwner(bot) : "";
  const runAsId = host.effectiveRunAs(value);
  const teamIds = new Set<string>();
  if (host.IDENTITY.kind === "perspicax") {
    for (const principalId of [ownerId, runAsId]) {
      if (principalId) for (const team of host.principalTeams(principalId)) teamIds.add(team.id);
    }
    if (bot) for (const grant of host.botGrants(bot)) if (grant.target.startsWith("team:")) teamIds.add(grant.target.slice("team:".length));
  }
  const owner = ownerId && isPrincipalId(ownerId) ? host.principals.byId(ownerId) : null;
  const ownerAvatarUrl = personAvatarUrl(owner);
  return {
    ownerId,
    ownerName: owner?.name || owner?.login || "",
    ...(ownerAvatarUrl ? { ownerAvatarUrl } : {}),
    ...(runAsId ? { runAsId } : {}),
    teamIds: [...teamIds],
    bot: { id: value.botId, name: bot?.name ?? "" }
  };

}
  return routineScopeFacts;
}
