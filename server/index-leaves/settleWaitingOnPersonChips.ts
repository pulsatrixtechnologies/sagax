// @ts-nocheck
/** settleWaitingOnPersonChips (#1388). Pure move from server/index.ts. */
import { settledChipLabel } from "../waits/waiting-chip.ts";
export type Host = Record<string, any>;

export function createSettleWaitingOnPersonChips(getHost: () => Host): any {
function settleWaitingOnPersonChips(threadId: string, requestId?: string, resolution?: Parameters<typeof settledChipLabel>[2]) {
  const host = getHost();

  for (const [key, chip] of host.waitingOnPersonChips) {
    if (requestId ? key !== `${threadId}:${requestId}` : !key.startsWith(`${threadId}:`)) continue;
    host.waitingOnPersonChips.delete(key);
    const existing = host.store.messagesFor(chip.threadId).find((message) => message.id === chip.messageId);
    if (!existing?.tool) continue;
    const child = { botId: chip.botId, threadId };
    const name = host.teammateNameFor(child, chip.parent);
    const current = host.store.bot(chip.botId);
    const readable = current && !host.roomHandoffProblem(child, chip.parent);
    host.store.patchMessage(chip.threadId, chip.messageId, {
      // patchMessage replaces these fields: undefined clears the old name,
      // color and private thread link instead of retaining stale metadata.
      from: readable ? { botId: chip.botId, name, color: current.color } : undefined,
      threadRef: readable ? { botId: chip.botId, threadId, title: host.store.taskByThread(chip.botId, threadId)?.title ?? name } : undefined,
      tool: {
        ...existing.tool,
        name: requestId ? host.settledChipLabel(name, chip.kind, resolution) : `@${name} is no longer waiting on your ${chip.kind}`,
        ok: true
      }
    });
  }

}
  return settleWaitingOnPersonChips;
}
