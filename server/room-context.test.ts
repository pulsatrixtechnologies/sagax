import { describe, expect, it } from "vitest";

import { DEFAULT_ROOM_COMPACT_AT, roomCompactTokens, RoomContextTracker } from "./room-context.ts";

describe("room context", () => {
  it("reads roomCompactAt like compactAt and follows autoCompact", () => {
    expect(DEFAULT_ROOM_COMPACT_AT).toBe(0.9);
    expect(roomCompactTokens(200_000, undefined)).toBe(180_000);
    expect(roomCompactTokens(200_000, { roomCompactAt: 0.5 })).toBe(100_000);
    expect(roomCompactTokens(200_000, { roomCompactAt: 50_000 })).toBe(50_000);
    expect(roomCompactTokens(200_000, { autoCompact: false })).toBeNull();
  });

  it("measures each member per room thread, with the model's window when the driver gave none", () => {
    const rooms = new RoomContextTracker();
    rooms.record("room", "scout", { tokens: 0 }, "claude-sonnet-4");
    rooms.record("room", "scout", { tokens: 120_000 }, "claude-sonnet-4");
    rooms.record("room", "pixel", { tokens: 10_000, window: 50_000 }, "anything");
    expect(rooms.forThread("room")).toEqual({
      scout: { tokens: 120_000, window: 200_000 },
      pixel: { tokens: 10_000, window: 50_000 },
    });
    expect(rooms.forThread("other")).toBeUndefined();
  });

  it("starts the next turn fresh at the threshold, once per reading", () => {
    const rooms = new RoomContextTracker();
    rooms.record("room", "scout", { tokens: 179_999, window: 200_000 }, undefined);
    expect(rooms.takeReset("room", "scout", undefined)).toBeNull();
    rooms.record("room", "scout", { tokens: 184_000, window: 200_000 }, undefined);
    expect(rooms.takeReset("room", "scout", { autoCompact: false })).toBeNull();
    expect(rooms.takeReset("room", "scout", undefined)).toEqual({ reason: "threshold", percent: 92 });
    expect(rooms.takeReset("room", "scout", undefined)).toBeNull();
    expect(rooms.forThread("room")).toBeUndefined();
  });

  it("honours Compact now even with automatic compaction off, and keeps it across a later reading", () => {
    const rooms = new RoomContextTracker();
    expect(rooms.request("room", "scout")).toBe(false);
    rooms.record("room", "scout", { tokens: 40_000, window: 200_000 }, undefined);
    expect(rooms.request("room", "scout")).toBe(true);
    expect(rooms.forThread("room")).toEqual({ scout: { tokens: 40_000, window: 200_000, compactRequested: true } });
    rooms.record("room", "scout", { tokens: 60_000, window: 200_000 }, undefined);
    expect(rooms.takeReset("room", "scout", { autoCompact: false })).toEqual({ reason: "requested", percent: 30 });
    expect(rooms.takeReset("room", "pixel", undefined)).toBeNull();
  });
});
