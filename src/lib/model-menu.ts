// The model list shared by the composer's model menu and the model window
// (ModelMenu.tsx): rows grouped in sections, a search that filters as one
// types, and the arrow keys over what is left. Pure, so the rules are tested
// without a DOM.

export type ModelMenuRowKind = "auto" | "follow" | "model";

export interface ModelMenuRow {
  /** Unique in the list. */
  key: string;
  kind: ModelMenuRowKind;
  instanceId?: string;
  modelId?: string;
  /** The model's name, in primary ink. */
  label: string;
  /** Its effort, variant or origin, in secondary ink. */
  detail?: string;
  /** A quiet second line under the name (who shares a local model, its server
   * when two share a name). It wraps, never truncates. */
  subtext?: string;
  /** Short markers after the detail (Default, Loaded, the bot's model). */
  tags?: string[];
  /** The choice in effect: checked. */
  current: boolean;
  /** Why it cannot be picked: shown dimmed with this as a tooltip. */
  unavailable?: string;
  /** The tooltip otherwise: the whole name and detail, which a narrow menu
   * truncates. */
  title?: string;
  /** More words the search matches (the engine's name, the model id). */
  keywords?: string;
  /** The model in use cannot run a turn now (src/lib/model-health.ts):
   * said beside it, discreetly. */
  warning?: string;
}

export interface ModelMenuSection {
  key: string;
  /** The heading (an engine, Cloud, Local); none for the top rows. */
  label?: string;
  /** A muted note beside the heading (an engine's state, or Account / API). */
  note?: string;
  /** #2106: subscription login vs pasted API key, for grouping and tags. */
  access?: "subscription" | "api";
  /** #2106: sign-in family key used to unify several accounts into one section. */
  family?: string;
  rows: ModelMenuRow[];
}

/** Lower case, accents dropped: "élevé" matches "eleve". */
export function foldSearch(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** Every word of the query must appear in the row's name, detail, tags,
 * keywords or its section's heading. An empty query keeps everything;
 * sections left without rows are dropped. */
export function filterModelSections(sections: readonly ModelMenuSection[], query: string): ModelMenuSection[] {
  const words = foldSearch(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return sections.filter((section) => section.rows.length > 0);
  return sections.flatMap((section) => {
    const rows = section.rows.filter((row) => {
      const haystack = foldSearch([section.label, row.label, row.detail, row.subtext, ...(row.tags ?? []), row.keywords, row.modelId].filter(Boolean).join(" "));
      return words.every((word) => haystack.includes(word));
    });
    return rows.length > 0 ? [{ ...section, rows }] : [];
  });
}

/** The rows the arrow keys and Enter reach, in order. */
export function pickableRows(sections: readonly ModelMenuSection[]): ModelMenuRow[] {
  return sections.flatMap((section) => section.rows.filter((row) => !row.unavailable));
}

/** The row Enter picks: the one the person moved to, else the first match
 * while searching, else the current choice, else the first row. */
export function activeRowKey(rows: readonly Pick<ModelMenuRow, "key" | "current">[], moved: string | null, searching: boolean): string | null {
  if (moved && rows.some((row) => row.key === moved)) return moved;
  if (!searching) {
    const current = rows.find((row) => row.current);
    if (current) return current.key;
  }
  return rows[0]?.key ?? null;
}

/** One step of the arrow keys, wrapping at both ends. */
export function stepRow(rows: readonly Pick<ModelMenuRow, "key">[], from: string | null, key: "ArrowDown" | "ArrowUp" | "Home" | "End"): string | null {
  if (rows.length === 0) return null;
  const at = rows.findIndex((row) => row.key === from);
  const next = key === "Home" ? 0
    : key === "End" ? rows.length - 1
    : key === "ArrowDown" ? (at + 1) % rows.length
    : (at <= 0 ? rows.length : at) - 1;
  return rows[next]!.key;
}

// The composer's menu (2026-10-14: "too many models shown"): with an
// empty search the root is short, Auto and the bot's model, the current
// model when neither of them is it, the person's favorites, then one row
// per provider that opens its models in a submenu. A search lists every
// provider's matches flat, as before.

export interface ModelMenuProvider {
  /** `provider:` and the section's key: unique beside the rows' keys. */
  key: string;
  section: ModelMenuSection;
  /** The current model is one of its rows. */
  current: boolean;
}

export interface ModelMenuRoot {
  /** Auto, the bot's model: the section without a heading. */
  top: ModelMenuRow[];
  /** The model in effect when no top row is checked and it is no favorite. */
  current?: ModelMenuRow;
  /** The starred models still offered, in the order they were starred. */
  favorites: ModelMenuRow[];
  providers: ModelMenuProvider[];
}

export const PROVIDER_KEY_PREFIX = "provider:";
/** A favorite's row key in the root, beside the same model in its submenu. */
export const FAVORITE_KEY_PREFIX = "favorite:";
export const CURRENT_KEY_PREFIX = "current:";

/** The root of the composer's menu. The top section is the one without a
 * heading; every other section is a provider. */
export function modelMenuRoot(sections: readonly ModelMenuSection[], favoriteKeys: readonly string[]): ModelMenuRoot {
  const top = sections.filter((section) => !section.label).flatMap((section) => section.rows);
  const engines = sections.filter((section) => section.label && section.rows.length > 0);
  const models = engines.flatMap((section) => section.rows.filter((row) => row.kind === "model"));
  const favorites = favoriteKeys.flatMap((key) => models.filter((row) => row.key === key).slice(0, 1));
  const currentRow = top.some((row) => row.current) ? undefined : models.find((row) => row.current);
  return {
    top,
    current: currentRow && !favoriteKeys.includes(currentRow.key) ? currentRow : undefined,
    favorites,
    providers: engines.map((section) => ({ key: `${PROVIDER_KEY_PREFIX}${section.key}`, section, current: section.rows.some((row) => row.current) })),
  };
}

/** What the arrow keys reach in the root, in order: the rows that can be
 * picked, under the keys the root draws them with, then the providers. */
export function modelMenuRootEntries(root: ModelMenuRoot): Array<{ key: string; current: boolean; row?: ModelMenuRow; provider?: ModelMenuProvider }> {
  const pickable = (row: ModelMenuRow) => !row.unavailable;
  return [
    ...root.top.filter(pickable).map((row) => ({ key: row.key, current: row.current, row })),
    ...(root.current && pickable(root.current) ? [{ key: `${CURRENT_KEY_PREFIX}${root.current.key}`, current: true, row: root.current }] : []),
    ...root.favorites.filter(pickable).map((row) => ({ key: `${FAVORITE_KEY_PREFIX}${row.key}`, current: row.current, row })),
    ...root.providers.map((provider) => ({ key: provider.key, current: false, provider })),
  ];
}

// The providers sit behind one "Provider ›" row (Simple since the maintainer
// 2026-10-14, every mode since 2026-10-18) under Auto, the bot's model
// and the favorites. Opening it lists the providers in place of the root,
// each still opening its own submenu.

/** The "Provider" row's key in the root (named "all models" first). */
export const ALL_MODELS_KEY = "all-models";

export type ModelMenuEntry = { key: string; current: boolean; row?: ModelMenuRow; provider?: ModelMenuProvider; all?: true };

/** The root's entries with the providers grouped: the root rows then one
 * "Provider" entry (when there is any provider), or, once it is open,
 * the providers alone. */
export function groupedModelMenuEntries(root: ModelMenuRoot, allOpen: boolean): ModelMenuEntry[] {
  const entries: ModelMenuEntry[] = modelMenuRootEntries(root);
  const providers = entries.filter((entry) => entry.provider);
  if (allOpen) return providers;
  const rest = entries.filter((entry) => !entry.provider);
  return providers.length > 0
    ? [...rest, { key: ALL_MODELS_KEY, current: false, all: true }]
    : rest;
}
