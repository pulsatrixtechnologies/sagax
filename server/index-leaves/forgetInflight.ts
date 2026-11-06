// @ts-nocheck
/** forgetInflight (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createForgetInflight(getHost: () => Host): any {
function forgetInflight(messageId: string) {
  const host = getHost();

  host.inflightWorkerAuthors.delete(messageId);
  for (const [deviceId, ids] of host.inflightWorkerTurns) {
    const next = ids.filter((id) => id !== messageId);
    if (next.length) host.inflightWorkerTurns.set(deviceId, next);
    else host.inflightWorkerTurns.delete(deviceId);
  }

}
  return forgetInflight;
}
