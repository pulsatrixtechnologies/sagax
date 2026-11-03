import { describe, expect, it } from "vitest";
import { ReplayBuffer, type ReplayFrame } from "./sse-replay.ts";

const entry = (seq: number, size: number, payload = true): ReplayFrame => {
  const frame = "x".repeat(size);
  return { seq, kind: "bot", frame, clientFrame: frame, payload: payload ? { kind: "bot" } : null };
};

describe("ReplayBuffer (port de OpenMausBot #3127)", () => {
  it("keeps at most the frame count", () => {
    const buffer = new ReplayBuffer(3, 1_000_000);
    for (let seq = 1; seq <= 5; seq++) buffer.push(entry(seq, 10));
    expect([...buffer].map((f) => f.seq)).toEqual([3, 4, 5]);
  });

  it("drops the oldest frames once the retained size is over the cap", () => {
    const buffer = new ReplayBuffer(500, 1_000);
    for (let seq = 1; seq <= 10; seq++) buffer.push(entry(seq, 200));
    // 200 chars of frame + 200 for its payload: two frames fit in 1 000.
    expect([...buffer].map((f) => f.seq)).toEqual([9, 10]);
    expect(buffer.retained).toBeLessThanOrEqual(1_000);
  });

  it("counts a separate member frame, and a frame without payload at its own size", () => {
    const buffer = new ReplayBuffer(500, 10_000);
    buffer.push({ seq: 1, kind: "config", frame: "a".repeat(100), clientFrame: "b".repeat(50), payload: { kind: "config" } });
    buffer.push({ seq: 2, kind: "screen", frame: null, clientFrame: null, payload: null });
    buffer.push(entry(3, 100, false));
    expect(buffer.retained).toBe(100 + 50 + 100 + 0 + 100);
  });

  it("always keeps the newest frame, even when it alone is over the cap", () => {
    const buffer = new ReplayBuffer(500, 100);
    buffer.push(entry(1, 10));
    buffer.push(entry(2, 1_000));
    expect([...buffer].map((f) => f.seq)).toEqual([2]);
  });

  it("covers a resume only when no frame after the cursor was dropped", () => {
    const empty = new ReplayBuffer();
    expect(empty.covers(0, 0)).toBe(true);
    expect(empty.covers(3, 4)).toBe(false);
    const buffer = new ReplayBuffer(2, 1_000_000);
    for (let seq = 1; seq <= 4; seq++) buffer.push(entry(seq, 1));
    expect(buffer.covers(2, 4)).toBe(true);
    expect(buffer.covers(1, 4)).toBe(false);
  });
});
