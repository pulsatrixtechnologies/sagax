// @ts-nocheck
/** notifyRoomMentions (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createNotifyRoomMentions(getHost: () => Host): any {
function notifyRoomMentions(groupId: string, threadId: string, text: string, auth: RequestAuth) {
  const host = getHost();
  const { personAvatarUrl, personDisplayName } = host;

  const room = host.store.group(groupId);
  const from = host.groupReaderId(auth);
  if (!room || room.peopleDm || room.dm || !from || !(room.humanIds ?? []).length) return;
  // The operator at this computer has no session: their profile name.
  const name = host.messageSender(auth)?.name || (auth.kind !== "session" ? host.cfg.profile?.name?.trim() : "") || personDisplayName(host.principals.byId(from));
  if (!name) return;
  const people = (room.humanIds ?? []).map((id) => {
    const person = host.principals.byId(id);
    return { id, names: [personDisplayName(person), person?.name ?? "", person?.login ?? ""] };
  });
  const avatarUrl = personAvatarUrl(host.principals.byId(from));
  const notification = host.roomMentionNotification({ room, threadId, text, sender: { principalId: from, name, ...(avatarUrl ? { avatarUrl } : {}) }, people, everyone: room.memberIds.length === 0 });
  if (!notification?.audience?.length) return;
  const unreadFor = [...new Set([...(room.unreadFor ?? []), ...notification.audience])].sort();
  const updated = host.store.patchGroup(room.id, { unreadFor });
  if (updated) host.broadcast({ kind: "group", group: host.publicGroupState(updated) });
  host.broadcast({ kind: "notify", notification });

}
  return notifyRoomMentions;
}
