// M-20261127-068: Advanced (former Developer) is a row at the end of General,
// gone from Updates beside About. Same label, summary and destination.
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSettingsSection } from "@/state/store";
import { setLocale } from "@/lib/i18n";
import { canonicalSubPageId, settingsTarget, SUB_PAGE_ALIASES } from "@/lib/settings-sections";

const fixture = vi.hoisted(() => ({
  section: "general" as AppSettingsSection,
  config: { rooms: { turnTimeoutMinutes: 5 } } as Record<string, unknown> | undefined,
}));
vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  api: vi.fn(),
  useStore: () => ({
    state: {
      appSettingsSection: fixture.section,
      appSettingsSubPage: null,
      instances: [],
      bots: [],
      groups: [],
      config: fixture.config,
    },
    dispatch: vi.fn(),
  }),
}));
vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => true, setAdvancedMode: () => {} }));
vi.mock("@/lib/updater", () => ({ useUpdaterState: () => ({ status: "idle", allowPrerelease: false }) }));
vi.mock("../DesktopCapabilities", () => ({ useDesktopCapabilities: () => ({ capabilities: {} }) }));

const { SettingsModal } = await import("../SettingsModal");
const lazy = await import("../lazy-settings-sections");
const render = () => renderToStaticMarkup(createElement(SettingsModal));
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

beforeAll(async () => {
  await Promise.all(Object.values(lazy).map((screen) => (screen as { preload?: () => Promise<unknown> }).preload?.()));
});
beforeEach(() => {
  fixture.section = "general";
  fixture.config = { rooms: { turnTimeoutMinutes: 5 } };
  setLocale("en");
  vi.stubGlobal("document", { documentElement: { dataset: {} } });
  vi.stubGlobal("window", { ogb: { updater: {}, exportDiagnostics: async () => "", exportLogs: async () => "" } });
});
afterEach(() => {
  vi.unstubAllGlobals();
  setLocale("en");
});

describe("Advanced on General (M-20261127-068)", () => {
  it("pins Advanced at the end of General with the same summary, and nowhere on Updates", () => {
    fixture.section = "general";
    const general = render();
    expect(general).toContain('data-settings-card="general.advanced"');
    expect(general).toContain("Advanced mode, diagnostics, logs, experimental features");
    expect(general).toMatch(/data-settings-card="general\.advanced"[\s\S]*Advanced/);
    const cards = [...general.matchAll(/data-settings-card="([^"]+)"/g)].map((match) => match[1]);
    expect(cards.at(-1)).toBe("general.advanced");

    fixture.section = "updates";
    const updates = render();
    expect(updates).toContain('data-settings-card="updates.about"');
    expect(updates).toContain("License, source and app tour");
    expect(updates).not.toContain('data-settings-card="updates.advanced"');
    expect(updates).not.toContain('data-settings-card="general.advanced"');
    expect(updates).not.toContain("Advanced mode, diagnostics, logs, experimental features");
  });

  it("keeps deep links and the old updates.advanced id on General > Advanced", () => {
    expect(settingsTarget("developer")).toEqual({ section: "general", subPage: "general.advanced" });
    expect(settingsTarget("experimental")).toEqual({ section: "general", subPage: "general.advanced" });
    expect(SUB_PAGE_ALIASES["updates.advanced"]).toBe("general.advanced");
    expect(canonicalSubPageId("updates.advanced")).toBe("general.advanced");
    expect(canonicalSubPageId("general.advanced")).toBe("general.advanced");
  });

  it("the General page source lists Advanced after System, and Updates no longer does", () => {
    const general = read("./AppPage.tsx");
    expect(general.indexOf('id="general.backups"')).toBeLessThan(general.indexOf('id="general.advanced"'));
    expect(general).toContain('summary={t("settings.sub.advanced.summary")}');
    const modal = read("../SettingsModal.tsx");
    expect(modal).toContain('<SubPageEntry id="updates.about"');
    expect(modal).not.toContain('<SubPageEntry id="updates.advanced"');
  });
});
