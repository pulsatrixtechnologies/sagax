/**
 * Calm handling of a short deploy outage (server restart behind Caddy).
 *
 * While the live stream is down for under DEPLOY_OUTAGE_QUIET_MS, the UI shows
 * "Reconnecting..." and suppresses error toasts for 502/503/connection refused.
 * Live events already resume from the cursor (src/lib/live-events.ts).
 */
import { isTransientFailure } from "./plain-error";

/** Sub-30 s outages stay quiet; past this, ordinary error surfaces may show. */
export const DEPLOY_OUTAGE_QUIET_MS = 30_000;

/** Whether a failure is the kind a deploy restart produces. */
export function isDeployOutageFailure(failure: unknown): boolean {
  if (isTransientFailure(failure)) return true;
  const raw = failure instanceof Error ? failure.message : String(failure ?? "");
  return /\b(?:ECONNREFUSED|ECONNRESET|EPIPE|socket hang up|connection refused)\b/i.test(raw)
    || /\b50[234]\b/.test(raw);
}

/** True when the disconnect is still inside the quiet window. */
export function isDeployOutageQuiet(
  disconnectedAt: number | null | undefined,
  now: number = Date.now(),
  quietMs: number = DEPLOY_OUTAGE_QUIET_MS,
): boolean {
  if (disconnectedAt == null || disconnectedAt <= 0) return false;
  return now - disconnectedAt < quietMs;
}

/**
 * Whether to swallow an error toast during a short reconnect.
 * Requires: we were connected before, we are reconnecting now, failure is
 * transient, and we are still inside the quiet window.
 */
export function shouldSuppressDeployOutageError(input: {
  failure: unknown;
  everConnected: boolean;
  connected: boolean;
  disconnectedAt: number | null | undefined;
  now?: number;
  quietMs?: number;
}): boolean {
  if (!input.everConnected || input.connected) return false;
  if (!isDeployOutageFailure(input.failure)) return false;
  return isDeployOutageQuiet(input.disconnectedAt, input.now, input.quietMs);
}
