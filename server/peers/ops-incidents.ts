/** #2695: engine and provider noise (rate limits, sign-in, timeouts, a
 * stall) is an ops incident, kept apart from the business incidents that
 * need the Primary Bot's judgment. An ops incident lands as one line in the
 * Primary Bot's "Ops incidents" thread: no chief turn, no push. */
import { problemReason } from "../org/org-problem-log.ts";
import { isEngineReconnectCondition } from "../engines/engine-reconnect-ahead.ts";
import { OPS_INCIDENT_REASONS } from "../../shared/signal-levels.ts";
import { isEngineEmptyFailure, type IncidentKind } from "./incidents.ts";

export function incidentIsOps(kind: IncidentKind, detail: string): boolean {
  if (kind === "routine-failed") return false;
  if (OPS_INCIDENT_REASONS.has(problemReason(kind, detail))) return true;
  return isEngineEmptyFailure(detail) || isEngineReconnectCondition(detail);
}
