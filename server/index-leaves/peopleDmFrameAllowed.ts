// @ts-nocheck
/** peopleDmFrameAllowed (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createPeopleDmFrameAllowed(getHost: () => Host): any {
function peopleDmFrameAllowed(payload: Record<string, unknown>, viewerId: string | undefined) {
  const host = getHost();

  // A person-to-person notice also carries its recipient as `audience`
  // (scopeChannelApproval keeps it to them).
  const note = payload.kind === "notify" && payload.notification && typeof payload.notification === "object"
    ? payload.notification as { threadId?: unknown }
    : null;
  const groupField = payload.group && typeof payload.group === "object" ? (payload.group as { id?: unknown }).id : undefined;
  const groupId = typeof payload.groupId === "string" ? payload.groupId : typeof groupField === "string" ? groupField : undefined;
  const event = payload.event && typeof payload.event === "object" ? (payload.event as { threadId?: unknown }).threadId : undefined;
  const threadId = typeof payload.threadId === "string" ? payload.threadId : typeof event === "string" ? event : typeof note?.threadId === "string" ? note.threadId : undefined;
  const group = (groupId ? host.store.group(groupId) : undefined) ?? (threadId ? host.store.groupByThread(threadId) : undefined);
  if (!group?.peopleDm) {
    // A frame that carries the record itself (a group just created) is
    // judged by what it carries.
    const carried = payload.group && typeof payload.group === "object" ? payload.group as { peopleDm?: unknown; humanIds?: unknown } : null;
    if (carried?.peopleDm === true) return host.isPeopleDmParticipant({ peopleDm: true, humanIds: Array.isArray(carried.humanIds) ? carried.humanIds.filter((id): id is string => typeof id === "string") : [] }, viewerId);
    return true;
  }
  return host.isPeopleDmParticipant(group, viewerId);

}
  return peopleDmFrameAllowed;
}
