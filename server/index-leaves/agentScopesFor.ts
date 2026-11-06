// @ts-nocheck
/** agentScopesFor (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createAgentScopesFor(getHost: () => Host): any {
function agentScopesFor(person: MemberPerson) {
  const host = getHost();
  const { can } = host;

  const held = person.admin ? { admin: true, permissions: [] } : host.principalPermissions(person.principalId);
  const scopes = new Set<AgentScope>();
  if (can(held, "clients.botsRead")) scopes.add("agents.read");
  if (can(held, "clients.botsMessage")) scopes.add("agents.send");
  if (can(held, "clients.agentsCreate")) scopes.add("agents.create");
  return scopes;

}
  return agentScopesFor;
}
