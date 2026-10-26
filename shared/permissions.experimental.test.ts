// server.experimental (2026-10-22, JC): the delegable right over Settings >
// Experimental, and the body guard that holds a delegate who holds only it to
// the experiment switches alone.
import { describe, expect, it } from "vitest";

import {
  EXPERIMENTAL_FEATURE_KEYS,
  experimentalOnlyConfigViolation,
  isExperimentalFeatureKey,
  isPermissionKey,
  MEMBER_DEFAULT_PERMISSIONS,
  PERMISSIONS,
} from "./permissions.ts";

describe("the server.experimental right", () => {
  it("is a known, grantable, non-admin-only key in the server group, not a member default", () => {
    expect(isPermissionKey("server.experimental")).toBe(true);
    const entry = PERMISSIONS.find((row) => row.key === "server.experimental")!;
    expect(entry.group).toBe("server");
    expect(entry.adminOnly).toBe(false);
    expect(entry.memberDefault).toBe(false);
    expect(MEMBER_DEFAULT_PERMISSIONS).not.toContain("server.experimental");
    for (const text of [entry.label.en, entry.label.fr, entry.description.en, entry.description.fr]) {
      expect(text.trim()).not.toBe("");
      expect(text).not.toMatch(/[–—]/);
    }
  });
});

describe("the experimental feature set", () => {
  it("names the Settings > Experimental switches and never a host-reaching one", () => {
    expect([...EXPERIMENTAL_FEATURE_KEYS].sort()).toEqual(
      ["browser", "connectedApps", "dataWindow", "decisionModel", "meetingNotetaker", "skillAuthoring"],
    );
    for (const host of ["sharedComputers", "claudeUserMcp", "vpsComputer", "boatComputer"]) {
      expect(isExperimentalFeatureKey(host)).toBe(false);
    }
    expect(isExperimentalFeatureKey("dataWindow")).toBe(true);
  });
});

describe("experimentalOnlyConfigViolation", () => {
  it("allows a features-only patch of experimental keys", () => {
    expect(experimentalOnlyConfigViolation({ features: { dataWindow: true } })).toBeNull();
    expect(experimentalOnlyConfigViolation({ features: { browser: false, skillAuthoring: true } })).toBeNull();
    expect(experimentalOnlyConfigViolation({})).toBeNull();
  });

  it("refuses any non-feature field", () => {
    expect(experimentalOnlyConfigViolation({ profile: { name: "x" } })).toBe("profile");
    expect(experimentalOnlyConfigViolation({ features: { dataWindow: true }, signIn: {} })).toBe("signIn");
    expect(experimentalOnlyConfigViolation({ browserProfiles: [] })).toBe("browserProfiles");
  });

  it("refuses a host-reaching or unknown feature key", () => {
    expect(experimentalOnlyConfigViolation({ features: { vpsComputer: true } })).toBe("features.vpsComputer");
    expect(experimentalOnlyConfigViolation({ features: { sharedComputers: true } })).toBe("features.sharedComputers");
    expect(experimentalOnlyConfigViolation({ features: { nope: true } })).toBe("features.nope");
  });

  it("refuses a body that is not a plain object", () => {
    expect(experimentalOnlyConfigViolation(null)).toBe("body");
    expect(experimentalOnlyConfigViolation([])).toBe("body");
    expect(experimentalOnlyConfigViolation({ features: 5 })).toBe("features");
  });
});
