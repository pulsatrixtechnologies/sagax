import { describe, expect, it } from "vitest";
import { TYPING_CACHE_PRIME_JOIN_MS, warmCachePrime } from "./warm-cache-prime.ts";

describe("warmCachePrime", () => {
  it("primes a call warm with the voice join, a typing warm with the long join, and leaves an open warm alone", () => {
    expect(warmCachePrime(true, false)).toEqual({ cachePrime: true });
    expect(warmCachePrime(true, true)).toEqual({ cachePrime: true });
    // QA 0.8.66: a new conversation paid a cold ~36k-token prefill; the typing
    // prime makes the first turn read it from cache (cached 9856 -> 34944).
    expect(warmCachePrime(false, true)).toEqual({ cachePrime: true, cachePrimeJoinMs: TYPING_CACHE_PRIME_JOIN_MS });
    expect(TYPING_CACHE_PRIME_JOIN_MS).toBeGreaterThanOrEqual(5_000);
    expect(warmCachePrime(false, false)).toEqual({});
  });
});
