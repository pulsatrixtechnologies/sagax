// @vitest-environment happy-dom
// #2614: every missing OS permission is one click away, in Settings >
// Permissions, in a banner where a feature needs it, and in a bot's reply
// (sagax://permission/<id>). The button runs the action main computed and
// the page reads again when the person comes back from System Settings.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import { parsePermissionLink } from "@/lib/os-permissions";
import { OsPermissionBanner, OsPermissionChatButton, OsPermissionsSection, ScreenPermissionActions } from "./OsPermissions";
import { MicrophonePermissionRow } from "./MicrophoneSettings";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const MIC_PANE = "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone";
const SCREEN_PANE = "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture";
let host: HTMLDivElement;
let root: Root;

function answer(permissions: unknown[], platform = "darwin") {
  return { platform, permissions };
}
async function render(node: ReturnType<typeof createElement>) {
  await act(async () => { root.render(node); });
  await act(async () => { await Promise.resolve(); });
}
function button(selector: string): HTMLButtonElement {
  const found = host.querySelector<HTMLButtonElement>(selector);
  if (!found) throw new Error(`no ${selector} in ${host.innerHTML}`);
  return found;
}

beforeEach(() => {
  setLocale("en");
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  delete (window as { ogb?: unknown }).ogb;
});

describe("parsePermissionLink", () => {
  it("reads the permission a bot's link names, whatever the case", () => {
    expect(parsePermissionLink("sagax://permission/screen")).toBe("screen");
    expect(parsePermissionLink("sagax://permission/FullDisk/")).toBe("fullDisk");
    expect(parsePermissionLink("sagax://permission/camera")).toBeNull();
    expect(parsePermissionLink("https://example.com")).toBeNull();
  });
});

describe("Settings > Permissions", () => {
  it("shows a row per permission with the button that grants it, none once allowed", async () => {
    const permAct = vi.fn().mockResolvedValue({ ok: true });
    const permAll = vi.fn().mockResolvedValue(answer([
      { id: "microphone", status: "granted", action: { kind: "none" } },
      { id: "screen", status: "denied", action: { kind: "settings", url: SCREEN_PANE, secondary: { kind: "relaunch" } } },
      { id: "accessibility", status: "not-determined", action: { kind: "prompt" } },
    ]));
    (window as { ogb?: unknown }).ogb = { permAll, permAct };
    await render(createElement(OsPermissionsSection));
    expect(host.querySelector('[data-settings-row="osPermission.microphone"] button')).toBeNull();
    expect(button('[data-settings-row="osPermission.screen"] [data-os-permission-action="settings"]').textContent).toBe("Open System Settings");
    expect(button('[data-settings-row="osPermission.screen"] [data-os-permission-secondary="relaunch"]').textContent).toBe("Relaunch Sagax");
    expect(button('[data-settings-row="osPermission.accessibility"] [data-os-permission-action="prompt"]').textContent).toBe("Allow");
    await act(async () => { button('[data-settings-row="osPermission.screen"] [data-os-permission-secondary]').click(); });
    expect(permAct).toHaveBeenCalledWith("screen", expect.objectContaining({ secondary: true }));
    // reads again after the action, so a grant shows without a restart
    expect(permAll.mock.calls.length).toBeGreaterThan(1);
  });

  it("reads again when the person comes back from System Settings", async () => {
    const permAll = vi.fn().mockResolvedValue(answer([{ id: "microphone", status: "denied", action: { kind: "settings", url: MIC_PANE } }]));
    (window as { ogb?: unknown }).ogb = { permAll, permAct: vi.fn() };
    await render(createElement(OsPermissionsSection));
    const before = permAll.mock.calls.length;
    await act(async () => { window.dispatchEvent(new Event("focus")); await Promise.resolve(); });
    expect(permAll.mock.calls.length).toBe(before + 1);
  });

  it("says Open Windows Settings on Windows", async () => {
    (window as { ogb?: unknown }).ogb = {
      permAll: vi.fn().mockResolvedValue(answer([{ id: "microphone", status: "denied", action: { kind: "settings", url: "ms-settings:privacy-microphone" } }], "win32")),
      permAct: vi.fn(),
    };
    await render(createElement(OsPermissionsSection));
    expect(button("[data-os-permission-action]").textContent).toBe("Open Windows Settings");
  });
});

describe("in context", () => {
  it("a banner shows the same button while the permission is missing, nothing once allowed", async () => {
    const permAll = vi.fn().mockResolvedValue(answer([{ id: "microphone", status: "denied", action: { kind: "settings", url: MIC_PANE } }]));
    (window as { ogb?: unknown }).ogb = { permAll, permAct: vi.fn() };
    await render(createElement(OsPermissionBanner, { id: "microphone" }));
    expect(host.querySelector('[data-os-permission-banner="microphone"]')?.textContent).toContain("Microphone: not allowed for Sagax yet.");
    expect(button("[data-os-permission-action]").textContent).toBe("Open System Settings");

    permAll.mockResolvedValue(answer([{ id: "microphone", status: "granted", action: { kind: "none" } }]));
    await act(async () => { window.dispatchEvent(new Event("focus")); await Promise.resolve(); });
    expect(host.querySelector("[data-os-permission-banner]")).toBeNull();
  });

  it("a bot's sagax://permission link is a button that runs the action", async () => {
    const permAct = vi.fn().mockResolvedValue({ ok: true });
    (window as { ogb?: unknown }).ogb = {
      permAll: vi.fn().mockResolvedValue(answer([{ id: "screen", status: "not-determined", action: { kind: "prompt", secondary: { kind: "relaunch" } } }])),
      permAct,
    };
    await render(createElement(OsPermissionChatButton, { id: "screen", children: "Allow Screen Recording" }));
    await act(async () => { button('[data-os-permission-chat="screen"]').click(); });
    expect(permAct).toHaveBeenCalledWith("screen", expect.objectContaining({ secondary: false }));
  });

  it("outside the desktop app the link stays plain text", async () => {
    await render(createElement(OsPermissionChatButton, { id: "screen", children: "Allow Screen Recording" }));
    expect(host.querySelector("button")).toBeNull();
    expect(host.textContent).toBe("Allow Screen Recording");
  });

  it("an unreadable status shows no warning banner", async () => {
    (window as { ogb?: unknown }).ogb = {
      permAll: vi.fn().mockResolvedValue(answer([{ id: "notifications", status: "unknown", action: { kind: "prompt" } }])),
      permAct: vi.fn(),
    };
    await render(createElement(OsPermissionBanner, { id: "notifications" }));
    expect(host.querySelector("[data-os-permission-banner]")).toBeNull();
  });

  it("the Computer panel with no picture offers Relaunch Sagax when the switch is on (the owner 2026-11-07)", async () => {
    const permAll = vi.fn().mockResolvedValue(answer([{ id: "screen", status: "granted", action: { kind: "relaunch", secondary: { kind: "settings", url: SCREEN_PANE } } }]));
    const permAct = vi.fn().mockResolvedValue({ ok: true });
    (window as { ogb?: unknown }).ogb = { permAll, permAct };
    await render(createElement(ScreenPermissionActions, { fallback: "old" }));
    expect(permAll).toHaveBeenCalledWith({ captureFailed: true });
    expect(button('[data-os-permission-action="relaunch"]').textContent).toBe("Relaunch Sagax");
    await act(async () => { button('[data-os-permission-action="relaunch"]').click(); });
    expect(permAct).toHaveBeenCalledWith("screen", expect.objectContaining({ secondary: false, captureFailed: true }));
  });

  it("Models and voice > Microphone uses the same buttons", async () => {
    (window as { ogb?: unknown }).ogb = {
      permAll: vi.fn().mockResolvedValue(answer([{ id: "microphone", status: "not-determined", action: { kind: "prompt" } }])),
      permAct: vi.fn(),
    };
    await render(createElement(MicrophonePermissionRow));
    expect(button('[data-settings-row="microphoneAccess"] [data-os-permission-action="prompt"]').textContent).toBe("Allow");
  });
});

describe("Settings > Permissions outside the desktop app", () => {
  it("says so instead of rendering nothing", async () => {
    (window as { ogb?: unknown }).ogb = undefined;
    await render(createElement(OsPermissionsSection));
    expect(host.querySelector("[data-os-permissions-unavailable]")?.textContent).toContain("desktop app");
  });
});
