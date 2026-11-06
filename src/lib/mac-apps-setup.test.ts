// @vitest-environment happy-dom
// The Apple apps setup reads the server first, then the desktop app on a Mac
// (organization server), and never comes back empty (the blank page, 2026-11-06).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.fn();
vi.mock("@/state/store", () => ({ api: (...args: unknown[]) => api(...args) }));
vi.mock("@/lib/i18n", () => ({ t: (key: string) => key }));

import { loadMessagesSetup, notOnThisMac } from "./mac-messages-setup";
import { loadMacApps, setMacAppEnabled, testMacApp } from "./mac-apps-setup";
import { macAppsSectionVisible } from "../../shared/mac-apps-setup.ts";

const notHere = Object.assign(new Error("not here"), { status: 404, body: { code: "messages_not_on_this_mac" } });
const desktopStatus = {
  available: true,
  onThisMac: true,
  apps: [
    { id: "messages", enabled: true, permissions: { automation: "granted", fullDiskAccess: "denied" } },
    { id: "mail", enabled: false, permissions: { automation: "notAsked" } },
  ],
};
type Win = { ogb?: unknown };

describe("Apple apps setup in the app", () => {
  beforeEach(() => { api.mockReset(); });
  afterEach(() => { delete (window as Win).ogb; });

  it("shows the This Mac section only in the desktop app on macOS", () => {
    expect(macAppsSectionVisible({ platform: "darwin" })).toBe(true);
    expect(macAppsSectionVisible({ platform: "win32" })).toBe(false);
    expect(macAppsSectionVisible({ platform: "linux" })).toBe(false);
    expect(macAppsSectionVisible(undefined)).toBe(false);
    expect(macAppsSectionVisible(null)).toBe(false);
  });

  it("an organization server's 404 turns to the desktop app on the Mac", async () => {
    api.mockRejectedValue(notHere);
    const set = vi.fn(async () => desktopStatus);
    const test = vi.fn(async () => ({ ok: true, count: 2, names: ["A", "B"] }));
    (window as Win).ogb = { platform: "darwin", macApps: { status: vi.fn(async () => desktopStatus), set, test, openSettings: vi.fn() } };
    expect(await loadMessagesSetup()).toEqual({ available: true, onThisMac: true, useMessages: true, permissions: { fullDiskAccess: "denied", automation: "granted" } });
    expect((await loadMacApps()).apps).toHaveLength(2);
    await setMacAppEnabled("mail", true);
    expect(set).toHaveBeenCalledWith("mail", true);
    expect(await testMacApp("mail")).toEqual({ ok: true, count: 2, names: ["A", "B"] });
  });

  it("a 404 with no desktop app reads plainly instead of an empty page", async () => {
    api.mockRejectedValue(notHere);
    await expect(loadMessagesSetup()).rejects.toThrow("connectApps.mac.notOnThisMac");
    (window as Win).ogb = { platform: "win32" };
    await expect(loadMacApps()).rejects.toThrow("connectApps.mac.notOnThisMac");
  });

  it("other failures are not mistaken for 'not on this Mac'", async () => {
    api.mockRejectedValue(Object.assign(new Error("boom"), { status: 500 }));
    await expect(loadMessagesSetup()).rejects.toThrow("boom");
    expect(notOnThisMac({ status: 404, body: { code: "other" } })).toBe(false);
    expect(notOnThisMac({ status: 404, body: { code: "mac_apps_not_on_this_mac" } })).toBe(true);
  });
});
