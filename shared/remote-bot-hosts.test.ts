import { describe, expect, it } from "vitest";

import {
  attachRemoteHost,
  botHasRemoteHost,
  cleanRemoteHosts,
  detachRemoteHost,
  hostPlaceKey,
  parseHostPlaceKey,
  remoteHostLabel,
  remoteHostPlaces,
  sessionForHost,
  temporaryRemoteSessions,
} from "./remote-bot-hosts.ts";
import type { UnattendedHostRow } from "./remote-unattended-host.ts";

const HOST = `h_${"ab".repeat(16)}`;
const OTHER = `h_${"cd".repeat(16)}`;
const THIRD = `h_${"ef".repeat(16)}`;

const row = (over: Partial<UnattendedHostRow> = {}): UnattendedHostRow => ({
  hostId: HOST,
  hostname: "PC-A",
  org: null,
  scope: "full-control",
  installedBy: null,
  enrolledAt: "2026-10-01T00:00:00.000Z",
  expiresAt: "2026-12-30T00:00:00.000Z",
  lastSeenAt: null,
  revokedAt: null,
  state: "enrolled",
  ...over,
});

describe("remote bot hosts", () => {
  it("cleans and dedupes host ids", () => {
    expect(cleanRemoteHosts([HOST, HOST.toUpperCase(), "nope", OTHER, 12])).toEqual([HOST, OTHER]);
    expect(cleanRemoteHosts(null)).toEqual([]);
  });

  it("attaches and detaches", () => {
    expect(attachRemoteHost([], HOST)).toEqual([HOST]);
    expect(attachRemoteHost([HOST], HOST)).toEqual([HOST]);
    expect(attachRemoteHost([], "PC-01")).toBeNull();
    expect(detachRemoteHost([HOST, OTHER], HOST)).toEqual([OTHER]);
    expect(botHasRemoteHost({ remoteHosts: [HOST] }, HOST)).toBe(true);
    expect(botHasRemoteHost({ remoteHosts: [HOST] }, OTHER)).toBe(false);
  });

  it("builds place keys and offers enrolled catalog hosts with attach state", () => {
    expect(hostPlaceKey(HOST)).toBe(`host:${HOST}`);
    expect(parseHostPlaceKey(`host:${HOST}`)).toBe(HOST);
    expect(parseHostPlaceKey("server")).toBeNull();
    expect(remoteHostLabel({ hostname: null }, "Remote")).toBe("Remote");
    expect(remoteHostLabel({ hostname: "  " }, "Remote")).toBe("Remote");
    const places = remoteHostPlaces([HOST], [
      row(),
      row({ hostId: OTHER, hostname: "PC-B" }),
      row({ hostId: THIRD, hostname: "Old", state: "revoked", revokedAt: "2026-10-20T00:00:00.000Z" }),
    ], "Remote");
    expect(places).toEqual([
      { hostId: HOST, label: "PC-A", state: "enrolled", attached: true },
      { hostId: OTHER, label: "PC-B", state: "enrolled", attached: false },
    ]);
  });

  it("matches a connected session by hostname and ignores ended ones", () => {
    expect(sessionForHost(
      [{ state: "ended", hostname: "PC-A" }, { state: "connected", hostname: "PC-A" }],
      { hostname: "PC-A" },
    )).toEqual({ state: "connected", hostname: "PC-A" });
    expect(sessionForHost([{ state: "connected", hostname: "other" }], { hostname: "PC-A" })).toBeUndefined();
    expect(sessionForHost([{ state: "connected", hostname: "PC-A" }], { hostname: null })).toBeUndefined();
  });

  it("keeps temporary attended sessions out of the unattended host places", () => {
    const sessions = [
      { id: "a", state: "connected", hostname: "PC-A" },
      { id: "b", state: "connected", hostname: "Laptop-Guest" },
      { id: "c", state: "ended", hostname: "Laptop-Guest" },
      { id: "d", state: "connected" },
    ];
    expect(temporaryRemoteSessions(sessions, [{ hostname: "PC-A" }]).map((row) => row.id)).toEqual(["b", "d"]);
    expect(temporaryRemoteSessions([], [{ hostname: "PC-A" }])).toEqual([]);
  });
});
