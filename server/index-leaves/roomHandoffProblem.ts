// @ts-nocheck
/** roomHandoffProblem (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createRoomHandoffProblem(getHost: () => Host): any {
function roomHandoffProblem(node: Pick<HandoffView, "groupId" | "threadId" | "botId"> & Partial<Pick<HandoffView, "kind">>, parent?: Pick<HandoffView, "groupId" | "threadId" | "botId">) {
  const host = getHost();
  const { canAccessBot, peerAllowed, peerInScope, sameOwnerBots } = host;

  const group = node.groupId ? host.store.group(node.groupId) : undefined;
  const bot = host.store.bot(node.botId);
  if (!bot || bot.hidden) return "The addressed agent no longer exists";
  if (node.groupId && (!group || group.dm || !host.store.groupTaskByThread(group.id, node.threadId))) return "Destination room task no longer exists";
  if (!node.groupId && !host.store.taskByThread(bot.id, node.threadId)) return "Destination bot task no longer exists";
  // A confidential thread takes no part in teammate work: nothing of it goes
  // to another conversation, nothing of another lands in it
  // (docs/confidential-threads.md).
  if (parent && parent.threadId !== node.threadId && (host.store.isConfidentialThread(node.threadId) || host.store.isConfidentialThread(parent.threadId))) {
    return "A confidential thread takes no part in teammate work";
  }
  if (group && !group.memberIds.includes(bot.id)) return "The addressed agent is no longer a member of this room";
  // Every reader matters, including members not addressed to speak. The
  // recipient must be allowed to read its destination; the sender's grant
  // cannot silently give a specialist access to another team's transcript.
  // #1098 (2026-10-27): a room whose bots are all one person's has no
  // section boundary inside it; the person put their own bots together.
  const outsideSection = (room: GroupRecord, speaker: BotRecord) => !host.oneOwnerRoom(room, speaker) && room.memberIds.some(id => {
    const member = host.store.bot(id);
    return member && !canAccessBot(speaker, member) && !coordinatorSupervises(member, speaker, host.resolveManagedNameFor(member));
  });
  if (group && outsideSection(group, bot)) return "Destination room includes a member outside the agent's section";
  if (parent) {
    const from = host.store.bot(parent.botId);
    const source = parent.groupId ? host.store.group(parent.groupId) : undefined;
    if (!from || from.hidden || (parent.groupId ? !source || !source.memberIds.includes(from.id) || !host.store.groupTaskByThread(source.id, parent.threadId) : !host.store.taskByThread(from.id, parent.threadId))) return "Source membership or task was removed";
    // A specialist may address its supervisor in their shared conversation;
    // supervision alone never grants a direct chat or another room's access.
    const sharedSupervisor = source && group && source.id === group.id && parent.threadId === node.threadId && coordinatorSupervises(bot, from, host.resolveManagedNameFor(bot));
    // Room work between two bots of one person, in rooms that hold only
    // that person's bots, crosses no section boundary (#1098).
    const ownRooms = Boolean(source || group) && sameOwnerBots(from, bot) && (!source || host.oneOwnerRoom(source, from)) && (!group || host.oneOwnerRoom(group, bot));
    if ((!canAccessBot(from, bot) && !sharedSupervisor && !ownRooms) || (source && outsideSection(source, from))) return "Room work cannot cross the sender's section boundary";
    if (source && group && source.id === group.id && parent.threadId !== node.threadId) return "Same-room work must stay in the originating conversation";
    if (!peerAllowed(from, bot)) return "The recipient is not an allowed peer of the sender";
    // A room the sender sits in keeps its own rule: people chose its
    // members. Anywhere else (another bot's direct thread, a room the
    // sender is not in) the organization scope applies, to every reader
    // of the destination (server/peers/peer-scope.ts).
    if (!group?.memberIds.includes(from.id)) {
      const readers = group ? group.memberIds.map(id => host.store.bot(id)).filter((member): member is BotRecord => Boolean(member)) : [bot];
      if (readers.some(member => !peerInScope(from, member))) return "The recipient is outside the sender's owner's bots";
    }
  }

}
  return roomHandoffProblem;
}
