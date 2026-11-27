// #4457 (the owner, 2026-11-16): Settings has the reference app's seven
// entries with no group title, and every setting keeps a home. This test
// walks the settings registry (the rail, the former page ids, the cards that
// moved by themselves, the sub-pages) so no setting is orphaned: each old
// place opens its new place, each sub-page belongs to a page of the rail and
// is reachable by a row of that page.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AppSettingsSection } from "@/state/settings-section";
import { CARD_HOME, OFF_RAIL_PAGES, RAIL_PAGES, SETTINGS_SUB_PAGES, settingsTarget, type SettingsSubPageId } from "@/lib/settings-sections";
import { railSections, SECTIONS } from "./settings-nav";

const src = join(__dirname, "..", "..");
const read = (path: string) => readFileSync(join(src, path), "utf8");
const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? walk(path) : [path];
});

/** Every page id the Settings dialog ever had (src/state/settings-section.ts). */
function everySectionId(): AppSettingsSection[] {
  const source = read("state/settings-section.ts");
  const union = source.slice(source.indexOf("export type AppSettingsSection"), source.indexOf("export type BotSettingsSection"));
  return [...union.matchAll(/\| "(\w+)"/g)].map((match) => match[1] as AppSettingsSection);
}

/** The table of the pull request: each former page, and where it lives now. */
const MOVES: Record<AppSettingsSection, { section: AppSettingsSection; subPage?: SettingsSubPageId }> = {
  account: { section: "general" },
  // the theme and accent are on General's Appearance card
  appearance: { section: "general" },
  notifications: { section: "general", subPage: "general.notifications" },
  general: { section: "general" },
  backups: { section: "general", subPage: "general.backups" },
  import: { section: "general", subPage: "general.backups" },
  security: { section: "security" },
  privacy: { section: "security" },
  permissions: { section: "security", subPage: "security.system" },
  credentials: { section: "credentials" },
  providers: { section: "providers" },
  connections: { section: "providers" },
  engines: { section: "providers", subPage: "providers.models" },
  decisionModel: { section: "providers", subPage: "providers.models" },
  connectedApps: { section: "providers", subPage: "providers.models" },
  voice: { section: "providers", subPage: "providers.voice" },
  usage: { section: "usage" },
  computer: { section: "computer" },
  updates: { section: "updates" },
  developer: { section: "general", subPage: "general.advanced" },
  experimental: { section: "general", subPage: "general.advanced" },
  about: { section: "updates", subPage: "updates.about" },
  organization: { section: "organization" },
  memory: { section: "organization" },
  // hidden since 2026-10-14 (Account then, General now)
  companion: { section: "general" },
  activity: { section: "general" },
  mail: { section: "general" },
  people: { section: "general" },
  workspaces: { section: "general" },
  // Published pages: Connect apps > Pages (openSettings), General as a section
  pages: { section: "general" },
};

const PLACES = new Set<string>([...RAIL_PAGES, ...OFF_RAIL_PAGES]);

describe("Settings: seven entries (#4457)", () => {
  it("the rail is General, Computer, Permissions, Vault, Providers, Usage, Updates, with no group title", () => {
    expect(railSections(SECTIONS).map((entry) => entry.id)).toEqual(["general", "computer", "security", "credentials", "providers", "usage", "updates"]);
    expect(SECTIONS.find((entry) => entry.id === "security")?.labelKey).toBe("settings.section.permissions");
    // Organization is off the rail; its page stays for the search and its address
    expect(SECTIONS.map((entry) => entry.id)).toContain("organization");
    expect(read("components/SettingsModal.tsx")).not.toMatch(/data-settings-nav-group|navGroupsFor/);
  });

  it("the footer links to the organization console, and only when one is linked", () => {
    const modal = read("components/SettingsModal.tsx");
    expect(modal).toMatch(/\{consoleIssuer && \(\s*<a\s/);
    expect(modal).toContain('data-settings-console-link=""');
    expect(modal).toContain('t("settings.consoleLink")');
  });

  it("every former page id opens its new place (the table of the pull request)", () => {
    const ids = everySectionId();
    expect(ids.length).toBeGreaterThan(25);
    // the table names each of them: none is orphaned
    expect(Object.keys(MOVES).sort()).toEqual([...ids].sort());
    for (const id of ids) {
      const target = settingsTarget(id);
      expect(target, id).toEqual(MOVES[id]);
      expect(PLACES.has(target.section), `${id} -> ${target.section}`).toBe(true);
    }
  });

  it("every card that moved by itself lands on a page of the rail (or Organization)", () => {
    for (const card of Object.keys(CARD_HOME)) {
      const target = settingsTarget("general", card);
      expect(PLACES.has(target.section), `${card} -> ${target.section}`).toBe(true);
      if (target.subPage) expect(SETTINGS_SUB_PAGES[target.subPage].section, card).toBe(target.section);
    }
    // the keys, rules and tool access are one page further on Permissions
    expect(settingsTarget("security", "security.keys")).toEqual({ section: "security", subPage: "security.keys" });
    expect(settingsTarget("security", "myApprovalRules")).toEqual({ section: "security", subPage: "security.rules" });
    expect(settingsTarget("voice", "voice.microphone")).toEqual({ section: "general" });
  });

  it("every sub-page belongs to a page of the rail, has its content, and a row opens it", () => {
    const content = read("components/settings/settings-sub-pages.tsx");
    const sources = walk(join(src, "components")).filter((path) => path.endsWith(".tsx") && !path.includes(".test.")).map((path) => readFileSync(path, "utf8")).join("\n");
    for (const [id, info] of Object.entries(SETTINGS_SUB_PAGES)) {
      expect(RAIL_PAGES as readonly string[], id).toContain(info.section);
      expect(content, id).toContain(`"${id}": {`);
      // a "▸" row (SubPageEntry) or an Edit row (openSubPage) on its page
      expect(sources.includes(`<SubPageEntry id="${id}"`) || sources.includes(`openSubPage("${id}")`) || id === "account.crop" || id === "usage.traces", id).toBe(true);
    }
  });

  it("the old Appearance id opens General, where the theme and accent are, and the mascots open their page", async () => {
    expect(settingsTarget("appearance")).toEqual({ section: "general" });
    const general = read("components/settings/AppPage.tsx");
    expect(general).toMatch(/generalAppearance[\s\S]*<AppearanceThemeRows \/>/);
    // the mascot cards' old ids open General > Mascots
    expect(settingsTarget("appearance", "appearance.mascots")).toEqual({ section: "general", subPage: "general.mascots" });
    expect(settingsTarget("appearance", "appearance.mascots-hd")).toEqual({ section: "general", subPage: "general.mascots" });
    // the openers that still name "appearance": the Appearance command (retro skins), the achievements screen
    for (const path of ["components/retro98/RetroChrome.tsx", "components/retro-assistant/RetroAssistant.tsx", "gallery/achievements-screen.tsx"]) {
      expect(read(path), path).toContain('section: "appearance"');
    }
    const { initialState, reducer } = await import("@/state/store");
    const opened = reducer(initialState, { type: "toggleAppSettings", open: true, section: "appearance" });
    expect(opened.appSettingsSection).toBe("general");
    expect(opened.appSettingsSubPage).toBeNull();
    // a mascot's own "Settings" item opens General > Mascots
    expect(read("components/floating-bots/floating-handle.ts")).toContain('{ type: "toggleAppSettings", open: true, section: "general", subPage: "general.mascots" }');
  });

  it("the reducer opens an old page at its new place", async () => {
    const { initialState, reducer } = await import("@/state/store");
    const opened = reducer(initialState, { type: "toggleAppSettings", open: true, section: "voice" });
    expect(opened.appSettingsSection).toBe("providers");
    expect(opened.appSettingsSubPage).toBe("providers.voice");
    const account = reducer(initialState, { type: "toggleAppSettings", open: true, section: "account" });
    expect(account.appSettingsSection).toBe("general");
    expect(account.appSettingsSubPage).toBeNull();
  });
});
