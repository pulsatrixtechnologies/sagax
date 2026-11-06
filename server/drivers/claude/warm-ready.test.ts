import { describe, expect, it, vi } from "vitest";

import { waitClaudePrewarmed } from "./warm-ready.ts";

describe("waitClaudePrewarmed", () => {
  it("returns at once when init already arrived", async () => {
    await expect(waitClaudePrewarmed({ sawInit: true, closing: false } as never)).resolves.toBeUndefined();
  });

  it("returns at once when the warm was aborted", async () => {
    await expect(waitClaudePrewarmed({ sawInit: false, closing: false } as never, AbortSignal.abort())).resolves.toBeUndefined();
  });

  it("resolves when init arrives", async () => {
    vi.useFakeTimers();
    const live = { sawInit: false, closing: false };
    const waiting = waitClaudePrewarmed(live as never, undefined, 5_000);
    await vi.advanceTimersByTimeAsync(30);
    live.sawInit = true;
    await vi.advanceTimersByTimeAsync(30);
    await expect(waiting).resolves.toBeUndefined();
    vi.useRealTimers();
  });

  it("resolves on timeout when init never comes", async () => {
    vi.useFakeTimers();
    const waiting = waitClaudePrewarmed({ sawInit: false, closing: false } as never, undefined, 100);
    await vi.advanceTimersByTimeAsync(150);
    await expect(waiting).resolves.toBeUndefined();
    vi.useRealTimers();
  });
});
