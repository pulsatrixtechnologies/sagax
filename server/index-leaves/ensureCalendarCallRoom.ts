// @ts-nocheck
/** ensureCalendarCallRoom (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createEnsureCalendarCallRoom(getHost: () => Host): any {
function ensureCalendarCallRoom(call: CalendarCall) {
  const host = getHost();

  const linked = call.roomId ? host.store.group(call.roomId) : undefined;
  let group = linked && host.sameCalendarRoster(linked, call.botIds)
    ? linked
    : undefined;
  // A call's room is a room like any other: one audience.
  const conflict = group ? null : host.roomAudienceConflict(call.botIds);
  if (conflict) throw Object.assign(new Error(conflict), { status: 400 });
  group ??= host.store.createGroup(call.name, call.botIds, false, undefined, {
    bulletin: "",
    defaultResponder: { kind: "everyone" }
  });
  if (call.roomId !== group.id) host.calendarCalls!.linkRoom(call.id, group.id);
  return group;

}
  return ensureCalendarCallRoom;
}
