// @ts-nocheck
/** perspicaxLinkSubjectToken (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createPerspicaxLinkSubjectToken(getHost: () => Host): any {
async function perspicaxLinkSubjectToken(sub: string) {
  const host = getHost();

  if (host.IDENTITY.kind !== "perspicax") return null;
  const person = host.principals.bySubject(host.IDENTITY.issuer, sub);
  if (!person || person.disabledAt !== undefined) return null;
  if (host.idpSessions) {
    const live = await host.idpSessions.subjectToken({ iss: host.IDENTITY.issuer, sub });
    if (live.ok) return live.token;
  }
  // Directory metadata reads must not start a no-session issuance backoff
  // before this person signs in. Only reuse an existing delegation here.
  if (host.routineConsents?.status(person.id).state === "active") {
    const delegated = await host.routineConsents.subjectToken(person.id);
    if (delegated.ok) return delegated.token;
  }
  return null;

}
  return perspicaxLinkSubjectToken;
}
