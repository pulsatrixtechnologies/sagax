// @ts-nocheck
/** visibleTo (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createVisibleTo(getHost: () => Host): any {
function visibleTo(viewer: Viewer) {
  const host = getHost();
  const { VisibleSet } = host;

  const key = viewer.kind === "all" ? "*" : viewer.kind === "none" ? "none" : `member:${viewer.email?.trim().toLowerCase() ?? ""}:${viewer.personId ?? ""}`;
  let set = host.visibleSets.get(key);
  if (!set) {
    set = new VisibleSet(host.store.bots, host.store.groups, viewer, host.threadOwner);
    if (host.visibleSets.size >= 1_000) host.visibleSets.clear();
    host.visibleSets.set(key, set);
  }
  return set;

}
  return visibleTo;
}
