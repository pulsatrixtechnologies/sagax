// @ts-nocheck
/** publicGroupState (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createPublicGroupState(getHost: () => Host): any {
function publicGroupState(record: GroupRecord) {
  const host = getHost();

  // The organization library's part hashes and the person-thread migration
  // marker stay server-side.
  const { installedPackage: _installedPackage, personThreads: _personThreads, archivedAt: _archivedAt, ...group } = record;
  let usage: WireGroup["usage"];
  try { usage = host.groupUsageReader.forThread(group.threadId); } catch { /* accounting must not block chat */ }
  const openHandoffs = host.coordinator.active().filter(n => n.groupId === group.id && !["completed", "failed", "cancelled"].includes(n.status));
  // A task works while a turn runs in it or its hand-offs are still out: its
  // composer locks on this, so another task stays free to talk in.
  const tasks = host.store.groupTasks(record.id).map((task) => {
    const working = host.groupThreadIsWorking(record.id, task.threadId) || openHandoffs.some(n => n.threadId === task.threadId);
    const speaker = host.groupSpeakers.get(task.threadId);
    return {
      ...task,
      working,
      busyBotId: speaker?.botId ?? null
    };
  });
  const currentSpeaker = host.groupSpeakers.get(group.threadId);
  const activeWorking = host.groupThreadIsWorking(record.id, group.threadId);
  // Organization server: who owns the group's settings (null: its admins).
  const owner = host.IDENTITY.kind === "perspicax" && !group.dm ? { ownerId: host.groupOwnerId(group) } : {};
  return {
    ...group, ...owner,
    tasks: record.dm ? undefined : tasks,
    // Always present so a client can tell "back to the group default"
    // apart from a partial patch that did not mention the field.
    turnTimeoutMinutes: record.turnTimeoutMinutes ?? null,
    usage: usage ?? null,
    busyBotId: currentSpeaker?.botId ?? (activeWorking ? record.busyBotId : null),
    // The room works while any of its tasks does, a background goal's too:
    // the sidebar, a call and Stop read this.
    working: host.groupIsWorking(record) || openHandoffs.length > 0,
    memberProfiles: host.groupMemberProfiles(group)
  };

}
  return publicGroupState;
}
