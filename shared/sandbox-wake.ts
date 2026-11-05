// The rows a conversation shows while the Kubernetes cluster of the server
// environments starts (server/sandbox/sandbox-k8s-wake.ts). The server writes these
// exact names; the client shows them in the person's language
// (src/lib/activity-runs.ts statusActivity).
export const SANDBOX_WAKE_NOTICE = "notice: The server environment is starting. This can take a few minutes.";
export const SANDBOX_WAKE_TIMEOUT_NOTICE = "notice: The server environment did not start in time. Send the message again in a few minutes.";
