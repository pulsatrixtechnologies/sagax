// The full emoji catalogue for the pickers (reactions and the composer):
// every Unicode emoji from emojibase-data, with English and French search
// words (label and tags of both languages, so either finds it whatever the
// app language). The data is loaded lazily, once, the first time a picker
// opens: it is two JSON chunks (about 1 MB raw) that the first paint never
// needs. Until it lands, src/lib/emoji-list.ts (the small built-in set) is
// what the pickers search.
//
// Pure helpers (mergeEmojiData, searchCatalog, canonicalEmoji) are tested in
// emoji-catalog.test.ts without loading the data.

/** One emoji of the catalogue. */
export interface CatalogEmoji {
  emoji: string;
  /** English label, shown as the button's name in English. */
  en: string;
  /** French label, shown as the button's name in French. */
  fr: string;
  /** Search words, accent-free and lowercase (labels and tags, en + fr). */
  words: string;
  group: number;
  order: number;
}

/** The emojibase shape this file reads (a subset of CompactEmoji). */
export interface CompactEmojiLike {
  hexcode: string;
  label: string;
  unicode: string;
  group?: number;
  order?: number;
  tags?: readonly string[];
}

/** emojibase groups, in display order. 2 (skin tone components) is not a
 * pickable group and stays out. */
export const EMOJI_GROUPS = [
  { id: 0, icon: "😀", key: "emoji.group.smileys" },
  { id: 1, icon: "👋", key: "emoji.group.people" },
  { id: 3, icon: "🐻", key: "emoji.group.animals" },
  { id: 4, icon: "🍔", key: "emoji.group.food" },
  { id: 5, icon: "✈️", key: "emoji.group.travel" },
  { id: 6, icon: "⚽", key: "emoji.group.activities" },
  { id: 7, icon: "💡", key: "emoji.group.objects" },
  { id: 8, icon: "❤️", key: "emoji.group.symbols" },
  { id: 9, icon: "🏁", key: "emoji.group.flags" },
] as const;

export type EmojiGroupKey = (typeof EMOJI_GROUPS)[number]["key"];

export function plainWords(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[’']/g, " ").replace(/\s+/g, " ").trim();
}

/** The form reactions store. emojibase 16 wrote a variation selector after
 * characters that are emoji by default (👍 as "👍️"); 18's fully-qualified
 * form drops that selector for those 152 emoji. Strip it so a reaction
 * saved under 16 still matches the same chip from 18. A character that
 * needs the selector to be an emoji (❤️) keeps it. */
export function canonicalEmoji(unicode: string): string {
  return unicode.replace(/(\p{Emoji_Presentation})️/gu, "$1");
}

/** Joins the English and French data by hexcode. Pure. */
export function mergeEmojiData(en: readonly CompactEmojiLike[], fr: readonly CompactEmojiLike[]): CatalogEmoji[] {
  const french = new Map(fr.map((entry) => [entry.hexcode, entry]));
  const out: CatalogEmoji[] = [];
  for (const entry of en) {
    if (entry.group === undefined || entry.group === 2) continue;
    const other = french.get(entry.hexcode);
    const words = plainWords([entry.label, ...(entry.tags ?? []), other?.label ?? "", ...(other?.tags ?? [])].join(" "));
    out.push({
      emoji: canonicalEmoji(entry.unicode),
      en: entry.label,
      fr: other?.label ?? entry.label,
      words,
      group: entry.group,
      order: entry.order ?? Number.MAX_SAFE_INTEGER,
    });
  }
  return out.sort((left, right) => left.order - right.order);
}

/** Entries whose words start with every word of the query: label hits
 * first, then the rest, in catalogue order. An emoji typed or pasted as
 * the query finds itself. Pure. */
export function searchCatalog(catalog: readonly CatalogEmoji[], query: string, limit = 160): CatalogEmoji[] {
  const raw = query.trim();
  const terms = plainWords(raw).split(" ").filter(Boolean);
  if (!terms.length) return [];
  const exact: CatalogEmoji[] = [];
  const labelHits: CatalogEmoji[] = [];
  const tagHits: CatalogEmoji[] = [];
  const pasted = canonicalEmoji(raw);
  for (const entry of catalog) {
    if (entry.emoji === pasted) { exact.push(entry); continue; }
    const words = entry.words.split(" ");
    if (!terms.every((term) => words.some((word) => word.startsWith(term)))) continue;
    const label = plainWords(`${entry.en} ${entry.fr}`).split(" ");
    (terms.every((term) => label.some((word) => word.startsWith(term))) ? labelHits : tagHits).push(entry);
  }
  return [...exact, ...labelHits, ...tagHits].slice(0, limit);
}

let loading: Promise<readonly CatalogEmoji[]> | null = null;
let loaded: readonly CatalogEmoji[] | null = null;

/** The catalogue once it has loaded, else null (nothing is started). */
export function emojiCatalogNow(): readonly CatalogEmoji[] | null {
  return loaded;
}

/** Load the catalogue (once; later calls share the same promise). A failed
 * load can be retried by the next picker that opens. */
export function loadEmojiCatalog(): Promise<readonly CatalogEmoji[]> {
  if (loaded) return Promise.resolve(loaded);
  if (!loading) {
    loading = Promise.all([
      import("emojibase-data/en/compact.json"),
      import("emojibase-data/fr/compact.json"),
    ]).then(([en, fr]) => {
      loaded = mergeEmojiData(en.default as CompactEmojiLike[], fr.default as CompactEmojiLike[]);
      return loaded;
    }).catch((error: unknown) => {
      loading = null;
      throw error;
    });
  }
  return loading;
}
