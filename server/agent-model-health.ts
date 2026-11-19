// Live health of each model list_agent_models offers, so a caller never picks
// a dead one. Additive: it reads what Sagax already tracks (the engine's
// sign-in snapshot, the account-scoped refusals of engine-refusals.ts, the
// usage-window clock and the per-payer limit holds); it probes nothing.
import type { EngineRefusal } from "./engines/engine-refusals.ts";
import { isPiLocalModel } from "./models/pi-local-model.ts";
import { isComputerModel } from "../shared/model-provider.ts";

export interface ModelHealth {
  /** The account or engine behind the model is signed in (a local model needs none). */
  signed_in: boolean;
  /** The usage limit refuses it now; `resets_at` (ISO) is when it reopens, when known. */
  limit_reached: boolean;
  resets_at?: string;
  /** A 402 or quota refusal says the credits are used up. */
  out_of_credits: boolean;
  kind: "local" | "cloud";
}

export interface HealthInstance {
  instanceId: string;
  driverKind?: string;
  snapshot?: { state?: string; authenticated?: boolean };
}

/** What the server knows about one engine for the person asking. */
export interface HealthSources {
  /** Refusals in force for this engine on the accounts that pay this person's turns. */
  refusals: readonly EngineRefusal[];
  /** The usage clock or a limit hold says the engine refuses work; resetsAt null when unsaid. */
  limit: { resetsAt: number | null } | null;
}

/** Whether a refusal's account is one this person's turns run on: the
 * organization's own accounts, or their own when they pay (account is
 * JSON [via, principal, slot], server/index.ts refusalAccount). */
export function refusalIsTheirs(account: string | undefined, principalId: string, paidByPerson: boolean): boolean {
  if (account === undefined) return true;
  let principal: unknown;
  try { principal = (JSON.parse(account) as unknown[])[1]; } catch { return true; }
  if (typeof principal !== "string") return true;
  return paidByPerson ? principal.toLowerCase() === principalId.trim().toLowerCase() : principal === "organization";
}

export function modelHealth(instance: HealthInstance, option: { id: string; local?: boolean }, sources: HealthSources): ModelHealth {
  const local = option.local === true || isComputerModel({ id: option.id, ...(option.local !== undefined ? { local: option.local } : {}) }) || isPiLocalModel(instance.driverKind, option.id);
  // A model on this computer or a shared one has no account, no usage limit and no credits.
  if (local) return { signed_in: true, limit_reached: false, out_of_credits: false, kind: "local" };
  const signedOut = instance.snapshot?.state === "unavailable" || instance.snapshot?.authenticated === false
    || sources.refusals.some((row) => row.cause === "signed_out");
  const resets = [
    ...(sources.limit?.resetsAt != null ? [sources.limit.resetsAt] : []),
    ...sources.refusals.filter((row) => row.cause === "usage_limit" && row.resetsAt !== undefined).map((row) => row.resetsAt!),
  ].filter((at) => Number.isFinite(at));
  const limited = sources.limit !== null || sources.refusals.some((row) => row.cause === "usage_limit");
  return {
    signed_in: !signedOut,
    limit_reached: limited,
    ...(limited && resets.length ? { resets_at: new Date(Math.max(...resets)).toISOString() } : {}),
    out_of_credits: sources.refusals.some((row) => row.cause === "credits"),
    kind: "cloud",
  };
}
