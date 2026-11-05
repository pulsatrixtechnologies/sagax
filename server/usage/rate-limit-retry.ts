// A connector that answers 429 refused the request before doing anything, so
// asking again is safe (R1). The wait is the server's own Retry-After, never
// longer than MAX_RATE_WAIT_MS; each wait is announced so the person sees
// "retrying in N s" instead of a silent stall, and the last refusal says
// plainly that nothing was sent.

/** Longest single wait; a longer Retry-After is not waited for. */
export const MAX_RATE_WAIT_MS = 30_000;
/** Waits before the call is given up on. */
export const MAX_RATE_RETRIES = 2;
const DEFAULT_RATE_WAIT_MS = 5_000;

/** A Retry-After header (seconds, or an HTTP date) in milliseconds, or undefined. */
export function parseRetryAfter(value: string | null | undefined, now = Date.now()): number | undefined {
  const text = value?.trim();
  if (!text) return undefined;
  if (/^\d+(\.\d+)?$/.test(text)) return Math.min(Math.round(Number(text) * 1000), 24 * 3_600_000);
  const at = Date.parse(text);
  return Number.isNaN(at) ? undefined : Math.min(Math.max(0, at - now), 24 * 3_600_000);
}

/** How long to wait before attempt `attempt` (0 first retry), or null when
 * the call should not be retried. */
export function rateLimitWait(retryAfterMs: number | undefined, attempt: number): number | null {
  if (attempt >= MAX_RATE_RETRIES) return null;
  const wait = retryAfterMs ?? DEFAULT_RATE_WAIT_MS * (attempt + 1);
  return wait > MAX_RATE_WAIT_MS ? null : Math.max(1_000, wait);
}

/** The line shown while waiting. */
export function rateLimitRetryText(server: string, wait: number): string {
  return `${server} is limiting requests: trying again in ${Math.ceil(wait / 1000)} s.`;
}

/** The last answer once retries are spent: nothing was sent, safe to ask again. */
export function rateLimitGaveUpText(server: string, retryAfterMs?: number): string {
  const later = retryAfterMs !== undefined && retryAfterMs > MAX_RATE_WAIT_MS ? ` The service asks to wait about ${Math.ceil(retryAfterMs / 60_000)} min.` : "";
  return `${server} is limiting requests (HTTP 429) and nothing was sent.${later} Try again in a moment.`;
}

export function sleepUnlessAborted(ms: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted) { resolve(false); return; }
    const timer = setTimeout(() => { signal.removeEventListener("abort", stop); resolve(true); }, ms);
    const stop = () => { clearTimeout(timer); resolve(false); };
    signal.addEventListener("abort", stop, { once: true });
  });
}
