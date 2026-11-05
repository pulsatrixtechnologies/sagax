/** Process-local, account-scoped memory of provider refusals. Never stores provider text or credentials. */
export interface EngineRefusal {
  engine: string;
  account?: string;
  cause: "credits" | "usage_limit" | "signed_out";
  resetsAt?: number;
  at: number;
}
export const ENGINE_REFUSAL_TTL_MS = 30 * 60_000;
const refusals = new Map<string, EngineRefusal>();
const key = (engine: string, account?: string) => JSON.stringify([engine, account ?? ""]);
export function noteEngineRefusal(refusal: EngineRefusal): void {
  const id = key(refusal.engine, refusal.account);
  if ((refusals.get(id)?.at ?? -Infinity) > refusal.at) return;
  refusals.delete(id);
  refusals.set(id, { ...refusal });
  if (refusals.size > 2_000) refusals.delete(refusals.keys().next().value!);
}
export function activeEngineRefusal(engine: string, account: string | undefined, now: number): EngineRefusal | undefined {
  const id = key(engine, account);
  const refusal = refusals.get(id);
  if (!refusal) return undefined;
  if (refusal.cause !== "signed_out" && now >= (refusal.cause === "usage_limit" && refusal.resetsAt !== undefined ? refusal.resetsAt : refusal.at + ENGINE_REFUSAL_TTL_MS)) {
    refusals.delete(id);
    return undefined;
  }
  return { ...refusal };
}
/** A newer completed turn, or a verified sign-in, releases only this account. */
export function clearEngineRefusal(engine: string, account?: string, at = Date.now(), signedInOnly = false): void {
  const id = key(engine, account);
  const refusal = refusals.get(id);
  if (refusal && at >= refusal.at && (!signedInOnly || refusal.cause === "signed_out")) refusals.delete(id);
}
