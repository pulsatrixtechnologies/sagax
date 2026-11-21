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
  // #5152: on an organization server a room shows through its people: the
  // call's room lists the people its bots are for (who may run them all
  // reaches the call, calendar-call-access.ts), or nobody would see it.
  const people = host.IDENTITY.kind === "perspicax"
    ? [...new Set(call.botIds.flatMap((id) => {
      const bot = host.store.bot(id);
      const owner = bot ? String(host.effectiveBotOwner(bot) ?? "").trim() : "";
      return owner ? [owner] : [];
    }))]
    : [];
  group ??= host.store.createGroup(call.name, call.botIds, false, undefined, {
    bulletin: "",
    defaultResponder: { kind: "everyone" }
  }, people.length ? people : undefined);
  if (call.roomId !== group.id) host.calendarCalls!.linkRoom(call.id, group.id);
  return group;

}
  return ensureCalendarCallRoom;
}
