// @ts-nocheck
/** memberDefaultSelection (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createMemberDefaultSelection(getHost: () => Host): any {
async function memberDefaultSelection(principalId: string | null | undefined) {
  const host = getHost();

  const organization = host.cfg.newBotDefaults?.profile.modelSelection ?? null;
  let person: ModelSelection[] = [];
  try {
    if (host.IDENTITY.kind === "perspicax" && principalId) person = starredModelSelections(host.userPreferenceStore.get(principalId).preferences["sagax.modelFavorites.v1"]);
  } catch { /* no preference of their own: the organization's level decides */ }
  if (host.hostedModels) {
    const own = person.find((candidate) => host.hostedModels!.allows(candidate));
    return own ?? host.hostedModels.select(organization ?? host.cfg.defaultModelSelection ?? undefined);
  }
  // #1445: every level is judged on what this person can run (their
  // subscription, their key, the organization's key when it was given to
  // them), never on the server's own sign-in.
  const instances = instancesForPerson(host.selectableInstances<SelectableInstance>(await host.registry.describe()),
    (instance) => host.personRunsEngine(principalId, instance));
  return memberNewBotSelection(instances, { person, organization, server: host.cfg.defaultModelSelection ?? null }, host.selectionContextFor(principalId));

}
  return memberDefaultSelection;
}
