import { describe, expect, it } from "vitest";

import {
  CONNECTION_NOTICE_DEBOUNCE_MS,
  connectionNoticeFor,
  GATEWAY_RESTART_MAX_MS,
  readHealth,
  RESTART_QUIET_MS,
  UPDATING_MAX_MS,
  type ConnectionWatch,
} from "./connection-notice";

const base: ConnectionWatch = { connected: false, everConnected: true, disconnectedAt: 10_000, restartAnnouncedAt: null, health: null, perspicax: null, online: true };
const at = (away: number) => 10_000 + away;

describe("connectionNoticeFor (#2013)", () => {
  it("shows nothing for a drop shorter than the debounce, or while the device is offline", () => {
    expect(connectionNoticeFor(base, 12_000)).toBeNull();
    expect(connectionNoticeFor({ ...base, online: false }, 60_000)).toBeNull();
    expect(connectionNoticeFor({ ...base, everConnected: false }, 60_000)).toBeNull();
  });

  it("calls an announced restart or a draining server an update, anything else unreachable", () => {
    expect(connectionNoticeFor({ ...base, restartAnnouncedAt: 9_900 }, at(RESTART_QUIET_MS))).toEqual({ kind: "updating", occurrence: "updating:10000" });
    expect(connectionNoticeFor({ ...base, health: "draining" }, at(RESTART_QUIET_MS))?.kind).toBe("updating");
    expect(connectionNoticeFor({ ...base, health: "down" }, at(CONNECTION_NOTICE_DEBOUNCE_MS))).toEqual({ kind: "server_unreachable", occurrence: "server_unreachable:10000" });
    // an announcement from an earlier restart explains nothing
    expect(connectionNoticeFor({ ...base, restartAnnouncedAt: 10_000 - 120_000 }, at(CONNECTION_NOTICE_DEBOUNCE_MS))?.kind).toBe("server_unreachable");
    // an update that never comes back reads as unreachable
    expect(connectionNoticeFor({ ...base, restartAnnouncedAt: 9_900 }, 10_000 + UPDATING_MAX_MS + 1)?.kind).toBe("server_unreachable");
  });

  it("says Perspicax is unreachable only while the server itself answers", () => {
    const perspicax = { state: "unreachable" as const, since: 20_000 };
    expect(connectionNoticeFor({ ...base, connected: true, disconnectedAt: null, perspicax }, 21_000)).toBeNull();
    expect(connectionNoticeFor({ ...base, connected: true, disconnectedAt: null, perspicax }, 20_000 + CONNECTION_NOTICE_DEBOUNCE_MS)).toEqual({ kind: "perspicax_unreachable", occurrence: "perspicax:20000" });
    expect(connectionNoticeFor({ ...base, perspicax }, at(CONNECTION_NOTICE_DEBOUNCE_MS))?.kind).toBe("server_unreachable");
  });
});

describe("connectionNoticeFor: a server roll stays silent (#4794)", () => {
  it("shows nothing for a few seconds without any answer (a wake from sleep, a network change)", () => {
    expect(connectionNoticeFor({ ...base, health: "down" }, at(5_000))).toBeNull();
    expect(connectionNoticeFor({ ...base, health: "down" }, at(CONNECTION_NOTICE_DEBOUNCE_MS - 1))).toBeNull();
  });

  it("shows nothing for a restart under the quiet window, announced or not", () => {
    // a roll that stops the server's own proxy first: the edge answers 502
    expect(connectionNoticeFor({ ...base, health: "gateway" }, at(25_000))).toBeNull();
    expect(connectionNoticeFor({ ...base, restartAnnouncedAt: 9_900 }, at(25_000))).toBeNull();
    expect(connectionNoticeFor({ ...base, health: "draining" }, at(RESTART_QUIET_MS - 1))).toBeNull();
    // the server answers again while the stream reconnects
    expect(connectionNoticeFor({ ...base, health: "up" }, at(RESTART_QUIET_MS - 1))).toBeNull();
  });

  it("a restart that lasts says the update once, then unreachable when it never comes back", () => {
    expect(connectionNoticeFor({ ...base, health: "gateway" }, at(RESTART_QUIET_MS))).toEqual({ kind: "updating", occurrence: "updating:10000" });
    expect(connectionNoticeFor({ ...base, health: "gateway" }, at(GATEWAY_RESTART_MAX_MS))?.kind).toBe("server_unreachable");
    // a server that answers its health but whose stream never comes back
    expect(connectionNoticeFor({ ...base, health: "up" }, at(RESTART_QUIET_MS))?.kind).toBe("server_unreachable");
  });
});

describe("readHealth", () => {
  it("reads the drain and the edge's maintenance marker as an update", async () => {
    expect(await readHealth(new Response(JSON.stringify({ ok: false, shuttingDown: true }), { status: 503 }))).toBe("draining");
    expect(await readHealth(new Response("", { status: 503, headers: { "x-sagax-maintenance": "restart" } }))).toBe("draining");
    expect(await readHealth(new Response("{}", { status: 200 }))).toBe("up");
    expect(await readHealth(new Response("nope", { status: 500 }))).toBe("down");
  });

  it("reads a bare 502, 503 or 504 from the edge as the server restarting behind it (#4794)", async () => {
    expect(await readHealth(new Response("bad gateway", { status: 502 }))).toBe("gateway");
    expect(await readHealth(new Response("", { status: 503 }))).toBe("gateway");
    expect(await readHealth(new Response("", { status: 504 }))).toBe("gateway");
  });
});
