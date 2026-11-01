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
    hostname: "PC-A", serial: "SN-A", user: "marie", ownerId: "tech@example.com",
    openedBy: "tech@example.com", botId: "bot-7", reachable: true, ...over,
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
    now: () => NOW,
  });
  return { admin, consent, closeById };
}

describe("remote sessions admin visibility", () => {
  it("an admin sees every session, a non-admin only their own", () => {
    const rows = [input({ id: "aaaaaaaaaaaa", ownerId: "tech@example.com" }), input({ id: "bbbbbbbbbbbb", ownerId: "other@example.com", serial: "SN-B" })];
    const { admin } = make(rows);
    expect(admin.list({ principalId: "x", orgAdmin: true }).map((r) => r.id).sort()).toEqual(["aaaaaaaaaaaa", "bbbbbbbbbbbb"]);
    expect(admin.list({ principalId: "tech@example.com", orgAdmin: false }).map((r) => r.id)).toEqual(["aaaaaaaaaaaa"]);
    expect(admin.canSee({ principalId: "tech@example.com", orgAdmin: false }, "bbbbbbbbbbbb")).toBe(false);
  });

  it("logs and end respect visibility", async () => {
    const rows = [input({ id: "bbbbbbbbbbbb", ownerId: "other@example.com" })];
    const { admin, closeById } = make(rows);
    const viewer = { principalId: "tech@example.com", orgAdmin: false };
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
  it("a person grants for a host of their own, recorded under their principal, and it shows on the row", () => {
    const rows = [input({ ownerId: "alice@example.com", openedBy: "alice@example.com" })];
    const { admin } = make(rows);
    const granted = admin.grantUnattended({ principalId: "alice@example.com", orgAdmin: false }, { hostKey: "SN-A", org: "acme", bannerVisible: false });
    expect(granted && granted !== "forbidden" && granted.hostKey).toBe("sn-a");
    expect(granted && granted !== "forbidden" && granted.installedBy).toBe("alice@example.com");
    const row = admin.list({ principalId: "alice@example.com", orgAdmin: false })[0]!;
    expect(row.unattended).toBe(true);
    expect(row.bannerVisible).toBe(false);
  });

  it("the installer is always the caller, whatever the input says", () => {
    const { admin, consent } = make([]);
    admin.grantUnattended({ principalId: "alice@example.com", orgAdmin: false }, { hostKey: "sn-new", org: "acme", installedBy: "bob@example.com" } as never);
    expect(consent.get("sn-new")?.installedBy).toBe("alice@example.com");
  });

  it("a person cannot grant for a host of another person; an admin can", () => {
    const rows = [input({ id: "bbbbbbbbbbbb", ownerId: "bob@example.com", openedBy: "bob@example.com", serial: "SN-B" })];
    const { admin, consent } = make(rows);
    expect(admin.grantUnattended({ principalId: "alice@example.com", orgAdmin: false }, { hostKey: "sn-b", org: "acme" })).toBe("forbidden");
    expect(consent.get("sn-b")).toBeNull();
    // A live consent another person granted is not overwritten either.
    consent.grant({ hostKey: "sn-c", org: "acme", installedBy: "bob@example.com" });
    expect(admin.grantUnattended({ principalId: "alice@example.com", orgAdmin: false }, { hostKey: "sn-c", org: "acme" })).toBe("forbidden");
    expect(consent.get("sn-c")?.installedBy).toBe("bob@example.com");
    const byAdmin = admin.grantUnattended({ principalId: "admin@example.com", orgAdmin: true }, { hostKey: "sn-b", org: "acme" });
    expect(byAdmin && byAdmin !== "forbidden" && byAdmin.installedBy).toBe("admin@example.com");
  });

  it("refuses a caller with no principal", () => {
    const { admin } = make([]);
    expect(admin.grantUnattended({ principalId: "", orgAdmin: false }, { hostKey: "sn-a", org: "acme" })).toBe("forbidden");
  });

  it("revoke marks consent, ends the live session on that host, and propagates", async () => {
    const rows = [input({ id: "cccccccccccc", serial: "SN-A", state: "connected" })];
    const closeById = vi.fn(async () => true);
    const consent = createUnattendedConsentStore({ dataDir: dir, now: () => NOW });
    consent.grant({ hostKey: "sn-a", org: "acme", installedBy: "admin@example.com" });
    const onRevoke = vi.fn(async () => {});
    const admin = createRemoteSessionsAdmin({ rows: () => rows, botLabel: () => "Atlas", consent, log: () => [], closeById, onRevoke, now: () => NOW });
    // Someone else, not an admin, does not revoke another person's host.
    expect((await admin.revokeUnattended({ principalId: "p", orgAdmin: false }, "sn-a"))).toEqual({ ok: false, error: "forbidden" });
    expect(consent.get("sn-a")?.revokedAt).toBeFalsy();
    const out = await admin.revokeUnattended({ principalId: "p", orgAdmin: true }, "sn-a", "poste remplacé");
    expect(out.ok).toBe(true);
    expect(closeById).toHaveBeenCalledWith("cccccccccccc");
    expect(onRevoke).toHaveBeenCalledWith(expect.objectContaining({ hostKey: "sn-a" }), "p", "poste remplacé");
    expect(consent.get("sn-a")?.revokedAt).toBeTruthy();
    expect((await admin.revokeUnattended({ principalId: "p", orgAdmin: true }, "missing"))).toEqual({ ok: false, error: "not_found" });
  });

  it("the person who recorded the consent revokes it themselves, no admin", async () => {
    const rows = [input({ id: "dddddddddddd", serial: "SN-B", ownerId: "tech@example.org" })];
    const consent = createUnattendedConsentStore({ dataDir: dir, now: () => NOW });
    consent.grant({ hostKey: "sn-b", org: "Exemple", installedBy: "tech@example.org" });
    const onRevoke = vi.fn(async () => {});
    const admin = createRemoteSessionsAdmin({ rows: () => rows, botLabel: () => "Atlas", consent, log: () => [], closeById: vi.fn(async () => true), onRevoke, now: () => NOW });
    const mine = { principalId: "tech@example.org", orgAdmin: false };
    expect(admin.list(mine)[0]?.unattendedMine).toBe(true);
    expect(admin.list({ principalId: "boss@example.org", orgAdmin: true })[0]?.unattendedMine).toBeUndefined();
    const out = await admin.revokeUnattended(mine, "sn-b");
    expect(out.ok).toBe(true);
    expect(onRevoke).toHaveBeenCalledWith(expect.objectContaining({ hostKey: "sn-b" }), "tech@example.org", "");
  });

  it("the person who granted it revokes it, and only their own live session ends", async () => {
    const rows = [
      input({ id: "aaaaaaaaaaaa", serial: "SN-A", state: "connected", ownerId: "alice@example.com", openedBy: "alice@example.com" }),
    ];
    const closeById = vi.fn(async () => true);
    const { admin, consent } = make(rows, closeById);
    expect(admin.grantUnattended({ principalId: "alice@example.com", orgAdmin: false }, { hostKey: "sn-a", org: "acme" })).not.toBe("forbidden");
    // Another person cannot revoke it.
    expect(await admin.revokeUnattended({ principalId: "bob@example.com", orgAdmin: false }, "sn-a")).toEqual({ ok: false, error: "forbidden" });
    expect(consent.get("sn-a")?.revokedAt).toBeFalsy();
    // A session of another person opened on that host later is not hers to end.
    rows.push(input({ id: "bbbbbbbbbbbb", serial: "SN-A", state: "connected", ownerId: "bob@example.com", openedBy: "bob@example.com" }));
    const out = await admin.revokeUnattended({ principalId: "Alice@Example.com", orgAdmin: false }, "sn-a");
    expect(out.ok).toBe(true);
    expect(consent.get("sn-a")?.revokedAt).toBeTruthy();
    expect(closeById).toHaveBeenCalledWith("aaaaaaaaaaaa");
    expect(closeById).not.toHaveBeenCalledWith("bbbbbbbbbbbb");
  });

  it("always allows grant; revoke still audits the actor (M4)", async () => {
    const consent = createUnattendedConsentStore({ dataDir: dir, now: () => NOW });
    const admin = createRemoteSessionsAdmin({ rows: () => [input()], botLabel: () => "Atlas", consent, log: () => [], closeById: vi.fn(async () => true), now: () => NOW });
    expect(admin.grantUnattended({ principalId: "p", orgAdmin: true }, { hostKey: "sn-a", org: "acme" })).toMatchObject({ hostKey: "sn-a", installedBy: "p" });
    expect(consent.get("sn-a")?.installedBy).toBe("p");
    const onRevoke = vi.fn(async () => {});
    const withAudit = createRemoteSessionsAdmin({ rows: () => [input()], botLabel: () => "Atlas", consent, log: () => [], closeById: vi.fn(async () => true), onRevoke, now: () => NOW });
    const out = await withAudit.revokeUnattended({ principalId: "boss@gox", orgAdmin: true }, "sn-a");
    expect(out.ok).toBe(true);
    expect(consent.get("sn-a")?.revokedAt).toBeTruthy();
    expect(onRevoke).toHaveBeenCalledWith(expect.objectContaining({ hostKey: "sn-a", installedBy: "p" }), "boss@gox", "");
  });
});
