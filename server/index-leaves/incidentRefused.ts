// @ts-nocheck
/** incidentRefused (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createIncidentRefused(getHost: () => Host): any {
function incidentRefused(chief: BotRecord, incidentsThreadId: string, asks: ReadonlyArray<Message["peerAsk"]>, why: string) {
  const host = getHost();
  const { deliverableNotification } = host;

  const refused = `the incident could not reach ${chief.name} — ${why}`;
  host.store.appendMessage(incidentsThreadId, { role: "bot", kind: "activity", tool: host.failedTurnTool(refused) });
  const lines = host.store.messagesFor(incidentsThreadId);
  for (const ask of asks) {
    if (!ask?.incident || ask.incident.notified) continue;
    const bot = host.store.bot(ask.botId);
    if (!bot) continue;
    const { threadId } = ask.incident;
    // the report's own chip, appended when it was raised
    const chip = lines.findLast(line => line.kind === "activity" && line.tool?.ok === false && line.threadRef?.threadId === threadId)?.tool?.name;
    const group = host.store.groupByThread(threadId);
    host.notify(deliverableNotification("incident", bot, threadId, chip ?? refused, {
      avatarUrl: bot.avatarUrl,
      ...(group ? { group: { id: group.id, name: group.name } } : {})
    }));
  }

}
  return incidentRefused;
}
