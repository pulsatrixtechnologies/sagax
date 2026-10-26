// Cancelling a reply that has not left yet (parité chat 47).
// `local`: the optimistic row is up and the POST has not started.
// `inflight`: the request is on the wire. Cancelling then is refused.
// A missing id is treated as already gone: the server may already have it.

type Phase = "local" | "inflight";

const phase = new Map<string, Phase>();
const cancelled = new Set<string>();

export function beginLocalSend(sendId: string): void {
  if (!cancelled.has(sendId)) phase.set(sendId, "local");
}

/** True when this send may still be posted. False when the person cancelled
 * it while it was only local. */
export function claimInFlightSend(sendId: string): boolean {
  if (cancelled.has(sendId)) return false;
  phase.set(sendId, "inflight");
  return true;
}

export function finishSend(sendId: string): void {
  phase.delete(sendId);
  cancelled.delete(sendId);
}

export function cancelLocalSend(sendId: string): "cancelled" | "already-sending" {
  if (phase.get(sendId) !== "local") return "already-sending";
  cancelled.add(sendId);
  phase.delete(sendId);
  return "cancelled";
}

/** Test isolation. */
export function resetSendCancel(): void {
  phase.clear();
  cancelled.clear();
}
