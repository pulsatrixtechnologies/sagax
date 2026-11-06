// @ts-nocheck
/** resolveSectionId (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createResolveSectionId(getHost: () => Host): any {
function resolveSectionId(section: string, auth: RequestAuth, bot?: { ownerUserId?: string }) {
  const host = getHost();

  if (!host.sectionChannels) return undefined;
  const owner = bot?.ownerUserId?.trim()
    || (auth.kind === "session" ? auth.session.principalId?.trim() || "" : "")
    || host.localPrincipalId();
  if (!owner) return undefined;
  return host.sectionChannels.ensure(section.trim(), owner).id;

}
  return resolveSectionId;
}
