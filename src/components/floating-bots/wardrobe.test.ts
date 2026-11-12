// The Appearance gallery's catalog rules (wardrobe.ts) and the families the
// registry carries for them (mascots.tsx).
import { describe, expect, it } from "vitest";
import en from "@/locales/en.json";
import fr from "@/locales/fr.json";
import { MASCOTS } from "./mascots";
import { filterWardrobe, MASCOT_FAMILIES, MASCOT_FAMILY_LABEL, wardrobeFilters, wardrobeShelf, wardrobeShelves, wardrobeStep, type WardrobeEntry } from "./wardrobe";


const ids = (entries: readonly WardrobeEntry[]) => entries.map((entry) => entry.id);

describe("the registry's families", () => {
  it("gives every character a family, Owl and Trombi the classics, the rest by kind", () => {
    expect(Object.fromEntries(MASCOTS.map((option) => [option.id, option.family]))).toEqual({
      owl: "classics",
      crab: "animals",
      shape: "shapes",
      trombi: "classics",
      bunbu: "animals",
      shiba: "animals",
      grump: "animals",
      ogre: "animals",
      frog: "animals",
    });
    for (const option of MASCOTS) expect(MASCOT_FAMILIES).toContain(option.family);
  });

  it("sells nothing and marks nothing new yet", () => {
    expect(MASCOTS.filter((option) => option.premium || option.isNew)).toEqual([]);
  });

  it("names every family in English and French", () => {
    for (const key of Object.values(MASCOT_FAMILY_LABEL)) {
      expect(en).toHaveProperty([key]);
      expect(fr).toHaveProperty([key]);
    }
  });
});

describe("the filter chips", () => {
  it("offers All, Owned, To unlock and one chip per family in use, no Premium while nothing is sold", () => {
    expect(wardrobeFilters(MASCOTS)).toEqual(["all", "owned", "locked", "family:classics", "family:shapes", "family:animals"]);
    expect(wardrobeFilters([{ id: "frog", family: "animals" }])).toEqual(["all", "owned", "locked", "family:animals"]);
  });

  it("adds Premium once the registry sells an edition", () => {
    const sold: WardrobeEntry[] = [...MASCOTS, { id: "axolotl", family: "animals", premium: { price: "$2.99" }, isNew: true }];
    expect(wardrobeFilters(sold)).toEqual(["all", "owned", "locked", "premium", "family:classics", "family:shapes", "family:animals"]);
  });

  it("drops the To unlock chip when no listed row is locked", () => {
    expect(wardrobeFilters(MASCOTS, () => false)).toEqual(["all", "owned", "family:classics", "family:shapes", "family:animals"]);
    expect(wardrobeFilters(MASCOTS)).toEqual(["all", "owned", "locked", "family:classics", "family:shapes", "family:animals"]);
  });
});

describe("shelves and filters", () => {
  const catalog: WardrobeEntry[] = [
    ...MASCOTS.map(({ id, family }) => ({ id, family })),
    { id: "axolotl", family: "animals", premium: { price: "$2.99" } },
    { id: "robo", family: "shapes", premium: { price: "$1.99" } },
  ];
  // the bot wears the owl; Trombi and Bunbu were earned; Robo was bought
  const unlocked = new Set(["owl", "trombi", "bunbu", "robo"]);
  const lockedOf = (entry: WardrobeEntry) => !unlocked.has(entry.id);
  const run = (filter: Parameters<typeof filterWardrobe>[1]) => ids(filterWardrobe(catalog, filter, lockedOf));

  it("puts an unlocked entry on Yours, a locked one on To unlock, and an unbought paid edition on Premium", () => {
    expect(wardrobeShelf({ id: "owl", family: "classics" }, false)).toBe("yours");
    expect(wardrobeShelf({ id: "shiba", family: "animals" }, true)).toBe("locked");
    expect(wardrobeShelf({ id: "axolotl", family: "animals", premium: { price: "$2.99" } }, true)).toBe("premium");
    expect(wardrobeShelf({ id: "robo", family: "shapes", premium: { price: "$1.99" } }, false)).toBe("yours");
  });

  it("splits the catalog into shelves in registry order and draws no empty shelf", () => {
    expect(wardrobeShelves(catalog, lockedOf).map(({ shelf, entries }) => [shelf, ids(entries)])).toEqual([
      ["yours", ["owl", "trombi", "bunbu", "robo"]],
      ["locked", ["crab", "shape", "shiba", "grump", "ogre", "frog"]],
      ["premium", ["axolotl"]],
    ]);
    expect(wardrobeShelves(MASCOTS, () => false).map(({ shelf }) => shelf)).toEqual(["yours"]);
    expect(wardrobeShelves([], lockedOf)).toEqual([]);
  });

  it("keeps what each chip names", () => {
    expect(run("all")).toEqual(ids(catalog));
    expect(run("owned")).toEqual(["owl", "trombi", "bunbu", "robo"]);
    expect(run("locked")).toEqual(["crab", "shape", "shiba", "grump", "ogre", "frog"]);
    expect(run("premium")).toEqual(["axolotl", "robo"]);
    expect(run("family:classics")).toEqual(["owl", "trombi"]);
    expect(run("family:shapes")).toEqual(["shape", "robo"]);
    expect(run("family:animals")).toEqual(["crab", "bunbu", "shiba", "grump", "ogre", "frog", "axolotl"]);
  });
});

describe("arrow keys across the tiles", () => {
  it("steps one tile across, one row down and up, and stays at the edges", () => {
    // 8 tiles in rows of 4
    expect(wardrobeStep(0, 8, 4, "ArrowRight")).toBe(1);
    expect(wardrobeStep(7, 8, 4, "ArrowRight")).toBe(7);
    expect(wardrobeStep(0, 8, 4, "ArrowLeft")).toBe(0);
    expect(wardrobeStep(1, 8, 4, "ArrowDown")).toBe(5);
    expect(wardrobeStep(5, 8, 4, "ArrowDown")).toBe(5);
    expect(wardrobeStep(5, 8, 4, "ArrowUp")).toBe(1);
    expect(wardrobeStep(2, 8, 4, "ArrowUp")).toBe(2);
    expect(wardrobeStep(4, 8, 4, "Home")).toBe(0);
    expect(wardrobeStep(0, 8, 4, "End")).toBe(7);
    expect(wardrobeStep(3, 8, 0, "ArrowDown")).toBe(4);
    expect(wardrobeStep(0, 8, 4, "Enter")).toBeNull();
    expect(wardrobeStep(0, 0, 4, "ArrowRight")).toBeNull();
  });
});
