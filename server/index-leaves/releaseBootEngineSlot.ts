// @ts-nocheck
/** releaseBootEngineSlot (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createReleaseBootEngineSlot(getHost: () => Host): any {
function releaseBootEngineSlot(threadId: string, closeIdleProcess: boolean) {
  const host = getHost();

  const held = host.bootEngineSlots.get(threadId);
  if (!held) return;
  host.bootEngineSlots.delete(threadId);
  if (closeIdleProcess) {
    // After the driver's own settle bookkeeping: an idle process only.
    setImmediate(() => {
      // closed here: it no longer counts as a warm session (engine memory guard)
      host.idleEngines.forget(threadId);
      try { held.instance.adapter.releaseWarmSession?.(threadId); } catch { /* the slot goes back regardless */ }
      host.perspicaxMcp?.noteEngineCold(threadId);
      held.slot.release();
    });
  } else held.slot.release();

}
  return releaseBootEngineSlot;
}
