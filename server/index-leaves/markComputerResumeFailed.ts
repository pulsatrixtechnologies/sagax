// @ts-nocheck
/** markComputerResumeFailed (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createMarkComputerResumeFailed(getHost: () => Host): any {
function markComputerResumeFailed(entry: ComputerResumeEntry, message: string) {
  const host = getHost();

  const owner = host.connectorThread(entry.botId, entry.threadId);
  if (!owner) return;
  host.store.appendMessage(entry.threadId, {
    role: "bot", kind: "activity",
    ...(owner.group ? { from: { botId: owner.bot.id, name: owner.bot.name, color: owner.bot.color } } : {}),
    tool: { name: `Parked turn could not continue: ${message.slice(0, 160)}`, ok: false }
  });

}
  return markComputerResumeFailed;
}
