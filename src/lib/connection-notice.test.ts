import { describe, expect, it } from "vitest";

import { connectionNoticeFor, readHealth, UPDATING_MAX_MS, type ConnectionWatch } from "./connection-notice";

const base: ConnectionWatch = { connected: false, everConnected: true, disconnectedAt: 10_000, restartAnnouncedAt: null, health: null, perspicax: null, online: true };

describe("connectionNoticeFor (#2013)", () => {
  it("shows nothing for a drop shorter than the debounce, or while the device is offline", () => {
    expect(connectionNoticeFor(base, 12_000)).toBeNull();
    expect(connectionNoticeFor({ ...base, online: false }, 60_000)).toBeNull();
    expect(connectionNoticeFor({ ...base, everConnected: false }, 60_000)).toBeNull();
  });

  it("calls an announced restart or a draining server an update, anything else unreachable", () => {
    expect(connectionNoticeFor({ ...base, restartAnnouncedAt: 9_900 }, 13_000)).toEqual({ kind: "updating", occurrence: "updating:10000" });
    expect(connectionNoticeFor({ ...base, health: "draining" }, 13_000)?.kind).toBe("updating");
    expect(connectionNoticeFor(base, 13_000)).toEqual({ kind: "server_unreachable", occurrence: "server_unreachable:10000" });
    // an announcement from an earlier restart explains nothing
    expect(connectionNoticeFor({ ...base, restartAnnouncedAt: 10_000 - 120_000 }, 13_000)?.kind).toBe("server_unreachable");
    // an update that never comes back reads as unreachable
    expect(connectionNoticeFor({ ...base, restartAnnouncedAt: 9_900 }, 10_000 + UPDATING_MAX_MS + 1)?.kind).toBe("server_unreachable");
  });

  it("says Perspicax is unreachable only while the server itself answers", () => {
    const perspicax = { state: "unreachable" as const, since: 20_000 };
    expect(connectionNoticeFor({ ...base, connected: true, disconnectedAt: null, perspicax }, 21_000)).toBeNull();
    expect(connectionNoticeFor({ ...base, connected: true, disconnectedAt: null, perspicax }, 23_000)).toEqual({ kind: "perspicax_unreachable", occurrence: "perspicax:20000" });
    expect(connectionNoticeFor({ ...base, perspicax }, 23_000)?.kind).toBe("server_unreachable");
  });
});

describe("readHealth", () => {
  it("reads the drain and the edge's maintenance marker as an update", async () => {
    expect(await readHealth(new Response(JSON.stringify({ ok: false, shuttingDown: true }), { status: 503 }))).toBe("draining");
    expect(await readHealth(new Response("", { status: 503, headers: { "x-sagax-maintenance": "restart" } }))).toBe("draining");
    expect(await readHealth(new Response("bad gateway", { status: 502 }))).toBe("down");
    expect(await readHealth(new Response("{}", { status: 200 }))).toBe("up");
  });
});
