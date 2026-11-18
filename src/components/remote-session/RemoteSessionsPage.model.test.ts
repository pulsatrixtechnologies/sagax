import { afterEach, describe, expect, it } from "vitest";

import type { RemoteSessionAdminRow } from "../../../shared/remote-session-admin";
import type { MyDevice } from "@/lib/desktop-bridge";
import { setLocale } from "@/lib/i18n";
import { durationLabel } from "./remote-session-format";
import { groupDevices, machineName, seenLongAgo, STALE_AFTER_MS } from "./MyDevicesList";
import { narrowSessions } from "./RemoteSessionsAdminPage";
import { sortSessions } from "./RemoteSessionsTable";

afterEach(() => setLocale("en"));

const NOW = Date.UTC(2026, 10, 17, 18, 0, 0);
const device = (over: Partial<MyDevice>): MyDevice => ({ key: "k", name: "Pad", kind: "computer", platform: "darwin", online: false, lastSeenAt: NOW, access: "always", current: false, desktopId: "d", ...over });

describe("devices that are the same machine", () => {
  it("matches a computer name without .local and .localdomain", () => {
    expect(machineName("Studio-Mac.local")).toBe("studio-mac");
    expect(machineName("Studio-Mac.localdomain")).toBe("studio-mac");
    expect(machineName("Studio-Mac")).toBe("studio-mac");
  });

  it("makes one row of the two names, this device first, and keeps the other as an alias (nothing is removed)", () => {
    const old = device({ key: "a", name: "Studio-Mac.localdomain", lastSeenAt: NOW - 20 * 86_400_000 });
    const current = device({ key: "b", name: "Studio-Mac.local", online: true, current: true });
    const groups = groupDevices([old, current]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.device.key).toBe("b");
    expect(groups[0]!.aliases.map((alias) => alias.key)).toEqual(["a"]);
  });

  it("never merges phones, nor two different computers", () => {
    const groups = groupDevices([device({ key: "p1", name: "Phone", kind: "phone", access: null }), device({ key: "p2", name: "Phone", kind: "phone", access: null }), device({ key: "c1", name: "A" }), device({ key: "c2", name: "B" })]);
    expect(groups).toHaveLength(4);
  });

  it("dims a device not seen for 14 days, never an online or never-seen one", () => {
    expect(seenLongAgo(false, NOW - STALE_AFTER_MS - 1, NOW)).toBe(true);
    expect(seenLongAgo(false, NOW - STALE_AFTER_MS + 1000, NOW)).toBe(false);
    expect(seenLongAgo(true, NOW - 30 * 86_400_000, NOW)).toBe(false);
    expect(seenLongAgo(false, 0, NOW)).toBe(false);
  });
});

const row = (id: string, over: Partial<RemoteSessionAdminRow>): RemoteSessionAdminRow => ({
  id, code: id.toUpperCase(), host: "box", os: "linux", osKnown: true, startedAt: new Date(NOW).toISOString(), endAt: new Date(NOW + 3_600_000).toISOString(),
  status: "ended", elevated: false, botId: "bot-a", botLabel: "Atlas", reachable: false, unattended: false, ...over,
});

describe("the Sessions tab", () => {
  const rows = [
    row("old", { startedAt: new Date(NOW - 3 * 86_400_000).toISOString(), host: "lab", botId: "bot-b", botLabel: "Nova" }),
    row("live-early", { status: "connected", startedAt: new Date(NOW - 7_200_000).toISOString() }),
    row("recent", { startedAt: new Date(NOW - 3_600_000).toISOString() }),
    row("live-late", { status: "connected", startedAt: new Date(NOW - 600_000).toISOString() }),
  ];

  it("lists live sessions first, then the most recent start", () => {
    expect(sortSessions(rows).map((r) => r.id)).toEqual(["live-late", "live-early", "recent", "old"]);
  });

  it("narrows by active, computer, bot, period and search on the client", () => {
    const base = { query: "", activeOnly: false, host: "", bot: "", period: "any" as const };
    expect(narrowSessions(rows, { ...base, activeOnly: true }, NOW).map((r) => r.id)).toEqual(["live-early", "live-late"]);
    expect(narrowSessions(rows, { ...base, host: "lab" }, NOW).map((r) => r.id)).toEqual(["old"]);
    expect(narrowSessions(rows, { ...base, bot: "bot-b" }, NOW).map((r) => r.id)).toEqual(["old"]);
    expect(narrowSessions(rows, { ...base, period: "today" }, NOW).map((r) => r.id)).not.toContain("old");
    expect(narrowSessions(rows, { ...base, period: "week" }, NOW)).toHaveLength(4);
    expect(narrowSessions(rows, { ...base, query: "nova" }, NOW).map((r) => r.id)).toEqual(["old"]);
  });

  it("says a duration in plain units", () => {
    expect(durationLabel(30_000)).toBe("< 1 min");
    expect(durationLabel(42 * 60_000)).toBe("42 min");
    expect(durationLabel(72 * 60_000)).toBe("1 h 12 min");
    expect(durationLabel(3 * 3_600_000)).toBe("3 h");
    expect(durationLabel(27 * 3_600_000)).toBe("1 d 3 h");
    expect(durationLabel(-5)).toBe("");
  });
});
