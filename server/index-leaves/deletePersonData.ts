// @ts-nocheck
/** deletePersonData (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createDeletePersonData(getHost: () => Host): any {
function deletePersonData(principalId: string): Promise<{ bots: number; threads: number }> {
  const host = getHost();

  const key = principalId.trim().toLowerCase();
  const previous = host.personErasures.get(key);
  const run = (previous ? previous.catch(() => undefined) : Promise.resolve(undefined)).then(() => host.erasePersonDataNow(principalId));
  host.personErasures.set(key, run);
  run.finally(() => { if (host.personErasures.get(key) === run) host.personErasures.delete(key); }).catch(host.reportBackgroundError);
  return run;

}
  return deletePersonData;
}
