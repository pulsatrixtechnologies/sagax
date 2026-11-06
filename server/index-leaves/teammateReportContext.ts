// @ts-nocheck
/** teammateReportContext (#1388). Pure move from server/index.ts. */
import { escapeNotes, reportNote } from "../peers/peer-provenance.ts";
export type Host = Record<string, any>;

export function createTeammateReportContext(getHost: () => Host): any {
function teammateReportContext(requestId: string, readerBotId?: string) {
  const host = getHost();

  const node = host.coordinator.node(requestId);
  const parent = node?.parentId ? host.coordinator.node(node.parentId) : undefined;
  const reader = parent && readerBotId ? { ...parent, botId: readerBotId } : parent;
  if (!node || !reader || host.roomHandoffProblem(node, reader)) return "[Teammate result withheld or no longer retained]";
  const bot = host.store.bot(node.botId)?.name;
  return `${reportNote(bot ?? "Teammate")}\n${JSON.stringify({ bot, task: escapeNotes(node.text), status: node.status, result: escapeNotes(node.result) })}`;

}
  return teammateReportContext;
}
