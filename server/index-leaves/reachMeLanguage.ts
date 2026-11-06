// @ts-nocheck
/** reachMeLanguage (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createReachMeLanguage(getHost: () => Host): any {
function reachMeLanguage(person: string) {
  const host = getHost();

  let language = "";
  try {
    if (host.IDENTITY.kind === "perspicax") language = host.userPreferenceStore.get(person).preferences["omb-language"] ?? "";
  } catch { /* the server's language */ }
  if (!language) language = host.cfg.language ?? "fr";
  return language.toLowerCase().startsWith("en") ? "en" : "fr";

}
  return reachMeLanguage;
}
