// @ts-nocheck
/** memberForAgentCaller (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createMemberForAgentCaller(getHost: () => Host): any {
function memberForAgentCaller(caller: AgentCaller): MemberPerson {
  const host = getHost();
  return {
    principalId: caller.id,
    sub: caller.sub ?? "",
    name: caller.name,
    admin: caller.admin === true,
    actor: caller.via === "console" ? "console" : "perspicax-mcp",
    ...(caller.client ? { client: caller.client } : {})
  };
}
  return memberForAgentCaller;
}
