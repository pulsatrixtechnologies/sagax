// @ts-nocheck
/** attachInterimPerson (#1388). Pure move from server/index.ts. */
import { directFromGrants } from "../store.ts";
export type Host = Record<string, any>;

export function createAttachInterimPerson(getHost: () => Host): any {
function attachInterimPerson(from: string, to: string, auth: RequestAuth) {
  const host = getHost();
  const { cleanBotGrants } = host;
  const result = host.rewritePeopleForAttach({ from, to }, {
    bots: host.store.bots.map((bot) => ({
      id: bot.id,
      ...(host.recordedBotOwner(bot) ? { ownerUserId: host.recordedBotOwner(bot) } : {}),
      directGrants: host.botDirectGrants(bot),
      ...(Array.isArray(bot.grants) ? { grants: cleanBotGrants(bot.grants) } : {})
    })),
    groups: host.store.groups.map((group) => ({ id: group.id, humanIds: group.humanIds ?? [] })),
    sections: host.sectionChannels?.list() ?? [],
    routines: (host.routines?.listRoutines() ?? []).map((routine) => ({ id: routine.id, ...(routine.runAs ? { runAs: routine.runAs } : {}) }))
  });
  for (const bot of result.bots) {
    host.store.patchBot(bot.id, {
      ...(bot.ownerUserId ? { ownerUserId: bot.ownerUserId } : {}),
      ...(bot.grants ? { grants: bot.grants, directGrants: directFromGrants(bot.grants) } : bot.directGrants ? { directGrants: bot.directGrants } : {})
    });
  }
  for (const group of result.groups) host.store.patchGroup(group.id, { humanIds: group.humanIds });
  for (const section of result.sections) host.sectionChannels?.setPeople(section.id, section);
  for (const routine of result.routines) host.routines?.setRunAs(routine.id, routine.runAs);
  host.principals.markMerged(from, to);
  const revoked = host.sessions.revokeWhere((session) => session.principalId === from);
  for (const bot of result.bots) {
    const updated = host.store.bot(bot.id);
    if (updated) host.broadcast({ kind: "bot", bot: host.wireBot(updated) });
  }
  host.audienceChanged();
  host.orgAudit({
    category: "org", action: "person.attach_interim", target: { kind: "person", id: to },
    before: { principalId: from }, after: { principalId: to, ...result.counts },
    actor: host.orgAuditActor(auth)
  });
  return { rewritten: result.counts, sessionsRevoked: revoked.length };

}
  return attachInterimPerson;
}
