// The full emoji catalogue: the en and fr data joined by hexcode, search in
// either language without accents, the stored form of an emoji, and the
// lazy load.
import { describe, expect, it } from "vitest";

import { canonicalEmoji, emojiCatalogNow, loadEmojiCatalog, mergeEmojiData, searchCatalog, type CompactEmojiLike } from "./emoji-catalog";

const en: CompactEmojiLike[] = [
  { hexcode: "1F680", label: "rocket", unicode: "🚀", group: 5, order: 900, tags: ["space"] },
  { hexcode: "1F44D", label: "thumbs up", unicode: "👍️", group: 1, order: 351, tags: ["+1", "like"] },
  { hexcode: "2764", label: "red heart", unicode: "❤️", group: 8, order: 140, tags: ["love"] },
  { hexcode: "1F3FB", label: "light skin tone", unicode: "🏻", group: 2, order: 1 },
  { hexcode: "1F1E6", label: "regional indicator A", unicode: "🇦" },
];
const fr: CompactEmojiLike[] = [
  { hexcode: "1F680", label: "fusée", unicode: "🚀", group: 5, order: 900, tags: ["espace"] },
  { hexcode: "1F44D", label: "pouce vers le haut", unicode: "👍️", group: 1, order: 351, tags: ["d’accord", "oui"] },
  { hexcode: "2764", label: "cœur rouge", unicode: "❤️", group: 8, order: 140, tags: ["amour"] },
];

describe("emoji catalogue", () => {
  it("joins both languages, in catalogue order, without components or ungrouped entries", () => {
    const catalog = mergeEmojiData(en, fr);
    expect(catalog.map((entry) => entry.emoji)).toEqual(["❤️", "👍", "🚀"]);
    expect(catalog[2]).toMatchObject({ en: "rocket", fr: "fusée", group: 5 });
  });

  it("stores the bare form of an emoji that is one by default, and keeps a needed selector", () => {
    expect(canonicalEmoji("👍️")).toBe("👍");
    expect(canonicalEmoji("❤️")).toBe("❤️");
  });

  it("finds an emoji by English or French words, accents or not", () => {
    const catalog = mergeEmojiData(en, fr);
    expect(searchCatalog(catalog, "rock").map((entry) => entry.emoji)).toEqual(["🚀"]);
    expect(searchCatalog(catalog, "fusee").map((entry) => entry.emoji)).toEqual(["🚀"]);
    expect(searchCatalog(catalog, "Amour").map((entry) => entry.emoji)).toEqual(["❤️"]);
    expect(searchCatalog(catalog, "d'accord").map((entry) => entry.emoji)).toEqual(["👍"]);
    expect(searchCatalog(catalog, "👍️").map((entry) => entry.emoji)).toEqual(["👍"]);
    expect(searchCatalog(catalog, "")).toEqual([]);
  });

  it("puts label matches before tag matches", () => {
    const catalog = mergeEmojiData([
      { hexcode: "1", label: "star struck", unicode: "🤩", group: 0, order: 1, tags: ["eyes"] },
      { hexcode: "2", label: "eyes", unicode: "👀", group: 1, order: 2, tags: [] },
    ], []);
    expect(searchCatalog(catalog, "eyes").map((entry) => entry.emoji)).toEqual(["👀", "🤩"]);
  });

  it("loads the real data once, lazily, with French words", async () => {
    expect(emojiCatalogNow()).toBeNull();
    const first = loadEmojiCatalog();
    const catalog = await first;
    expect(await loadEmojiCatalog()).toBe(catalog);
    expect(catalog.length).toBeGreaterThan(1800);
    expect(searchCatalog(catalog, "pouce vers le haut")[0]?.emoji).toBe("👍");
    expect(searchCatalog(catalog, "thumbs up")[0]?.emoji).toBe("👍");
  });

  it("a reaction stored with emojibase 16's FE0F form still resolves under 18", async () => {
    const catalog = await loadEmojiCatalog();
    // 16 wrote 👍️ for thumbs up; 18's unicode field is the bare 👍.
    expect(catalog.some((entry) => entry.emoji === "👍")).toBe(true);
    expect(catalog.some((entry) => entry.emoji === "👍️")).toBe(false);
    expect(canonicalEmoji("👍️")).toBe("👍");
    expect(searchCatalog(catalog, "👍️")[0]?.emoji).toBe("👍");
    // ❤️ still needs the selector; both the stored and the catalogue form keep it.
    expect(canonicalEmoji("❤️")).toBe("❤️");
    expect(searchCatalog(catalog, "❤️")[0]?.emoji).toBe("❤️");
  });
});
