import { describe, expect, it } from "vitest";

import { MEMBER_ALWAYS_PERMISSIONS, MEMBER_DEFAULT_PERMISSIONS, PERMISSION_KEYS } from "../shared/permissions.ts";
import { effectivePermissions, permissionList } from "./org-permissions.ts";

describe("effectivePermissions", () => {
  it("an admin holds every key", () => {
    const admin = effectivePermissions({ admin: true, fromDirectory: [], botsUseOnly: true });
    expect(admin.source).toBe("admin");
    expect(permissionList(admin)).toEqual([...PERMISSION_KEYS]);
    expect(admin.narrowedBy).toEqual([]);
  });

  it("no list from Perspicax: the member defaults, so nothing regresses", () => {
    const member = effectivePermissions({ admin: false, fromDirectory: null });
    expect(member.source).toBe("defaults");
    expect(permissionList(member)).toEqual([...MEMBER_DEFAULT_PERMISSIONS]);
  });

  it("a list from Perspicax is taken as is, plus the keys about the person's own things (2026-10-26)", () => {
    expect(permissionList(effectivePermissions({ admin: false, fromDirectory: ["usage.view"] }))).toEqual(PERMISSION_KEYS.filter((key) => key === "usage.view" || MEMBER_ALWAYS_PERMISSIONS.includes(key)));
    const none = effectivePermissions({ admin: false, fromDirectory: [] });
    expect(none.source).toBe("perspicax");
    expect(permissionList(none)).toEqual([...MEMBER_ALWAYS_PERMISSIONS]);
    // what reaches past the person's own environment still comes from the list
    for (const key of ["bots.computer", "host.commands", "server.settings", "people.manage"] as const) {
      expect(none.permissions.has(key), key).toBe(false);
    }
  });

  it("a local service holds exactly its list, never a person's own keys", () => {
    expect(permissionList(effectivePermissions({ admin: false, fromDirectory: [], service: true }))).toEqual([]);
  });

  it("the person sheet narrows on top of the profiles (sagax_integrations is ignored)", () => {
    const sheet = effectivePermissions({
      admin: false,
      fromDirectory: ["bots.create", "bots.tools", "sharing.grants", "apps.ownIntegrations", "usage.view"],
      botsUseOnly: true,
    });
    // the clients.* keys about their own conversations and routines stay
    // the folder of their own groups too (#1098); their bots' folder goes with sagax_bots
    expect(permissionList(sheet)).toEqual(["apps.ownIntegrations", "folders.roomWorkingFolder", "usage.view", "clients.botsRead", "clients.botsMessage", "clients.routinesRun", "clients.routinesRead", "clients.routinesWrite", "clients.agentsCreate"]);
    expect(sheet.narrowedBy).toEqual(["sagax_bots"]);
  });
});
