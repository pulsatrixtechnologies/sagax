// @ts-nocheck
/** personalHostRefusalCached (#1388). Pure move from server/index.ts. */
import { personalMcpHostRefusal, personalMcpPrivateAllowed } from "../people/person-connections.ts";
export type Host = Record<string, any>;

export function createPersonalHostRefusalCached(getHost: () => Host): any {
async function personalHostRefusalCached(url: string) {
  const host = getHost();

  const seen = host.personalHostChecks.get(url);
  if (seen && Date.now() - seen.at < 5 * 60_000) return seen.refused;
  const refused = Boolean(await personalMcpHostRefusal(url, { allowPrivate: personalMcpPrivateAllowed() }));
  if (host.personalHostChecks.size > 500) host.personalHostChecks.clear();
  host.personalHostChecks.set(url, { at: Date.now(), refused });
  return refused;

}
  return personalHostRefusalCached;
}
