import { describe, expect, it } from "vitest";

import {
  MEMBER_ALWAYS_PERMISSIONS,
  ADMIN_ONLY_PERMISSIONS,
  BOT_FIELD_PERMISSIONS,
  can,
  isPermissionKey,
  MEMBER_DEFAULT_PERMISSIONS,
  normalizePermissions,
  PERMISSION_GROUPS,
  PERMISSION_KEY_PATTERN,
  PERMISSION_KEYS,
  PERMISSIONS,
  permissionCatalogue,
  permissionLabel,
  permissionRefusal,
} from "./permissions.ts";
import { MEMBER_BOT_FIELDS } from "./viewer-capabilities.ts";

describe("the permission catalogue", () => {
  it("has stable, unique, dotted keys in known groups, with both languages", () => {
    expect(new Set(PERMISSION_KEYS).size).toBe(PERMISSION_KEYS.length);
    const groups = new Set(PERMISSION_GROUPS.map((group) => group.id));
    for (const entry of PERMISSIONS) {
      expect(entry.key, entry.key).toMatch(PERMISSION_KEY_PATTERN);
      expect(entry.key.split(".")[0], entry.key).toBe(entry.group);
      expect(groups.has(entry.group), entry.key).toBe(true);
      for (const text of [entry.label.en, entry.label.fr, entry.description.en, entry.description.fr]) {
        expect(text.trim(), entry.key).not.toBe("");
        // no em dash or en dash anywhere in product copy
        expect(text, entry.key).not.toMatch(/[\u2013\u2014]/);
      }
    }
  });

  it("keeps the admin-only list tiny, each with its reason, never a member default", () => {
    // 2026-10-19: only what decides who reaches the server at all
    expect([...ADMIN_ONLY_PERMISSIONS].sort()).toEqual(["server.link"]);
    for (const entry of PERMISSIONS.filter((row) => row.adminOnly)) {
      expect(entry.memberDefault, entry.key).toBe(false);
      expect(entry.adminOnlyReason?.en, entry.key).toBeTruthy();
      expect(entry.adminOnlyReason?.fr, entry.key).toBeTruthy();
    }
  });

  it("member defaults open everything about a member's own bots, routines and connections (2026-10-26)", () => {
    const own = ["apps.ownIntegrations", "bots.approvalLevel", "bots.behaviour", "bots.create", "bots.fullAccess", "bots.tools",
      "clients.agentsCreate", "clients.botsMessage", "clients.botsRead", "clients.routinesRead", "clients.routinesRun", "clients.routinesWrite", "sharing.grants", "sharing.visibility",
      // 2026-10-28 (#1098): the working folder of their own bots and groups
      "folders.botWorkingFolder", "folders.roomWorkingFolder"];
    // #1098: defensive security work is a default too (conversation), not
    // one of the person's own things a profile can never leave out
    expect([...MEMBER_DEFAULT_PERMISSIONS].sort()).toEqual([...own, "security.triage"].sort());
    expect([...MEMBER_ALWAYS_PERMISSIONS].sort()).toEqual([...own].sort());
  });

  it("lets the owner set Always allow on their own bot with bots.approvalLevel, never without it (2026-10-26)", () => {
    expect(BOT_FIELD_PERMISSIONS.alwaysAllow).toBe("bots.approvalLevel");
    expect(can({ admin: false, permissions: ["bots.approvalLevel"] }, BOT_FIELD_PERMISSIONS.alwaysAllow!)).toBe(true);
    expect(can({ admin: false, permissions: ["bots.behaviour"] }, BOT_FIELD_PERMISSIONS.alwaysAllow!)).toBe(false);
  });

  it("maps every bot field a permission opens, and none a member already sets", () => {
    for (const [field, key] of Object.entries(BOT_FIELD_PERMISSIONS)) {
      expect(isPermissionKey(key), field).toBe(true);
      expect((MEMBER_BOT_FIELDS as readonly string[]).includes(field), field).toBe(false);
    }
  });

  it("has the routine scope keys: read side off by default, never admin-only, an older list without them still reads", () => {
    for (const key of ["routines.viewTeam", "routines.viewAll", "routines.runNowAny", "routines.runAsAnyone"] as const) {
      expect(isPermissionKey(key), key).toBe(true);
      expect(PERMISSIONS.find((entry) => entry.key === key)).toMatchObject({ group: "routines", memberDefault: false, adminOnly: false });
    }
    expect(PERMISSIONS.filter((entry) => entry.group === "routines").map((entry) => entry.key)).toEqual(["routines.runAsAnyone", "routines.runNowAny", "routines.viewTeam", "routines.viewAll"]);
    expect(can({ admin: true, permissions: [] }, "routines.viewAll")).toBe(true);
    expect(can({ admin: false, permissions: [] }, "routines.viewTeam")).toBe(false);
    expect(can({ admin: false, permissions: ["routines.viewTeam"] }, "routines.viewAll")).toBe(false);
    // A newer Perspicax may send a key this build does not know: ignored.
    expect(normalizePermissions(["routines.viewTeam", "routines.viewEverything"])).toEqual({ granted: ["routines.viewTeam"], unknown: ["routines.viewEverything"], ignored: [] });
  });

  it("grants defensive security work to a member by default (#1098)", () => {
    expect(PERMISSIONS.find((entry) => entry.key === "security.triage")).toMatchObject({
      group: "security", memberDefault: true, adminOnly: false,
    });
    expect(MEMBER_DEFAULT_PERMISSIONS).toContain("security.triage");
    expect(can({ admin: true, permissions: [] }, "security.triage")).toBe(true);
    // a profile from Perspicax that leaves it out still does
    expect(can({ admin: false, permissions: [] }, "security.triage")).toBe(false);
    expect(can({ admin: false, permissions: ["security.triage"] }, "security.triage")).toBe(true);
  });

  it("is what the console reads", () => {
    const catalogue = permissionCatalogue();
    expect(catalogue.version).toBe(1);
    expect(catalogue.permissions).toBe(PERMISSIONS);
    expect(JSON.parse(JSON.stringify(catalogue)).permissions[0]).toMatchObject({ key: "bots.create", memberDefault: true, adminOnly: false });
  });
});

describe("can", () => {
  it("lets the operator and an admin do everything, admin-only keys included", () => {
    expect(can(undefined, "host.shell")).toBe(true);
    expect(can({ admin: true, permissions: [] }, "host.shell")).toBe(true);
    expect(can({ admin: true, permissions: [] }, "usage.view")).toBe(true);
  });

  it("needs the key for anyone else, and never grants an admin-only key", () => {
    const member = { admin: false, permissions: new Set(["usage.view", "host.shell", "server.link"]) };
    expect(can(member, "usage.view")).toBe(true);
    expect(can(member, "engines.manage")).toBe(false);
    // 2026-10-19: host.shell is given in Perspicax; server.link never
    expect(can(member, "host.shell")).toBe(true);
    expect(can(member, "server.link")).toBe(false);
    expect(can({ admin: false, permissions: ["bots.create"] }, "bots.create")).toBe(true);
  });
});

describe("normalizePermissions", () => {
  it("keeps known grantable keys in catalogue order and reports the rest", () => {
    expect(normalizePermissions(["usage.view", "bots.create", "nope.key", "server.link", 7, "usage.view"])).toEqual({
      granted: ["bots.create", "usage.view"],
      unknown: ["nope.key"],
      ignored: ["server.link"],
    });
    expect(normalizePermissions("bots.create")).toEqual({ granted: [], unknown: [], ignored: [] });
    expect(normalizePermissions(null).granted).toEqual([]);
  });
});

describe("the refusal", () => {
  it("names the key and words it for the person", () => {
    expect(permissionRefusal("bots.create")).toEqual({
      error: "forbidden",
      permission: "bots.create",
      message: "Your profile does not include Create and own bots. Ask an admin to add it in Perspicax.",
    });
    expect(permissionLabel("usage.view", "fr-CA")).toBe("Voir l'utilisation et les dépenses");
    expect(permissionLabel("nope.key")).toBe("nope.key");
  });
});
