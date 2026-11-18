// The compact sidebar (the reference design's "Activer ou désactiver la barre latérale
// compacte"): the icons rail, its expand button in the rail's foot, Enter on
// the edge, its arrow keys. The head no longer holds Collapse sidebar (#4484 reversed),
// the reference's button (sidebar panel icon, first in its top button row).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => true, setAdvancedMode: () => {} }));

import { setLocale } from "@/lib/i18n";
import { resetAchievementsForTests } from "@/lib/achievements";
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

import { Sidebar } from "./Sidebar";

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

describe("compact sidebar", () => {
  it("gives the rail an Expand sidebar button back to the full sidebar, in its foot", () => {
    fixture.density = "icons";
    const html = render();
    const toggle = (html.match(/<button[^>]*data-sidebar-compact-toggle[^>]*>/g) ?? [])[0] ?? "";
    expect(toggle).toContain('aria-expanded="false"');
    expect(toggle).toContain('aria-label="Expand sidebar"');
    expect(toggle).toContain('title="Expand sidebar"');
    expect(html).not.toContain("data-sidebar-collapse");
    // in the foot, not the head
    expect(html.indexOf("data-sidebar-compact-toggle")).toBeGreaterThan(html.indexOf("data-sidebar-foot"));
    expect(html).toContain("data-sidebar-rail");
    expect(html).toContain('aria-description="Enter turns the compact sidebar on or off"');
  });

  it.each(["comfortable", "compact"] as const)("has no Collapse sidebar button in the head (the bot panel's ... leads it), no rail toggle or rail keys at %s density", (density) => {
    fixture.density = density;
    const html = render();
    expect(html).not.toContain("data-sidebar-collapse");
    expect(html).not.toContain('aria-label="Collapse sidebar"');
    expect(html).not.toContain("data-sidebar-compact-toggle");
    expect(html).not.toContain("data-sidebar-rail");
  });

  it("speaks Québec French", () => {
    fixture.density = "icons";
    setLocale("fr");
    const html = render();
    expect(html).toContain('aria-label="Agrandir la barre latérale"');
    expect(html).toContain('aria-description="Entrée active ou désactive la barre latérale compacte"');
  });
});
