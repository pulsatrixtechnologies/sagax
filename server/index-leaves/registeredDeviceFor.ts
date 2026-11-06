// @ts-nocheck
/** registeredDeviceFor (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createRegisteredDeviceFor(getHost: () => Host): any {
function registeredDeviceFor(input: { sessionId?: string; userId: string }) {
  const host = getHost();

  if (!input.userId) return null;
  const deviceId = input.sessionId
    ? host.sessionDeviceIds.get(input.sessionId) ?? null
    : host.loopbackDeviceIds.get(input.userId) ?? null;
  if (!deviceId) return null;
  const worker = host.registeredWorkers.find((entry) => entry.deviceId === deviceId && entry.userId === input.userId);
  if (!worker) return null;
  const ownerSession = host.deviceOwnerSession.get(deviceId);
  if (input.sessionId) return ownerSession === input.sessionId ? deviceId : null;
  return ownerSession === "" ? deviceId : null;

}
  return registeredDeviceFor;
}
