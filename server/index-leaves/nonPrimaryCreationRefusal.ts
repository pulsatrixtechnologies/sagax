// @ts-nocheck
/** nonPrimaryCreationRefusal (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createNonPrimaryCreationRefusal(getHost: () => Host): any {
function nonPrimaryCreationRefusal(bot: BotRecord, threadId: string, body: Record<string, unknown>) {
  const host = getHost();
  const owner = host.effectiveBotOwner(bot);
  const cwd = body.cwd !== undefined;
  return botCreationRefusal({
    temporary: bot.temporary !== undefined,
    depth: botCreationDepth(bot),
    turnOrigin: host.botCreationTurnOrigin(bot, threadId),
    suggestion: body.suggestion === true,
    cwd,
    // what POST /api/bots asks of a member who names a folder
    cwdAllowed: host.IDENTITY.kind !== "perspicax" || host.principalPermissions(owner).permissions.has(BOT_FIELD_PERMISSIONS.cwd!),
    recent: recentBotCreations(host.store.bots, (other) => host.effectiveBotOwner(other as BotRecord) === owner, Date.now())
  });

}
  return nonPrimaryCreationRefusal;
}
