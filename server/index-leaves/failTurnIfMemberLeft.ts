// @ts-nocheck
/** failTurnIfMemberLeft (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createFailTurnIfMemberLeft(getHost: () => Host): any {
function failTurnIfMemberLeft(group: GroupRecord, beforeHumanIds: string[], beforeMemberIds: string[]) {
  const host = getHost();
  const { store } = host;

  const afterHumanIds = group.humanIds ?? [];
  const afterMemberIds = group.memberIds;
  const humanGone = beforeHumanIds.some((id) => !afterHumanIds.includes(id));
  const botGone = beforeMemberIds.some((id) => !afterMemberIds.includes(id));
  if (!humanGone && !botGone) return;
  const messageIds = host.turnsHeldOnGroup(group);
  if (!messageIds.length && host.groupIsWorking(group)) {
    const user = [...store.messagesFor(group.threadId)].reverse().find((message) => message.role === "user");
    if (user) messageIds.push(user.id);
  }
  const removed = { beforeHumanIds, afterHumanIds, beforeMemberIds, afterMemberIds };
  for (const messageId of messageIds) {
    const located = host.locateChannelMessage(messageId);
    const partial = located ? host.partialAlreadyWritten(located.messages, messageId) : "";
    host.failQueuedMessage(messageId, partial, "The turn failed because a member left the channel.", removed);
  }

}
  return failTurnIfMemberLeft;
}
