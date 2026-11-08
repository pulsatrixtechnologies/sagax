/** #2695: engine and provider noise (rate limits, sign-in, timeouts, a
 * stall) is an ops incident, kept apart from the business incidents that
 * need the Primary Bot's judgment. An ops incident lands as one line in the
 * Primary Bot's "Ops incidents" thread: no chief turn, no push. */
import { problemReason } from "../org/org-problem-log.ts";
import { isEngineReconnectCondition } from "../engines/engine-reconnect-ahead.ts";
import { OPS_INCIDENT_REASONS } from "../../shared/signal-levels.ts";
import { isEngineEmptyFailure, type IncidentKind } from "./incidents.ts";

export function incidentIsOps(kind: IncidentKind, detail: string): boolean {
  const reason = problemReason(kind, detail);
  // #2695: a routine stopped by a provider limit (429, quota) is not a
  // business incident; its run-failed notice is the only notification.
  if (kind === "routine-failed") return isProviderLimitReason(reason);
  if (OPS_INCIDENT_REASONS.has(reason)) return true;
  return isEngineEmptyFailure(detail) || isEngineReconnectCondition(detail);
}

/** #2695: a provider limit (429, quota), not a fault of the routine itself. */
export function isProviderLimitReason(reason: string): boolean {
  return reason === "rate_limited" || reason === "quota";
}

/** True when a run failure only hit a provider limit (429, quota). */
export function runFailureIsProviderLimit(detail: string): boolean {
  return isProviderLimitReason(problemReason("routine-failed", detail));
}
