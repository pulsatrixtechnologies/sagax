export type RevocationHint = "refresh_token" | "access_token";

/** Where a revocation goes: the durable queue in production. */
export interface RevocationSink {
  enqueue(token: string, hint: RevocationHint, why: string): void;
}

export type RevokeAttempt =
  | { kind: "done" }
  | { kind: "drop"; why: string }
  | { kind: "rate_limited"; retryAfterMs: number }
  | { kind: "retry"; why: string };
