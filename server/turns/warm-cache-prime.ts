/** Which warms also fill the provider cache with the system prefix.
 *
 * QA 0.8.66: the first turn of a new conversation paid a cold prefill of
 * about 36k tokens (6 to 10 s) because each conversation is a new engine
 * session. A warm sent while the person types (src/lib/prewarm.ts) now
 * primes that cache too, so the turn they send reads it.
 */

/** How long a typed turn waits for a prime still running. A cancelled prime
 * leaves the whole prefill to the turn, so waiting is never slower. */
export const TYPING_CACHE_PRIME_JOIN_MS = 8_000;

export function warmCachePrime(onCall: boolean, typing: boolean): { cachePrime?: true; cachePrimeJoinMs?: number } {
  if (onCall) return { cachePrime: true };
  if (typing) return { cachePrime: true, cachePrimeJoinMs: TYPING_CACHE_PRIME_JOIN_MS };
  return {};
}
