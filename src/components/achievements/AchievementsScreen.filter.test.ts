// @vitest-environment happy-dom
// The Achievements page, a sister of Automations (2026-10-28): the
// categories are in Filters (as Automations' bot), the status is the
// header's segment, the settings a section of the ☰ menu. Picking a
// category narrows the rows to it, the counts stay on every option, the
// menu swaps the rows for the settings and back, and the page takes focus
// so Escape works at once.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ACHIEVEMENTS } from "../../../shared/achievements-catalog";
import { ACHIEVEMENT_CATEGORIES, type AchievementSnapshot } from "../../../shared/achievements";
import { resetAchievementsForTests } from "@/lib/achievements";
import { setLocale } from "@/lib/i18n";
import { StoreProvider } from "@/state/store";
import { AchievementsScreen } from "./AchievementsScreen";

let host: HTMLDivElement;
let root: Root;

function snapshot(): AchievementSnapshot {
  return {
    points: 120,
    maxPoints: 1500,
    level: { level: 2, from: 100, to: 250 },
    unlockedCount: 2,
    count: ACHIEVEMENTS.length,
    streak: 3,
    rewards: [],
    recent: ["hello-bot"],
    items: ACHIEVEMENTS.map((item) => ({ id: item.id, current: 0, target: 1, ...(item.id === "hello-bot" || item.id === "first-words" ? { unlockedAt: 1 } : {}) })),
    settings: { showPoints: true, showTitle: true, toasts: true, native: false, public: false },
  };
}

const cards = () => [...host.querySelectorAll<HTMLElement>("[data-achievement-grid] [data-achievement]")].map((card) => card.dataset.achievement);
const select = () => host.querySelector<HTMLSelectElement>("[data-achievement-category-select]")!;
const click = (element: HTMLElement) => flushSync(() => { element.click(); });
function choose(id: string) {
  flushSync(() => {
    select().value = id;
    select().dispatchEvent(new Event("change", { bubbles: true }));
  });
}
const segment = (label: string) => [...host.querySelectorAll<HTMLButtonElement>("[data-achievements-primary] [role=group] button")].find((button) => button.textContent === label)!;
const byCategory = () => ACHIEVEMENT_CATEGORIES.flatMap((category) => ACHIEVEMENTS.filter((item) => item.category === category).map((item) => item.id));

beforeEach(() => {
  setLocale("en");
  // the page asks the server again on mount: answer with the same snapshot
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify(snapshot()), { headers: { "content-type": "application/json" } }));
  resetAchievementsForTests({ status: "ready", snapshot: snapshot() });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  flushSync(() => root.render(createElement(StoreProvider, null, createElement(AchievementsScreen))));
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  resetAchievementsForTests();
  vi.unstubAllGlobals();
});

describe("the Achievements page", () => {
  it("has no navigation column; the page takes focus for its keyboard", () => {
    expect(host.querySelector("nav")).toBeNull();
    expect(document.activeElement).toBe(host.querySelector("[data-achievements-screen]"));
  });

  it("narrows the rows to the category chosen in Filters, and back to All", () => {
    expect(cards()).toEqual(byCategory());
    expect(select().value).toBe("all");
    choose("voice");
    expect(cards()).toEqual(ACHIEVEMENTS.filter((item) => item.category === "voice").map((item) => item.id));
    expect(host.querySelector("[data-achievements-filter-count]")!.textContent).toBe("1");
    // the recent unlocks belong to All
    expect(host.querySelector("[data-recent-achievement]")).toBeNull();
    // every option keeps its count while another is chosen
    const onboarding = ACHIEVEMENTS.filter((item) => item.category === "onboarding").length;
    expect(select().querySelector<HTMLOptionElement>('option[value="onboarding"]')!.textContent).toBe(`Getting started (2/${onboarding})`);
    expect(select().querySelector<HTMLOptionElement>('option[value="all"]')!.textContent).toBe(`All (2/${ACHIEVEMENTS.length})`);
    // Clear filters brings All back
    click(host.querySelector<HTMLButtonElement>("[data-achievement-filter-reset]")!);
    expect(cards()).toEqual(byCategory());
    expect(host.querySelector("[data-achievements-filter-count]")).toBeNull();
    expect(host.querySelector("[data-recent-achievement]")).not.toBeNull();
  });

  it("filters on the status segment, combines with the search, and says so when nothing is left", () => {
    click(segment("Unlocked"));
    expect(segment("Unlocked").getAttribute("aria-pressed")).toBe("true");
    expect(cards().sort()).toEqual(["first-words", "hello-bot"]);
    click(segment("All"));
    choose("onboarding");
    const input = host.querySelector<HTMLInputElement>("[data-achievement-search]")!;
    flushSync(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "zzzz-nothing");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(cards()).toEqual([]);
    expect(host.querySelector("[data-achievements-empty]")!.textContent).toBe("No achievement matches these filters.");
  });

  it("the ☰ menu and the header gear open the settings modal over the same category; Escape closes it first", () => {
    choose("streaks");
    click(host.querySelector<HTMLButtonElement>("[data-achievements-menu-settings]")!);
    const dialog = document.querySelector("[data-achievements-settings-dialog]");
    expect(dialog).not.toBeNull();
    expect(dialog!.getAttribute("role")).toBe("dialog");
    // a modal over the page: the grid stays, no "› Settings" sub-page in the header
    expect(host.querySelector("[data-achievement-grid]")).not.toBeNull();
    expect(host.querySelector("[data-achievements-section]")).toBeNull();
    // the six settings are there: the title, then five switches
    const settings = dialog!.querySelector("[data-achievements-settings-page]")!;
    expect(settings.querySelector('[data-settings-row="achievements.title"]')).not.toBeNull();
    for (const label of ["Show my points", "Show my title", "Show my points to colleagues", "Unlock banners", "System notification in the background"]) {
      expect(settings.querySelector(`[aria-label="${label}"]`), label).not.toBeNull();
    }
    // Escape closes the modal first, the category stays
    flushSync(() => { dialog!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(document.querySelector("[data-achievements-settings-dialog]")).toBeNull();
    expect(cards()).toEqual(ACHIEVEMENTS.filter((item) => item.category === "streaks").map((item) => item.id));
    // the header gear opens the same modal; its close button closes it
    click(host.querySelector<HTMLButtonElement>("[data-achievements-settings-open]")!);
    expect(document.querySelector("[data-achievements-settings-dialog]")).not.toBeNull();
    click(document.querySelector<HTMLButtonElement>("[data-achievements-settings-dialog] button[aria-label]")!);
    expect(document.querySelector("[data-achievements-settings-dialog]")).toBeNull();
    click(host.querySelector<HTMLButtonElement>("[data-achievements-menu-list]")!);
    expect(select().value).toBe("streaks");
  });
});
