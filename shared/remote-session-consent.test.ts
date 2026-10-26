import { describe, expect, it } from "vitest";

import {
  DEFAULT_UNATTENDED_DAYS,
  MAX_UNATTENDED_DAYS,
  defaultUnattendedExpiry,
  isUnattendedActive,
  normalizeHostKey,
  parseUnattendedConsent,
  renewUnattendedConsent,
  revokeUnattendedConsent,
  unattendedDaysLeft,
} from "./remote-session-consent.ts";

const NOW = Date.parse("2026-10-22T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

describe("normalizeHostKey", () => {
  it("lowercases, trims, and drops control characters", () => {
    expect(normalizeHostKey("  PC-01\tFoo ")).toBe("pc-01 foo");
    expect(normalizeHostKey("")).toBeNull();
    expect(normalizeHostKey(42)).toBeNull();
  });
});

describe("parseUnattendedConsent", () => {
  const base = { hostKey: "SN-123", org: "Acme", installedBy: "admin@acme" };

  it("requires host, org and an installer (never a silent install)", () => {
    expect(parseUnattendedConsent({ ...base, installedBy: "" }, NOW)).toBeNull();
    expect(parseUnattendedConsent({ hostKey: "SN-1", org: "", installedBy: "a" }, NOW)).toBeNull();
    expect(parseUnattendedConsent({ hostKey: "", org: "a", installedBy: "a" }, NOW)).toBeNull();
  });

  it("defaults expiry to 90 days and keeps banner and tray on, unsigned, unbound", () => {
    const consent = parseUnattendedConsent(base, NOW)!;
    expect(consent.hostKey).toBe("sn-123");
    expect(consent.bannerVisible).toBe(true);
    expect(consent.trayVisible).toBe(true);
    expect(consent.signed).toBe(false);
    expect(consent.keyBound).toBe(false);
    expect(Math.round((Date.parse(consent.expiresAt) - NOW) / DAY)).toBe(DEFAULT_UNATTENDED_DAYS);
  });

  it("honors org options to hide the banner and the tray", () => {
    const consent = parseUnattendedConsent({ ...base, bannerVisible: false, trayVisible: false, signed: true, keyBound: true }, NOW)!;
    expect(consent.bannerVisible).toBe(false);
    expect(consent.trayVisible).toBe(false);
    expect(consent.signed).toBe(true);
    expect(consent.keyBound).toBe(true);
  });

  it("refuses an expiry before the install or past the cap", () => {
    expect(parseUnattendedConsent({ ...base, installedAt: "2026-10-22T12:00:00Z", expiresAt: "2026-10-22T11:00:00Z" }, NOW)).toBeNull();
    expect(parseUnattendedConsent({ ...base, expiresAt: new Date(NOW + (MAX_UNATTENDED_DAYS + 5) * DAY).toISOString() }, NOW)).toBeNull();
  });
});

describe("isUnattendedActive / daysLeft", () => {
  it("is active until expiry and never after a revoke", () => {
    const consent = parseUnattendedConsent({ hostKey: "h", org: "o", installedBy: "a", expiresAt: defaultUnattendedExpiry(NOW, 10) }, NOW)!;
    expect(isUnattendedActive(consent, NOW)).toBe(true);
    expect(unattendedDaysLeft(consent, NOW)).toBe(10);
    expect(isUnattendedActive(consent, NOW + 11 * DAY)).toBe(false);
    const revoked = revokeUnattendedConsent(consent, NOW + DAY);
    expect(revoked.revokedAt).toBeTruthy();
    expect(isUnattendedActive(revoked, NOW + DAY)).toBe(false);
    expect(unattendedDaysLeft(revoked, NOW + DAY)).toBe(0);
  });

  it("renew extends a live record but never resurrects a revoked one", () => {
    const consent = parseUnattendedConsent({ hostKey: "h", org: "o", installedBy: "a", expiresAt: defaultUnattendedExpiry(NOW, 2) }, NOW)!;
    const renewed = renewUnattendedConsent(consent, NOW, 30);
    expect(unattendedDaysLeft(renewed, NOW)).toBe(30);
    const revoked = revokeUnattendedConsent(consent, NOW);
    expect(renewUnattendedConsent(revoked, NOW, 30).revokedAt).toBeTruthy();
  });
});
