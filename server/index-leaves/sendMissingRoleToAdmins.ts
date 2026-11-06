// @ts-nocheck
/** sendMissingRoleToAdmins (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createSendMissingRoleToAdmins(getHost: () => Host): any {
function sendMissingRoleToAdmins(input: { actor: string; botId: string; missing: MissingPermission }) {
  const host = getHost();
  const { personDisplayName } = host;

  if (host.IDENTITY.kind !== "perspicax") return 0;
  const from = input.actor.toLowerCase();
  const fromName = personDisplayName(host.principals.byId(from)) || "";
  const botName = host.store.bot(input.botId)?.name ?? "";
  const admins = host.principals.list()
    .filter((person) => person.orgRole === "admin" && person.subject && person.disabledAt === undefined && !person.mergedInto && person.id.toLowerCase() !== from)
    .slice(0, 10);
  let reached = 0;
  for (const admin of admins) {
    const to = admin.id.toLowerCase();
    const text = host.missingRoleMessage(host.languageOfPerson(to), { person: fromName, bot: botName, missing: input.missing });
    const group = host.findPeopleDm(host.store.groups, from, to)
      ?? host.store.createGroup(`${fromName}, ${personDisplayName(admin) || admin.login || ""}`, [], false, undefined, { defaultResponder: { kind: "mentions" } }, [from, to], { peopleDm: true, createdBy: from });
    host.store.appendMessage(group.threadId, { role: "user", kind: "text", text, ...(fromName ? { sender: { name: fromName, id: from } } : {}) });
    host.store.patchGroup(group.id, host.peopleDmThreadUnreadPatch(group, to, true, group.threadId));
    reached += 1;
  }
  return reached;

}
  return sendMissingRoleToAdmins;
}
