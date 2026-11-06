// @ts-nocheck
/** perspicaxAccessToken (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createPerspicaxAccessToken(getHost: () => Host): any {
async function perspicaxAccessToken(principalId: string) {
  const host = getHost();

  if (host.codeFixture) return host.codeFixture.token;
  if (host.IDENTITY.kind !== "perspicax" || !host.idpSessions) return null;
  const person = host.principals.byId(principalId);
  if (!person?.subject || person.subject.iss !== host.IDENTITY.issuer || person.disabledAt !== undefined) return null;
  const outcome = await host.idpSessions.subjectToken({ iss: person.subject.iss, sub: person.subject.sub });
  return outcome.ok ? outcome.token : null;

}
  return perspicaxAccessToken;
}
