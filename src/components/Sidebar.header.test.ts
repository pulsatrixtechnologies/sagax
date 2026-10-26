// Density is an occasional preference chosen in Settings > Appearance; the
// Sagax sidebar head keeps only its frequent controls (search and New). The
// edge collapses it: see `sidebarDragTarget` in sidebar-preferences.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => true, setAdvancedMode: () => {} }));

import { setLocale, t } from "@/lib/i18n";
import { resetAchievementsForTests } from "@/lib/achievements";
import type { AchievementSnapshot } from "../../shared/achievements";
import type { SidebarDensity } from "@/lib/sidebar-preferences";
import { StoreProvider } from "@/state/store";

const fixture = vi.hoisted(() => ({ showLogo: true, density: "comfortable" as SidebarDensity, shortcuts: false }));

vi.mock("@/lib/sidebar-preferences", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/sidebar-preferences")>(),
  useSidebarDensity: () => fixture.density,
}));

vi.mock("@/lib/sidebar-shortcuts-preferences", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/sidebar-shortcuts-preferences")>(),
  useSidebarShortcuts: () => fixture.shortcuts,
  migrateSidebarShortcuts: () => false,
}));

vi.mock("@/lib/sidebar-logo-preferences", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/sidebar-logo-preferences")>(),
  useShowSidebarLogo: () => fixture.showLogo,
}));

import { paletteShortcutLabel, Sidebar } from "./Sidebar";

const achievementSnapshot = (): AchievementSnapshot => ({
  points: 195,
  maxPoints: 1500,
  level: { level: 2, from: 0, to: 200 },
  unlockedCount: 0,
  count: 0,
  streak: 0,
  rewards: [],
  recent: [],
  items: [],
  settings: { showPoints: true, showTitle: true, toasts: true, native: false, public: false, title: "commander" },
});

const render = () => renderToStaticMarkup(
  createElement(StoreProvider, null, createElement(Sidebar, { open: true, onClose: () => {} })),
);

beforeEach(() => {
  vi.stubGlobal("window", { innerWidth: 1280, location: { protocol: "http:", search: "" } });
  setLocale("en");
});

afterEach(() => {
  vi.unstubAllGlobals();
  fixture.shortcuts = false;
  fixture.density = "comfortable";
  resetAchievementsForTests();
  setLocale("en");
});

describe("sidebar header", () => {
  it.each(["comfortable", "compact", "icons"] as const)(
    "keeps search and New but no collapse button or density menu at %s density",
    (density) => {
      fixture.density = density;
      const html = render();
      expect(html).toContain('aria-label="New"');
      expect(html).not.toContain("data-sidebar-collapse");
      expect(html).not.toContain('aria-label="Expand sidebar"');
      expect(html).not.toContain('aria-label="Collapse sidebar to avatars"');
      expect(html).not.toContain("lucide-panel-left");
      expect(html).not.toContain("Choose sidebar density");
      expect(html).not.toContain('title="Sidebar density"');
    },
  );

  it.each(["comfortable", "compact", "icons"] as const)(
    "draws New as a round button like search, with upstream's plus glyph, at %s density",
    (density) => {
      fixture.density = density;
      const html = render();
      const news = html.match(/<button[^>]*data-sidebar-new[^>]*>[\s\S]*?<\/button>/g) ?? [];
      expect(news).toHaveLength(1);
      expect(news[0]).toContain('title="New"');
      expect(news[0]).toContain("lucide-plus");
      expect(news[0]).not.toContain("lucide-square-pen");
      const search = (html.match(/<button[^>]*data-sidebar-search[^>]*>/g) ?? [])[0] ?? "";
      const classOf = (tag: string) => /class="([^"]*)"/.exec(tag)?.[1];
      expect(classOf(news[0] ?? "")).toBe(classOf(search));
    },
  );

  it.each(["comfortable", "icons"] as const)(
    "keeps the edge separator (drag, double-click) at %s density, quiet at rest",
    (density) => {
      fixture.density = density;
      const html = render();
      const handle = (html.match(/<div[^>]*role="separator"[^>]*aria-label="Resize sidebar"[^>]*>/g) ?? [])[0] ?? "";
      expect(handle).toContain("app-resize-handle");
      expect(handle).toContain('aria-valuemin="80"');
      expect(handle).toContain(density === "icons" ? 'aria-valuenow="80"' : 'aria-valuenow="280"');
      expect(handle).not.toMatch(/bg-accent|w-3\b/);
    },
  );

  it.each(["comfortable", "compact", "icons"] as const)(
    "puts search in a round head button, not a full-width bar, at %s density",
    (density) => {
      fixture.density = density;
      const html = render();
      const buttons = html.match(/<button[^>]*data-sidebar-search[^>]*>/g) ?? [];
      expect(buttons).toHaveLength(1);
      expect(buttons[0]).toContain('aria-label="Search bots and messages"');
      expect(buttons[0]).toMatch(/aria-keyshortcuts="(Meta|Control)\+K"/);
      expect(buttons[0]).toMatch(/title="Search \((⌘K|Ctrl\+K)\)"/);
      expect(buttons[0]).toContain("rounded-full");
      expect(buttons[0]).toContain("focus-visible:ring-2");
      expect(buttons[0]).not.toContain("w-full");
      expect(html).not.toContain("Search…");
      expect(html).not.toContain("<kbd");
    },
  );

  // The foot (reference design): the account pill (avatar and name, the
  // account menu) and the plain Connect apps button, whatever Sidebar
  // shortcuts said. No Browse Bots row: Browse Bots is in the account menu.
  it.each([true, false])("draws only the account pill and the Connect apps button at the foot (shortcuts %s)", (shortcuts) => {
    fixture.density = "comfortable";
    fixture.shortcuts = shortcuts;
    resetAchievementsForTests({ status: "ready", snapshot: achievementSnapshot() });
    const html = render();
    const foot = html.slice(html.indexOf("data-sidebar-foot"));
    expect(foot).toContain("data-sidebar-account-row");
    // the row is the container the open label's cap measures (100cqw)
    const row = /<div data-sidebar-account-row="[^"]*" class="([^"]*)"/.exec(foot)?.[1] ?? "";
    expect(row.split(" ")).toEqual(expect.arrayContaining(["gap-1.5", "[container-type:inline-size]"]));
    expect(foot).not.toContain("data-sidebar-place=");
    expect(foot).not.toContain(">Browse Bots</span>");
    expect(foot).not.toContain("data-account-name");
    // Show my title / Show my points are on: the line sits under the name
    expect(foot).toContain("data-member-line");
    const buttons = foot.match(/<button[^>]*data-sidebar-connect-apps[^>]*>[\s\S]*?<\/button>/g) ?? [];
    expect(buttons).toHaveLength(1);
    const pill = buttons[0] ?? "";
    expect(pill).toContain('type="button"');
    expect(pill).toContain('data-tour="nav-apps"');
    // a plain rounded-lg nav button, no longer the removed round pill
    expect(pill).toContain("rounded-lg");
    expect(pill).not.toContain("rounded-full");
    expect(pill).not.toContain("sidebar-apps-pill");
    // it gives its label up before the account pill's minimum
    expect(pill).toContain("min-w-0");
    expect(pill.slice(0, pill.indexOf(">"))).not.toContain("shrink-0");
    // same height as the account pill (the --foot-tile-h tile of #980)
    expect(pill).toContain("h-[var(--foot-tile-h,2.25rem)]");
    // the label is always shown (no hover reveal), as a truncating span
    expect(pill).toMatch(/<span class="truncate">Connect apps<\/span>/);
    expect(pill).toContain("lucide-puzzle");
    // the account pill carries the avatar and the name
    expect(foot).toContain("data-sidebar-account-pill");
    expect(foot).toContain("data-account-pill-name");
    // the avatar comes first, then the pill
    expect(foot.indexOf("aria-haspopup")).toBeLessThan(foot.indexOf("data-sidebar-connect-apps"));
    expect(html).toMatch(/data-sidebar-foot[^>]*class="px-4 pb-4"/);
  });

  it("always draws the Connect apps button, wide or collapsed (no feature flag any more)", () => {
    expect(render()).toContain("data-sidebar-connect-apps");
    fixture.density = "icons";
    expect(render()).toContain("data-sidebar-connect-apps");
    expect(render()).toContain("data-sidebar-account-rail");
  });

  it("keeps one Connect apps icon on the collapsed rail", () => {
    fixture.density = "icons";
    const html = render();
    expect((html.match(/<button[^>]*data-sidebar-connect-apps[^>]*>/g) ?? [])[0]).toContain('aria-label="Connect apps"');
    // one entry for apps and bots: Browse Bots is a tab of Connect apps
    expect(html).not.toContain('aria-label="Browse Bots"');
    expect(html).not.toContain('data-place-anim="grid"');
    expect(html).toContain("data-sidebar-account-rail");
  });

  it("hides the brand row when the sidebar logo is turned off, keeping search and New", () => {
    expect(render()).toContain("data-sidebar-brand");
    fixture.showLogo = false;
    try {
      const html = render();
      expect(html).not.toContain("data-sidebar-brand");
      expect(html).toContain("data-sidebar-search");
    } finally {
      fixture.showLogo = true;
    }
  });

  it("spells the palette chord per platform", () => {
    expect(paletteShortcutLabel(true)).toBe("⌘K");
    expect(paletteShortcutLabel(false)).toBe("Ctrl+K");
    setLocale("fr");
    expect(t("sidebar.search")).toBe("Rechercher");
  });

  it("keeps no .sidebar-apps-pill or .connect-apps-pill rule in styles.css (the label always shows)", () => {
    const css = readFileSync(resolve(__dirname, "../styles.css"), "utf8");
    expect(css).not.toContain("sidebar-apps-pill");
    expect(css).not.toContain("connect-apps-pill");
    expect(css).not.toContain("connect-apps-tile-in");
    // the equal-height foot tiles (#980) stay
    expect(css).toContain("--foot-tile-h: 2.25rem");
  });
});
