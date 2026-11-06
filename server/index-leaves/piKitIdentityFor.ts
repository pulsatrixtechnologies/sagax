// @ts-nocheck
/** piKitIdentityFor (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createPiKitIdentityFor(getHost: () => Host): any {
function piKitIdentityFor(principalId: string | null) {
  const host = getHost();
  const { isPrincipalId, personDisplayName } = host;

  const person = principalId && isPrincipalId(principalId) ? principalId : null;
  const name = person ? personDisplayName(host.principals.byId(person)) : host.cfg.profile?.name?.trim();
  const timeZone = (person ? host.botSettings.person(person).timeZone : null) || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const code = host.languageOfPerson(person);
  let language = "";
  try {
    language = new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? "";
  } catch {
    /* an unknown tag leaves the line out */
  }
  const identity: PiKitIdentity = {};
  if (name) identity.USER_NAME = name;
  if (timeZone) identity.TIMEZONE = timeZone;
  if (language) identity.LANG_NAME = language;
  const org = process.env.SAGAX_ORG_NAME?.trim();
  if (org) identity.USER_ORG = org;
  const member = process.env.SAGAX_PI_CW_MEMBER?.trim();
  if (member && host.IDENTITY.kind !== "perspicax") identity.CW_MEMBER = member;
  const parallel = process.env.SAGAX_PI_MAX_PARALLEL?.trim();
  if (parallel && /^[1-9][0-9]{0,2}$/.test(parallel)) identity.MAX_PARALLEL = parallel;
  return identity;

}
  return piKitIdentityFor;
}
