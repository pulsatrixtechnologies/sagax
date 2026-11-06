// @ts-nocheck
/** teamMemoryMemberMayAnswer (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createTeamMemoryMemberMayAnswer(getHost: () => Host): any {
function teamMemoryMemberMayAnswer(threadId: string, card: { teamMemoryRequest?: { section?: unknown }; confidentialMemoryRequest?: unknown } | null | undefined, viewerId: string | undefined, botId?: string) {
  const host = getHost();
  const { teamMemorySharingOf } = host;

  if (!viewerId) return false;
  const bot = botId ? host.store.bot(botId) : host.store.botByThread(threadId);
  return teamMemoryCardReachesMember({
    card,
    sharing: teamMemorySharingOf(bot),
    sharedServer: host.teamMemoryShared(),
    cloudHome: false,
    confidential: host.store.isConfidentialThread(threadId),
    memberOfSection: (section) => host.viewerUsesTeamSection(host.authzViewerFromId(viewerId), section),
    seesCardContext: () => host.memberSeesFrame({ threadId, ...(bot ? { botId: bot.id } : {}) }, viewerId)
  });

}
  return teamMemoryMemberMayAnswer;
}
