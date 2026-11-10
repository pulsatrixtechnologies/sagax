// The rows a conversation shows while the Kubernetes cluster of the server
// environments starts (server/sandbox/sandbox-k8s-wake.ts). The server writes these
// exact names; the client shows them in the person's language
// (src/lib/activity-runs.ts statusActivity).
export const SANDBOX_WAKE_NOTICE = "notice: The server environment is starting. This can take a few minutes.";
export const SANDBOX_WAKE_TIMEOUT_NOTICE = "notice: The server environment did not start in time. Send the message again in a few minutes.";

/** #3296: what a waiting turn waits for: the cluster of the environments
 * (it was asleep), or the person's environment on it (its Pod starting). */
export type SandboxWakeWaitingFor = "cluster" | "environment";

/** #3296: the live state of the SANDBOX_WAKE_NOTICE row (Message.tool.sandboxWake).
 * The server writes it when the wait starts, refreshes `checkedAt` while it
 * goes on, and sets `endedAt` when it ends; the apps draw it in the reader's
 * language, with the time since `since` while it is not ended. */
export interface SandboxWakeLine {
  waitingFor: SandboxWakeWaitingFor;
  /** When the wait started (epoch ms). */
  since: number;
  /** The last check that found it not ready yet (epoch ms). */
  checkedAt?: number;
  /** When the wait ended (epoch ms), and how. */
  endedAt?: number;
  /** "interrupted": the turn ended, was stopped or was cut by a restart
   * before the environment was ready. */
  outcome?: "ready" | "timeout" | "interrupted";
}
