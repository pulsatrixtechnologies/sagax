// @ts-nocheck
/** teamSetupApplyRefusal (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createTeamSetupApplyRefusal(getHost: () => Host): any {
function teamSetupApplyRefusal(auth: RequestAuth, req: IncomingMessage) {
  const host = getHost();
  const { sectionKey } = host;
  return (request: TeamSetupRequest): Record<string, unknown> | null => {
    if (auth.kind === "loopback") {
      const trusted = host.DESKTOP_MANAGED || Boolean(req.headers.origin) && !host.store.bots.some((bot) => bot.busy || host.activeGroupTurnForBot(bot.id));
      return trusted ? null : { error: host.TEAM_SETUP_DESKTOP_MESSAGE, code: host.TEAM_SETUP_DESKTOP_ONLY };
    }
    if (auth.scopes.includes("admin")) return null;
    if (host.IDENTITY.kind !== "perspicax" || auth.kind !== "session") return { error: host.TEAM_SETUP_DESKTOP_MESSAGE, code: host.TEAM_SETUP_DESKTOP_ONLY };
    const caller = host.approvalCallerUserId(auth).trim().toLowerCase();
    const refusal = host.memberTeamSetupRefusal(request, {
      callerId: caller,
      ownerOf: (botId) => { const bot = host.store.bot(botId); return bot ? host.effectiveBotOwner(bot).trim().toLowerCase() : undefined; },
      sectionOf: (botId) => { const bot = host.store.bot(botId); return bot ? sectionKey(bot.section) : undefined; },
      mayCreateBots: host.botCreationAllowed(auth),
      can: (permission) => host.callerCan(auth, permission),
      // #1098 (isolation): a folder outside the member's own roots
      folderAllowed: (folder) => host.memberFolderRefusal(host.memberFolderPrincipal(auth), folder) === null
    });
    return refusal ? { ...refusal } : null;
  };

}
  return teamSetupApplyRefusal;
}
