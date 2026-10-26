// Settings > Appearance > Sidebar shortcuts: a per-person choice on this
// device, seeded once from the experimental switches that used to show the
// rows (Connected apps, Browse Bots under `features.templates`).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
  };
}

let local: ReturnType<typeof memoryStorage>;

beforeEach(() => {
  vi.resetModules();
  local = memoryStorage();
  vi.stubGlobal("localStorage", local);
  vi.stubGlobal("window", new EventTarget());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const load = () => import("./sidebar-shortcuts-preferences");

describe("sidebar shortcuts preference", () => {
  it("follows the old experimental switches while the person has no stored choice, without writing on read", async () => {
    const preference = await load();
    expect(preference.sidebarShortcutsOn({ features: {} })).toBe(false);
    expect(preference.sidebarShortcutsOn(null)).toBe(false);
    expect(preference.sidebarShortcutsOn({ features: { templates: true } })).toBe(true);
    expect(local.setItem).not.toHaveBeenCalled();
  });

  it("migrates once: shown before means shown now, hidden before means hidden now", async () => {
    let preference = await load();
    expect(preference.migrateSidebarShortcuts({ features: { templates: true } })).toBe(true);
    expect(local.getItem(preference.SIDEBAR_SHORTCUTS_KEY)).toBe("1");
    // the stored value is the person's from now on, whatever the switches say
    expect(preference.migrateSidebarShortcuts({ features: {} })).toBe(false);
    expect(preference.sidebarShortcutsOn({ features: {} })).toBe(true);

    local.clear();
    vi.resetModules();
    preference = await load();
    expect(preference.migrateSidebarShortcuts({ features: { templates: false } })).toBe(true);
    expect(local.getItem(preference.SIDEBAR_SHORTCUTS_KEY)).toBe("0");
    expect(preference.sidebarShortcutsOn({ features: { templates: true } })).toBe(false);
  });

  it("does not migrate before the configuration is known", async () => {
    const preference = await load();
    expect(preference.migrateSidebarShortcuts(null)).toBe(false);
    expect(preference.migrateSidebarShortcuts(undefined)).toBe(false);
    expect(local.setItem).not.toHaveBeenCalled();
  });

  it("keeps an explicit choice through a reload, over the legacy value", async () => {
    let preference = await load();
    preference.setSidebarShortcuts(false);
    expect(local.getItem(preference.SIDEBAR_SHORTCUTS_KEY)).toBe("0");
    vi.resetModules();
    preference = await load();
    expect(preference.storedSidebarShortcuts()).toBe(false);
    expect(preference.sidebarShortcutsOn({ features: { templates: true } })).toBe(false);
    preference.setSidebarShortcuts(true);
    vi.resetModules();
    preference = await load();
    expect(preference.sidebarShortcutsOn({ features: {} })).toBe(true);
  });

  it("ignores a stored value it does not know and survives blocked storage", async () => {
    local.setItem("sagax-sidebar-shortcuts", "maybe");
    let preference = await load();
    expect(preference.storedSidebarShortcuts()).toBeUndefined();

    vi.stubGlobal("localStorage", {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
    });
    vi.resetModules();
    preference = await load();
    expect(preference.storedSidebarShortcuts()).toBeUndefined();
    preference.setSidebarShortcuts(true);
    expect(preference.sidebarShortcutsOn({ features: {} })).toBe(true);
  });
});
