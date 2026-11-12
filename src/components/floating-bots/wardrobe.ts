// The Appearance gallery's catalog rules, as pure functions (MascotLookEditor.tsx):
// the filter chips, the search, and the shelves a character sits on. They
// read any list shaped like the mascot registry (mascots.tsx) and a lock
// answer per character, so a paid edition or a new family is an entry in
// the registry, not a change here.
//
//   Chips: All, Owned, To unlock (omitted when lockedOf is passed and no
//   listed row is locked), Premium (only while the registry sells one), then
//   one per family the registry uses, in MASCOT_FAMILIES order.
//   Shelves: Yours (unlocked), To unlock (locked by an achievement), Premium
//   (a paid edition not owned yet). The character the bot wears is always
//   unlocked, so it is always on Yours. Locked characters sit on To unlock,
//   greyed (Trombi excepted: out of the gallery until found).
import type { LocaleKey } from "@/locales";

/** The families, in the chip order. */
export const MASCOT_FAMILIES = ["classics", "shapes", "animals"] as const;
export type MascotFamily = (typeof MASCOT_FAMILIES)[number];

export const MASCOT_FAMILY_LABEL = {
  classics: "appearance.family.classics",
  shapes: "appearance.family.shapes",
  animals: "appearance.family.animals",
} satisfies Record<MascotFamily, LocaleKey>;

/** What the gallery needs of a registry entry. */
export interface WardrobeEntry<Id extends string = string> {
  id: Id;
  family: MascotFamily;
  premium?: { price: string };
  isNew?: boolean;
}

export type WardrobeFilter = "all" | "owned" | "locked" | "premium" | `family:${MascotFamily}`;

export type WardrobeShelf = "yours" | "locked" | "premium";

/** The chips the gallery offers for these entries. */
export function wardrobeFilters(entries: readonly WardrobeEntry[], lockedOf?: (entry: WardrobeEntry) => boolean): WardrobeFilter[] {
  const families = MASCOT_FAMILIES.filter((family) => entries.some((entry) => entry.family === family));
  const showLocked = lockedOf ? entries.some((entry) => lockedOf(entry)) : true;
  return [
    "all",
    "owned",
    ...(showLocked ? (["locked"] as const) : []),
    ...(entries.some((entry) => entry.premium) ? (["premium"] as const) : []),
    ...families.map((family) => `family:${family}` as const),
  ];
}

/** The shelf an entry sits on: a paid edition not owned is Premium, any other locked one To unlock. */
export function wardrobeShelf(entry: WardrobeEntry, locked: boolean): WardrobeShelf {
  if (!locked) return "yours";
  return entry.premium ? "premium" : "locked";
}

/** The entries a chip keeps, in registry order. */
export function filterWardrobe<E extends WardrobeEntry>(entries: readonly E[], filter: WardrobeFilter, lockedOf: (entry: E) => boolean): E[] {
  return entries.filter((entry) => {
    const shelf = wardrobeShelf(entry, lockedOf(entry));
    return filter === "all" ? true
      : filter === "owned" ? shelf === "yours"
        : filter === "locked" ? shelf === "locked"
          : filter === "premium" ? Boolean(entry.premium)
            : entry.family === filter.slice("family:".length);
  });
}

/** The entries by shelf, each in registry order; an empty shelf is not drawn. */
export function wardrobeShelves<E extends WardrobeEntry>(entries: readonly E[], lockedOf: (entry: E) => boolean): { shelf: WardrobeShelf; entries: E[] }[] {
  const order: WardrobeShelf[] = ["yours", "locked", "premium"];
  return order
    .map((shelf) => ({ shelf, entries: entries.filter((entry) => wardrobeShelf(entry, lockedOf(entry)) === shelf) }))
    .filter((group) => group.entries.length > 0);
}

/**
 * Arrow keys across the tiles, read as rows of `columns`: left and right
 * step one tile, up and down one row (staying put at an edge), Home and End
 * jump to the ends. Null for any other key.
 */
export function wardrobeStep(index: number, count: number, columns: number, key: string): number | null {
  if (count === 0) return null;
  const last = count - 1;
  const across = Math.max(1, columns);
  if (key === "ArrowRight") return Math.min(index + 1, last);
  if (key === "ArrowLeft") return Math.max(index - 1, 0);
  if (key === "ArrowDown") return index + across <= last ? index + across : index;
  if (key === "ArrowUp") return index - across >= 0 ? index - across : index;
  if (key === "Home") return 0;
  if (key === "End") return last;
  return null;
}
