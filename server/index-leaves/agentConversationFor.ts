// @ts-nocheck
/** agentConversationFor (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createAgentConversationFor(getHost: () => Host): any {
function agentConversationFor(target: BotRecord, principalId: string, client: string | undefined, fresh: boolean) {
  const host = getHost();
  const { isAgentConversation, isPrincipalId } = host;

  const person = principalId.trim().toLowerCase();
  const name = agentCallerLabel(client);
  const opener = agentOpenerId(name);
  if (!fresh) {
    const at = (task: TaskRecord) => task.updatedAt ?? task.createdAt;
    const open = host.store.tasks(target.id)
      .filter((task) => isAgentConversation(task) && task.openedBy?.botId === opener && task.ownerPrincipalId === person
        && task.archivedAt === undefined && !task.closedBy && task.confidential !== true && !task.routineRunId)
      .sort((a, b) => at(b) - at(a))[0];
    if (open) return open.threadId;
  }
  const task = host.store.createTask(target.id, undefined, false, undefined, { botId: opener, name, kind: "agent", at: Date.now() }, undefined,
    isPrincipalId(person) ? person : undefined, undefined, false, undefined, false);
  return task?.threadId ?? null;

}
  return agentConversationFor;
}
