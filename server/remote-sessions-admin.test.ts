import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createRemoteSessionsAdmin } from "./remote-sessions-admin.ts";
import { createUnattendedConsentStore } from "./remote-session-consent-store.ts";
import type { AdminSessionInput } from "../shared/remote-session-admin.ts";

const NOW = Date.parse("2026-10-22T12:00:00.000Z");
let dir: string;
beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), "rsadmin-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

function input(over: Partial<AdminSessionInput> = {}): AdminSessionInput {
  return {
    id: "a1b2c3d4e5f6", code: "ABC234", os: "windows", elevated: false,
    endAt: "2026-10-22T18:00:00Z", state: "connected", createdAt: NOW - 1000,
    hostname: "PC-A", serial: "SN-A", user: "marie", ownerId: "tech@gox",
    openedBy: "tech@gox", botId: "bot-7", reachable: true, ...over,
  };
}

function make(rows: AdminSessionInput[], closeById = vi.fn(async () => true)) {
  const consent = createUnattendedConsentStore({ dataDir: dir, now: () => NOW });
  const admin = createRemoteSessionsAdmin({
    rows: () => rows,
    botLabel: (id) => (id === "bot-7" ? "Atlas" : id),
    consent,
    log: () => [{ at: "2026-10-22T12:00:00Z", kind: "exec", command: "whoami", readOnly: true }],
    closeById,
    unattendedEnabled: () => true,
    now: () => NOW,
  });
  return { admin, consent, closeById };
}

describe("remote sessions admin visibility", () => {
  it("an admin sees every session, a non-admin only their own", () => {
    const rows = [input({ id: "aaaaaaaaaaaa", ownerId: "tech@gox" }), input({ id: "bbbbbbbbbbbb", ownerId: "other@gox", serial: "SN-B" })];
    const { admin } = make(rows);
    expect(admin.list({ principalId: "x", orgAdmin: true }).map((r) => r.id).sort()).toEqual(["aaaaaaaaaaaa", "bbbbbbbbbbbb"]);
    expect(admin.list({ principalId: "tech@gox", orgAdmin: false }).map((r) => r.id)).toEqual(["aaaaaaaaaaaa"]);
    expect(admin.canSee({ principalId: "tech@gox", orgAdmin: false }, "bbbbbbbbbbbb")).toBe(false);
  });

  it("logs and end respect visibility", async () => {
    const rows = [input({ id: "bbbbbbbbbbbb", ownerId: "other@gox" })];
    const { admin, closeById } = make(rows);
    const viewer = { principalId: "tech@gox", orgAdmin: false };
    expect(admin.logs(viewer, "bbbbbbbbbbbb")).toBeNull();
    expect(await admin.end(viewer, "bbbbbbbbbbbb")).toBe("forbidden");
    expect(closeById).not.toHaveBeenCalled();
    const okAdmin = { principalId: "x", orgAdmin: true };
    expect(admin.logs(okAdmin, "bbbbbbbbbbbb")).toHaveLength(1);
    expect(await admin.end(okAdmin, "bbbbbbbbbbbb")).toBe(true);
    expect(closeById).toHaveBeenCalledWith("bbbbbbbbbbbb");
  });
});

describe("unattended grant and revoke", () => {
  it("grant is admin only and shows on the row", () => {
    const rows = [input()];
    const { admin } = make(rows);
    expect(admin.grantUnattended({ principalId: "p", orgAdmin: false }, { hostKey: "sn-a", org: "GOX", installedBy: "p" })).toBe("forbidden");
    const granted = admin.grantUnattended({ principalId: "p", orgAdmin: true }, { hostKey: "sn-a", org: "GOX", installedBy: "admin@gox", bannerVisible: false });
    expect(granted && granted !== "forbidden" && granted !== "disabled" && granted.hostKey).toBe("sn-a");
    const row = admin.list({ principalId: "p", orgAdmin: true })[0]!;
    expect(row.unattended).toBe(true);
    expect(row.bannerVisible).toBe(false);
  });

  it("revoke marks consent, ends the live session on that host, and propagates", async () => {
    const rows = [input({ id: "cccccccccccc", serial: "SN-A", state: "connected" })];
    const closeById = vi.fn(async () => true);
    const consent = createUnattendedConsentStore({ dataDir: dir, now: () => NOW });
    consent.grant({ hostKey: "sn-a", org: "GOX", installedBy: "admin@gox" });
    const onRevoke = vi.fn(async () => {});
    const admin = createRemoteSessionsAdmin({ rows: () => rows, botLabel: () => "Atlas", consent, log: () => [], closeById, onRevoke, unattendedEnabled: () => true, now: () => NOW });
    expect((await admin.revokeUnattended({ principalId: "p", orgAdmin: false }, "sn-a"))).toEqual({ ok: false, error: "forbidden" });
    const out = await admin.revokeUnattended({ principalId: "p", orgAdmin: true }, "sn-a");
    expect(out.ok).toBe(true);
    expect(closeById).toHaveBeenCalledWith("cccccccccccc");
    expect(onRevoke).toHaveBeenCalled();
    expect(consent.get("sn-a")?.revokedAt).toBeTruthy();
    expect((await admin.revokeUnattended({ principalId: "p", orgAdmin: true }, "missing"))).toEqual({ ok: false, error: "not_found" });
  });

  it("is gated off by default: grant and revoke are disabled until the path is wired", async () => {
    const consent = createUnattendedConsentStore({ dataDir: dir, now: () => NOW });
    const admin = createRemoteSessionsAdmin({ rows: () => [input()], botLabel: () => "Atlas", consent, log: () => [], closeById: vi.fn(async () => true), now: () => NOW });
    expect(admin.unattendedEnabled()).toBe(false);
    expect(admin.grantUnattended({ principalId: "p", orgAdmin: true }, { hostKey: "sn-a", org: "GOX", installedBy: "admin@gox" })).toBe("disabled");
    expect(await admin.revokeUnattended({ principalId: "p", orgAdmin: true }, "sn-a")).toEqual({ ok: false, error: "disabled" });
    expect(consent.get("sn-a")).toBeNull();
  });
});
