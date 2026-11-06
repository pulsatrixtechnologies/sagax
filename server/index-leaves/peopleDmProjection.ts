// @ts-nocheck
/** peopleDmProjection (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createPeopleDmProjection(getHost: () => Host): any {
function peopleDmProjection(group: GroupRecord, personId: string | undefined, knows: boolean, page?: { limit: number | undefined; viewer: ApprovalViewer }) {
  const host = getHost();
  const { publicGroupState } = host;

  const open = host.peopleDmOpenThread(group, personId, knows);
  const tasks = host.store.groupTasks(group.id);
  const base = {
    ...publicGroupState(group),
    tasks: knows ? tasks : tasks.filter((task) => task.threadId === group.threadId),
    ...(page ? host.messagePage(open, page.limit, null, page.viewer) : {})
  };
  return host.peopleDmForViewer(base, personId, open);

}
  return peopleDmProjection;
}
