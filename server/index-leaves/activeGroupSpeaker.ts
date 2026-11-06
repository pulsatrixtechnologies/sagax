// @ts-nocheck
/** activeGroupSpeaker (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createActiveGroupSpeaker(getHost: () => Host): any {
function activeGroupSpeaker(groupId: string): { botId: string; name: string; color: string } | undefined {
  const host = getHost();

  const group = host.store.group(groupId);
  if (!group) return undefined;
  const activeSpeaker = host.groupSpeakers.get(group.threadId);
  if (activeSpeaker) return activeSpeaker;
  const tasks = host.store.groupTasks(groupId);
  for (const task of tasks) {
    const s = host.groupSpeakers.get(task.threadId);
    if (s) return s;
  }
  return undefined;

}
  return activeGroupSpeaker;
}
