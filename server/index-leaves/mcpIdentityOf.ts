// @ts-nocheck
/** mcpIdentityOf (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createMcpIdentityOf(getHost: () => Host): any {
function mcpIdentityOf(botId: string, threadId: string) {
  const host = getHost();

  const speakerId = host.safetyPrincipal(threadId).principalId;
  const person = speakerId ? host.principals.byId(speakerId) : undefined;
  return {
    botId, ...(speakerId ? { principalId: speakerId } : {}), perspicaxRole: person?.perspicaxRole, teamIds: (person?.teams ?? []).map((team) => team.id),
    // 2026-10-26: a call to another of the person's own bots or rooms is
    // theirs, not a team call (mcp-permissions.ts scopeForCall)
    ...(speakerId ? host.personOwnScope(speakerId) : {}),
    // 2026-10-28: ask_bot and delegate_bot to a bot shared with them at run
    ...(speakerId ? { runBotIds: host.personRunBots(speakerId) } : {})
  };

}
  return mcpIdentityOf;
}
