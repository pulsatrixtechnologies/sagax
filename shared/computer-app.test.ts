import { describe, expect, it } from "vitest";

import { appBundleDenied, appBundleOf, appLabelFromPath, appRuleOffered, screenAppTarget, screenCallOf } from "./computer-app.ts";

describe("screenAppTarget", () => {
  it("reads the pid of a direct screen call", () => {
    expect(screenAppTarget("mcp__computer__click", JSON.stringify({ pid: 812, element_index: 4 }))).toEqual({ kind: "pid", pid: 812 });
    expect(screenAppTarget("mcp__computer__click", JSON.stringify({ pid: 812, window_id: 3 }))).toEqual({ kind: "pid", pid: 812, windowId: 3 });
    expect(screenAppTarget("computer__type_text", JSON.stringify({ pid: 812, text: "bonjour" }))).toEqual({ kind: "pid", pid: 812, focusCheck: true });
  });

  it("reads the desktop bridge's computer_use", () => {
    const input = JSON.stringify({ tool_name: "scroll", arguments: { pid: 4410, direction: "down" } });
    expect(screenAppTarget("mcp__sagax-desktop__computer_use", input)).toEqual({ kind: "pid", pid: 4410 });
    expect(screenCallOf("sagax-desktop__computer_use", input)?.tool).toBe("scroll");
  });

  it("names no app for a whole-screen action, a tool that is not per app or another server", () => {
    expect(screenAppTarget("mcp__computer__click", JSON.stringify({ pid: 812, scope: "desktop", x: 1, y: 2 }))).toBeNull();
    expect(screenAppTarget("mcp__computer__click", JSON.stringify({ x: 1, y: 2 }))).toBeNull();
    expect(screenAppTarget("mcp__computer__list_apps", "{}")).toBeNull();
    expect(screenAppTarget("mcp__computer__get_desktop_state", "{}")).toBeNull();
    expect(screenAppTarget("mcp__sagax-desktop__run_command", JSON.stringify({ command: "ls" }))).toBeNull();
    expect(screenAppTarget("mcp__other__click", JSON.stringify({ pid: 812 }))).toBeNull();
  });

  it("refuses a malformed pid or window", () => {
    for (const pid of [0, 1, -4, 1.5, "812", 99_999_999]) expect(screenAppTarget("mcp__computer__click", JSON.stringify({ pid }))).toBeNull();
    expect(screenAppTarget("mcp__computer__click", JSON.stringify({ pid: 812, window_id: "3" }))).toBeNull();
  });

  it("never covers launch_app, the foreground, a global shortcut, a file written or an unknown argument (review of #954)", () => {
    expect(screenAppTarget("mcp__computer__launch_app", JSON.stringify({ bundle_id: "com.apple.Safari" }))).toBeNull();
    expect(screenAppTarget("mcp__computer__click", JSON.stringify({ pid: 812, delivery_mode: "foreground" }))).toBeNull();
    expect(screenAppTarget("mcp__computer__click", JSON.stringify({ pid: 812, delivery_mode: "background" }))).not.toBeNull();
    expect(screenAppTarget("mcp__computer__hotkey", JSON.stringify({ pid: 812, keys: ["cmd", "space"] }))).toBeNull();
    expect(screenAppTarget("mcp__computer__press_key", JSON.stringify({ pid: 812, key: "space", modifiers: ["cmd"] }))).toBeNull();
    expect(screenAppTarget("mcp__computer__press_key", JSON.stringify({ pid: 812, key: "a", modifiers: ["shift"] }))).not.toBeNull();
    // a combo written in the key itself is a global shortcut
    for (const key of ["cmd+q", "command+space", "ctrl+c", "f12", "cmd"]) expect(screenAppTarget("mcp__computer__press_key", JSON.stringify({ pid: 812, key }))).toBeNull();
    expect(screenAppTarget("mcp__computer__press_key", JSON.stringify({ pid: 812, key: "return" }))).not.toBeNull();
    expect(screenAppTarget("mcp__computer__click", JSON.stringify({ pid: 812, debug_image_out: "/tmp/a.png" }))).toBeNull();
    expect(screenAppTarget("mcp__computer__get_window_state", JSON.stringify({ pid: 812, screenshot_out_file: "/tmp/a.png" }))).toBeNull();
    expect(screenAppTarget("mcp__computer__click", JSON.stringify({ pid: 812, app: "Safari" }))).toBeNull();
  });

  it("types only into the focused element", () => {
    expect(screenAppTarget("mcp__computer__type_text", JSON.stringify({ pid: 812, element_index: 4, text: "x" }))).toBeNull();
    expect(screenAppTarget("mcp__computer__set_value", JSON.stringify({ pid: 812, element_token: "t", value: "x" }))).toBeNull();
    expect(screenAppTarget("mcp__computer__type_text", JSON.stringify({ pid: 812, x: 4, y: 5, text: "x" }))).toBeNull();
  });
});

describe("app bundles", () => {
  it("keeps the outermost app bundle", () => {
    expect(appLabelFromPath("/Applications/Safari.app/Contents/MacOS/Safari")).toBe("Safari");
    expect(appBundleOf("/Applications/Google Chrome.app/Contents/Frameworks/Helpers/Google Chrome Helper.app/Contents/MacOS/x")).toBe("/Applications/Google Chrome.app");
    expect(appLabelFromPath("/bin/zsh")).toBeNull();
    expect(appLabelFromPath(undefined)).toBeNull();
  });

  it("denies by bundle id and by name, and needs a signed identity", () => {
    expect(appRuleOffered({ label: "Safari", bundleId: "com.apple.Safari", team: "apple" })).toBe(true);
    for (const bundleId of ["com.apple.Terminal", "com.microsoft.VSCodeInsiders", "com.jetbrains.intellij", "com.apple.mail", "com.tinyspeck.slackmacgap", "com.apple.ScreenSharing", "io.tailscale.ipn.macsys", "com.openai.codex", "com.screenconnect.client.abc"]) {
      expect(appBundleDenied(bundleId)).toBe(true);
      expect(appRuleOffered({ label: "Renamed", bundleId, team: "ABCDE12345" })).toBe(false);
    }
    for (const app of ["Terminal", "Sagax", "Raycast", "Messages", "Disk Utility", "iPhone Mirroring", "Zoom", "Discord"]) expect(appRuleOffered(app)).toBe(false);
    for (const bundleId of ["com.apple.ScreenContinuity", "com.apple.RemoteDesktop", "com.carriez.rustdesk", "tv.parsec.www", "org.keepassxc.keepassxc", "com.microsoft.Outlook", "us.zoom.xos", "org.whispersystems.signal-desktop"]) expect(appBundleDenied(bundleId)).toBe(true);
    expect(appRuleOffered({ label: "Safari", bundleId: "com.apple.Safari", team: "" })).toBe(false);
    expect(appRuleOffered(null)).toBe(false);
  });
});
