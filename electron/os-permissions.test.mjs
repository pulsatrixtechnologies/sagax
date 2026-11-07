// #2614: every missing OS permission maps to one action that grants it.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  OS_PERMISSIONS,
  isPermissionSettingsUrl,
  normalizePermissionStatus,
  permissionAction,
  permissionsFor,
} from "./os-permissions.mjs";

const vectors = JSON.parse(readFileSync(new URL("./os-permissions.vectors.json", import.meta.url), "utf8"));

describe("permissionAction", () => {
  it.each(vectors.desktop)("$platform $id $status $run -> $expect.kind", ({ platform, id, status, run, expect: want }) => {
    const action = permissionAction(id, platform, status, run);
    expect(action.kind).toBe(want.kind);
    if (want.url) expect(action.url).toBe(want.url);
    if (want.secondary) expect(action.secondary?.kind).toBe(want.secondary);
  });

  it("never leaves a missing permission without an action", () => {
    for (const platform of Object.keys(OS_PERMISSIONS)) {
      for (const { id } of permissionsFor(platform)) {
        for (const status of ["denied", "not-determined", "unknown"]) {
          for (const run of [{}, { asked: true }, { openedSettings: true }, { relaunched: true }]) {
            expect(permissionAction(id, platform, status, run).kind, `${platform} ${id} ${status}`).not.toBe("none");
          }
        }
      }
    }
  });

  it("Screen Recording refused always offers Relaunch Sagax too (the status is cached per process)", () => {
    expect(permissionAction("screen", "darwin", "denied")).toMatchObject({ kind: "settings", secondary: { kind: "relaunch" } });
    expect(permissionAction("screen", "darwin", "denied", { openedSettings: true })).toMatchObject({ kind: "relaunch" });
    expect(permissionAction("screen", "darwin", "denied", { relaunched: true })).toMatchObject({ kind: "reset" });
    expect(permissionAction("screen", "darwin", "granted", { captureFailed: true })).toMatchObject({ kind: "relaunch" });
  });

  it("JC 2026-11-07: Sagax checked in Screen Recording but no picture is never text alone", () => {
    // Allowed, capture fails: Relaunch Sagax first.
    expect(permissionAction("screen", "darwin", "granted", { captureFailed: true })).toMatchObject({ kind: "relaunch", secondary: { kind: "settings" } });
    // Still failing after that relaunch: a stale entry, reset it.
    expect(permissionAction("screen", "darwin", "granted", { captureFailed: true, relaunched: true })).toMatchObject({ kind: "reset", secondary: { kind: "settings" } });
    // The cached "denied" while the switch is on: Relaunch is right there.
    expect(permissionAction("screen", "darwin", "denied").secondary?.kind).toBe("relaunch");
  });

  it("every pane is a System Settings URL and unknown ids do nothing", () => {
    for (const platform of Object.keys(OS_PERMISSIONS)) {
      for (const entry of permissionsFor(platform)) expect(isPermissionSettingsUrl(entry.pane), entry.id).toBe(true);
    }
    expect(permissionAction("__proto__", "darwin", "denied").kind).toBe("none");
    expect(permissionAction("microphone", "linux", "denied").kind).toBe("none");
    expect(isPermissionSettingsUrl("https://example.com")).toBe(false);
    expect(isPermissionSettingsUrl("file:///etc/passwd")).toBe(false);
  });
});

describe("normalizePermissionStatus", () => {
  it("reads Electron, accessibility and notification answers", () => {
    expect(normalizePermissionStatus("granted")).toBe("granted");
    expect(normalizePermissionStatus(true)).toBe("granted");
    expect(normalizePermissionStatus("delivered")).toBe("granted");
    expect(normalizePermissionStatus("restricted")).toBe("denied");
    expect(normalizePermissionStatus(false)).toBe("denied");
    expect(normalizePermissionStatus("not-delivered")).toBe("denied");
    expect(normalizePermissionStatus("not-determined")).toBe("not-determined");
    expect(normalizePermissionStatus(undefined)).toBe("unknown");
  });
});
