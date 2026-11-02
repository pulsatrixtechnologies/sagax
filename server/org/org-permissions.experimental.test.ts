// server.experimental is a separate, explicit right (2026-10-22, the owner): it is
// NOT implied by server.settings. A settings delegate who should also manage
// the experiments is given both keys in Perspicax.
import { describe, expect, it } from "vitest";

import { can, MEMBER_ALWAYS_PERMISSIONS, PERMISSION_KEYS, type PermissionKey } from "../../shared/permissions.ts";
import { effectivePermissions, permissionList } from "./org-permissions.ts";

// Since 2026-10-26 every non-service principal also holds the keys about a
// person's own things (MEMBER_ALWAYS_PERMISSIONS), whatever the directory sends.
const withMemberAlways = (...keys: PermissionKey[]) =>
  PERMISSION_KEYS.filter((key) => keys.includes(key) || MEMBER_ALWAYS_PERMISSIONS.includes(key));

describe("server.experimental is a separate right", () => {
  it("a server.settings delegate does NOT gain server.experimental", () => {
    const effective = effectivePermissions({ admin: false, fromDirectory: ["server.settings"] });
    expect(can(effective, "server.settings")).toBe(true);
    expect(can(effective, "server.experimental")).toBe(false);
    expect(permissionList(effective)).toEqual(withMemberAlways("server.settings"));
  });

  it("a server.experimental delegate does NOT gain server.settings", () => {
    const effective = effectivePermissions({ admin: false, fromDirectory: ["server.experimental"] });
    expect(can(effective, "server.experimental")).toBe(true);
    expect(can(effective, "server.settings")).toBe(false);
    expect(permissionList(effective)).toEqual(withMemberAlways("server.experimental"));
  });

  it("both keys are granted only when both are in the directory list", () => {
    const effective = effectivePermissions({ admin: false, fromDirectory: ["server.settings", "server.experimental"] });
    expect(can(effective, "server.settings")).toBe(true);
    expect(can(effective, "server.experimental")).toBe(true);
  });

  it("an admin holds both; a plain member holds neither", () => {
    const admin = effectivePermissions({ admin: true, fromDirectory: null });
    expect(can(admin, "server.experimental")).toBe(true);
    expect(can(admin, "server.settings")).toBe(true);
    const member = effectivePermissions({ admin: false, fromDirectory: null });
    expect(can(member, "server.experimental")).toBe(false);
    expect(can(member, "server.settings")).toBe(false);
  });
});
