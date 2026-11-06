// The achievements' drawing: never in the sidebar footer, the member card,
// the unlock toast, the catalog's icons, the page, and its own page.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppState } from "@/state/store";
import { ACHIEVEMENTS } from "../../../shared/achievements-catalog";
import type { AchievementSnapshot } from "../../../shared/achievements";
import { resetAchievementsForTests } from "@/lib/achievements";
import { setLocale } from "@/lib/i18n";

const fixture = vi.hoisted(() => ({ state: {} as Partial<AppState> }));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({ state: { ...original.initialState, ...fixture.state }, dispatch: vi.fn() }) };
});

import { SidebarProfileMenu } from "../SidebarProfileMenu";
import { AchievementToast } from "./AchievementToaster";
import { AchievementsPage } from "./AchievementsPage";
import { AchievementsScreen, ACHIEVEMENTS_SCREEN_CATEGORIES, achievementCategoryCounts } from "./AchievementsScreen";
import { SECTIONS } from "../SettingsModal";
import { ACHIEVEMENT_ICONS } from "./icons";
import { MemberCard, memberCardRows, publicMemberRows } from "./MemberCard";

function snapshot(partial: Partial<AchievementSnapshot> = {}): AchievementSnapshot {
  return {
    points: 1240,
    maxPoints: 1500,
    level: { level: 7, from: 1050, to: 1400 },
    unlockedCount: 2,
    count: ACHIEVEMENTS.length,
    streak: 4,
    rewards: [],
    recent: ["hello-bot"],
    items: ACHIEVEMENTS.map((item) => ({ id: item.id, current: item.id === "small-family" ? 2 : 0, target: item.id === "small-family" ? 3 : 1, ...(item.id === "hello-bot" || item.id === "first-words" ? { unlockedAt: 1 } : {}) })),
    settings: { showPoints: true, showTitle: true, toasts: true, native: false, public: false },
    ...partial,
  };
}

beforeEach(() => {
  setLocale("en");
  fixture.state = { config: { profile: { name: "Ada Lovelace", email: "ada@example.com" } } as AppState["config"], achievementsFocus: { category: "all", nonce: 0 } };
  vi.stubGlobal("window", {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetAchievementsForTests();
});

describe("member card", () => {
  it("shows the title and the points on my own footer row only while their switches are on", () => {
    const cases: Array<[boolean, boolean]> = [[true, true], [false, true], [true, false], [false, false]];
    for (const [showPoints, showTitle] of cases) {
      const settings = { showPoints, showTitle, toasts: true, native: false, public: true, title: "rookie" };
      resetAchievementsForTests({ status: "ready", snapshot: snapshot({ settings }) });
      const html = renderToStaticMarkup(createElement(SidebarProfileMenu, {}));
      expect(html).toContain(">Ada Lovelace</span>");
      expect(html.includes("data-gamertag")).toBe(showPoints);
      expect(html.includes("1,240")).toBe(showPoints);
      expect(html.includes(">Rookie<")).toBe(showTitle);
      expect(html.includes("data-member-line")).toBe(showPoints || showTitle);
    }
  });

  it("centres the name beside the avatar when the card has no title and no points", () => {
    const bare = renderToStaticMarkup(createElement(MemberCard, { name: "Ada Lovelace", initials: "AL", title: null, pointsText: null, rows: [] }));
    expect(bare).toContain("member-card-head");
    expect(bare).toContain("data-member-highlight");
    expect(bare).not.toContain("Level");
    expect(bare).not.toContain("lucide-trophy");
    // the name is the only line next to the avatar: no empty second line
    const head = bare.slice(bare.indexOf("member-card-head"), bare.indexOf("</div></div></div>"));
    expect(head).toContain("member-card-identity");
    expect(head).toContain("Ada Lovelace");
    expect(head).not.toContain("data-member-title");
    expect(head).not.toContain("data-member-points");
    expect(bare).toContain("width:64px");
    const titled = renderToStaticMarkup(createElement(MemberCard, { name: "Ada Lovelace", initials: "AL", title: "Rookie", pointsText: null, rows: [] }));
    expect(titled).toContain("data-member-title");
    expect(titled).toContain(">Rookie<");
    expect(titled).not.toContain("lucide-trophy");
    const panel = renderToStaticMarkup(createElement(MemberCard, { name: "Ada Lovelace", initials: "AL", title: "Rookie", pointsText: "1,240", rows: [], variant: "panel" }));
    expect(panel).toContain("data-member-variant=\"panel\"");
    expect(panel).toContain("member-card-head");
    expect(panel).toContain("width:72px");
    expect(panel).toContain("data-member-title");
    expect(panel).toContain("data-member-points");
  });

  it("lists an unlocked achievement and hides a locked secret", () => {
    const rows = memberCardRows(snapshot());
    expect(rows.some((row) => row.id === "hello-bot" && row.unlocked)).toBe(true);
    expect(rows.some((row) => row.id === "konami")).toBe(false);
    const html = renderToStaticMarkup(createElement(MemberCard, {
      name: "Ada Lovelace",
      initials: "AL",
      title: "Rookie",
      pointsText: "1,240",
      level: 7,
      rows,
      onOpenPage: () => {},
    }));
    expect(html).toContain("data-member-card");
    expect(html).toContain("data-member-highlight");
    expect(html).toContain("Ada Lovelace");
    expect(html).toContain("data-member-title");
    expect(html).toContain("Rookie");
    expect(html).toContain("data-member-points");
    expect(html).toContain("1,240");
    expect(html).toContain("Level 7");
    expect(html.indexOf("data-member-highlight")).toBeLessThan(html.indexOf("member-card-list"));
    expect(html).toMatch(/It(?:'|&#x27;)s Alive!/);
    expect(html).toContain('data-achievement="hello-bot"');
    expect(html).toContain("data-unlocked");
    expect(html).not.toContain("Up Up Down Down");
    expect(html).not.toContain('data-achievement="konami"');
    // a locked achievement that is not a secret stays, dim, with progress
    expect(html).toContain('data-achievement="small-family"');
    expect(html).toContain("data-locked");
    expect(html).toContain("2/3");
    expect(html).toContain("View achievements");
    expect(html).toContain("member-card-list");
    // a public card only has unlocked ids, so a locked secret cannot appear
    const shared = publicMemberRows([
      { id: "first-words", points: 5 },
      { id: "konami", points: 50 },
    ]);
    expect(shared.map((row) => row.name)).toEqual(["First Words", "Up Up Down Down"]);
    const hidden = renderToStaticMarkup(createElement(MemberCard, {
      name: "Ada Lovelace",
      initials: "AL",
      title: null,
      pointsText: "5",
      level: 1,
      rows: publicMemberRows([{ id: "first-words", points: 5 }]),
    }));
    expect(hidden).toContain("First Words");
    expect(hidden).not.toContain("Up Up Down Down");
    expect(hidden).not.toContain('data-achievement="konami"');
  });
});

describe("unlock toast", () => {
  it("names the achievement, its points and what it unlocked", () => {
    const html = renderToStaticMarkup(createElement(AchievementToast, { id: "month-streak", leaving: false, onDismiss: () => {} }));
    expect(html).toContain("Achievement unlocked");
    expect(html).toContain("+100");
    expect(html).toContain("Unstoppable");
    expect(html).toContain("Skin unlocked: Galaxy (Owl)");
    expect(html).toContain('data-tier="legendary"');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    setLocale("fr");
    const fr = renderToStaticMarkup(createElement(AchievementToast, { id: "trombi-summoned", leaving: false, onDismiss: () => {} }));
    expect(fr).toContain("Succès débloqué");
    expect(fr).toContain("Personnage débloqué : Trombi");
  });

  it("reveals the crab on the claude-linked toast", () => {
    resetAchievementsForTests({ status: "ready", snapshot: snapshot() });
    const html = renderToStaticMarkup(createElement(AchievementToast, { id: "claude-linked", leaving: false, onDismiss: () => {} }));
    expect(html).toContain("Claude Linked");
    expect(html).toContain("Character unlocked: Crab");
    expect(html).toContain("achievement-toast-preview");
    expect(html).not.toContain("a surprise character");
  });
});

// 2026-10-28: a sister of Automations (content-page.tsx): its header, its
// Filters and ☰ menu, its centred column, its sections and rows.
const slice = (html: string, attribute: string) => html.slice(html.indexOf(attribute), html.indexOf("</li>", html.indexOf(attribute)));
const headerOf = (html: string) => html.slice(html.indexOf("<header"), html.indexOf("</header>"));

describe("achievements page body", () => {
  it("shows the heading with the level, the recent unlocks and a section of rows per category on All", () => {
    resetAchievementsForTests({ status: "ready", snapshot: snapshot() });
    const html = renderToStaticMarkup(createElement(AchievementsPage, { category: "all" }));
    expect(html).toContain("data-achievements-page");
    // the heading: the category, its unlocked count, then the level, its bar and what is left
    expect(html).toMatch(/<h2[^>]*>All achievements<\/h2>/);
    expect(html).toContain(`2 of ${ACHIEVEMENTS.length} unlocked`);
    expect(html).toContain("Level 7");
    expect(html).toContain('aria-valuenow="190"');
    expect(html).toContain("160 to the next level");
    // recent unlocks, a section of its own, as rows
    expect(html).toContain('data-achievement-recent=""');
    expect(html).toMatch(/<h2[^>]*>Recent unlocks<\/h2>/);
    expect(html).toContain('data-recent-achievement="hello-bot"');
    // one section per category, in order, each with its unlocked/total count
    const sections = [...html.matchAll(/data-achievement-section="([a-z]+)"/g)].map((match) => match[1]);
    expect(sections).toEqual(["onboarding", "productivity", "power", "voice", "claude", "collaboration", "streaks", "mastery", "tiers", "secrets"]);
    const onboarding = ACHIEVEMENTS.filter((item) => item.category === "onboarding").length;
    expect(html).toContain(`>2/${onboarding}</span>`);
    // rows, not cards: the shared row of the Automations list
    expect(html).not.toContain("achievement-card");
    const row = /<li class="([^"]*)" data-tier="[a-z]+" data-unlocked="" data-achievement="hello-bot"/.exec(html)?.[1] ?? "";
    // 2dfc4b2a0 put shared rows on the closed spacing scale: 8px gap/padding.
    for (const name of ["achievement-row", "flex", "gap-2", "rounded-lg", "px-2", "py-2", "items-start", "hover:bg-hover"]) expect(row.split(" "), name).toContain(name);
    const hello = slice(html, 'data-achievement="hello-bot"');
    expect(hello).toContain("achievement-row-badge");
    expect(hello).toMatch(/data-achievement-row-points=""[^>]*>10<\/span>/);
    expect(hello).toContain("achievement-row-tier");
    expect(hello).toContain("a surprise look");
    // a locked row's progress, as numbers too
    const family = slice(html, 'data-achievement="small-family"');
    expect(family).toContain('aria-valuenow="2"');
    expect(family).toContain(">2/3</span>");
    expect(family).not.toContain("data-unlocked");
    for (const item of ACHIEVEMENTS) expect(html).toContain(`data-achievement="${item.id}"`);
    // a secret stays a secret until found
    expect(html).toMatch(/data-achievement="konami" data-secret=""/);
    expect(html).not.toContain("Up Up Down Down");
    // the settings are a section of the ☰ menu, not on this page
    expect(html).not.toContain("Show my points");
  });

  it("shows the share of people who have one when the server says it", () => {
    const items = snapshot().items.map((item) => (item.id === "hello-bot" ? { ...item, percent: 42 } : item));
    resetAchievementsForTests({ status: "ready", snapshot: snapshot({ items }) });
    const html = renderToStaticMarkup(createElement(AchievementsPage, { category: "onboarding" }));
    expect(slice(html, 'data-achievement="hello-bot"')).toContain("42% of people");
  });

  it("shows one category's rows under its heading, without the recent unlocks", () => {
    resetAchievementsForTests({ status: "ready", snapshot: snapshot() });
    const html = renderToStaticMarkup(createElement(AchievementsPage, { category: "voice" }));
    expect(html).toMatch(/<h2[^>]*>Voice<\/h2>/);
    expect(html).toContain("Level 7");
    expect(html).not.toContain("data-recent-achievement");
    // the heading names it once: no section heading repeats it
    expect(html).not.toContain("data-achievement-section");
    for (const item of ACHIEVEMENTS) expect(html.includes(`data-achievement="${item.id}"`), item.id).toBe(item.category === "voice");
  });

  it("narrows by status, reward and search together, and says so when nothing is left", () => {
    resetAchievementsForTests({ status: "ready", snapshot: snapshot() });
    const unlocked = renderToStaticMarkup(createElement(AchievementsPage, { status: "unlocked" }));
    expect([...unlocked.matchAll(/ data-achievement="([^"]+)"/g)].map((match) => match[1]).sort()).toEqual(["first-words", "hello-bot"]);
    // a narrowed list leaves the recent unlocks out, and the empty sections
    expect(unlocked).not.toContain("data-recent-achievement");
    expect([...unlocked.matchAll(/data-achievement-section="([a-z]+)"/g)].map((match) => match[1])).toEqual(["onboarding"]);
    const none = renderToStaticMarkup(createElement(AchievementsPage, { search: "zzzz-nothing" }));
    expect(none).toContain('data-achievements-empty=""');
    expect(none).toContain("No achievement matches these filters.");
    expect(none).toContain("border-dashed");
  });

  it("has an icon for every achievement", () => {
    for (const item of ACHIEVEMENTS) expect(ACHIEVEMENT_ICONS[item.icon], item.icon).toBeTruthy();
  });

  it("surprise-words a locked crab character and hides Crab on hello-bot", () => {
    resetAchievementsForTests({ status: "ready", snapshot: snapshot() });
    const html = renderToStaticMarkup(createElement(AchievementsPage, { category: "claude" }));
    const linked = slice(html, 'data-achievement="claude-linked"');
    expect(linked).toContain("a surprise character");
    expect(linked).not.toContain("Character unlocked: Crab");
    const all = renderToStaticMarkup(createElement(AchievementsPage, { category: "all" }));
    const hello = slice(all, 'data-achievement="hello-bot"');
    expect(hello).toContain("a surprise look");
    expect(hello).not.toContain("Pearl");
    expect(hello).not.toContain("Crab");
    const recent = slice(all, 'data-recent-achievement="hello-bot"');
    expect(recent).toContain("lucide-bot");
    expect(recent).not.toContain("data-character=");
    resetAchievementsForTests({ status: "ready", snapshot: snapshot({ rewards: ["character:shape"] }) });
    const owned = renderToStaticMarkup(createElement(AchievementsPage, { category: "all" }));
    expect(slice(owned, 'data-recent-achievement="hello-bot"')).not.toContain("lucide-bot");
    const pinch = slice(html, 'data-achievement="first-pinch"');
    expect(pinch).not.toContain("proud");
    expect(pinch).not.toContain("Look unlocked");
  });
});

describe("achievements page, a sister of Automations", () => {
  it("uses the Automations header: icon and title, a segment and a search, then the numbers, Filters and ☰", () => {
    resetAchievementsForTests({ status: "ready", snapshot: snapshot() });
    const html = renderToStaticMarkup(createElement(AchievementsScreen));
    // a page of the content frame (not a dialog), no navigation column
    expect(html).toContain("data-achievements-screen");
    expect(html).not.toContain('role="dialog"');
    expect(html).not.toContain("<nav");
    const header = headerOf(html);
    // the shared header (content-page.tsx), the frame's top bar
    expect(header).toContain('data-achievements-header=""');
    expect(header).toContain('data-page-header=""');
    expect(header).toContain("content-topbar");
    expect(header).toContain("@container/page-header");
    expect(header).toMatch(/<h1 class="[^"]*text-\[17px\] font-semibold[^"]*">Achievements<\/h1>/);
    expect(header).toContain("lucide-trophy");
    // the Team map standard: a grey count and a one-line subtitle
    expect(header).toMatch(/data-page-count=""[^>]*>[^<]*of[^<]*unlocked/);
    expect(header).toMatch(/data-page-subtitle=""[^>]*>Milestones your bots and you unlock/);
    // no way back button; the settings open from a square icon button (a modal)
    expect(header).not.toContain('aria-label="Back"');
    expect(header).toMatch(/data-achievements-settings-open=""[^>]*aria-haspopup="dialog"/);
    expect(html).not.toContain("rounded-full text-ink-tertiary");
    // the toolbar row under the title: All, Unlocked, Locked, the search, then Filters
    const primary = header.slice(header.indexOf("data-achievements-primary"));
    expect(primary).toMatch(/role="group"[^>]*aria-label="Show"/);
    expect(primary).toMatch(/aria-pressed="true"[^>]*>(<[^>]+>)*All</);
    expect(primary).toContain(">Unlocked<");
    expect(primary).toContain(">Locked<");
    expect(primary).toContain('data-achievement-search=""');
    expect(primary).toContain('aria-label="Search achievements"');
    expect(primary).toContain('aria-label="Filters"');
    expect(primary.indexOf("data-achievement-search")).toBeLessThan(primary.indexOf("data-achievements-filters"));
    // the right group: points and streak as indicators, the settings, then ☰
    const actions = header.slice(header.indexOf("data-achievements-actions"), header.indexOf("data-achievements-primary"));
    expect(actions).toMatch(/data-achievement-points=""[^>]*aria-label="1,240 points, Level 7"/);
    expect(actions).toMatch(/data-achievement-streak=""[^>]*aria-label="4-day streak"/);
    expect(actions.indexOf("data-achievement-points")).toBeLessThan(actions.indexOf("data-achievements-settings-open"));
    expect(actions.indexOf("data-achievements-settings-open")).toBeLessThan(actions.indexOf("data-achievements-menu"));
    expect(actions).toContain('aria-label="Achievements menu"');
    // the body: the frame's card and the Automations column
    expect(html).toContain("content-card-body");
    // 2dfc4b2a0 keeps the centred 4xl column with 16px section spacing.
    expect(html).toContain("mx-auto w-full max-w-4xl space-y-4 p-4 sm:p-6");
  });

  it("puts the categories in Filters, each with its unlocked count, and the reward beside them", () => {
    resetAchievementsForTests({ status: "ready", snapshot: snapshot() });
    const html = renderToStaticMarkup(createElement(AchievementsScreen));
    // no row of category pills any more
    expect(html).not.toContain('role="toolbar"');
    expect(html).not.toContain("data-achievement-category-filter");
    const filters = html.slice(html.indexOf("data-achievements-filters"), html.indexOf("</details>", html.indexOf("data-achievements-filters")));
    expect(filters).toContain('data-achievement-category-select=""');
    expect(filters).toContain('aria-label="Categories"');
    expect(ACHIEVEMENTS_SCREEN_CATEGORIES).toEqual(["all", "onboarding", "productivity", "power", "voice", "claude", "collaboration", "streaks", "mastery", "tiers", "secrets"]);
    const labels = ["All", "Getting started", "Productivity", "Power user", "Voice", "Claude", "Together", "Streaks", "Mastery", "Tiers", "Secrets"];
    let at = 0;
    for (const label of labels) {
      const next = filters.indexOf(`>${label} (`, at);
      expect(next, label).toBeGreaterThan(at);
      at = next;
    }
    expect(filters).toContain(`>All (2/${ACHIEVEMENTS.length})</option>`);
    const mastery = ACHIEVEMENTS.filter((item) => item.category === "mastery").length;
    expect(filters).toContain(`>Mastery (0/${mastery})</option>`);
    expect(filters).toContain('data-achievement-reward-select=""');
    expect(filters).toContain(">All rewards</option>");
    // nothing narrows the page yet: no count, no Clear filters
    expect(html).not.toContain("data-achievements-filter-count");
    expect(html).not.toContain("data-achievement-filter-reset");
  });

  it("counts a category as an active filter and names it in the heading", () => {
    resetAchievementsForTests({ status: "ready", snapshot: snapshot() });
    const html = renderToStaticMarkup(createElement(AchievementsScreen, { initialCategory: "secrets" }));
    expect(html).toContain('aria-label="Filters, 1 active"');
    expect(html).toContain("data-achievements-filter-count");
    expect(html).toContain('data-achievement-filter-reset=""');
    expect(html).toMatch(/<option value="secrets" data-achievement-category="secrets" selected="">/);
    expect(html).toMatch(/<h2[^>]*>Secrets<\/h2>/);
    expect(html).not.toContain("data-recent-achievement");
    expect(html).not.toContain('data-achievement="hello-bot"');
    expect(html).toMatch(/data-achievement="konami" data-secret=""/);
    expect(html).toContain(">Secret achievement</span>");
  });

  it("opens the settings from the ☰ menu, as Automations opens its sections", () => {
    resetAchievementsForTests({ status: "ready", snapshot: snapshot() });
    const html = renderToStaticMarkup(createElement(AchievementsScreen));
    const menu = html.slice(html.indexOf("data-achievements-menu"), html.indexOf("</details>", html.indexOf("data-achievements-menu")));
    const item = (html: string, name: string) => new RegExp(`<button [^>]*data-achievements-menu-${name}=""[^>]*>`).exec(html)?.[0] ?? "";
    expect(item(menu, "list")).toContain('role="menuitem"');
    expect(item(menu, "list")).toContain('aria-current="page"');
    expect(item(menu, "settings")).toContain('role="menuitem"');
    expect(item(menu, "settings")).not.toContain("aria-current");
    expect(menu).toMatch(/data-achievements-menu-settings=""[^>]*>.*Settings/);
    // settings: a modal of the Sagax settings family over the page, no sub-page
    const settings = renderToStaticMarkup(createElement(AchievementsScreen, { initialCategory: "settings" }));
    const header = headerOf(settings);
    expect(header).not.toContain("data-achievements-section");
    expect(header).toContain("data-achievements-filters");
    expect(settings).toContain("data-achievements-page");
    expect(settings).toMatch(/data-achievements-settings-dialog=""[^>]*role="dialog"|role="dialog"[^>]*data-achievements-settings-dialog=""/);
    expect(settings).toMatch(/aria-modal="true"/);
    expect(settings).toContain("data-achievements-settings-page");
    expect(settings).toMatch(/<h2[^>]*id="achievement-settings-title"[^>]*>Settings<\/h2>/);
    expect(settings).toMatch(/data-settings-row="achievements.title"/);
    for (const label of ["Show my points", "Show my title", "Show my points to colleagues", "Unlock banners", "System notification in the background"]) {
      expect(settings, label).toContain(`aria-label="${label}"`);
    }
    // the points and the streak stay in the header
    expect(header).toContain("data-achievement-points");
    expect(header).toContain("data-achievement-streak");
  });

  it("speaks French", () => {
    resetAchievementsForTests({ status: "ready", snapshot: snapshot() });
    setLocale("fr");
    const fr = renderToStaticMarkup(createElement(AchievementsScreen));
    expect(fr).toContain(">Succès</h1>");
    expect(fr).toContain(">Premiers pas (");
    expect(fr).toMatch(/<h2[^>]*>Débloqués récemment<\/h2>/);
    expect(fr).toContain('aria-label="Menu des succès"');
  });

  it("shows the Mastery category with its progress bars, what each unlocks, and its secrets masked", () => {
    const mastery = ACHIEVEMENTS.filter((item) => item.category === "mastery");
    expect(mastery).toHaveLength(24);
    const items = ACHIEVEMENTS.map((item) => ({
      id: item.id,
      current: item.id === "hands-off" ? 4 : 0,
      target: item.rule.kind === "mastery" || item.rule.kind === "category" ? item.rule.target : 1,
      ...(item.id === "polyglot" ? { unlockedAt: 1 } : {}),
    }));
    resetAchievementsForTests({ status: "ready", snapshot: snapshot({ items, recent: [] }) });
    const html = renderToStaticMarkup(createElement(AchievementsScreen, { initialCategory: "mastery" }));
    expect(html).not.toContain('data-achievement="hello-bot"');
    expect(html.match(/data-mastery=""/g)).toHaveLength(24);
    const handsOff = slice(html, 'data-achievement="hands-off"');
    expect(handsOff).toContain('role="progressbar"');
    expect(handsOff).toContain(">4/10</span>");
    expect(handsOff).toContain(">Hands Off<");
    expect(slice(html, 'data-achievement="quiet-nights"')).toContain(">0/30</span>");
    expect(handsOff).toContain('data-mastery-preview="hands-off"');
    expect(handsOff).toContain(">Unlocks</span>");
    expect(handsOff).toMatch(/class="mastery-look[^"]*" data-locked=""/);
    const polyglot = slice(html, 'data-achievement="polyglot"');
    expect(html).toContain('data-unlocked="" data-achievement="polyglot"');
    expect(polyglot).not.toContain('data-locked=""');
    expect(polyglot).not.toContain('role="progressbar"');
    expect(slice(html, 'data-achievement="sagax-master"')).toContain(">+3 more</span>");
    const secret = slice(html, 'data-achievement="not-so-fast"');
    expect(secret).toContain("data-secret");
    expect(secret).not.toContain("Not So Fast");
    expect(secret).not.toContain("data-mastery-preview");
    setLocale("fr");
    const fr = renderToStaticMarkup(createElement(AchievementsScreen, { initialCategory: "mastery" }));
    expect(fr).toMatch(/<h2[^>]*>Maîtrise<\/h2>/);
    expect(fr).toContain(">Déléguer sans surveiller<");
    expect(fr).toContain(">Débloque</span>");
  });

  it("counts unlocked and total per category", () => {
    const counts = achievementCategoryCounts(new Set(["hello-bot", "first-words", "konami"]));
    expect(counts.all).toEqual({ unlocked: 3, total: ACHIEVEMENTS.length });
    expect(counts.onboarding.unlocked).toBe(2);
    expect(counts.secrets.unlocked).toBe(1);
    expect(counts.voice.unlocked).toBe(0);
    const sum = ACHIEVEMENTS_SCREEN_CATEGORIES.filter((id) => id !== "all").reduce((total, id) => total + counts[id].total, 0);
    expect(sum).toBe(ACHIEVEMENTS.length);
  });

  it("is no longer a Settings section", () => {
    expect(SECTIONS.map((section) => section.id)).not.toContain("achievements");
  });
});

describe("Automations and Achievements share their pieces", () => {
  it("both pages build their header, filters, menu and body from content-page.tsx", () => {
    const automations = readFileSync(join(process.cwd(), "src/components/RoutineCalendarPage.tsx-parts/RoutinesPageView.tsx"), "utf8");
    const automationsHook = readFileSync(join(process.cwd(), "src/components/RoutineCalendarPage.tsx-parts/useRoutinesPage.ts"), "utf8");
    const achievements = readFileSync(join(process.cwd(), "src/components/achievements/AchievementsScreen.tsx"), "utf8");
    const body = readFileSync(join(process.cwd(), "src/components/achievements/AchievementsPage.tsx"), "utf8");
    for (const piece of ["<PageHeader", "<PageFilters", "<PageMenu ", "<PageMenuItem", "<PageSegment"]) {
      expect(automations, piece).toContain(piece);
      expect(achievements, piece).toContain(piece);
    }
    expect(automationsHook).toContain("useDismissMenus(");
    expect(achievements).toContain("useDismissMenus(");
    expect(automations).toContain("<PageHeading");
    expect(body).toContain("<PageHeading");
    expect(achievements).toContain("<PageBody");
    // no header styles of their own: the shared constants only
    expect(automations).not.toContain('const HEADER_BUTTON = "');
    expect(achievements).not.toMatch(/className="[^"]*\bh-9\b[^"]*rounded-lg border/);
  });
});
