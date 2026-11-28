import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { SETTINGS } from "../../shared/settings-actions";
import { USER_PREFERENCE_KEYS } from "../../shared/user-preferences";
import { personWorkThreads } from "./person-work-threads";

describe("Person-work threads (#5289, D-20261127-040)", () => {
  afterEach(() => {
    personWorkThreads.set("off");
    try {
      globalThis.localStorage?.removeItem(personWorkThreads.key);
    } catch {
      // no storage
    }
  });

  it("is off by default for everyone, and remembers the person's choice", () => {
    try { globalThis.localStorage?.removeItem(personWorkThreads.key); } catch { /* no storage */ }
    expect(personWorkThreads.get()).toBe("off");
    personWorkThreads.set("on");
    expect(personWorkThreads.get()).toBe("on");
    personWorkThreads.set("off");
    expect(personWorkThreads.get()).toBe("off");
  });

  it("is one of the person's synced appearance keys, and a setting a bot can change", () => {
    expect(personWorkThreads.key).toBe("sagax.personWorkThreads.v1");
    expect(USER_PREFERENCE_KEYS).toContain(personWorkThreads.key);
    const spec = SETTINGS.find((setting) => setting.key === "appearance.personWorkThreads");
    expect(spec?.value).toBe("enum:on|off");
    expect(spec?.where).toContain("Sidebar");
  });

  it("the sidebar and the header picker read the choice, and Settings > Appearance > Sidebar holds its switch", () => {
    const sidebar = readFileSync(new URL("../components/Sidebar.tsx", import.meta.url), "utf8");
    expect(sidebar).toMatch(/personWorkThreads:\s*usePersonWorkThreads\(\)/);
    const picker = readFileSync(new URL("../components/TaskPicker.tsx", import.meta.url), "utf8");
    expect(picker).toMatch(/personWorkThreads:\s*usePersonWorkThreads\(\)/);
    const page = readFileSync(new URL("../components/settings/AppearanceSettings.tsx", import.meta.url), "utf8");
    expect(page).toContain('rowId="personWorkThreads"');
    const sidebarGroup = page.slice(page.indexOf('groupId="sidebar"'));
    expect(sidebarGroup.indexOf('rowId="personWorkThreads"')).toBeGreaterThan(-1);
    expect(sidebarGroup.indexOf('rowId="personWorkThreads"')).toBeLessThan(sidebarGroup.indexOf("</SettingsGroup>"));
  });
});
