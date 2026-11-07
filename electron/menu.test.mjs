import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { name: "openmausbot" },
  Menu: { buildFromTemplate: (template) => template },
}));

import { buildApplicationMenu } from "./menu.mjs";

describe("buildApplicationMenu", () => {
  const originalPlatform = process.platform;

  function withPlatform(platform, fn) {
    Object.defineProperty(process, "platform", { value: platform, configurable: true });
    try {
      return fn();
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
    }
  }

  const environments = [{ id: "x", name: "X", origin: "http://localhost" }];
  const build = (platform, overrides = {}) =>
    withPlatform(platform, () =>
      buildApplicationMenu({
        environments,
        activeId: "x",
        onSwitch: vi.fn(),
        onAddFromClipboard: vi.fn(),
        onForget: vi.fn(),
        ...overrides,
      }),
    );

  it("macOS app menu wires an explicit Preferences item to the settings callback", () => {
    const onOpenSettings = vi.fn();
    const template = build("darwin", { onOpenSettings });
    const item = template[0].submenu.find((entry) => entry.label === "Preferences…");
    expect(item).toBeDefined();
    expect(item.accelerator).toBe("CmdOrCtrl+,");
    expect(item.click).toBeTypeOf("function");
    item.click();
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("labels the macOS app menu with the display name, not the runtime name", () => {
    const [appMenu] = build("darwin");
    expect(appMenu.label).toBe("Sagax");
    const labels = appMenu.submenu.map((entry) => entry.label).filter(Boolean);
    expect(labels).toEqual(expect.arrayContaining(["About Sagax", "Hide Sagax", "Quit Sagax"]));
    expect(JSON.stringify(appMenu)).not.toContain("openmausbot");
  });

  it("macOS About opens the in-app About modal, not the native about panel", () => {
    const onOpenAbout = vi.fn();
    const [appMenu] = build("darwin", { onOpenAbout });
    const about = appMenu.submenu.find((entry) => entry.label === "About Sagax");
    expect(about.role).toBeUndefined();
    expect(about.click).toBeTypeOf("function");
    about.click();
    expect(onOpenAbout).toHaveBeenCalledTimes(1);
  });

  it.each(["linux", "win32"])("does not add an app menu on %s", (platform) => {
    const template = build(platform);
    expect(template[0].role).toBe("fileMenu");
    for (const item of template) {
      expect(item.label).not.toBe("Sagax");
    }
  });

  it.each(["linux", "win32"])("Help > About opens the in-app About modal on %s", (platform) => {
    const onOpenAbout = vi.fn();
    const template = build(platform, { onOpenAbout });
    const help = template.find((entry) => entry.role === "help");
    expect(help).toBeDefined();
    const about = help.submenu.find((entry) => entry.label === "About");
    about.click();
    expect(onOpenAbout).toHaveBeenCalledTimes(1);
  });

  it.each(["darwin", "linux", "win32"])("Help > Send Feedback… opens the Feedback bot with Cmd/Ctrl+Shift+F on %s (#2618)", (platform) => {
    const onSendFeedback = vi.fn();
    const template = build(platform, { onSendFeedback });
    const help = template.find((entry) => entry.role === "help");
    const item = help.submenu.find((entry) => entry.label === "Send Feedback…");
    expect(item.accelerator).toBe("CmdOrCtrl+Shift+F");
    item.click();
    expect(onSendFeedback).toHaveBeenCalledTimes(1);
  });

  it.each(["darwin", "linux", "win32"])("does not offer hosted organisation sign-in on %s", platform => {
    const template = build(platform);
    const server = template.find(entry => entry.label === "Server").submenu;
    expect(server.some(entry => entry.id === "organization-sign-in")).toBe(false);
    expect(JSON.stringify(server)).not.toContain("Sign in with your organization");
    expect(server.some(entry => entry.label === "Connect to a server…")).toBe(true);
  });

  it("in server mode the Server menu shows this computer, the organization's server and Change server", () => {
    const onLeaveServerMode = vi.fn();
    const onSwitch = vi.fn();
    const template = build("darwin", { serverModeId: "x", onLeaveServerMode, onSwitch });
    const items = template.find(entry => entry.label === "Server").submenu;
    const labels = items.map(entry => entry.label).filter(Boolean);
    expect(labels).toEqual(["This computer", "X — localhost", "Change server…"]);
    expect(items.find(entry => entry.label === "X — localhost").checked).toBe(true);
    expect(JSON.stringify(items)).not.toContain("Connect to a server");
    items.find(entry => entry.label === "Change server…").click();
    expect(onLeaveServerMode).toHaveBeenCalledOnce();
    expect(onSwitch).not.toHaveBeenCalled();
  });

  it("in server mode, This computer switches to Personal without leaving the server (no sign-out)", () => {
    const onLeaveServerMode = vi.fn();
    const onSwitch = vi.fn();
    const template = build("darwin", { serverModeId: "x", activeId: "local", onLeaveServerMode, onSwitch });
    const items = template.find(entry => entry.label === "Server").submenu;
    expect(items.find(entry => entry.label === "This computer").checked).toBe(true);
    items.find(entry => entry.label === "This computer").click();
    items.find(entry => entry.label === "X — localhost").click();
    expect(onSwitch.mock.calls).toEqual([["local"], ["x"]]);
    expect(onLeaveServerMode).not.toHaveBeenCalled();
  });

  it("the Window menu names each artifact open in its own window and brings it forward", () => {
    const onShowArtifactWindow = vi.fn();
    const artifactWindows = [{ artifactId: "art_1", title: "Live table" }];
    const template = build("win32", { artifactWindows, onShowArtifactWindow });
    const windowMenu = template.find((entry) => entry.label === "Window");
    const item = windowMenu.submenu.find((entry) => entry.label === "Live table");
    expect(item).toBeDefined();
    item.click();
    expect(onShowArtifactWindow).toHaveBeenCalledWith("art_1");
    // none open: only the standard items
    const empty = build("win32").find((entry) => entry.label === "Window");
    expect(empty.submenu.map((entry) => entry.role)).toEqual(["minimize", "close"]);
    // macOS lists every window in its own Window menu
    expect(build("darwin", { artifactWindows }).find((entry) => entry.role === "windowMenu")).toEqual({ role: "windowMenu" });
  });
});
