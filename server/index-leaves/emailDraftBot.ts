// @ts-nocheck
/** emailDraftBot (#1388). Pure move from server/index.ts. */
import { approvalAnswerStatus, approvalAudience } from "../approvals/approval-audience.ts";
export type Host = Record<string, any>;

export function createEmailDraftBot(getHost: () => Host): any {
function emailDraftBot(auth: RequestAuth, threadId: string, botIdHint: unknown): { bot: BotRecord } | { status: number; body: Record<string, unknown> } {
  const host = getHost();
  const { channelViewerId } = host;

  const group = host.store.groupByThread(threadId);
  let bot: BotRecord | undefined;
  if (group) {
    if (group.peopleDm) return { status: 404, body: { error: "no such conversation" } };
    if (host.IDENTITY.kind === "perspicax" && !host.groupPostAllowed(group, channelViewerId(auth))) {
      return { status: 403, body: { error: "you may read this channel, not post in it", code: "read_only" } };
    }
    const botId = typeof botIdHint === "string" ? botIdHint : "";
    if (!group.memberIds.includes(botId)) return { status: 400, body: { error: "botId must name a bot of this group" } };
    bot = host.store.bot(botId) ?? undefined;
  } else {
    const owner = host.store.botByThread(threadId);
    if (!owner) return { status: 404, body: { error: "no such conversation" } };
    try {
      host.routeThreadId(owner, threadId, "thread.post");
    } catch (error) {
      const status = (error as { status?: number }).status ?? 403;
      return { status, body: { error: status === 404 ? "no such conversation" : "you may not post in this conversation" } };
    }
    bot = host.botForThread(owner.id, threadId) ?? owner;
  }
  if (!bot) return { status: 404, body: { error: "no such bot" } };
  const audience = approvalAudience({ ownerUserId: host.approvalOwnerId(bot, threadId), host: host.approvalHostOf(bot) });
  if (!host.cwActionActor(auth) || approvalAnswerStatus({ question: false, audience, callerUserId: host.approvalCallerUserId(auth) }) === 403) {
    return { status: 403, body: { error: "Only the bot owner can send this draft.", code: "email_draft_owner_only" } };
  }
  return { bot };

}
  return emailDraftBot;
}
