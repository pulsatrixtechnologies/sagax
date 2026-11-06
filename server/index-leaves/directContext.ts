// @ts-nocheck
/** directContext (#1388). Pure move from server/index.ts. */
import { webhookPostText } from "../peers/peer-provenance.ts";
import { digestPromptLine } from "../digest.ts";
export type Host = Record<string, any>;

export function createDirectContext(getHost: () => Host): any {
function directContext(bot: BotRecord, threadId: string, messages: Message[]) {
  const host = getHost();
  const { isContextMessage, peerLineText } = host;

  const messagesById = new Map(host.store.messagesFor(threadId).map(message => [message.id, message]));
  return messages.filter(isContextMessage).map(m => ({
    id: m.id, role: m.role === "user" ? "user" : "assistant",
    text: m.kind === "compaction" ? ""
      : m.roomRequest?.phase === "result" ? host.teammateReportContext(m.roomRequest.id, bot.id)
        : m.kind === "digest" && m.digest ? digestPromptLine(m.digest, m.from?.name ?? bot.name)
          : m.peerAsk ? peerLineText(m.peerAsk.name, m.text ?? "", "delivered")
            : m.webhookPost && m.role !== "user" ? webhookPostText(bot.name, host.transcriptText(m, messagesById, host.cfg.profile?.name?.trim() || "User"))
            : m.role !== "user" && m.from ? host.peerReplayText(m, m.from.name, host.transcriptText(m, messagesById, host.cfg.profile?.name?.trim() || "User"))
              : host.transcriptText(m, messagesById, host.cfg.profile?.name?.trim() || "User"),
    keep: m.roomRequest?.phase === "result" || Boolean(m.peerAsk) || (m.role !== "user" && (Boolean(m.from) || m.webhookPost === true)),
    ...(m.steered ? { steered: true } : {}),
    ...(m.role === "user" && m.voiceCall ? { spoken: true } : {})
  }));

}
  return directContext;
}
