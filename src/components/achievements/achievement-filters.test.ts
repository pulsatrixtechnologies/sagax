// Reward and search rules for the achievements list. No browser: the page
// calls achievementMatches, and these cases build the achievements by hand.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { NOTHING_LOCKED, type AchievementDefinition, type AchievementSnapshot, type Unlocks } from "../../../shared/achievements";
import { ACHIEVEMENTS } from "../../../shared/achievements-catalog";
import { MASCOT_CHARACTERS } from "../../../shared/mascot-look";
import { resetAchievementsForTests, unlocksFromSnapshot } from "@/lib/achievements";
import { setLocale } from "@/lib/i18n";
import { StoreProvider } from "@/state/store";
import { AchievementsScreen } from "./AchievementsScreen";
import { achievementMatches, achievementRewardFilterLabel, achievementRewardFilters, type AchievementListQuery } from "./achievement-filters";

function achievement(overrides: Partial<AchievementDefinition> & Pick<AchievementDefinition, "id" | "rewards">): AchievementDefinition {
  return {
    category: "onboarding",
    name: { en: "Sample", fr: "Exemple" },
    description: { en: "A sample achievement.", fr: "Un succès d'exemple." },
    icon: "Trophy",
    points: 10,
    rule: { kind: "count", event: "message.sent", target: 1 },
    ...overrides,
  };
}

function query(partial: Partial<AchievementListQuery> = {}): AchievementListQuery {
  return { category: "all", status: "all", reward: "all", search: "", ...partial };
}

const owlSkin = achievement({
  id: "owl-skin",
  name: { en: "Unstoppable", fr: "Inarrêtable" },
  description: { en: "Keep a long streak.", fr: "Gardez une longue série." },
  rewards: [{ kind: "skin", character: "owl", skin: "lightning" }],
});

const trombiCharacter = achievement({
  id: "trombi-character",
  category: "secrets",
  name: { en: "Office Friend", fr: "Ami de bureau" },
  description: { en: "Find the retro assistant.", fr: "Trouvez l'assistant rétro." },
  rewards: [{ kind: "character", character: "trombi" }],
});

const titled = achievement({
  id: "titled",
  name: { en: "First Words", fr: "Premiers mots" },
  description: { en: "Send your first message to a bot.", fr: "Envoie ton premier message à un robot." },
  rewards: [{ kind: "title", id: "rookie", name: { en: "Rookie", fr: "Recrue" } }],
});

const both = achievement({
  id: "both",
  category: "mastery",
  name: { en: "Platinum", fr: "Platine" },
  description: { en: "Finish the public list.", fr: "Terminez la liste publique." },
  rewards: [
    { kind: "skin", character: "bunbu", skin: "galaxy" },
    { kind: "title", id: "platinum", name: { en: "Platinum Sage", fr: "Sage platine" } },
  ],
});

const iconOnly = achievement({
  id: "icon-only",
  name: { en: "New Face", fr: "Nouveau visage" },
  description: { en: "Change the app icon.", fr: "Change l'icône de l'application." },
  rewards: [{ kind: "appIcon", id: "glyph:cube" }],
});

const secret = achievement({
  id: "secret-one",
  category: "secrets",
  hidden: true,
  name: { en: "Up Up Down Down", fr: "Haut haut bas bas" },
  description: { en: "Enter the old cheat code.", fr: "Entre le vieux code de triche." },
  hint: { en: "Gamers of a certain age know a code made of arrows.", fr: "Les joueurs d'une certaine époque connaissent un code fait de flèches." },
  rewards: [{ kind: "skin", character: "owl", skin: "lightning" }],
});

afterEach(() => {
  setLocale("en");
  resetAchievementsForTests();
});

describe("achievement filters", () => {
  it("matches a mascot skin and leaves achievements with no mascot reward in All rewards", () => {
    expect(achievementMatches(owlSkin, undefined, query({ reward: "owl" }))).toBe(true);
    expect(achievementMatches(owlSkin, undefined, query({ reward: "shape" }))).toBe(false);
    expect(achievementMatches(owlSkin, undefined, query({ reward: "trombi" }))).toBe(false);
    expect(achievementMatches(owlSkin, undefined, query({ reward: "title" }))).toBe(false);
    expect(achievementMatches(iconOnly, undefined, query())).toBe(true);
    expect(achievementMatches(iconOnly, undefined, query({ reward: "owl" }))).toBe(false);
    expect(achievementMatches(iconOnly, undefined, query({ reward: "bunbu" }))).toBe(false);
    expect(achievementMatches(iconOnly, undefined, query({ reward: "title" }))).toBe(false);
  });

  it("matches a mascot character reward", () => {
    expect(achievementMatches(trombiCharacter, undefined, query({ reward: "trombi" }))).toBe(true);
    expect(achievementMatches(trombiCharacter, undefined, query({ reward: "owl" }))).toBe(false);
    expect(achievementMatches(trombiCharacter, undefined, query({ reward: "shape" }))).toBe(false);
    expect(achievementMatches(trombiCharacter, undefined, query({ reward: "bunbu" }))).toBe(false);
    const shape = achievement({ id: "shape", rewards: [{ kind: "character", character: "shape" }] });
    expect(achievementMatches(shape, undefined, query({ reward: "shape" }))).toBe(true);
    expect(achievementMatches(shape, undefined, query({ reward: "trombi" }))).toBe(false);
  });

  it("matches a title reward, including one that also grants a mascot", () => {
    expect(achievementMatches(titled, undefined, query({ reward: "title" }))).toBe(true);
    expect(achievementMatches(titled, undefined, query({ reward: "owl" }))).toBe(false);
    expect(achievementMatches(both, undefined, query({ reward: "title" }))).toBe(true);
    expect(achievementMatches(both, undefined, query({ reward: "bunbu" }))).toBe(true);
    expect(achievementMatches(both, undefined, query({ reward: "owl" }))).toBe(false);
    expect(achievementMatches(owlSkin, undefined, query({ reward: "title" }))).toBe(false);
  });

  it("matches a search hit on the name, the description and the reward label", () => {
    expect(achievementMatches(titled, undefined, query({ search: "  fIrSt  " }))).toBe(true);
    expect(achievementMatches(titled, undefined, query({ search: "message" }))).toBe(true);
    expect(achievementMatches(owlSkin, undefined, query({ search: "lightning" }))).toBe(true);
    expect(achievementMatches(both, undefined, query({ search: "sage" }))).toBe(true);
    expect(achievementMatches(titled, undefined, query({ search: "   " }))).toBe(true);
    setLocale("fr");
    expect(achievementMatches(titled, undefined, query({ search: "premiers" }))).toBe(true);
    expect(achievementMatches(titled, undefined, query({ search: "recrue" }))).toBe(true);
    expect(achievementMatches(titled, undefined, query({ search: "rookie" }))).toBe(false);
  });

  it("misses a search that is not on the card", () => {
    expect(achievementMatches(titled, undefined, query({ search: "not-on-the-card" }))).toBe(false);
    expect(achievementMatches(owlSkin, undefined, query({ search: "galaxy" }))).toBe(false);
  });

  it("does not find a locked secret by its real name, description or reward", () => {
    expect(achievementMatches(secret, undefined, query({ search: "Up Up Down Down" }))).toBe(false);
    expect(achievementMatches(secret, undefined, query({ search: "cheat code" }))).toBe(false);
    expect(achievementMatches(secret, undefined, query({ search: "lightning" }))).toBe(false);
    expect(achievementMatches(secret, undefined, query({ search: "arrows" }))).toBe(true);
    expect(achievementMatches(secret, undefined, query({ search: "Secret achievement" }))).toBe(true);
    const quiet = achievement({
      id: "quiet",
      hidden: true,
      name: { en: "Hidden Gem", fr: "Joyau caché" },
      description: { en: "Do the hidden thing.", fr: "Faites la chose cachée." },
      rewards: [{ kind: "title", id: "quiet", name: { en: "Quiet", fr: "Discret" } }],
    });
    expect(achievementMatches(quiet, undefined, query({ search: "Hidden Gem" }))).toBe(false);
    expect(achievementMatches(quiet, undefined, query({ search: "Keep exploring" }))).toBe(true);
    expect(achievementMatches(secret, 1_700_000_000_000, query({ search: "Up Up Down Down" }))).toBe(true);
    expect(achievementMatches(secret, 1_700_000_000_000, query({ search: "lightning" }))).toBe(true);
  });

  it("does not match Crab through a locked crab-skin reward", () => {
    const hello = ACHIEVEMENTS.find((item) => item.id === "hello-bot")!;
    const locked = { enforced: true, keys: new Set<string>() };
    expect(achievementMatches(hello, undefined, query({ search: "Crab" }), locked)).toBe(false);
    expect(achievementMatches(hello, undefined, query({ search: "Pearl" }), locked)).toBe(false);
    expect(achievementMatches(hello, undefined, query({ search: "Alive" }), locked)).toBe(true);
    expect(achievementMatches(hello, undefined, query({ search: "surprise" }), locked)).toBe(true);
    const army = ACHIEVEMENTS.find((item) => item.id === "crab-army")!;
    expect(achievementMatches(army, undefined, query({ search: "Crab" }), locked)).toBe(true);
  });

  it("combines the reward and the search with unlocked and locked", () => {
    expect(achievementMatches(titled, undefined, query({ status: "locked", reward: "title", search: "first" }))).toBe(true);
    expect(achievementMatches(titled, 5, query({ status: "locked", reward: "title", search: "first" }))).toBe(false);
    expect(achievementMatches(titled, 5, query({ status: "unlocked", reward: "title", search: "first" }))).toBe(true);
    expect(achievementMatches(titled, 5, query({ status: "unlocked", reward: "owl", search: "first" }))).toBe(false);
    expect(achievementMatches(owlSkin, undefined, query({ status: "locked", reward: "owl", category: "onboarding" }))).toBe(true);
    expect(achievementMatches(owlSkin, undefined, query({ status: "locked", reward: "owl", category: "voice" }))).toBe(false);
    expect(achievementMatches(secret, undefined, query({ status: "locked", reward: "owl", search: "arrows" }))).toBe(true);
    expect(achievementMatches(secret, undefined, query({ status: "unlocked", search: "arrows" }))).toBe(false);
    expect(achievementMatches(secret, undefined, query({ status: "locked", reward: "title", search: "arrows" }))).toBe(false);
    expect(achievementMatches(both, 9, query({ status: "unlocked", reward: "bunbu", category: "mastery", search: "platine" }))).toBe(false);
    setLocale("fr");
    expect(achievementMatches(both, 9, query({ status: "unlocked", reward: "bunbu", category: "mastery", search: "platine" }))).toBe(true);
  });
});

describe("achievements page reward controls", () => {
  it("lists owl plus unlocked characters in the reward filter", () => {
    const empty: Unlocks = { enforced: true, keys: new Set() };
    expect(achievementRewardFilters(empty)).toEqual(["all", "title", "owl"]);
    expect(achievementRewardFilters({ enforced: true, keys: new Set(["character:crab", "character:shape"]) })).toEqual(["all", "title", "owl", "crab", "shape"]);
    expect(achievementRewardFilters(NOTHING_LOCKED)).toEqual(["all", "title", ...MASCOT_CHARACTERS]);
  });

  it("puts the search and the status in the header, the reward in Filters, with the mascot names the app already uses", () => {
    resetAchievementsForTests({ status: "ready", snapshot: snapshot() });
    const render = () => renderToStaticMarkup(createElement(StoreProvider, null, createElement(AchievementsScreen)));
    const html = render();
    expect(html).not.toContain('role="tablist"');
    expect(html).toContain('data-achievement-search=""');
    expect(html).toContain('placeholder="Search"');
    expect(html).toContain('aria-label="Search achievements"');
    // the status: the header's segment, as Automations' List and Calendar
    expect(html).toMatch(/role="group"[^>]*aria-label="Show"/);
    // the reward: a select of Filters, as Automations' bot
    const filters = html.slice(html.indexOf("data-achievements-filters"));
    expect(filters).toMatch(/aria-label="Reward" data-achievement-reward-select=""/);
    expect(filters).toContain(">All rewards</option>");
    expect(filters).toContain(">Gives a title</option>");
    expect(filters).toContain(">Owl</option>");
    const labels = () => achievementRewardFilters(unlocksFromSnapshot(snapshot())).map(achievementRewardFilterLabel);
    expect(labels()).toContain("All rewards");
    expect(labels()).toContain("Gives a title");
    expect(labels()).toContain("Owl");
    for (const hidden of ["Shapes", "Trombi", "Bunbu", "Crab"]) expect(labels()).not.toContain(hidden);
    expect(achievementRewardFilterLabel("title")).toBe("Gives a title");
    setLocale("fr");
    const french = render();
    expect(french).toContain('placeholder="Rechercher"');
    expect(french).toContain('aria-label="Rechercher des succès"');
    expect(french).toContain(">Toutes les récompenses</option>");
    expect(labels()).toContain("Donne un titre");
    expect(labels()).toContain("Hibou");
    for (const hidden of ["Formes", "Trombi", "Bunbu"]) expect(labels()).not.toContain(hidden);
  });
});

function snapshot(): AchievementSnapshot {
  return {
    points: 0,
    maxPoints: 1,
    level: { level: 1, from: 0, to: 50 },
    unlockedCount: 0,
    count: ACHIEVEMENTS.length,
    streak: 0,
    rewards: [],
    recent: [],
    items: [],
    settings: { showPoints: false, showTitle: true, toasts: true, native: false, public: false },
  };
}
