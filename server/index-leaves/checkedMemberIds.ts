// @ts-nocheck
/** checkedMemberIds (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createCheckedMemberIds(getHost: () => Host): any {
function checkedMemberIds(value: unknown, people = 0): { ok: true; memberIds: string[] } | { ok: false; error: string } {
  const host = getHost();

  if (!Array.isArray(value)) return { ok: false, error: "memberIds must be a list of bot IDs" };
  const invalidIndex = value.findIndex(
    (id) => typeof id !== "string" || !id.trim() || !host.store.bot(id),
  );
  if (invalidIndex !== -1) {
    return { ok: false, error: `unknown channel member: ${String(value[invalidIndex])}` };
  }
  const memberIds = [...new Set(value as string[])];
  if (!memberIds.length) {
    if (people >= 2) return { ok: true, memberIds };
    return { ok: false, error: "a channel needs at least one bot" };
  }
  // A room whose every member is archived accepts messages and answers none of
  // them — the failure only surfaces later, as "… is archived and can't
  // respond" on the first turn. Refuse it here, where the mistake is made.
  if (memberIds.every((id) => host.store.bot(id)?.hidden)) {
    return {
      ok: false,
      error: "a channel needs at least one active bot — every member given is archived"
    };
  }
  return { ok: true, memberIds };

}
  return checkedMemberIds;
}
