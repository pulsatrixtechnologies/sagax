import { describe, expect, it } from "vitest";

import { NUDGE_FRESH_MS, badgeCount, createNotificationTargets, messageAttention, nudgeAttention } from "./attention";
import type { AttentionSettings } from "./notification-preferences";

const types = { bots: true, people: true, groups: true, approvals: true };
const on: AttentionSettings = { sound: true, persistent: true, badge: true, nudgeSound: true, nudgeShake: true, ...types };
const off: AttentionSettings = { sound: false, persistent: false, badge: false, nudgeSound: false, nudgeShake: false, bots: false, people: false, groups: false, approvals: false };

describe("a new message", () => {
  const dm = { kind: "message" as const, threadId: "dm-thread" };

  it("is shown with sound, stays, bounces and flashes when the window is in the background", () => {
    expect(messageAttention({ ...dm, windowFocused: false, activeThreadId: "dm-thread", settings: on }))
      .toEqual({ show: true, sound: true, persistent: true, bounce: "critical", flash: true });
  });

  it("is shown when the window is in front but another conversation is open", () => {
    expect(messageAttention({ ...dm, windowFocused: true, activeThreadId: "other", settings: on }).show).toBe(true);
    expect(messageAttention({ ...dm, windowFocused: true, activeThreadId: null, settings: on }).show).toBe(true);
  });

  it("is not shown while the person reads that very conversation in a focused window", () => {
    expect(messageAttention({ ...dm, windowFocused: true, activeThreadId: "dm-thread", settings: on }))
      .toEqual({ show: false, sound: false, persistent: false, bounce: null, flash: false });
  });

  it("a spend notice shows even over its own conversation", () => {
    expect(messageAttention({ kind: "spend", threadId: "t", windowFocused: true, activeThreadId: "t", settings: on }).show).toBe(true);
  });

  it("a bot that finished does not bounce; a bot waiting on an answer bounces once", () => {
    expect(messageAttention({ kind: "done", threadId: "t", windowFocused: false, activeThreadId: null, settings: on }))
      .toMatchObject({ show: true, bounce: null, flash: false });
    expect(messageAttention({ kind: "question", threadId: "t", windowFocused: false, activeThreadId: null, settings: on }))
      .toMatchObject({ show: true, bounce: "informational", flash: true });
  });

  it("follows this computer's sound and persistence switches", () => {
    expect(messageAttention({ ...dm, windowFocused: false, activeThreadId: null, settings: off }))
      .toMatchObject({ show: true, sound: false, persistent: false });
  });
});

describe("a received nudge", () => {
  const now = 1_000_000;

  it("rings and shakes; a notification too when the window is not in front", () => {
    expect(nudgeAttention({ at: now - 500, now, windowFocused: false, settings: on }))
      .toEqual({ fresh: true, sound: true, shake: true, notify: true });
    expect(nudgeAttention({ at: now, now, windowFocused: true, settings: on }).notify).toBe(false);
  });

  it("a stale replay does nothing", () => {
    expect(nudgeAttention({ at: now - NUDGE_FRESH_MS - 1, now, windowFocused: false, settings: on }))
      .toEqual({ fresh: false, sound: false, shake: false, notify: false });
    expect(nudgeAttention({ at: Number.NaN, now, windowFocused: false, settings: on }).fresh).toBe(false);
  });

  it("a clock a little ahead still counts", () => {
    expect(nudgeAttention({ at: now + 30_000, now, windowFocused: false, settings: on }).fresh).toBe(true);
  });

  it("follows the nudge sound and shake switches", () => {
    expect(nudgeAttention({ at: now, now, windowFocused: false, settings: off }))
      .toEqual({ fresh: true, sound: false, shake: false, notify: true });
  });
});

describe("the Dock badge", () => {
  it("is the unread count, or nothing when turned off", () => {
    expect(badgeCount(3, { badge: true })).toBe(3);
    expect(badgeCount(3, { badge: false })).toBe(0);
    expect(badgeCount(-2, { badge: true })).toBe(0);
    expect(badgeCount(Number.NaN, { badge: true })).toBe(0);
  });
});

describe("notification click targets", () => {
  it("each id opens its own target once, and the oldest are forgotten", () => {
    const targets = createNotificationTargets<string>(2);
    const a = targets.add("a");
    const b = targets.add("b");
    const c = targets.add("c");
    expect(targets.take(a)).toBeUndefined();
    expect(targets.take(b)).toBe("b");
    expect(targets.take(b)).toBeUndefined();
    expect(targets.take(c)).toBe("c");
  });
});
