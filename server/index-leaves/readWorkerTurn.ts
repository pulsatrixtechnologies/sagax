// @ts-nocheck
/** readWorkerTurn (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createReadWorkerTurn(getHost: () => Host): any {
function readWorkerTurn(input: { deviceId: string; userId: string; messageId: string; botId?: string }): WorkerTurnView | { status: number; error: string } | null {
  const host = getHost();
  const { machineApprovals } = host;

  const queued = host.queuedWorkerTurns.some((item) => item.messageId === input.messageId && item.deviceId === input.deviceId && item.userId === input.userId && (!input.botId || item.botId === input.botId));
  const inflight = (host.inflightWorkerTurns.get(input.deviceId) ?? []).includes(input.messageId);
  if (!queued && !inflight && !host.machineTurnDone.has(input.messageId)) return null;
  const held = host.machineTurnDone.get(input.messageId);
  const remembered = host.machineTurnBots.get(`${input.deviceId}\0${input.messageId}`);
  const bot = host.machineBotFrom(input.botId) ?? host.machineBotFrom(held?.botId) ?? host.machineBotFrom(remembered);
  let threadId = held?.threadId ?? host.locateChannelMessage(input.messageId)?.threadId ?? null;
  if (!threadId && bot) {
    for (const task of host.store.tasks(bot.id)) {
      if (host.store.messagesFor(task.threadId).some((message) => message.id === input.messageId)) {
        threadId = task.threadId;
        break;
      }
    }
  }
  if (!bot || !threadId) return { status: 404, error: "no such turn" };
  if (bot.host?.kind !== "machine" || bot.host.deviceId !== input.deviceId || bot.host.userId !== input.userId) {
    return { status: 403, error: "forbidden" };
  }
  const messages = host.store.messagesFor(threadId);
  const current = messages.find((message) => message.id === input.messageId);
  const prompt = (current?.text ?? host.machinePrompts.get(input.messageId) ?? "").slice(0, 100_000);
  const history = messages.filter((message) => message.kind === "text" && message.text && message.id !== input.messageId).slice(-12).map((message) => ({
    role: message.role === "user" ? "user" as const : "assistant" as const,
    text: message.text!.slice(0, 4_000)
  }));
  const approvals = [...machineApprovals.values()].filter((row) => row.threadId === threadId).map((row) => ({
    requestId: row.requestId,
    tool: row.tool,
    summary: row.summary,
    ...(row.behavior ? { behavior: row.behavior } : {}),
    ...(row.message ? { message: row.message } : {})
  }));
  return {
    messageId: input.messageId,
    botId: bot.id,
    threadId,
    prompt,
    model: bot.modelSelection,
    bot: { id: bot.id, name: bot.name, ...(bot.soul ? { soul: bot.soul.slice(0, 8_000) } : {}) },
    history,
    approvals
  };

}
  return readWorkerTurn;
}
