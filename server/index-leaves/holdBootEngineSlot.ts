// @ts-nocheck
/** holdBootEngineSlot (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createHoldBootEngineSlot(getHost: () => Host): any {
async function holdBootEngineSlot(threadId: string, label: string, instance: ProviderInstance) {
  const host = getHost();
  const { turnTrace } = host;

  // A retry on the same thread (a backup engine) keeps the slot it holds.
  const held = host.bootEngineSlots.get(threadId);
  if (held) {
    held.instance = instance;
    return;
  }
  host.watchdog.setWaitingOnComputer(threadId, true);
  try {
    // A container near its memory limit starts no routine engine until
    // usage falls back (server/memory/engine-memory-guard.ts); a person's own
    // turn never waits here.
    if (host.memoryWatch.current() === "critical") console.log(`[memory] routine ${label} waits: memory critical`);
    // A bot that will start its browser also waits for room for it.
    await host.memoryWatch.whenRoom(threadId, host.ROUTINE_MEMORY_WAIT_MS);
    turnTrace(threadId, "memory-guard");
    // During boot the boot gate; after it, the steady routine limit.
    const gate = host.engineStartGate.booting ? host.engineStartGate : host.routineEngineGate;
    const slot = await gate.acquire("turn", label);
    if (slot.gated) host.bootEngineSlots.set(threadId, { slot, instance });
  } finally {
    host.watchdog.setWaitingOnComputer(threadId, false);
  }

}
  return holdBootEngineSlot;
}
