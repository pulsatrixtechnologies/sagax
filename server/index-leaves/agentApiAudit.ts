// @ts-nocheck
/** agentApiAudit (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createAgentApiAudit(getHost: () => Host): any {
function agentApiAudit(caller: AgentCaller, entry: AuditEntry) {
  const host = getHost();
  const { DATA_DIR, appendAdminAction } = host;
  const target = entry.agentId ? host.store.bot(entry.agentId) : undefined;
  appendAdminAction(DATA_DIR, {
    category: "client",
    action: `agents.${entry.tool}`,
    ...(entry.agentId ? { target: { kind: "bot", id: entry.agentId, ...(target ? { name: target.name } : {}) } } : {}),
    after: { outcome: entry.outcome, ...(entry.code ? { code: entry.code } : {}), ...(caller.kind === "bot" ? { callerBotId: caller.id, callerBotName: caller.name, speakerPrincipalId: caller.speakerPrincipalId ?? null } : {}), ...entry.detail },
    actor: caller.kind === "person"
      ? { kind: "person", principalId: caller.id, via: caller.via === "console" ? "console" : "perspicax-mcp" }
      : { kind: "worker" }
  });

}
  return agentApiAudit;
}
