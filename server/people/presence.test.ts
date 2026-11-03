import { describe, expect, it } from "vitest";

import { PRESENCE_AWAY_AFTER_MS, PRESENCE_DISCONNECT_GRACE_MS, PRESENCE_OFFLINE_AFTER_MS, type PresenceView } from "../../shared/presence.ts";
import { PresenceTracker } from "./presence.ts";

function tracker() {
  let now = 50_000_000;
  const changes: PresenceView[] = [];
  const presence = new PresenceTracker({ now: () => now, onChange: (view) => changes.push(view) });
  return { presence, changes, advance: (ms: number) => { now += ms; }, now: () => now };
}

const beat = (over: Partial<{ pageId: string; kind: "desktop" | "web"; idleMs: number; systemIdle: "active" | "idle" | "locked" | "unknown" }> = {}) => ({
  pageId: "page-0001", kind: "web" as const, idleMs: 0, systemIdle: "unknown" as const, ...over,
});

describe("PresenceTracker", () => {
  it("a stream makes its person online and reports the change once", () => {
    const { presence, changes } = tracker();
    presence.connect("PR_Alice", "s1");
    presence.connect("pr_alice", "s2");
    expect(presence.view("pr_alice").state).toBe("online");
    expect(changes.map((change) => [change.principalId, change.state])).toEqual([["pr_alice", "online"]]);
  });

  it("heartbeats carry idle time: away past 5 minutes, back online on use", () => {
    const { presence, changes, advance } = tracker();
    presence.connect("pr_bob", "s1");
    expect(presence.heartbeat("pr_bob", "s1", beat({ idleMs: PRESENCE_AWAY_AFTER_MS + 1 })).state).toBe("away");
    expect(presence.heartbeat("pr_bob", "s1", beat({ idleMs: 0 })).state).toBe("online");
    advance(PRESENCE_AWAY_AFTER_MS + 1);
    presence.sweep();
    expect(presence.view("pr_bob").state).toBe("away");
    expect(changes.map((change) => change.state)).toEqual(["online", "away", "online", "away"]);
  });

  it("the desktop's idle or locked screen is away at once", () => {
    const { presence } = tracker();
    presence.connect("pr_bob", "s1");
    expect(presence.heartbeat("pr_bob", "s1", beat({ kind: "desktop", systemIdle: "locked" })).state).toBe("away");
    expect(presence.heartbeat("pr_bob", "s1", beat({ kind: "desktop", systemIdle: "idle" })).state).toBe("away");
    expect(presence.heartbeat("pr_bob", "s1", beat({ kind: "desktop", systemIdle: "active" })).state).toBe("online");
  });

  it("closing the last stream: offline after the grace, with the close as last seen", () => {
    const { presence, changes, advance, now } = tracker();
    const close = presence.connect("pr_cara", "s1");
    presence.heartbeat("pr_cara", "s1", beat());
    advance(1_000);
    const closedAt = now();
    close();
    close(); // twice is once
    presence.sweep();
    expect(presence.view("pr_cara").state).toBe("online");
    advance(PRESENCE_DISCONNECT_GRACE_MS + 1);
    presence.sweep();
    expect(presence.view("pr_cara")).toEqual({ principalId: "pr_cara", state: "offline", lastSeenAt: closedAt });
    expect(changes.at(-1)).toMatchObject({ state: "offline", lastSeenAt: closedAt });
  });

  it("a reconnect inside the grace does not flicker", () => {
    const { presence, changes, advance } = tracker();
    presence.connect("pr_dan", "s1")();
    advance(PRESENCE_DISCONNECT_GRACE_MS - 1);
    presence.connect("pr_dan", "s1");
    advance(PRESENCE_DISCONNECT_GRACE_MS + 1);
    presence.sweep();
    expect(changes.map((change) => change.state)).toEqual(["online"]);
  });

  it("a client that vanished without closing is offline 10 minutes after its last sign", () => {
    const { presence, advance, now } = tracker();
    presence.connect("pr_eve", "s1");
    advance(60_000);
    presence.touch("pr_eve", "s1");
    const last = now();
    advance(PRESENCE_OFFLINE_AFTER_MS);
    presence.sweep();
    expect(presence.view("pr_eve").state).toBe("away");
    advance(1);
    presence.sweep();
    expect(presence.view("pr_eve")).toEqual({ principalId: "pr_eve", state: "offline", lastSeenAt: last });
  });

  it("nobody seen is offline with no time, and no news is sent for them", () => {
    const { presence, changes } = tracker();
    expect(presence.view("pr_zed")).toEqual({ principalId: "pr_zed", state: "offline", lastSeenAt: null });
    presence.sweep();
    expect(changes).toEqual([]);
  });

  it("refresh reports the person again (their visibility changed); forget drops them", () => {
    const { presence, changes } = tracker();
    presence.connect("pr_fay", "s1");
    presence.refresh("pr_fay");
    expect(changes.map((change) => change.state)).toEqual(["online", "online"]);
    presence.forget("pr_fay");
    expect(presence.view("pr_fay")).toEqual({ principalId: "pr_fay", state: "offline", lastSeenAt: null });
  });

  it("keeps at most 16 pages per session", () => {
    const { presence, advance } = tracker();
    for (let index = 0; index < 40; index++) {
      presence.heartbeat("pr_gus", "s1", beat({ pageId: `page-${String(index).padStart(4, "0")}`, idleMs: PRESENCE_AWAY_AFTER_MS + 1 }));
      advance(10);
    }
    // the newest page reports active: still counted
    expect(presence.heartbeat("pr_gus", "s1", beat({ pageId: "page-0039", idleMs: 0 })).state).toBe("online");
  });
});
