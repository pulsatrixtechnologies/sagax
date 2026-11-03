import { describe, expect, it } from "vitest";
import { DEFAULT_STALE_SESSION_BYTES, DEFAULT_STALE_SESSION_HOURS, staleSessionReason } from "./stale-session.ts";

const HOUR = 3_600_000;
const now = 1_800_000_000_000;

describe("staleSessionReason", () => {
  it("does not resume a thread quiet for longer than the threshold (default 6 h)", () => {
    expect(DEFAULT_STALE_SESSION_HOURS).toBe(6);
    expect(staleSessionReason({ now, lastActivityAt: now - 6 * HOUR - 1 })).toBe("idle");
    expect(staleSessionReason({ now, lastActivityAt: now - 6 * HOUR })).toBeNull();
    expect(staleSessionReason({ now, lastActivityAt: now - 2 * HOUR, hours: 1 })).toBe("idle");
  });

  it("does not resume a saved session past the size threshold once its cache is cold", () => {
    expect(staleSessionReason({ now, lastActivityAt: now - 61 * 60_000, sessionBytes: DEFAULT_STALE_SESSION_BYTES + 1 })).toBe("size");
    expect(staleSessionReason({ now, lastActivityAt: now - 61 * 60_000, sessionBytes: DEFAULT_STALE_SESSION_BYTES })).toBeNull();
    expect(staleSessionReason({ now, lastActivityAt: now - 2 * HOUR, sessionBytes: 6_400_000, maxBytes: 10_000_000 })).toBeNull();
    // An active task keeps its session however large.
    expect(staleSessionReason({ now, lastActivityAt: now - 20 * 60_000, sessionBytes: 60_000_000 })).toBeNull();
    expect(staleSessionReason({ now, lastActivityAt: now - 20 * 60_000, sessionBytes: 6_400_000, coldMinutes: 10 })).toBe("size");
    // The size is read only once the thread is quiet long enough.
    let reads = 0;
    const bytes = () => { reads++; return 6_400_000; };
    expect(staleSessionReason({ now, lastActivityAt: now - 60_000, sessionBytes: bytes })).toBeNull();
    expect(reads).toBe(0);
    expect(staleSessionReason({ now, lastActivityAt: now - 2 * HOUR, sessionBytes: bytes })).toBe("size");
    expect(reads).toBe(1);
  });

  it("0 turns a check off; an engine that reports no size is judged on time only", () => {
    expect(staleSessionReason({ now, lastActivityAt: now - 100 * HOUR, hours: 0 })).toBeNull();
    expect(staleSessionReason({ now, lastActivityAt: now - 2 * HOUR, sessionBytes: 9e9, maxBytes: 0 })).toBeNull();
    expect(staleSessionReason({ now, lastActivityAt: now })).toBeNull();
    expect(staleSessionReason({ now })).toBeNull();
    // A broken setting falls back to the default rather than turning the check off.
    expect(staleSessionReason({ now, lastActivityAt: now - 7 * HOUR, hours: Number.NaN })).toBe("idle");
    expect(staleSessionReason({ now, lastActivityAt: now - 7 * HOUR, hours: -1 })).toBe("idle");
  });
});
