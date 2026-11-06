// @ts-nocheck
/** offerRoomPostToBots (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createOfferRoomPostToBots(getHost: () => Host): any {
function offerRoomPostToBots(room: GroupRecord, poster: BotRecord, text: string, messageId: string, hops: number, onlyBotId?: string) {
  const host = getHost();

  for (const memberId of room.memberIds) {
    if (memberId === poster.id || (onlyBotId !== undefined && memberId !== onlyBotId)) continue;
    const member = host.store.bot(memberId);
    if (!member) continue;
    // a direct conversation of two bots: every post is for the other one
    const mentionsBot = room.dm === true || textNamesBot(text, member.name);
    host.offerProactive({
      botId: member.id, source: "bot", key: `room-post:${messageId}`, fromBotId: poster.id, hops, mentionsBot,
      ...(room.dm === true ? { dm: true } : {}),
      replay: { kind: "room", groupId: room.id, threadId: room.threadId, messageId, posterId: poster.id, hops },
      label: `Post by ${poster.name} in ${room.name}`,
      detail: `Room: ${room.name} (id ${room.id})\nFrom: ${poster.name}\n\n${text}`
    });
  }

}
  return offerRoomPostToBots;
}
