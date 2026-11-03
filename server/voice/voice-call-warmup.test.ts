import { describe, expect, it } from "vitest";

import { VoiceCallWarmup } from "./voice-call-warmup.ts";

describe("VoiceCallWarmup", () => {
  it("starts a warm when the call starts", async () => {
    const warm = new VoiceCallWarmup();
    let ran = 0;
    warm.begin("t1", "call-0123456789", async () => { ran += 1; });
    await warm.join("t1");
    expect(ran).toBe(1);
  });

  it("does not start a second warm for the same call", async () => {
    const warm = new VoiceCallWarmup();
    let ran = 0;
    warm.begin("t1", "call-0123456789", async () => { ran += 1; });
    warm.begin("t1", "call-0123456789", async () => { ran += 1; });
    await warm.join("t1");
    // a keepalive after the warm has finished
    warm.begin("t1", "call-0123456789", async () => { ran += 1; });
    await warm.join("t1");
    expect(ran).toBe(1);
  });

  it("joins immediately when the thread has no warm", async () => {
    const warm = new VoiceCallWarmup();
    await expect(warm.join("missing")).resolves.toBeUndefined();
  });

  it("waits for the warm before join resolves", async () => {
    const warm = new VoiceCallWarmup();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let finished = false;
    warm.begin("t1", "call-0123456789", async () => { await gate; });
    const pending = warm.join("t1").then(() => { finished = true; });
    await Promise.resolve();
    expect(finished).toBe(false);
    release();
    await pending;
    expect(finished).toBe(true);
  });

  it("cancels the warm and still lets join wait until the run finishes", async () => {
    const warm = new VoiceCallWarmup();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let signal!: AbortSignal;
    warm.begin("t1", "call-0123456789", async (next) => {
      signal = next;
      await gate;
    });
    await Promise.resolve();
    expect(warm.cancel("t1", "call-other-123")).toBe(false);
    expect(signal.aborted).toBe(false);
    expect(warm.cancel("t1", "call-0123456789")).toBe(true);
    expect(signal.aborted).toBe(true);
    let finished = false;
    const pending = warm.join("t1").then(() => { finished = true; });
    await Promise.resolve();
    expect(finished).toBe(false);
    release();
    await pending;
    expect(finished).toBe(true);
  });

  it("warms again after that call has ended", async () => {
    const warm = new VoiceCallWarmup();
    let ran = 0;
    warm.begin("t1", "call-0123456789", async () => { ran += 1; });
    await warm.join("t1");
    expect(warm.cancel("t1", "call-0123456789")).toBe(true);
    warm.begin("t1", "call-0123456789", async () => { ran += 1; });
    await warm.join("t1");
    expect(ran).toBe(2);
  });

  it("replaces a call only after the previous warm finishes", async () => {
    const warm = new VoiceCallWarmup();
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let firstSignal!: AbortSignal;
    let secondStarted = false;
    warm.begin("t1", "call-aaaaaaaa", async (signal) => {
      firstSignal = signal;
      await firstGate;
    });
    await Promise.resolve();
    expect(firstSignal.aborted).toBe(false);
    warm.begin("t1", "call-bbbbbbbb", async () => { secondStarted = true; });
    await Promise.resolve();
    expect(firstSignal.aborted).toBe(true);
    expect(secondStarted).toBe(false);
    // The replacement is the job join waits on, and cancel still finds it.
    expect(warm.cancel("t1", "call-bbbbbbbb")).toBe(true);
    releaseFirst();
    await warm.join("t1");
    expect(secondStarted).toBe(false);
  });

  it("runs the replacement when the new call is not cancelled", async () => {
    const warm = new VoiceCallWarmup();
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let secondStarted = false;
    warm.begin("t1", "call-aaaaaaaa", async () => { await firstGate; });
    await Promise.resolve();
    warm.begin("t1", "call-bbbbbbbb", async () => { secondStarted = true; });
    await Promise.resolve();
    expect(secondStarted).toBe(false);
    releaseFirst();
    await warm.join("t1");
    expect(secondStarted).toBe(true);
  });
});
