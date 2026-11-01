import { describe, expect, it } from "vitest";

import {
  canOpenUnattendedHost,
  canRevokeUnattendedHost,
  hostOwnedByPerson,
  parseUnattendedHostId,
  parseUnattendedHosts,
} from "./remote-unattended-host.ts";

const NOW = Date.parse("2026-10-26T12:00:00.000Z");
const A = `h_${"a1".repeat(16)}`;
const B = `h_${"b2".repeat(16)}`;
const C = `h_${"c3".repeat(16)}`;

const row = (over: Record<string, unknown> = {}) => ({
  host_id: A, hostname: "POSTE-RECEPTION", org: "Clinique du Nord", scope: "full-control",
  created_at: "2026-10-01T10:00:00Z", expires_at: "2026-12-30T10:00:00Z", last_seen_at: "2026-10-26T11:59:50Z", revoked_at: null,
  ...over,
});

describe("enrolled hosts", () => {
  it("parses the contract's host rows and derives the state", () => {
    const hosts = parseUnattendedHosts({ hosts: [
      row({ host_id: B, hostname: "MBP", revoked_at: "2026-10-20T00:00:00Z" }),
      row(),
      row({ host_id: C, hostname: "OLD", expires_at: "2026-10-25T00:00:00Z" }),
    ] }, NOW);
    expect(hosts.map((h) => [h.hostId, h.state])).toEqual([[A, "enrolled"], [C, "expired"], [B, "revoked"]]);
    expect(hosts[0]).toMatchObject({ hostname: "POSTE-RECEPTION", org: "Clinique du Nord", scope: "full-control", lastSeenAt: "2026-10-26T11:59:50.000Z" });
  });

  it("drops rows without a key-derived host id (never a hostname or a serial: E3)", () => {
    const hosts = parseUnattendedHosts([row({ host_id: "PC-01" }), row({ host_id: "h_123" }), row({ expires_at: "nope" }), row(), row()], NOW);
    expect(hosts.map((h) => h.hostId)).toEqual([A]);
    expect(parseUnattendedHostId(` ${A.toUpperCase()} `)).toBe(A);
    expect(parseUnattendedHostId("h_zz")).toBeNull();
  });

  it("never keeps an id as a label: no readable name means null", () => {
    const [host] = parseUnattendedHosts([row({ hostname: A, org: "9f0c6a3e-1b2d-4c5e-8f9a-0b1c2d3e4f5a" })], NOW);
    expect(host!.hostname).toBeNull();
    expect(host!.org).toBeNull();
  });

  it("an unknown scope reads as full-control, the contract default", () => {
    expect(parseUnattendedHosts([row({ scope: "root" })], NOW)[0]!.scope).toBe("full-control");
    expect(parseUnattendedHosts([row({ scope: "view-only" })], NOW)[0]!.scope).toBe("view-only");
  });

  it("opens only an enrolled host; revokes anything not yet revoked", () => {
    expect(canOpenUnattendedHost({ state: "enrolled" })).toBe(true);
    expect(canOpenUnattendedHost({ state: "expired" })).toBe(false);
    expect(canOpenUnattendedHost({ state: "revoked" })).toBe(false);
    expect(canRevokeUnattendedHost({ state: "expired" })).toBe(true);
    expect(canRevokeUnattendedHost({ state: "revoked" })).toBe(false);
  });

  it("parses installed_by and owns only the person's hosts", () => {
    const [host] = parseUnattendedHosts([row({ installed_by: "sub-alice" })], NOW);
    expect(host!.installedBy).toBe("sub-alice");
    expect(hostOwnedByPerson(host!, "sub-alice")).toBe(true);
    expect(hostOwnedByPerson(host!, "sub-bob")).toBe(false);
    // Solo / no subject: every listed host is theirs.
    expect(hostOwnedByPerson(host!, null)).toBe(true);
    // Known subject + missing installed_by: fail closed.
    expect(hostOwnedByPerson({ installedBy: null }, "sub-alice")).toBe(false);
  });
});
