// Refs #1939: Settings capture helpers — drawn page vs store, Advanced flag.
import { describe, expect, it } from "vitest";
import { SETTINGS_NAV_LABEL, SETTINGS_NEEDS_ADVANCED, SURFACES } from "../../ios/parity/desktop/surfaces.mjs";

describe("SETTINGS_NAV_LABEL", () => {
  it("names the English nav for Updates and Vault", () => {
    expect(SETTINGS_NAV_LABEL.updates).toBe("Updates");
    expect(SETTINGS_NAV_LABEL.credentials).toBe("Vault");
    expect(SETTINGS_NAV_LABEL.account).toBe("Account");
  });

  it("maps merged section ids to the host page label", () => {
    expect(SETTINGS_NAV_LABEL.memory).toBe("Organization");
    expect(SETTINGS_NAV_LABEL.privacy).toBe("Notifications");
    expect(SETTINGS_NAV_LABEL.connections).toBe("Providers");
    expect(SETTINGS_NAV_LABEL.general).toBe("Account");
  });
});

describe("SETTINGS_NEEDS_ADVANCED", () => {
  it("covers Simple-hidden sections that used to capture Account", () => {
    for (const id of ["voice", "providers", "import", "experimental", "engines", "computer", "backups"]) {
      expect(SETTINGS_NEEDS_ADVANCED.has(id), id).toBe(true);
    }
    expect(SETTINGS_NEEDS_ADVANCED.has("updates")).toBe(false);
    expect(SETTINGS_NEEDS_ADVANCED.has("credentials")).toBe(false);
    expect(SETTINGS_NEEDS_ADVANCED.has("account")).toBe(false);
  });
});

describe("SURFACES settings metadata", () => {
  it("marks Simple-hidden Settings surfaces as advanced", () => {
    const byId = Object.fromEntries(SURFACES.map((s) => [s.id, s]));
    expect(byId["settings-voice"].advanced).toBe(true);
    expect(byId["settings-providers"].advanced).toBe(true);
    expect(byId["settings-import"].advanced).toBe(true);
    expect(byId["settings-updates"].advanced).toBeUndefined();
    expect(byId["settings-credentials"].advanced).toBeUndefined();
  });

  it("keeps hover surfaces on keepPointer", () => {
    const byId = Object.fromEntries(SURFACES.map((s) => [s.id, s]));
    expect(byId["sidebar-row-hover"].keepPointer).toBe(true);
    expect(byId["chat-message-hover"].keepPointer).toBe(true);
  });
});
