// The footer row, the way Perspicax lays out its account footer: the avatar
// and the full name, opening the profile menu. The sidebar's places are rows
// above it (SidebarPlaces.test.ts), so the tour's `tools` anchor is not here.
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppState } from "@/state/store";
import type { AchievementSnapshot } from "../../shared/achievements";
import { resetAchievementsForTests } from "@/lib/achievements";

const fixture = vi.hoisted(() => ({ state: {} as Partial<AppState>, badge: true }));
vi.mock("@/lib/routines-badge-preferences", () => ({ useShowRoutinesBadge: () => fixture.badge }));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({ state: { ...original.initialState, ...fixture.state }, dispatch: vi.fn() }) };
});

import { SidebarProfileMenu, SidebarRoutinesBadge } from "./SidebarProfileMenu";

/** The account trigger's opening tag (its class says how the name sits). */
const accountTag = (html: string) => /<span[^>]*data-sidebar-account="[^"]*"[^>]*>/.exec(html)?.[0] ?? "";

const place = (key: string, attention = false) => ({ key, label: key, attention, onSelect: () => {} });

const points = (): AchievementSnapshot => ({
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

beforeEach(() => {
  fixture.badge = true;
  fixture.state = { config: { profile: { name: "Jean-Baptiste Exemplar", email: "owner@example.com" } } as AppState["config"] };
  resetAchievementsForTests();
  vi.stubGlobal("window", {});
});
afterEach(() => { vi.unstubAllGlobals(); resetAchievementsForTests(); });

describe("sidebar footer row", () => {
  it("shows the avatar in its real colours and the full name, without the places' tour anchor", () => {
    const html = renderToStaticMarkup(createElement(SidebarProfileMenu, { places: [place("archived")] }));
    expect(html).toContain(">Jean-Baptiste Exemplar</span>");
    expect(html).not.toContain('data-tour="tools"');
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).not.toContain("footer-tint");
    expect(html).not.toContain("filter");
    expect(html).toContain(">JE<");
    expect(html).toContain("width:40px");
    expect(html).toContain("height:40px");
    expect(html).not.toContain('data-testid="footer-attention"');
  });

  const withBadge = () => {
    fixture.state = {
      config: { profile: { name: "Jean-Baptiste Exemplar", email: "owner@example.com" } } as AppState["config"],
      bots: [{ id: "b1" }] as AppState["bots"],
      routines: [{ id: "r1", botId: "b1", enabled: true, nextRunAt: 1 }] as AppState["routines"],
    };
  };

  it("shows my title and points under the name when both switches are on", () => {
    resetAchievementsForTests({ status: "ready", snapshot: points() });
    const html = renderToStaticMarkup(createElement(SidebarProfileMenu, {}));
    const nameAt = html.indexOf(">Jean-Baptiste Exemplar</span>");
    const lineAt = html.indexOf("data-member-line");
    expect(lineAt).toBeGreaterThan(nameAt);
    expect(html).toContain(">Commander<");
    expect(html).toContain(">195<");
    expect(html).toContain("data-gamertag");
    expect(html).not.toContain("-mt-[21px]");
  });

  it("drops the title and points line while the sidebar shortcuts take the room", () => {
    resetAchievementsForTests({ status: "ready", snapshot: points() });
    const html = renderToStaticMarkup(createElement(SidebarProfileMenu, { memberLine: false }));
    expect(html).toContain(">Jean-Baptiste Exemplar</span>");
    expect(html).not.toContain("data-member-line");
    expect(html).not.toContain(">Commander<");
    expect(html).not.toContain("data-gamertag");
  });

  it("shows only the title, or only the points, when one switch is off", () => {
    const base = points();
    resetAchievementsForTests({ status: "ready", snapshot: { ...base, settings: { ...base.settings, showPoints: false } } });
    let html = renderToStaticMarkup(createElement(SidebarProfileMenu, {}));
    expect(html).toContain(">Commander<");
    expect(html).not.toContain("data-gamertag");
    resetAchievementsForTests({ status: "ready", snapshot: { ...base, settings: { ...base.settings, showTitle: false } } });
    html = renderToStaticMarkup(createElement(SidebarProfileMenu, {}));
    expect(html).not.toContain(">Commander<");
    expect(html).toContain(">195<");
  });

  it("with both switches off the name stands alone, centred beside the avatar", () => {
    const base = points();
    resetAchievementsForTests({ status: "ready", snapshot: { ...base, settings: { ...base.settings, showPoints: false, showTitle: false } } });
    const html = renderToStaticMarkup(createElement(SidebarProfileMenu, {}));
    expect(html).toContain(">Jean-Baptiste Exemplar</span>");
    expect(html).not.toContain("data-member-line");
    expect(html).not.toContain(">Commander<");
    expect(html).not.toContain(">195<");
    expect(accountTag(html)).toContain("items-center");
    expect(html).not.toContain("data-routines-line");
  });

  it("hides the routines icon and count by default, even with active routines", () => {
    withBadge();
    fixture.badge = false;
    const html = renderToStaticMarkup(createElement(SidebarProfileMenu, {}));
    expect(html).not.toContain("data-routines-line");
    expect(html).not.toContain("data-active-routines");
    expect(html).toContain(">Jean-Baptiste Exemplar</span>");
  });

  it("puts the routines badge at the right of the row, beside the name, opening Automations", () => {
    fixture.state = {
      config: { profile: { name: "Jean-Baptiste Exemplar", email: "owner@example.com" } } as AppState["config"],
      bots: [{ id: "b1" }] as AppState["bots"],
      routines: [
        { id: "r1", botId: "b1", enabled: true, nextRunAt: 1 },
        { id: "r2", botId: "b1", enabled: true, nextRunAt: 2 },
        { id: "r3", botId: "b1", enabled: false, nextRunAt: null },
      ] as AppState["routines"],
    };
    resetAchievementsForTests({ status: "ready", snapshot: points() });
    const html = renderToStaticMarkup(createElement(SidebarProfileMenu, {}));
    const nameAt = html.indexOf(">Jean-Baptiste Exemplar</span>");
    const lineAt = html.indexOf("data-routines-line");
    const badgeAt = html.indexOf('data-active-routines="2"');
    expect(lineAt).toBeGreaterThan(nameAt);
    expect(badgeAt).toBeGreaterThan(lineAt);
    // right of the whole account block, same flex row, centred, never under the name
    expect(html).toContain('<div class="flex items-center gap-1"><div class="relative min-w-0 flex-1">');
    expect(html).toContain('class="flex shrink-0 items-center" data-routines-line=""');
    expect(html).not.toContain("-mt-[21px]");
    expect(html).not.toContain("pl-[46px]");
    expect(html).toContain('aria-label="2 active routines"');
    expect(html).toContain("lucide-calendar-clock");
    // bigger and never red: 18 px icon, regular sidebar text size, accent tone
    expect(html).toContain('width="18"');
    expect(html).toContain("text-[14px]");
    expect(html).toContain("text-accent-text");
    expect(html).not.toContain("text-danger");
    expect(html).toContain("<span>2</span>");
    // the count is its own button, never inside the menu's
    expect(html.lastIndexOf("</button>", badgeAt)).toBeGreaterThan(nameAt);
    expect(html).not.toContain('data-testid="footer-attention"');
  });

  it("keeps the badge right-aligned with both switches off", () => {
    withBadge();
    const base = points();
    resetAchievementsForTests({ status: "ready", snapshot: { ...base, settings: { ...base.settings, showPoints: false, showTitle: false } } });
    const html = renderToStaticMarkup(createElement(SidebarProfileMenu, {}));
    expect(html).toContain('data-active-routines="1"');
    expect(html).toContain('class="flex shrink-0 items-center" data-routines-line=""');
    expect(html).not.toContain("data-member-line");
  });

  it("says one routine in the singular", () => {
    fixture.state = {
      config: { profile: { name: "Jean-Baptiste Exemplar", email: "owner@example.com" } } as AppState["config"],
      bots: [{ id: "b1" }] as AppState["bots"],
      routines: [{ id: "r1", botId: "b1", enabled: true, nextRunAt: 1 }] as AppState["routines"],
    };
    const html = renderToStaticMarkup(createElement(SidebarProfileMenu, {}));
    expect(html).toContain('aria-label="1 active routine"');
  });

  it("carries a place's attention dot while the menu is closed", () => {
    const html = renderToStaticMarkup(createElement(SidebarProfileMenu, { places: [place("archived", true)] }));
    expect(html).toContain('data-testid="footer-attention"');
  });

  it("keeps the routines count and icon without any dot when an automation failed, and clears the failed label once seen", () => {
    fixture.state = {
      config: { profile: { name: "Jean-Baptiste Exemplar", email: "owner@example.com" } } as AppState["config"],
      bots: [{ id: "b1" }] as AppState["bots"],
      routines: [{ id: "r1", botId: "b1", enabled: true, nextRunAt: 1 }] as AppState["routines"],
      routineRuns: [{ status: "failed" }] as AppState["routineRuns"],
    };
    const failed = renderToStaticMarkup(createElement(SidebarProfileMenu, {}));
    expect(failed).not.toContain('data-testid="footer-attention"');
    expect(failed).toContain("data-attention");
    expect(failed).not.toContain("routines-attention-dot");
    expect(failed).not.toContain("text-danger");
    expect(failed).toContain('aria-label="1 active routine. A run failed: open Automations"');
    fixture.state = {
      ...fixture.state,
      routineRuns: [{ status: "failed", seenAt: 1 }] as AppState["routineRuns"],
    };
    const seen = renderToStaticMarkup(createElement(SidebarProfileMenu, {}));
    expect(seen).not.toContain("data-attention");
    expect(seen).not.toContain("routines-attention-dot");
    expect(seen).toContain('aria-label="1 active routine"');
  });

  it("falls back to the viewer's name for a member on a shared server", () => {
    fixture.state = { config: { viewer: { operator: false, principalId: "u1", email: "sam@example.com", name: "Sam Tremblay", role: "member", canCreateBots: false } } as AppState["config"] };
    const html = renderToStaticMarkup(createElement(SidebarProfileMenu, {}));
    expect(html).toContain(">Sam Tremblay</span>");
  });

  it("keeps the avatar-only trigger for the collapsed rail, without the tour anchor", () => {
    const html = renderToStaticMarkup(createElement(SidebarProfileMenu, { avatarOnly: true }));
    expect(html).not.toContain('data-tour="tools"');
    expect(html).not.toContain(">Jean-Baptiste Exemplar</span>");
    expect(html).toContain('title="Jean-Baptiste Exemplar"');
    expect(html).toContain("width:36px");
    expect(html).not.toContain("data-sidebar-account-row");
    expect(html).not.toContain("width:40px");
  });
});

describe("the foot's profile (the reference design's row)", () => {
  it("draws the avatar and the name, no background pill, that opens the account menu", () => {
    const html = renderToStaticMarkup(createElement(SidebarProfileMenu, { avatarOnly: true, withName: true }));
    const pill = /<span[^>]*data-sidebar-account-pill=""[^>]*>/.exec(html)?.[0] ?? "";
    expect(pill).toContain("rounded-full");
    expect(pill).toContain("h-[var(--foot-tile-h,2.25rem)]");
    expect(pill).toContain("[button:focus-visible:not([data-pointer-focus])&gt;&amp;]:ring-2");
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toMatch(/data-account-pill-name=""[^>]*>[^<]+<\/span>/);
    expect(html).toContain("width:36px");
    expect(pill).not.toContain("bg-sidebar-card");
    expect(pill).not.toContain("border-sidebar-hairline");
    // no title or points line in the pill, and not the wide row's layout
    expect(html).not.toContain("data-member-line");
    expect(html).not.toContain("data-sidebar-account-row");
  });

  it("fills the row and keeps room for its name when Connect apps widens", () => {
    const html = renderToStaticMarkup(createElement(SidebarProfileMenu, { avatarOnly: true, withName: true }));
    // the outer box takes the rest of the row; its floor is low (the avatar
    // and an ellipsis) so the English label is never cut from a 260px
    // sidebar: the label's own cap (styles.css) keeps the name its avatar and
    // about three characters when the label is longer
    const outer = /^<div class="([^"]*)"/.exec(html)?.[1] ?? "";
    expect(outer.split(" ")).toEqual(expect.arrayContaining(["flex-1", "min-w-[3.5rem]"]));
    const pill = /<span[^>]*data-sidebar-account-pill=""[^>]*>/.exec(html)?.[0] ?? "";
    expect(pill).toContain("w-full");
    // tight insets, so "Jean…" still shows beside the open label at 280px
    expect(pill.split(/[\s"]/)).toEqual(expect.arrayContaining(["gap-2", "pl-0.5", "pr-1"]));
    // the name is one line, cut only by the room it has (never in markup)
    const name = /<span data-account-pill-name="" class="([^"]*)"/.exec(html)?.[1] ?? "";
    expect(name.split(" ")).toEqual(expect.arrayContaining(["min-w-0", "flex-1", "truncate"]));
  });

  it("is wired in the sidebar's wide foot, the rail keeps the bare avatar", () => {
    const source = readFileSync(new URL("./Sidebar.tsx", import.meta.url), "utf8");
    expect(source).toContain("<SidebarFoot places={accountPlaces}");
    expect(source).toContain("<SidebarRailFoot places={accountPlaces}");
    const foot = readFileSync(new URL("./SidebarFoot.tsx", import.meta.url), "utf8");
    expect(foot).toContain("<SidebarProfileMenu avatarOnly withName places={places} />");
    // the rail's foot (chosen or automatic): the apps grid, then the bare avatar
    const rail = foot.slice(foot.indexOf("export function SidebarRailFoot"));
    expect(rail).toContain("<FootConnectApps apps={apps} onOpen={onOpenApps} />");
    expect(rail.slice(rail.indexOf("data-sidebar-account-rail"), rail.indexOf("data-sidebar-account-rail") + 200)).toContain("<SidebarProfileMenu avatarOnly places={places} />");
  });
});

describe("the footer avatar (Grok Bot's foot, 2026-10-16)", () => {
  it("draws no presence dot on the avatar", () => {
    fixture.state = { ...fixture.state, config: { ...fixture.state.config, viewer: { principalId: "pr_me" } } as AppState["config"] };
    const html = renderToStaticMarkup(createElement(SidebarProfileMenu, { avatarOnly: true }));
    expect(html).not.toContain("data-presence");
    // the dot only draws once presence is known, so the source says it too
    expect(readFileSync("src/components/SidebarProfileMenu.tsx", "utf8")).not.toContain("<PresenceDot");
  });
});

describe("the routines badge in Grok Bot's foot (Owner, 2026-10-16)", () => {
  const active = () => {
    fixture.state = {
      config: { profile: { name: "Jean-Baptiste Exemplar", email: "owner@example.com" } } as AppState["config"],
      bots: [{ id: "b1" }] as AppState["bots"],
      routines: [{ id: "r1", botId: "b1", enabled: true, nextRunAt: 1 }] as AppState["routines"],
    };
  };

  it("stands on its own, right of Connect apps, while the switch is on and a routine runs", () => {
    active();
    const html = renderToStaticMarkup(createElement(SidebarRoutinesBadge));
    expect(html).toContain('data-active-routines="1"');
    expect(html).toContain("data-routines-line");
  });

  it("draws nothing with the switch off or no active routine", () => {
    active();
    fixture.badge = false;
    expect(renderToStaticMarkup(createElement(SidebarRoutinesBadge))).toBe("");
    fixture.badge = true;
    fixture.state = { ...fixture.state, routines: [] };
    expect(renderToStaticMarkup(createElement(SidebarRoutinesBadge))).toBe("");
  });

  it("is wired right after the Connect apps pill in the sidebar foot", () => {
    const source = readFileSync(new URL("./SidebarFoot.tsx", import.meta.url), "utf8");
    const pill = source.indexOf("<FootConnectApps ");
    expect(pill).toBeGreaterThan(-1);
    expect(source.indexOf("<SidebarRoutinesBadge />", pill)).toBeGreaterThan(pill);
  });
});

// The wide foot's account pill (avatarOnly + withName) beside the Connect apps
// pill: the second line (title and points) lives in the pill, and both tiles
// take their height from the same custom property so they never differ.
describe("sidebar foot account pill: title and points line", () => {
  const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  const pill = (props: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(SidebarProfileMenu, { avatarOnly: true, withName: true, ...props }));
  const withSettings = (patch: Partial<AchievementSnapshot["settings"]>, extra: Partial<AchievementSnapshot> = {}) => {
    const base = points();
    resetAchievementsForTests({ status: "ready", snapshot: { ...base, ...extra, settings: { ...base.settings, ...patch } } });
  };

  it.each([
    [true, true],
    [true, false],
    [false, true],
    [false, false],
  ])("shows points %s and title %s as the toggles say", (showPoints, showTitle) => {
    withSettings({ showPoints, showTitle });
    const html = pill();
    expect(html).toContain(">Jean-Baptiste Exemplar</span>");
    expect(html.includes("data-member-line")).toBe(showPoints || showTitle);
    expect(html.includes(">Commander<")).toBe(showTitle);
    expect(html.includes("data-gamertag")).toBe(showPoints);
    expect(html.includes(">195<")).toBe(showPoints);
    expect(html.includes("data-account-pill-line")).toBe(showPoints || showTitle);
    // the name stays on top
    if (showPoints || showTitle) expect(html.indexOf("data-member-line")).toBeGreaterThan(html.indexOf(">Jean-Baptiste Exemplar</span>"));
  });

  it("takes the points from the achievements state, never a fixed number", () => {
    withSettings({}, { points: 1240 });
    const html = pill();
    expect(html).toContain(">1,240<");
    expect(html).not.toContain(">195<");
  });

  it("shows nothing while the achievements are not loaded, like today", () => {
    resetAchievementsForTests();
    const html = pill();
    expect(html).not.toContain("data-member-line");
    expect(html).not.toContain("data-account-pill-line");
  });

  it("never prints an id: the title is its human name", () => {
    withSettings({});
    expect(pill()).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  it("gives the account pill and the Connect apps pill one height, from one property", () => {
    const tile = "h-[var(--foot-tile-h,2.25rem)]";
    withSettings({});
    expect(pill()).toContain(tile);
    // the apps button beside it is the round size-9 tile (FootConnectApps);
    // the old square Connect apps pill left with the rail's Puzzle icon
    expect(css).toMatch(/\[data-sidebar-account-row\]\s*\{[^}]*--foot-tile-h:\s*2\.5rem/);
    expect(css).toMatch(/\[data-sidebar-account-row\]:has\(\[data-account-pill-line\]\)\s*\{[^}]*--foot-tile-h:\s*2\.875rem/);
  });
});

