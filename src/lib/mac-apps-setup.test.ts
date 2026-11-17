// @vitest-environment happy-dom
// The Apple apps setup reads the server first, then the desktop app on a Mac
// (organization server), and never comes back empty (the blank page, 2026-11-06).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.fn();
vi.mock("@/state/store", () => ({ api: (...args: unknown[]) => api(...args) }));
vi.mock("@/lib/i18n", () => ({ t: (key: string) => key }));

import { loadMessagesSetup, messagesFromMacApps, notOnThisMac, openMessagesPermissionPane } from "./mac-messages-setup";
import { loadMacApps, openMacAppPermissionPane, setMacAppEnabled, testMacApp } from "./mac-apps-setup";
import { macAppDetailActions, macAppPrivacyAnchor, macAppsSectionVisible } from "../../shared/mac-apps-setup.ts";

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

  it("keeps Messages actions from the one mac-apps list", () => {
    const next = messagesFromMacApps({
      available: true,
      onThisMac: true,
      apps: [
        {
          id: "messages",
          enabled: true,
          permissions: { automation: "granted", fullDiskAccess: "denied" },
          actions: [{ tool: "mac_messages_send", kind: "send", needs: "automation", granted: true }],
        },
        { id: "mail", enabled: false, permissions: { automation: "notAsked" } },
      ],
    });
    expect(next.actions).toEqual([{ tool: "mac_messages_send", kind: "send", needs: "automation", granted: true }]);
  });

  it("lists granted actions and parks the rest under the missing permission", () => {
    expect(macAppDetailActions(undefined)).toBeNull();
    expect(macAppDetailActions([])).toBeNull();
    const detail = macAppDetailActions([
      { tool: "mac_mail_search", kind: "read", needs: "automation", granted: true },
      { tool: "mac_mail_delete", kind: "delete", needs: "automation", granted: false },
      { tool: "mac_contacts_search", kind: "read", needs: "contacts", granted: false },
    ]);
    expect(detail?.offered.map((action) => action.tool)).toEqual(["mac_mail_search"]);
    expect(detail?.byNeed).toEqual(["automation", "contacts"]);
    expect(detail?.waiting.automation?.map((action) => action.tool)).toEqual(["mac_mail_delete"]);
    expect(detail?.waiting.contacts?.map((action) => action.tool)).toEqual(["mac_contacts_search"]);
    expect(macAppPrivacyAnchor("calendars")).toBe("Privacy_Calendars");
    expect(macAppPrivacyAnchor("reminders")).toBe("Privacy_Reminders");
    expect(macAppPrivacyAnchor("contacts")).toBe("Privacy_Contacts");
  });

  it("opens a permission pane on the Mac by its anchor from the one map, never by a second list in the desktop app", async () => {
    const openSettings = vi.fn(async () => true);
    (window as Win).ogb = { platform: "darwin", macApps: { openSettings } };
    await openMacAppPermissionPane("calendars");
    await openMacAppPermissionPane("fullDiskAccess");
    await openMessagesPermissionPane("automation");
    expect(openSettings.mock.calls.map((call) => call[0])).toEqual(["Privacy_Calendars", "Privacy_AllFiles", "Privacy_Automation"]);
  });

  it("other failures are not mistaken for 'not on this Mac'", async () => {
    api.mockRejectedValue(Object.assign(new Error("boom"), { status: 500 }));
    await expect(loadMessagesSetup()).rejects.toThrow("boom");
    expect(notOnThisMac({ status: 404, body: { code: "other" } })).toBe(false);
    expect(notOnThisMac({ status: 404, body: { code: "mac_apps_not_on_this_mac" } })).toBe(true);
  });
});
