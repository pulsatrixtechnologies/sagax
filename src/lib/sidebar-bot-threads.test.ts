import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { SETTINGS } from "../../shared/settings-actions";
import { USER_PREFERENCE_KEYS } from "../../shared/user-preferences";
import { sidebarBotThreads } from "./sidebar-bot-threads";
import { partitionSidebarGroups } from "./sidebar-layout";

describe("Show Bot threads (#5239)", () => {
  afterEach(() => {
    sidebarBotThreads.set("off");
    try {
      globalThis.localStorage?.removeItem(sidebarBotThreads.key);
    } catch {
      // no storage
    }
  });

  it("is off by default for everyone, and remembers the person's choice", () => {
    try { globalThis.localStorage?.removeItem(sidebarBotThreads.key); } catch { /* no storage */ }
    expect(sidebarBotThreads.get()).toBe("off");
    sidebarBotThreads.set("on");
    expect(sidebarBotThreads.get()).toBe("on");
    sidebarBotThreads.set("off");
    expect(sidebarBotThreads.get()).toBe("off");
  });

  it("is one of the person's synced appearance keys, and a setting a bot can change", () => {
    expect(sidebarBotThreads.key).toBe("sagax.sidebarBotThreads.v1");
    expect(USER_PREFERENCE_KEYS).toContain(sidebarBotThreads.key);
    const spec = SETTINGS.find((setting) => setting.key === "appearance.sidebarBotThreads");
    expect(spec?.value).toBe("enum:on|off");
    expect(spec?.where).toContain("Sidebar");
  });

  it("leaves the section out of the sidebar when off, without touching the threads or the rooms", () => {
    const dm = { id: "dm", dm: true, section: "Work" };
    const groups = [dm, { id: "project", section: "Work" }, { id: "general" }];
    const off = partitionSidebarGroups(groups, { botThreads: false });
    expect(off.botChats).toEqual([]);
    expect(off.sectionedRooms.map((room) => room.id)).toEqual(["project"]);
    expect(off.unsectionedRooms.map((room) => room.id)).toEqual(["general"]);
    // the thread itself is untouched, and never filed with the rooms
    expect(dm).toEqual({ id: "dm", dm: true, section: "Work" });
    expect(groups).toHaveLength(3);
    const on = partitionSidebarGroups(groups, { botThreads: true });
    expect(on.botChats).toEqual([dm]);
  });

  it("the sidebar reads the choice, and Settings > Appearance > Sidebar holds its switch", () => {
    const roster = readFileSync(new URL("../components/Sidebar.tsx-parts/useSidebarRoster.tsx", import.meta.url), "utf8");
    expect(roster).toMatch(/const botThreads = useSidebarBotThreads\(\);[\s\S]*partitionSidebarGroups\(visibleGroups, \{ peopleApart, botThreads \}\)/);
    const page = readFileSync(new URL("../components/settings/AppearanceSettings.tsx", import.meta.url), "utf8");
    expect(page).toContain('rowId="sidebarBotThreads"');
    const sidebarGroup = page.slice(page.indexOf('groupId="sidebar"'));
    expect(sidebarGroup.indexOf('rowId="sidebarBotThreads"')).toBeGreaterThan(-1);
    expect(sidebarGroup.indexOf('rowId="sidebarBotThreads"')).toBeLessThan(sidebarGroup.indexOf("</SettingsGroup>"));
  });
});
