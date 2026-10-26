import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createUnattendedConsentStore } from "./remote-session-consent-store.ts";
import { defaultUnattendedExpiry } from "../shared/remote-session-consent.ts";

const NOW = Date.parse("2026-10-22T12:00:00.000Z");
let dir: string;

beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), "consent-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe("unattended consent store", () => {
  it("grants, gets, and refuses a silent install", () => {
    const store = createUnattendedConsentStore({ dataDir: dir, now: () => NOW });
    expect(store.grant({ hostKey: "SN-1", org: "", installedBy: "" })).toBeNull();
    const granted = store.grant({ hostKey: "SN-1", hostLabel: "PC-A", org: "GOX", installedBy: "admin@gox" });
    expect(granted?.hostKey).toBe("sn-1");
    expect(store.get("sn-1")?.org).toBe("GOX");
  });

  it("persists across reopens", () => {
    createUnattendedConsentStore({ dataDir: dir, now: () => NOW }).grant({ hostKey: "SN-2", org: "GOX", installedBy: "a" });
    const reopened = createUnattendedConsentStore({ dataDir: dir, now: () => NOW });
    expect(reopened.get("sn-2")).toBeTruthy();
  });

  it("revoke marks the record and keeps it for the audit", () => {
    const store = createUnattendedConsentStore({ dataDir: dir, now: () => NOW });
    store.grant({ hostKey: "SN-3", org: "GOX", installedBy: "a", expiresAt: defaultUnattendedExpiry(NOW, 30) });
    const revoked = store.revoke("sn-3");
    expect(revoked?.revokedAt).toBeTruthy();
    expect(store.get("sn-3")?.revokedAt).toBeTruthy();
    expect(store.revoke("missing")).toBeNull();
  });
});
