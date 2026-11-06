// @ts-nocheck
/** pagesSeparation (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createPagesSeparation(getHost: () => Host): any {
function pagesSeparation(): { pagesOrigin: URL; appOrigin: URL } | null {
  const host = getHost();

  if (!host.PAGES_ORIGIN) return null;
  try {
    const app = new URL((host.IDENTITY.kind === "perspicax" ? host.IDENTITY.publicOrigin : null) ?? host.publicUrl() ?? "");
    return app.host.toLowerCase() === host.PAGES_ORIGIN.host.toLowerCase() ? null : { pagesOrigin: host.PAGES_ORIGIN, appOrigin: app };
  } catch {
    return null;
  }

}
  return pagesSeparation;
}
