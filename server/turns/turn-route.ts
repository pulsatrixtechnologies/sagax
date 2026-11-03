export type BotHost = { kind: "fleet" } | { kind: "machine"; userId: string; deviceId: string };

export function turnDestination(input: {
  host: BotHost;
  workerOnline: boolean;
}): { kind: "fleet" } | { kind: "worker"; deviceId: string } | { kind: "queued" } {
  if (input.host.kind === "fleet") return { kind: "fleet" };
  if (input.workerOnline) return { kind: "worker", deviceId: input.host.deviceId };
  return { kind: "queued" };
}
